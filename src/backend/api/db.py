"""SQLite persistence for lesion reports (Phase A — decision 5B).

Why SQLite (not Postgres / Redis):
  - Single-server deployment, low write rate (~1 report / 5s)
  - Zero ops overhead — file-based, no daemon
  - Sufficient for thesis / pilot stage; swap to Postgres later if multi-tenant

Why sync sqlite3 (not aiosqlite) here:
  - One INSERT per ~5 seconds — blocking the event loop for ~1ms is invisible
  - Avoids adding aiosqlite dep just for save_lesion_report
  - If write contention ever shows up, switch to asyncio.to_thread()

Schema in this module is INTENTIONALLY minimal (lesion_reports only).
Sessions / detections / qa_messages tables are deferred to Phase B —
no point creating empty tables for Phase A; YAGNI applies.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Optional

from loguru import logger

# DB lives next to other persistent data (uploads, library) — keeps the
# server self-contained for backup/move purposes. Override with ENDOSCOPY_DB_PATH
# for deployments that keep the database on a separate volume.
_DB_PATH = Path(os.getenv("ENDOSCOPY_DB_PATH", str(Path(__file__).parent / "data" / "endoscopy.db")))

_LESION_REPORTS_DDL = """
CREATE TABLE IF NOT EXISTS lesion_reports (
    session_id    TEXT NOT NULL,
    frame_index   INTEGER NOT NULL,
    report_json   TEXT NOT NULL,
    generated_at  INTEGER NOT NULL,   -- unix epoch ms
    model         TEXT,                -- e.g. 'qwen2.5vl:7b' | 'gpt-4o'
    label         TEXT,                -- detected lesion label (denormalized for query convenience)
    severity      TEXT,                -- thấp / trung bình / cao (denormalized for filtering)
    PRIMARY KEY (session_id, frame_index)
)
"""

_INDEX_DDL = "CREATE INDEX IF NOT EXISTS idx_lesion_session ON lesion_reports(session_id)"

# Phase D — "Báo sai" persistent false-positive store.
# Bbox stored as full-frame normalized to 1920×1080 so cross-session match
# works regardless of original source resolution (same as DETECTION_FOUND payload).
# IoU-based match at query time, no spatial index needed at <10k rows.
_FALSE_POSITIVES_DDL = """
CREATE TABLE IF NOT EXISTS false_positives (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    label              TEXT NOT NULL,
    bbox_x1            REAL NOT NULL,
    bbox_y1            REAL NOT NULL,
    bbox_x2            REAL NOT NULL,
    bbox_y2            REAL NOT NULL,
    reported_at        INTEGER NOT NULL,    -- unix epoch ms
    session_id_source  TEXT,                 -- which session originally reported it
    frame_b64          TEXT                  -- cropped thumbnail for analytics review (v2)
)
"""

_FP_LABEL_INDEX_DDL = "CREATE INDEX IF NOT EXISTS idx_fp_label ON false_positives(label)"

# Idempotent migration: ALTER TABLE ADD COLUMN succeeds only the first time;
# subsequent calls raise OperationalError "duplicate column" which we swallow.
# Lets older deployments pick up the frame_b64 column without a manual migration.
_FP_ADD_FRAME_B64 = "ALTER TABLE false_positives ADD COLUMN frame_b64 TEXT"

# Phase 02 — "Xác nhận luôn" persistent confirmed-lesion store. Same shape as
# false_positives but opposite intent: a matching detection on a later run is
# NOT paused — it is silently captured to the side panel. bbox normalized to
# 1920×1080 so cross-run IoU match works regardless of source resolution.
_CONFIRMED_LESIONS_DDL = """
CREATE TABLE IF NOT EXISTS confirmed_lesions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    label              TEXT NOT NULL,
    bbox_x1            REAL NOT NULL,
    bbox_y1            REAL NOT NULL,
    bbox_x2            REAL NOT NULL,
    bbox_y2            REAL NOT NULL,
    reported_at        INTEGER NOT NULL,    -- unix epoch ms
    session_id_source  TEXT,                 -- run that first confirmed it
    frame_b64          TEXT                  -- cropped thumbnail for review
)
"""

_CL_LABEL_INDEX_DDL = "CREATE INDEX IF NOT EXISTS idx_cl_label ON confirmed_lesions(label)"

# Phase B — session summary table. One row per session (UPSERT on re-summary
# from EOS re-trigger). Stores the full SESSION_SUMMARY_SCHEMA JSON so the
# frontend's summary panel can render without re-querying the LLM.
_SESSION_SUMMARIES_DDL = """
CREATE TABLE IF NOT EXISTS session_summaries (
    session_id    TEXT PRIMARY KEY,
    summary_json  TEXT NOT NULL,
    generated_at  INTEGER NOT NULL,   -- unix epoch ms
    model         TEXT
)
"""

# Phase B — Q&A chat history per session. (session_id, sequence) ordered by
# sequence to replay the conversation. Role enum: user | assistant.
# No deletion API at this layer — kept append-only so we can later analyze
# what doctors actually ask.
_QA_MESSAGES_DDL = """
CREATE TABLE IF NOT EXISTS qa_messages (
    session_id    TEXT NOT NULL,
    sequence      INTEGER NOT NULL,
    role          TEXT NOT NULL,       -- user | assistant
    content       TEXT NOT NULL,
    created_at    INTEGER NOT NULL,   -- unix epoch ms
    PRIMARY KEY (session_id, sequence)
)
"""

_QA_SESSION_INDEX_DDL = "CREATE INDEX IF NOT EXISTS idx_qa_session ON qa_messages(session_id)"


def _connect() -> sqlite3.Connection:
    """Open a fresh connection. Caller must close. Each call sets pragmas
    that matter for our access pattern (WAL = better concurrent reads)."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create all Phase A + Phase B + Phase D tables if missing. Safe to call repeatedly."""
    try:
        with _connect() as conn:
            conn.execute(_LESION_REPORTS_DDL)
            conn.execute(_INDEX_DDL)
            conn.execute(_FALSE_POSITIVES_DDL)
            conn.execute(_FP_LABEL_INDEX_DDL)
            # v2 migration: add frame_b64 column to existing FP tables.
            # Already-exists raises OperationalError — swallow it.
            try:
                conn.execute(_FP_ADD_FRAME_B64)
            except sqlite3.OperationalError:
                pass
            conn.execute(_CONFIRMED_LESIONS_DDL)
            conn.execute(_CL_LABEL_INDEX_DDL)
            conn.execute(_SESSION_SUMMARIES_DDL)
            conn.execute(_QA_MESSAGES_DDL)
            conn.execute(_QA_SESSION_INDEX_DDL)
        logger.info("SQLite DB ready at {}", _DB_PATH)
    except sqlite3.Error as e:
        logger.error("init_db failed: {}", e)


# ── Durability: backup + self-heal so report history is never lost ────────────

_BACKUP_DIR = Path(os.getenv("ENDOSCOPY_DB_BACKUP_DIR", str(_DB_PATH.parent / "backups")))


def _row_count(conn: sqlite3.Connection) -> int:
    """Total persisted rows that represent session history (reports + summaries)."""
    try:
        r = conn.execute("SELECT COUNT(*) FROM lesion_reports").fetchone()[0]
        s = conn.execute("SELECT COUNT(*) FROM session_summaries").fetchone()[0]
        return int(r) + int(s)
    except sqlite3.Error:
        return 0


def restore_db_if_empty() -> bool:
    """If the live DB has no session history but a non-empty backup exists,
    restore the newest backup. Self-heals an accidental wipe of the live file.
    MUST run at startup BEFORE any writes. Returns True if a restore happened."""
    try:
        with _connect() as conn:
            if _row_count(conn) > 0:
                return False
        if not _BACKUP_DIR.exists():
            return False
        for bak in sorted(_BACKUP_DIR.glob("endoscopy-*.db"), reverse=True):
            try:
                with sqlite3.connect(bak) as src:
                    if _row_count(src) <= 0:
                        continue
                # Live DB is empty; restore this non-empty backup over it.
                with sqlite3.connect(bak) as src, _connect() as dst:
                    src.backup(dst)
                logger.warning("DB was empty — restored history from backup {}", bak.name)
                return True
            except sqlite3.Error:
                continue
        return False
    except Exception as e:  # pragma: no cover - best effort
        logger.error("restore_db_if_empty failed: {}", e)
        return False


def backup_db(keep: int = int(os.getenv("ENDOSCOPY_DB_BACKUP_KEEP", "15"))) -> Optional[Path]:
    """Snapshot the DB to data/backups/ (WAL-safe online backup) so report
    history survives an accidental wipe of the live file. Skips empty DBs so we
    don't evict good snapshots. Keeps the newest `keep` backups. The backups dir
    lives under data/ which is excluded from rsync — it stays on the server."""
    try:
        if not _DB_PATH.exists():
            return None
        with _connect() as conn:
            if _row_count(conn) <= 0:
                return None
        _BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        dest = _BACKUP_DIR / f"endoscopy-{stamp}.db"
        with _connect() as src, sqlite3.connect(dest) as dst:
            src.backup(dst)
        backups = sorted(_BACKUP_DIR.glob("endoscopy-*.db"))
        for old in backups[:-keep]:
            old.unlink(missing_ok=True)
        logger.info("DB backup written: {}", dest.name)
        return dest
    except Exception as e:  # pragma: no cover - best effort
        logger.error("backup_db failed: {}", e)
        return None


def save_lesion_report(session_id: str, frame_index: int, report: dict,
                       model: str, generated_at_ms: int) -> bool:
    """Persist one structured lesion report. Returns True on success.

    Uses INSERT OR REPLACE on the (session_id, frame_index) primary key —
    if the same detection is re-explained, the latest report wins. That's
    the right behavior since 'Giải thích lại' should overwrite, not append.
    """
    try:
        label = report.get("conclusion", {}).get("primary_dx", "")[:200]
        severity = report.get("conclusion", {}).get("severity", "")
        with _connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO lesion_reports
                   (session_id, frame_index, report_json, generated_at, model, label, severity)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (session_id, frame_index, json.dumps(report, ensure_ascii=False),
                 generated_at_ms, model, label, severity),
            )
        return True
    except sqlite3.Error as e:
        logger.error("save_lesion_report failed (session={}, frame={}): {}",
                     session_id, frame_index, e)
        return False


def get_lesion_reports_for_session(session_id: str) -> list[dict]:
    """Fetch all reports for a session, ordered by frame_index. Returns list
    of dicts with keys: frame_index, report (parsed JSON), generated_at, model.

    Used by Phase B session-summary chatbot — reads back all per-detection
    reports to feed into the summary prompt."""
    try:
        with _connect() as conn:
            cur = conn.execute(
                """SELECT frame_index, report_json, generated_at, model, label, severity
                   FROM lesion_reports WHERE session_id = ?
                   ORDER BY frame_index ASC""",
                (session_id,),
            )
            rows = cur.fetchall()
        return [
            {"frame_index": r[0], "report": json.loads(r[1]),
             "generated_at": r[2], "model": r[3],
             "label": r[4], "severity": r[5]}
            for r in rows
        ]
    except sqlite3.Error as e:
        logger.error("get_lesion_reports_for_session failed: {}", e)
        return []


def db_path() -> Path:
    """Exposed for tests / health checks that need the on-disk location."""
    return _DB_PATH


# ── False-positives (Phase D) ────────────────────────────────────────────────

# Canvas dims come from the pipeline (single source of truth); fall back to the
# known 1920×1080 if the pipeline module isn't importable (e.g. standalone use).
try:
    from pipeline_controller import FRAME_W as _PC_FRAME_W, FRAME_H as _PC_FRAME_H
    _FRAME_W, _FRAME_H = float(_PC_FRAME_W), float(_PC_FRAME_H)
except Exception:
    _FRAME_W, _FRAME_H = 1920.0, 1080.0
_MAX_FP_AREA_RATIO = 0.7  # reject near-full-frame bboxes — they cause IoU>=0.6
                          # matches against unrelated future detections (Copilot
                          # high-severity finding, see PR review).


def save_false_positive(label: str, bbox: list[float], session_id_source: str,
                        reported_at_ms: int,
                        frame_b64: Optional[str] = None) -> bool:
    """Persist one false-positive entry. bbox is [x1,y1,x2,y2] normalized to
    1920×1080 (matches DETECTION_FOUND payload). frame_b64 is the cropped
    thumbnail of the reported region (~140px wide) — stored so the analytics
    page can show what the doctor flagged. Returns True on success."""
    if len(bbox) < 4:
        return False
    w = max(0.0, float(bbox[2]) - float(bbox[0]))
    h = max(0.0, float(bbox[3]) - float(bbox[1]))
    area_ratio = (w * h) / (_FRAME_W * _FRAME_H)
    if area_ratio <= 0.0 or area_ratio > _MAX_FP_AREA_RATIO:
        logger.warning(
            "save_false_positive rejected: bbox area ratio {:.2%} exceeds {:.0%} cap "
            "(label={}, bbox={})", area_ratio, _MAX_FP_AREA_RATIO, label, bbox,
        )
        return False
    try:
        with _connect() as conn:
            conn.execute(
                """INSERT INTO false_positives
                   (label, bbox_x1, bbox_y1, bbox_x2, bbox_y2, reported_at,
                    session_id_source, frame_b64)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (label, float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]),
                 reported_at_ms, session_id_source, frame_b64),
            )
        return True
    except sqlite3.Error as e:
        logger.error("save_false_positive failed: {}", e)
        return False


def load_all_false_positives() -> list[dict]:
    """Load every false-positive entry as a list of dicts. Called once per
    WS connect — small table, no pagination needed at this scale."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT label, bbox_x1, bbox_y1, bbox_x2, bbox_y2 FROM false_positives"
            ).fetchall()
        return [
            {"label": r[0], "bbox": [r[1], r[2], r[3], r[4]]}
            for r in rows
        ]
    except sqlite3.Error as e:
        logger.error("load_all_false_positives failed: {}", e)
        return []


def _iou(a: list[float], b: list[float]) -> float:
    """Standard IoU between two [x1,y1,x2,y2] boxes. Defined here to avoid
    importing it into endoscopy_ws_server — keep the DB module self-contained."""
    ix1 = max(a[0], b[0]); iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2]); iy2 = min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def matches_false_positive(label: str, bbox: list[float],
                           false_positives: list[dict],
                           iou_threshold: float = 0.6) -> bool:
    """Check if (label, bbox) matches any entry in the FP list. IoU 0.6 chosen
    as a balance: cross-session videos won't have pixel-perfect repeat, but
    same anatomical region should overlap > 60 % on the normalized 1920×1080
    canvas. Lower than session-local 0.8 because cross-session is fuzzier."""
    for fp in false_positives:
        if fp["label"] == label and _iou(fp["bbox"], bbox) >= iou_threshold:
            return True
    return False


# ── Confirmed-always lesions (Phase 02 — "Xác nhận luôn") ─────────────────────

def save_confirmed_lesion(label: str, bbox: list[float], session_id_source: str,
                          reported_at_ms: int,
                          frame_b64: Optional[str] = None) -> bool:
    """Persist one confirmed-always lesion. bbox is [x1,y1,x2,y2] normalized to
    1920×1080. On a later run, a detection matching (label + IoU) is captured to
    the side panel instead of pausing the video. Same area-ratio guard as FP to
    avoid near-full-frame boxes matching unrelated future detections."""
    if len(bbox) < 4:
        return False
    w = max(0.0, float(bbox[2]) - float(bbox[0]))
    h = max(0.0, float(bbox[3]) - float(bbox[1]))
    area_ratio = (w * h) / (_FRAME_W * _FRAME_H)
    if area_ratio <= 0.0 or area_ratio > _MAX_FP_AREA_RATIO:
        logger.warning(
            "save_confirmed_lesion rejected: bbox area ratio {:.2%} exceeds {:.0%} cap "
            "(label={})", area_ratio, _MAX_FP_AREA_RATIO, label,
        )
        return False
    try:
        with _connect() as conn:
            conn.execute(
                """INSERT INTO confirmed_lesions
                   (label, bbox_x1, bbox_y1, bbox_x2, bbox_y2, reported_at,
                    session_id_source, frame_b64)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (label, float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]),
                 reported_at_ms, session_id_source, frame_b64),
            )
        return True
    except sqlite3.Error as e:
        logger.error("save_confirmed_lesion failed: {}", e)
        return False


def load_all_confirmed_lesions() -> list[dict]:
    """Load every confirmed-always lesion as [{label, bbox}]. Called once per
    WS connect and passed to the worker so 2nd+ runs auto-capture them."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT label, bbox_x1, bbox_y1, bbox_x2, bbox_y2 FROM confirmed_lesions"
            ).fetchall()
        return [{"label": r[0], "bbox": [r[1], r[2], r[3], r[4]]} for r in rows]
    except sqlite3.Error as e:
        logger.error("load_all_confirmed_lesions failed: {}", e)
        return []


def _delete_matching(table: str, label: str, bbox: list[float],
                     iou_threshold: float = 0.5) -> int:
    """Delete rows in `table` whose (label + bbox IoU) match. Used to keep
    confirmed_lesions and false_positives MUTUALLY EXCLUSIVE — the latest doctor
    action wins (reporting a lesion false removes any prior 'confirm always', and
    confirming always removes any prior 'false')."""
    if len(bbox) < 4 or table not in ("confirmed_lesions", "false_positives"):
        return 0
    try:
        with _connect() as conn:
            rows = conn.execute(
                f"SELECT id, bbox_x1, bbox_y1, bbox_x2, bbox_y2 FROM {table} WHERE label = ?",
                (label,),
            ).fetchall()
            ids = [r[0] for r in rows if _iou([r[1], r[2], r[3], r[4]], bbox) >= iou_threshold]
            for _id in ids:
                conn.execute(f"DELETE FROM {table} WHERE id = ?", (_id,))
        return len(ids)
    except sqlite3.Error as e:
        logger.error("_delete_matching({}) failed: {}", table, e)
        return 0


def delete_confirmed_lesions_matching(label: str, bbox: list[float]) -> int:
    """Remove confirmed-always lesions matching (label + IoU). Called on 'Báo sai'."""
    return _delete_matching("confirmed_lesions", label, bbox)


def delete_false_positives_matching(label: str, bbox: list[float]) -> int:
    """Remove false-positives matching (label + IoU). Called on 'Xác nhận luôn'."""
    return _delete_matching("false_positives", label, bbox)


def _clear_table(table: str) -> int:
    """Delete every row from a learned-memory table. Returns rows removed."""
    try:
        with _connect() as conn:
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.execute(f"DELETE FROM {table}")
            conn.commit()
            return int(n)
    except sqlite3.Error as e:
        logger.error("clear {} failed: {}", table, e)
        return 0


def clear_false_positives() -> int:
    """Wipe all 'Báo sai' entries (Settings → reset AI memory)."""
    return _clear_table("false_positives")


def clear_confirmed_lesions() -> int:
    """Wipe all 'Xác nhận luôn' entries (Settings → reset AI memory)."""
    return _clear_table("confirmed_lesions")


def memory_counts() -> dict:
    """Row counts of the learned-memory tables for the Settings/status panel."""
    out = {"false_positives": 0, "confirmed_lesions": 0}
    try:
        with _connect() as conn:
            for t in out:
                out[t] = int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
    except sqlite3.Error as e:
        logger.error("memory_counts failed: {}", e)
    return out


# ── Session history (DB-backed report list) ──────────────────────────────────

def list_all_sessions() -> list[dict]:
    """Aggregate every session that has persisted data (reports and/or a summary)
    so the Report page can list them straight from the DB — durable across
    browser cache clears and origin changes (localStorage is none of those).

    Returns newest-first: [{session_id, started_at(ms), detections:[{frame_index,
    label, severity, report}], summary}]."""
    try:
        with _connect() as conn:
            reps = conn.execute(
                "SELECT session_id, frame_index, report_json, generated_at, label, severity "
                "FROM lesion_reports ORDER BY generated_at ASC"
            ).fetchall()
            sums = conn.execute(
                "SELECT session_id, summary_json, generated_at FROM session_summaries"
            ).fetchall()
    except sqlite3.Error as e:
        logger.error("list_all_sessions failed: {}", e)
        return []

    sessions: dict[str, dict] = {}

    def _slot(sid: str, ts: int) -> dict:
        s = sessions.setdefault(
            sid, {"session_id": sid, "started_at": ts, "detections": [], "summary": None})
        s["started_at"] = min(s["started_at"], ts)
        return s

    for sid, fi, rj, gen, label, sev in reps:
        s = _slot(sid, gen)
        try:
            report = json.loads(rj)
        except (json.JSONDecodeError, TypeError):
            report = None
        s["detections"].append({"frame_index": fi, "label": label,
                                "severity": sev, "report": report})
    for sid, sj, gen in sums:
        s = _slot(sid, gen)
        try:
            s["summary"] = json.loads(sj)
        except (json.JSONDecodeError, TypeError):
            s["summary"] = None

    return sorted(sessions.values(), key=lambda x: x["started_at"], reverse=True)


def delete_session(session_id: str) -> int:
    """Delete every persisted trace of a session (lesion reports, summary, Q&A).
    Returns total rows removed. Backs the DELETE /sessions/{id} trash action on
    the Report page. False-positive / confirmed-lesion memory is intentionally
    left intact (it is cross-session learning, not per-session report data)."""
    total = 0
    try:
        with _connect() as conn:
            for sql in (
                "DELETE FROM lesion_reports WHERE session_id = ?",
                "DELETE FROM session_summaries WHERE session_id = ?",
                "DELETE FROM qa_messages WHERE session_id = ?",
            ):
                cur = conn.execute(sql, (session_id,))
                total += max(cur.rowcount, 0)
            conn.commit()
    except sqlite3.Error as e:
        logger.error("delete_session({}) failed: {}", session_id, e)
    return total


# ── Session summaries (Phase B) ──────────────────────────────────────────────

def save_session_summary(session_id: str, summary: dict, model: str,
                         generated_at_ms: int) -> bool:
    """Persist a session summary. UPSERT — if user re-triggers summary
    generation, latest one wins (we don't keep history of summaries)."""
    try:
        with _connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO session_summaries
                   (session_id, summary_json, generated_at, model)
                   VALUES (?, ?, ?, ?)""",
                (session_id, json.dumps(summary, ensure_ascii=False),
                 generated_at_ms, model),
            )
        return True
    except sqlite3.Error as e:
        logger.error("save_session_summary failed: {}", e)
        return False


def get_session_summary(session_id: str) -> Optional[dict]:
    """Return the parsed summary dict, or None if no summary saved."""
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT summary_json, generated_at, model FROM session_summaries WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "summary": json.loads(row[0]),
            "generated_at": row[1],
            "model": row[2],
        }
    except sqlite3.Error as e:
        logger.error("get_session_summary failed: {}", e)
        return None


# ── Q&A messages (Phase B) ───────────────────────────────────────────────────

def append_qa_message(session_id: str, role: str, content: str,
                      created_at_ms: int) -> int:
    """Append a chat message. Returns the new sequence number, or -1 on error.
    Auto-increments sequence per session — no client-side counter needed."""
    if role not in ("user", "assistant"):
        logger.error("append_qa_message: invalid role {}", role)
        return -1
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM qa_messages WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            next_seq = row[0] if row else 1
            conn.execute(
                """INSERT INTO qa_messages
                   (session_id, sequence, role, content, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (session_id, next_seq, role, content, created_at_ms),
            )
        return next_seq
    except sqlite3.Error as e:
        logger.error("append_qa_message failed: {}", e)
        return -1


def get_qa_history(session_id: str) -> list[dict]:
    """Fetch full chat history for a session, ordered by sequence."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT sequence, role, content, created_at
                   FROM qa_messages WHERE session_id = ?
                   ORDER BY sequence ASC""",
                (session_id,),
            ).fetchall()
        return [
            {"sequence": r[0], "role": r[1], "content": r[2], "created_at": r[3]}
            for r in rows
        ]
    except sqlite3.Error as e:
        logger.error("get_qa_history failed: {}", e)
        return []
