"""endoscopy-ws-server.py — FastAPI WebSocket controller for endoscopy pipeline.

Implements SYSTEM_REQUIREMENTS §2 (FastAPI WebSocket middleware):

  POST /upload                   → receive video file, return video_id
  WebSocket /ws/analysis/{id}    → bidirectional channel between FE and pipeline
  GET  /session/{id}/detections  → fetch confirmed detections for report

WebSocket message contract (§5):
  Server → Client:
    DETECTION_FOUND  { data: { frame_index, timestamp_ms, location, lesion, frame_b64 } }
    STATE_CHANGE     { data: { state } }
    LLM_CHUNK        { data: { chunk } }
    LLM_DONE         { data: {} }
    VIDEO_FINISHED   { data: { detections: [...] } }
    ERROR            { data: { message } }

  Client → Server:
    ACTION_IGNORE    {}
    ACTION_EXPLAIN   {}
    ACTION_RESUME    {}
    ACTION_CONFIRM   {}
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Dict, Optional

from dotenv import load_dotenv
import subprocess
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from openai import AsyncOpenAI
from voice_api import router as voice_router

# ── Path setup ───────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve()

# Load .env before importing logger (LOG_LEVEL may be set there)
load_dotenv(_HERE.parent / ".env")

from logger import logger  # noqa: E402 — must come after load_dotenv
_REPO_ROOT = _HERE.parents[3]

# Support running from arbitrary directory (e.g. GPU server deployment)
# PIPELINE_DIR env var overrides default relative path
_PIPELINE_DIR = Path(os.getenv("PIPELINE_DIR", str(_HERE.parents[1] / "pipeline")))
sys.path.insert(0, str(_PIPELINE_DIR))

from pipeline_controller import PipelineController, PipelineState   # noqa: E402
from video_library import VideoLibrary                               # noqa: E402
from llm_prompts import (                                              # noqa: E402
    LESION_REPORT_SCHEMA,
    LESION_REPORT_PROMPT,
    build_lesion_user_message,
)
from db import (                                                       # noqa: E402
    init_db, save_lesion_report,
    save_false_positive, load_all_false_positives, matches_false_positive,
)

# ── Config ───────────────────────────────────────────────────────────────────
# ENDOSCOPY_UPLOAD_DIR env var overrides default (needed on GPU server)
UPLOAD_DIR = Path(os.getenv("ENDOSCOPY_UPLOAD_DIR", str(_REPO_ROOT / "data" / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

LIBRARY_DIR = Path(os.getenv("ENDOSCOPY_LIBRARY_DIR", str(_REPO_ROOT / "data" / "library")))
LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL_VISION  = os.getenv("OPENAI_MODEL_VISION",  "gpt-4o")
LLM_MODEL_FOLLOWUP = os.getenv("OPENAI_MODEL_FOLLOWUP", "gpt-4o-mini")

# ── LLM backend selector ─────────────────────────────────────────────────────
# LLM_BACKEND=ollama  → use local Ollama at OLLAMA_BASE_URL (default for Phase A+)
# LLM_BACKEND=openai  → use OpenAI SaaS (legacy, requires OPENAI_API_KEY)
# Both backends share the OpenAI Python SDK — only base_url + api_key differ.
LLM_BACKEND     = os.getenv("LLM_BACKEND", "openai").lower()
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "qwen2.5vl:7b")
LLM_SYSTEM_PROMPT = """
Bạn là trợ lý nội soi tiêu hóa chuyên nghiệp, hỗ trợ bác sĩ Việt Nam trong ca nội soi dạ dày.
Nhiệm vụ của bạn là phân tích phát hiện tổn thương từ hình ảnh nội soi và đưa ra nhận định lâm sàng.

## Hệ thống phân loại Paris (bắt buộc áp dụng)

Phân loại tổn thương dạng polypoid và không polypoid theo Paris Classification:

**Dạng polypoid (nhô cao):**
- 0-Ip (cuống): Tổn thương có cuống rõ ràng, phần đầu to hơn thân
- 0-Is (không cuống): Tổn thương nhô cao, đáy rộng, không có cuống

**Dạng phẳng/không polypoid:**
- 0-IIa (nhô thấp): Nhô cao < 2.5mm, bờ rõ
- 0-IIb (phẳng hoàn toàn): Không nhô, không lõm — khó nhận biết, thường thay đổi màu sắc
- 0-IIc (lõm nông): Lõm nhẹ < 1.2mm, bờ không đều
- 0-IIa+IIc (kết hợp): Phần nhô thấp kết hợp lõm nông — nguy cơ xâm lấn cao

**Dạng lõm sâu:**
- 0-III (loét): Lõm sâu > 1.2mm, thường có bờ fibrin, nguy cơ ác tính cao nếu bờ cứng/gồ

**Đặc điểm phân biệt lành/ác tính:**
- Lành tính: bề mặt trơn láng, màu sắc đều, bờ rõ, mềm khi sinh thiết
- Tiền ung thư / nghi ngờ: bề mặt gồ ghề, màu đỏ/trắng không đều, bờ không rõ
- Ác tính: cứng, hoại tử, chảy máu tự phát, xâm lấn rõ

## Hướng dẫn phân loại H. pylori

- HP-negative gastritis: Niêm mạc bình thường hoặc viêm nhẹ, không có tổn thương đặc trưng
- HP-positive gastritis: Viêm xung huyết, nốt lymphoid, vết trợt nông
- Gastric cancer: Tổn thương bất thường, phân loại Paris phù hợp 0-IIc, 0-IIa+IIc hoặc 0-III

## Format phản hồi (bắt buộc)

Luôn trả lời bằng tiếng Việt với cấu trúc sau:

**Phân loại Paris:** [Loại cụ thể] — [mô tả đặc điểm hình thái quan sát được: màu sắc, bờ viền, kích thước ước tính]

**Nhận định lâm sàng:** [Đánh giá nguy cơ: lành tính / tiền ung thư / nghi ngờ ác tính] — [lý do ngắn gọn dựa trên đặc điểm quan sát]

**Checklist hành động:**
- [ ] [Bước 1 — cụ thể, có thể thực hiện ngay]
- [ ] [Bước 2]
- [ ] [Bước 3]
- [ ] [Bước 4 — nếu cần]
- [ ] [Bước 5 — nếu cần]

Ngắn gọn, chính xác, ưu tiên an toàn bệnh nhân. Không thêm phần giới thiệu hay kết luận.
"""

# ── GStreamer DOT graph — generated once at startup ───────────────────────────

_DOT_DIR = Path(os.getenv("GST_DEBUG_DUMP_DOT_DIR", "/tmp/gst-dot"))
_DOT_FILE = _DOT_DIR / "endoscopy_pipeline.dot"


def _generate_pipeline_dot() -> None:
    """Build the canonical file-source pipeline, dump its DOT topology, then destroy it.
    The topology is static (independent of video), so we only need to do this once."""
    try:
        import gi
        gi.require_version("Gst", "1.0")
        from gi.repository import Gst
        Gst.init(None)

        # Representative pipeline string (file source, CPU decoder)
        pipeline_str = (
            "filesrc location=/dev/null"
            " ! qtdemux"
            " ! h264parse"
            " ! avdec_h264"
            " ! videoconvert"
            " ! queue max-size-buffers=4 leaky=downstream"
            " ! appsink name=sink sync=false"
        )
        pipe = Gst.parse_launch(pipeline_str)
        _DOT_DIR.mkdir(parents=True, exist_ok=True)
        dot_data = Gst.debug_bin_to_dot_data(pipe, Gst.DebugGraphDetails.ALL)
        _DOT_FILE.write_text(dot_data)
        pipe.set_state(Gst.State.NULL)
        logger.info("Pipeline DOT graph written → {}", _DOT_FILE)
    except Exception as exc:
        logger.warning("Could not generate pipeline DOT: {}", exc)


_generate_pipeline_dot()


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Endoscopy AI WebSocket Server",
    description="Real-time GStreamer + YOLO + LLM pipeline controller",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(voice_router)

# Phase A persistence — initialize SQLite on app startup so that the very
# first lesion report can be saved without a cold-start race. init_db is
# idempotent (CREATE IF NOT EXISTS).
init_db()

# ── In-memory session registry ───────────────────────────────────────────────
# video_id → { controller, video_path, confirmed_detections, library_id }
_sessions: Dict[str, dict] = {}

_library = VideoLibrary(LIBRARY_DIR)

_llm_client: Optional[AsyncOpenAI] = None


def _get_llm_client() -> Optional[AsyncOpenAI]:
    """Return a singleton AsyncOpenAI-compatible client for the active backend.

    LLM_BACKEND=ollama → Ollama local (no API key needed)
    LLM_BACKEND=openai → OpenAI SaaS (requires OPENAI_API_KEY)

    Both expose identical chat.completions.create() interface; the call sites
    only need to pick the right model name via _llm_model_name().
    """
    global _llm_client
    if _llm_client is not None:
        return _llm_client
    if LLM_BACKEND == "ollama":
        # Any non-empty api_key works for Ollama's openai-compat endpoint
        _llm_client = AsyncOpenAI(api_key="ollama", base_url=OLLAMA_BASE_URL)
        logger.info("LLM backend: ollama @ {} (model={})", OLLAMA_BASE_URL, OLLAMA_MODEL)
    elif OPENAI_API_KEY:
        _llm_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        logger.info("LLM backend: openai (vision={}, followup={})",
                    LLM_MODEL_VISION, LLM_MODEL_FOLLOWUP)
    return _llm_client


def _llm_model_name(role: str = "vision") -> str:
    """Return the model name appropriate for the active backend.

    role="vision"   → primary detection report / image analysis
    role="followup" → text-only Q&A (cheaper on OpenAI; same model on Ollama)
    """
    if LLM_BACKEND == "ollama":
        return OLLAMA_MODEL
    return LLM_MODEL_VISION if role == "vision" else LLM_MODEL_FOLLOWUP


# Backward-compat shim: legacy code paths still call _get_openai()
_get_openai = _get_llm_client


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "active_sessions": len(_sessions)}


@app.get("/pipeline/metrics")
async def get_pipeline_metrics():
    """Parse GstShark CSV logs and return per-element performance metrics."""
    from pipeline_controller import _GSTSHARK_ENABLED, _GSTSHARK_LOG_DIR
    if not _GSTSHARK_ENABLED:
        return {"enabled": False}

    log_dir = Path(_GSTSHARK_LOG_DIR)

    def _parse_tsv(filename: str) -> list[list[str]]:
        p = log_dir / filename
        if not p.exists():
            return []
        rows = []
        for line in p.read_text().splitlines():
            parts = line.strip().split("\t")
            if len(parts) >= 3:
                rows.append(parts)
        return rows

    # framerate: timestamp_ns \t element \t fps
    fps_rows = _parse_tsv("framerate.log")
    fps_by_elem: dict[str, list[float]] = {}
    for row in fps_rows:
        elem, val = row[1], float(row[2])
        fps_by_elem.setdefault(elem, []).append(val)
    framerate = [{"element": k, "avg_fps": round(sum(v) / len(v), 2), "min_fps": round(min(v), 2)}
                 for k, v in fps_by_elem.items()]

    # proctime: timestamp_ns \t element \t time_ns
    pt_rows = _parse_tsv("proctime.log")
    pt_by_elem: dict[str, list[float]] = {}
    for row in pt_rows:
        elem, ns = row[1], float(row[2])
        pt_by_elem.setdefault(elem, []).append(ns / 1_000_000)  # → ms
    proctime = [{"element": k, "avg_ms": round(sum(v) / len(v), 3), "max_ms": round(max(v), 3)}
                for k, v in pt_by_elem.items()]

    # interlatency: timestamp_ns \t from_pad \t to_pad \t time_ns
    il_rows = _parse_tsv("interlatency.log")
    il_pairs: dict[str, list[float]] = {}
    for row in il_rows:
        if len(row) < 4:
            continue
        key = f"{row[1]} → {row[2]}"
        il_pairs.setdefault(key, []).append(float(row[3]) / 1_000_000)
    interlatency = [{"path": k, "avg_ms": round(sum(v) / len(v), 3)}
                    for k, v in il_pairs.items()]

    return {"enabled": True, "framerate": framerate, "proctime": proctime, "interlatency": interlatency}


@app.get("/pipeline/graph")
async def get_pipeline_graph():
    """Return the GStreamer pipeline topology as SVG."""
    if not _DOT_FILE.exists():
        raise HTTPException(status_code=404, detail="Pipeline DOT not available")
    try:
        result = subprocess.run(
            ["dot", "-Tsvg", str(_DOT_FILE)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"dot error: {result.stderr[:200]}")
        return Response(content=result.stdout, media_type="image/svg+xml")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="graphviz 'dot' not found on server")


@app.post("/upload")
async def upload_video(request: Request, filename: str = "video.mp4"):
    """Accept raw binary video body and return a session video_id.

    Client sends Content-Type: application/octet-stream with filename as query param.
    Avoids python-multipart size limits that affect large video files.
    """
    ext = Path(filename).suffix or ".mp4"
    video_id = uuid.uuid4().hex[:12]
    dest = UPLOAD_DIR / f"{video_id}{ext}"

    size = 0
    with dest.open("wb") as f:
        async for chunk in request.stream():
            f.write(chunk)
            size += len(chunk)

    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty file received")

    _sessions[video_id] = {
        "controller": None,
        "video_path": dest,
        "confirmed_detections": [],
        "library_id": None,
        "conv_history": [],
        "llm_cache": {},
    }
    logger.info("Video uploaded: {} ({:.1f} MB) → session {}", filename, size / 1_048_576, video_id)
    return {"video_id": video_id, "filename": filename, "size_bytes": size}


@app.post("/stream/connect")
async def connect_stream(request: Request):
    """Register a live source (RTSP URL or V4L2 device) and return a session video_id."""
    body = await request.json()
    source = body.get("source", "").strip()
    if not source:
        raise HTTPException(status_code=400, detail="'source' field is required")

    video_id = uuid.uuid4().hex[:12]
    _sessions[video_id] = {
        "controller": None,
        "video_path": source,   # GStreamer will receive this as the source URI
        "confirmed_detections": [],
        "library_id": None,
        "conv_history": [],
        "llm_cache": {},
    }
    logger.info("Live stream registered: {} → session {}", source, video_id)
    return {"video_id": video_id, "source": source}


@app.get("/library")
async def list_library():
    """Return all library videos (public fields, newest first)."""
    return {"videos": _library.list_videos()}


@app.post("/library/upload")
async def upload_to_library(request: Request, filename: str = "video.mp4"):
    """Upload a video and persist it to the permanent library.

    Checks for duplicates via SHA-256(first 4 MB) + size_bytes before writing.
    Returns duplicate:true and the existing entry if the file is already stored.
    """
    from video_library import _ALLOWED_EXTENSIONS
    import errno as _errno

    ext = Path(filename).suffix.lower() or ".mp4"
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported format. Allowed: {', '.join(_ALLOWED_EXTENSIONS)}")

    # Stream body to a temp file first so we can hash it without holding it all in RAM
    tmp_id = uuid.uuid4().hex[:12]
    tmp_path = LIBRARY_DIR / f".tmp_{tmp_id}{ext}"
    size = 0
    try:
        with tmp_path.open("wb") as f:
            async for chunk in request.stream():
                f.write(chunk)
                size += len(chunk)
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        if exc.errno == _errno.ENOSPC:
            raise HTTPException(status_code=507, detail="Insufficient server storage")
        raise

    if size == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty file received")

    sha256_prefix = _library.compute_sha256_prefix(tmp_path)
    existing = _library.find_duplicate(sha256_prefix, size)

    if existing:
        tmp_path.unlink(missing_ok=True)
        logger.info("Library duplicate detected: {} → {}", filename, existing["library_id"])
        return {**{k: existing[k] for k in ("library_id", "filename", "size_bytes", "uploaded_at")}, "duplicate": True}

    library_id = uuid.uuid4().hex[:12]
    dest = LIBRARY_DIR / f"{library_id}{ext}"
    tmp_path.rename(dest)

    entry = {
        "library_id": library_id,
        "filename": filename,
        "size_bytes": size,
        "uploaded_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "sha256_prefix": sha256_prefix,
        "path": str(dest),
    }
    _library.add_entry(entry)
    return {k: entry[k] for k in ("library_id", "filename", "size_bytes", "uploaded_at")} | {"duplicate": False}


@app.post("/sessions/from-library/{library_id}")
async def session_from_library(library_id: str):
    """Create an analysis session from an existing library video (no upload needed)."""
    entries = _library.load_index()
    entry = next((e for e in entries if e.get("library_id") == library_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Library video not found")

    video_id = uuid.uuid4().hex[:12]
    _sessions[video_id] = {
        "controller": None,
        "video_path": Path(entry["path"]),
        "confirmed_detections": [],
        "library_id": library_id,
        "conv_history": [],
        "llm_cache": {},
    }
    logger.info("Session from library: library_id={} → video_id={}", library_id, video_id)
    return {"video_id": video_id, "library_id": library_id, "filename": entry["filename"]}


@app.delete("/library/{library_id}")
async def delete_library_video(library_id: str):
    """Permanently delete a library video. Blocked if any active session holds it."""
    entries = _library.load_index()
    entry = next((e for e in entries if e.get("library_id") == library_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Library video not found")

    # Block deletion only if a pipeline is actively running against this library video.
    # Sessions linger in _sessions after WS closes, so checking just library_id membership
    # would permanently block deletion after the first use.
    def _session_active(s: dict) -> bool:
        ctrl = s.get("controller")
        return (
            s.get("library_id") == library_id and
            ctrl is not None and
            ctrl._proc is not None and
            ctrl._proc.is_alive()
        )
    if any(_session_active(s) for s in _sessions.values()):
        raise HTTPException(status_code=409, detail="Video đang được sử dụng, không thể xóa")

    _library.remove_entry(library_id)
    file_path = Path(entry["path"])
    file_path.unlink(missing_ok=True)
    logger.info("Library video deleted: {}", library_id)
    return {"deleted": True, "library_id": library_id}


@app.get("/session/{video_id}/detections")
async def get_detections(video_id: str):
    """Return confirmed detections for the report page."""
    sess = _sessions.get(video_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    ctrl: Optional[PipelineController] = sess["controller"]
    detections = ctrl._confirmed if ctrl else sess["confirmed_detections"]
    return {"video_id": video_id, "detections": detections}


@app.get("/session/{video_id}/video")
async def stream_session_video(video_id: str):
    """Stream the session's video file for browser preview (supports Range requests).

    Used by the frontend to play library videos in the <video> element without
    requiring a local copy of the file.
    """
    from fastapi.responses import FileResponse
    sess = _sessions.get(video_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    video_path = sess.get("video_path")
    if not video_path or not isinstance(video_path, Path) or not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")
    suffix = video_path.suffix.lower()
    media_type = {
        ".mp4": "video/mp4", ".mov": "video/quicktime",
        ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
    }.get(suffix, "video/mp4")
    return FileResponse(str(video_path), media_type=media_type)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws/analysis/{video_id}")
async def ws_analysis(websocket: WebSocket, video_id: str):
    """Bidirectional WebSocket between React FE and GStreamer pipeline controller."""
    await websocket.accept()

    sess = _sessions.get(video_id)
    if not sess:
        await websocket.send_json({"event": "ERROR", "data": {"message": "Session not found"}})
        await websocket.close()
        return

    # Create and start pipeline controller
    logger.info("WS connected: session {}", video_id)
    ctrl = PipelineController(video_id=video_id)
    sess["controller"] = ctrl
    ctrl.set_loop(asyncio.get_running_loop())
    ctrl.start(sess["video_path"])

    # Phase D: load persistent false-positive list ONCE per session. Auto-skip
    # any DETECTION_FOUND whose (label + bbox IoU >0.6) matches an entry, so
    # the user isn't asked the same false alarm twice across sessions.
    sess["false_positives"] = load_all_false_positives()
    logger.info("Loaded {} persistent false-positives for session {}",
                len(sess["false_positives"]), video_id)

    # Serialise all WS writes through a single lock — prevents concurrent send errors
    # when _relay_events and _stream_llm/_stream_follow_up both write at the same time.
    _ws_lock = asyncio.Lock()

    # Two concurrent tasks: relay pipeline events → FE, and FE actions → pipeline
    async def _relay_events():
        """Forward detection / state events from pipeline queue to FE."""
        while True:
            try:
                evt = await asyncio.wait_for(ctrl.events.get(), timeout=0.1)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            # Track confirmed detections (user did NOT ignore)
            if evt["event"] == "VIDEO_FINISHED":
                sess["confirmed_detections"] = evt["data"]["detections"]

            # Phase D: auto-skip detections matching known false-positives.
            # Filter at this layer (main process) rather than in the worker
            # subprocess so FP updates during a session take effect immediately.
            if evt["event"] == "DETECTION_FOUND":
                det = evt["data"]
                lesion = det.get("lesion", {})
                if matches_false_positive(
                    lesion.get("label", ""),
                    list(lesion.get("bbox", [])),
                    sess.get("false_positives", []),
                ):
                    logger.info("Auto-skip false-positive: {} at frame {}",
                                lesion.get("label"), det.get("frame_index"))
                    # Tell controller to resume so the pipeline doesn't stay
                    # paused on a detection the user already classified as wrong.
                    ctrl.send_action("ACTION_IGNORE")
                    continue  # don't forward to FE

            try:
                async with _ws_lock:
                    await websocket.send_json(evt)
            except Exception:
                break

            if evt["event"] == "VIDEO_FINISHED":
                break

    async def _handle_actions():
        """Receive user actions from FE and dispatch to pipeline controller."""
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                ctrl.stop()
                break
            except Exception:
                ctrl.stop()
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = msg.get("action", "")

            if action == "ACTION_EXPLAIN":
                pending = ctrl._pending
                if pending and not sess.get("llm_streaming"):
                    sess["conv_history"] = []
                    sess["llm_streaming"] = True
                    # Phase A: structured 3-section report (replaces legacy
                    # free-form markdown _stream_llm). Frontend renders cards.
                    asyncio.ensure_future(_stream_lesion_report(websocket, pending, sess, video_id, _ws_lock))
                ctrl.send_action(action)

            elif action == "ACTION_FOLLOW_UP":
                text = msg.get("payload", {}).get("text", "")
                if text.strip():
                    asyncio.ensure_future(_stream_follow_up(websocket, text, sess, _ws_lock))

            elif action in ("ACTION_IGNORE", "ACTION_CONFIRM"):
                sess["conv_history"] = []
                sess["llm_streaming"] = False
                ctrl.send_action(action, msg.get("payload"))

            elif action == "ACTION_REPORT_FALSE_POSITIVE":
                # Phase D — persist (label, bbox) so future detections matching
                # this region auto-skip (across sessions). Then behave like IGNORE
                # to advance the pipeline past the current pending detection.
                pending = ctrl._pending
                if pending:
                    lesion = pending.get("lesion", {})
                    label = lesion.get("label", "")
                    bbox = list(lesion.get("bbox", []))
                    if label and len(bbox) >= 4:
                        ok = save_false_positive(
                            label=label, bbox=bbox,
                            session_id_source=video_id,
                            reported_at_ms=int(time.time() * 1000),
                        )
                        if ok:
                            sess["false_positives"].append({"label": label, "bbox": bbox})
                            logger.info(
                                "False-positive persisted: {} bbox={} (now {} total)",
                                label, [round(v, 1) for v in bbox],
                                len(sess["false_positives"]),
                            )
                sess["conv_history"] = []
                sess["llm_streaming"] = False
                ctrl.send_action("ACTION_IGNORE", msg.get("payload"))

            elif action == "ACTION_RECHECK":
                # Phase D — re-run YOLO on the currently paused frame with a
                # lowered confidence threshold. The worker subprocess owns the
                # model + last frame, so we forward a RECHECK:<conf> command
                # and let it emit new DETECTION_FOUND events directly.
                payload = msg.get("payload") or {}
                try:
                    conf = float(payload.get("conf", 0.4))
                except (TypeError, ValueError):
                    conf = 0.4
                # Clamp to a sane band — too low (<0.2) floods false positives,
                # too high (>0.6) won't surface anything the first pass missed.
                conf = max(0.2, min(0.6, conf))
                if ctrl._cmd_q:
                    ctrl._cmd_q.put(f"RECHECK:{conf:.2f}")
                logger.info("Re-check requested at conf={:.2f}", conf)

            else:
                ctrl.send_action(action, msg.get("payload"))

    relay_task = asyncio.ensure_future(_relay_events())
    action_task = asyncio.ensure_future(_handle_actions())

    try:
        done, pending = await asyncio.wait(
            [relay_task, action_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except Exception:
        pass
    finally:
        ctrl.stop()
        # Delete ephemeral upload when session ends. The UPLOAD_DIR prefix guard
        # intentionally excludes library files (LIBRARY_DIR) and live sources —
        # library videos must persist across sessions and are deleted only via DELETE /library/{id}.
        video_path = sess.get("video_path")
        if video_path and isinstance(video_path, Path) and str(video_path).startswith(str(UPLOAD_DIR)):
            try:
                video_path.unlink(missing_ok=True)
                logger.info("Cleaned up upload: {}", video_path.name)
            except Exception:
                pass


# ── LLM streaming ─────────────────────────────────────────────────────────────

async def _stream_llm(websocket: WebSocket, detection: dict, sess: dict, ws_lock: asyncio.Lock | None = None) -> None:
    """Stream GPT-4o vision explanation; caches result by label:location."""
    async def _send(data: dict) -> None:
        if ws_lock:
            async with ws_lock:
                await websocket.send_json(data)
        else:
            await websocket.send_json(data)

    client = _get_openai()

    location   = detection.get("location", "Unknown")
    lesion     = detection.get("lesion", {})
    label      = lesion.get("label", "Unknown")
    confidence = lesion.get("confidence", 0.0)
    frame_b64  = detection.get("frame_b64")

    cache_key = f"{label}:{location}"

    try:
        # Cache hit: stream cached response word-by-word
        if cache_key in sess["llm_cache"]:
            logger.info("LLM cache hit: {}", cache_key)
            cached = sess["llm_cache"][cache_key]
            for word in cached.split(" "):
                await asyncio.sleep(0.02)
                await _send({"event": "LLM_CHUNK", "data": {"chunk": word + " "}})
            await _send({"event": "LLM_DONE", "data": {}})
            return

        # No API key: send mock response
        if client is None:
            mock = _mock_llm_response(label, location)
            for chunk in mock.split(" "):
                await asyncio.sleep(0.04)
                await _send({"event": "LLM_CHUNK", "data": {"chunk": chunk + " "}})
            await _send({"event": "LLM_DONE", "data": {}})
            return

        user_text = (
            f"Phát hiện: {label} (độ tin cậy {confidence * 100:.0f}%) tại {location}. "
            "Phân tích tổn thương trong ảnh và đưa ra nhận định lâm sàng."
        )
        if frame_b64:
            user_content = [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}", "detail": "low"}},
                {"type": "text",      "text": user_text},
            ]
        else:
            logger.warning("LLM fallback text-only: frame_b64 missing for {}", label)
            user_content = user_text

        initial_user_turn = {"role": "user", "content": user_content}
        messages = [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            initial_user_turn,
        ]

        t0 = time.monotonic()
        full_response = ""
        stream = await client.chat.completions.create(
            model=LLM_MODEL_VISION,
            messages=messages,
            stream=True,
            max_tokens=700,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                full_response += delta
                await _send({"event": "LLM_CHUNK", "data": {"chunk": delta}})
        await _send({"event": "LLM_DONE", "data": {}})
        latency = time.monotonic() - t0
        logger.info("LLM initial explain: model={} latency={:.2f}s tokens_out=~{}", LLM_MODEL_VISION, latency, len(full_response) // 4)

        sess["conv_history"] = [
            initial_user_turn,
            {"role": "assistant", "content": full_response},
        ]
        sess["llm_cache"][cache_key] = full_response

    except Exception as exc:
        logger.error("LLM stream error: {}", exc)
        await _send({"event": "ERROR", "data": {"message": f"LLM error: {exc}"}})
    finally:
        sess["llm_streaming"] = False


async def _stream_lesion_report(websocket: WebSocket, detection: dict,
                                 sess: dict, video_id: str,
                                 ws_lock: asyncio.Lock | None = None) -> None:
    """Generate structured 3-section lesion report (Kỹ thuật / Mô tả / Kết luận).

    Replaces the legacy free-form markdown response from _stream_llm. Calls the
    LLM (Ollama or OpenAI per LLM_BACKEND env) with response_format=json_schema
    to force a structured payload that the frontend renders as cards.

    Sends the report as a SINGLE LESION_REPORT_DONE event (no streaming chunks)
    because JSON schema responses cannot be partial-parsed mid-stream — the full
    object must be received before parsing.
    """
    async def _send(data: dict) -> None:
        if ws_lock:
            async with ws_lock:
                await websocket.send_json(data)
        else:
            await websocket.send_json(data)

    client = _get_llm_client()
    lesion = detection.get("lesion", {})
    label  = lesion.get("label", "Unknown")
    conf   = lesion.get("confidence", 0.0)
    frame_b64    = detection.get("frame_b64")
    frame_index  = detection.get("frame_index", 0)
    timestamp_ms = detection.get("timestamp_ms", 0)

    # Cache by (label, bbox-signature) — finer-grained than the legacy
    # label:location key so different lesion instances of the same class get
    # distinct reports rather than a recycled generic one.
    bbox = lesion.get("bbox", [0, 0, 0, 0])
    bbox_sig = "_".join(str(int(v / 50) * 50) for v in bbox[:4])  # quantized to 50px
    cache_key = f"report:{label}:{bbox_sig}"

    if cache_key in sess.get("llm_cache", {}):
        logger.info("Lesion report cache hit: {}", cache_key)
        cached = sess["llm_cache"][cache_key]
        await _send({"event": "LESION_REPORT_DONE",
                     "data": {"frame_index": frame_index, "report": cached}})
        return

    if client is None:
        logger.warning("No LLM client available — sending mock report")
        mock = _mock_lesion_report(label, conf, frame_index, timestamp_ms)
        await _send({"event": "LESION_REPORT_DONE",
                     "data": {"frame_index": frame_index, "report": mock}})
        return

    user_text = build_lesion_user_message(label, conf, timestamp_ms, frame_index)
    if frame_b64:
        user_content = [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}", "detail": "low"}},
            {"type": "text", "text": user_text},
        ]
    else:
        logger.warning("Lesion report fallback text-only: frame_b64 missing for {}", label)
        user_content = user_text

    messages = [
        {"role": "system", "content": LESION_REPORT_PROMPT},
        {"role": "user",   "content": user_content},
    ]

    # response_format spec: Ollama (Qwen2.5+) supports json_schema natively;
    # OpenAI uses the same param name. The schema enforces the 3-section structure.
    response_format = {
        "type": "json_schema",
        "json_schema": {"name": "endoscopy_lesion_report", "schema": LESION_REPORT_SCHEMA},
    }

    t0 = time.monotonic()
    try:
        # No streaming for JSON schema — must wait for full response then parse.
        completion = await client.chat.completions.create(
            model=_llm_model_name("vision"),
            messages=messages,
            response_format=response_format,
            max_tokens=1500,
        )
        raw_json = completion.choices[0].message.content or "{}"
        try:
            report = json.loads(raw_json)
        except json.JSONDecodeError as je:
            logger.error("Lesion report JSON parse failed: {} — raw: {}", je, raw_json[:200])
            await _send({"event": "ERROR", "data": {"message": f"Báo cáo AI lỗi định dạng — {je}"}})
            return

        # Phase A post-process: enforce primary_dx ↔ differential[0] consistency.
        # The 7B model doesn't reliably follow this rule from prompt alone
        # (~33% compliance on real runs), so we sort differentials by
        # probability descending and overwrite primary_dx with the top entry.
        # This guarantees primary_dx == differential[0].dx and the differential
        # list is properly ranked — both required by the schema's clinical logic.
        #
        # Also strip double-bilingual wraps ("X (X-en) (X)") — model sometimes
        # appends a redundant VN parenthetical after a valid VN (EN) pair. We
        # keep only the FIRST parenthesized group following the head term.
        import re as _re
        def _dedup_bilingual(text: str) -> str:
            # Match: "<head> (<first paren>) (<second paren>)" → "<head> (<first paren>)"
            return _re.sub(r"(\([^)]+\))\s*\([^)]+\)\s*$", r"\1", text).strip()

        conclusion = report.get("conclusion", {})
        diff = conclusion.get("differential", [])
        if diff:
            for d in diff:
                d["dx"] = _dedup_bilingual(d.get("dx", ""))
            diff.sort(key=lambda d: d.get("probability_pct", 0), reverse=True)
            conclusion["differential"] = diff
            conclusion["primary_dx"] = diff[0]["dx"]
        elif "primary_dx" in conclusion:
            conclusion["primary_dx"] = _dedup_bilingual(conclusion["primary_dx"])

        latency = time.monotonic() - t0
        logger.info("Lesion report generated: model={} latency={:.2f}s severity={}",
                    _llm_model_name("vision"), latency,
                    report.get("conclusion", {}).get("severity", "?"))

        sess.setdefault("llm_cache", {})[cache_key] = report

        # Phase A persistence — save the parsed report so Phase B summary
        # chatbot and PDF export can read back without re-running the LLM.
        # Failure here is non-fatal: log and continue (the report still
        # reaches the user via the WS event below).
        save_lesion_report(
            session_id=video_id,
            frame_index=frame_index,
            report=report,
            model=_llm_model_name("vision"),
            generated_at_ms=int(time.time() * 1000),
        )

        # Maintain conv_history for follow-up Q&A on this detection — store the
        # initial user message + the assistant's JSON response so subsequent
        # ACTION_FOLLOW_UP calls have context.
        sess["conv_history"] = [
            {"role": "user",      "content": user_content},
            {"role": "assistant", "content": raw_json},
        ]

        await _send({"event": "LESION_REPORT_DONE",
                     "data": {"frame_index": frame_index, "report": report}})

    except Exception as exc:
        logger.error("Lesion report stream error: {}", exc)
        await _send({"event": "ERROR", "data": {"message": f"LLM error: {exc}"}})
    finally:
        sess["llm_streaming"] = False


def _mock_lesion_report(label: str, confidence: float, frame_index: int, timestamp_ms: int) -> dict:
    """Fallback structured report when no LLM client available — keeps frontend
    working in dev environments without OpenAI key or Ollama running."""
    secs = timestamp_ms / 1000.0
    minutes = int(secs // 60)
    seconds = secs - minutes * 60
    ts_label = f"{minutes} phút {seconds:.0f} giây" if minutes else f"{seconds:.1f} giây"
    return {
        "technique": {
            "method": "Nội soi dạ dày-tá tràng AI-assisted (mock)",
            "device": "Không xác định",
            "timestamp": f"{ts_label} — frame {frame_index}",
        },
        "description": {
            "size_mm":     "Không xác định",
            "paris_class": "Phân loại 0-IIb (Paris 0-IIb, phẳng hoàn toàn)",
            "surface":     "Không quan sát rõ (mock)",
            "color":       "Không quan sát rõ (mock)",
            "margin":      "Không quan sát rõ (mock)",
            "vascular":    "Không quan sát rõ (mock)",
            "fluid":       "Không thấy",
        },
        "conclusion": {
            "primary_dx":  f"{label} (mock — LLM client unavailable)",
            "severity":    "trung bình",
            "differential": [
                {"dx": f"{label} (primary, mock)", "probability_pct": 60},
                {"dx": "Tiền ung thư (precancerous lesion)", "probability_pct": 30},
            ],
            "recommendations": [
                "Khu vực cần sinh thiết để loại trừ ung thư",
                "Cân nhắc test CLO tại chỗ phát hiện H. pylori",
                "Tái khám 6-8 tuần sau điều trị",
            ],
            "ai_confidence": int(confidence * 100),
        },
    }


async def _stream_follow_up(websocket: WebSocket, text: str, sess: dict, ws_lock: asyncio.Lock | None = None) -> None:
    """Follow-up question using GPT-4o-mini text-only with conversation history."""
    async def _send(data: dict) -> None:
        if ws_lock:
            async with ws_lock:
                await websocket.send_json(data)
        else:
            await websocket.send_json(data)

    if not sess["conv_history"]:
        logger.warning("ACTION_FOLLOW_UP received but conv_history empty — ignoring")
        return

    client = _get_openai()
    if client is None:
        return

    history = sess["conv_history"]
    if len(history) > 10:
        history = history[:2] + history[-8:]

    messages = [
        {"role": "system", "content": LLM_SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": text[:500]},
    ]

    t0 = time.monotonic()
    full_response = ""
    try:
        stream = await client.chat.completions.create(
            model=LLM_MODEL_FOLLOWUP,
            messages=messages,
            stream=True,
            max_tokens=350,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                full_response += delta
                await _send({"event": "LLM_CHUNK", "data": {"chunk": delta}})
        await _send({"event": "LLM_DONE", "data": {}})
        latency = time.monotonic() - t0
        logger.info("LLM follow-up: model={} latency={:.2f}s", LLM_MODEL_FOLLOWUP, latency)
    except Exception as exc:
        logger.error("LLM follow-up error: {}", exc)
        await _send({"event": "ERROR", "data": {"message": f"LLM error: {exc}"}})
        return

    sess["conv_history"].append({"role": "user",      "content": text[:500]})
    sess["conv_history"].append({"role": "assistant", "content": full_response})


def _mock_llm_response(label: str, location: str) -> str:
    """Fallback response when OPENAI_API_KEY is not set — matches 3-section Paris format."""
    return (
        f"**Phân loại Paris:** 0-IIb — Tổn thương phẳng hoàn toàn tại {location}, "
        f"phù hợp với {label}. Không nhô, không lõm, có thay đổi màu sắc nhẹ.\n\n"
        "**Nhận định lâm sàng:** Tiền ung thư / nghi ngờ — bề mặt thay đổi màu sắc không đều, "
        "bờ không rõ ràng, cần đánh giá thêm.\n\n"
        "**Checklist hành động:**\n"
        "- [ ] Xác nhận vị trí giải phẫu chính xác và ghi nhận vào hồ sơ.\n"
        "- [ ] Cân nhắc sinh thiết 2–4 mảnh tại rìa tổn thương.\n"
        "- [ ] Kiểm tra H. pylori nếu là viêm dạ dày.\n"
        "- [ ] Ghi nhận kích thước và đặc điểm hình thái.\n"
        "- [ ] Hẹn tái khám nội soi sau 4–6 tuần nếu điều trị nội khoa."
    )


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "endoscopy-ws-server:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        # Allow large video uploads (default h11 limit is 16 KB for incomplete events)
        h11_max_incomplete_event_size=None,
    )
