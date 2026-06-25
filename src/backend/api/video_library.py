"""video-library.py — Persistent video library service.

Manages data/library/index.json and the video files stored alongside it.
All index mutations are written atomically via a temp-file rename.
"""

from __future__ import annotations

import errno
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from logger import logger

_INDEX_FILE = "index.json"
_SHA256_PREFIX_BYTES = 4 * 1024 * 1024  # 4 MB
_ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


class VideoLibrary:
    def __init__(self, library_dir: Path) -> None:
        self._dir = library_dir
        self._index_path = library_dir / _INDEX_FILE

    # ── Index I/O ─────────────────────────────────────────────────────────────

    def load_index(self) -> list[dict]:
        if not self._index_path.exists():
            return []
        try:
            return json.loads(self._index_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to read library index: {}", exc)
            return []

    def save_index(self, entries: list[dict]) -> None:
        tmp = self._index_path.with_suffix(".json.tmp")
        try:
            tmp.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self._index_path)
        except Exception as exc:
            logger.warning("Failed to write library index: {}", exc)
            tmp.unlink(missing_ok=True)
            raise

    # ── Public API ────────────────────────────────────────────────────────────

    def list_videos(self, source: Optional[str] = None) -> list[dict]:
        """Return library entries (public fields only, sorted newest first).

        ``source`` filters by origin: pass ``"live_recording"`` to list only
        recordings captured from a live (Trực tiếp) session, or omit to list all.
        The recording-specific fields (source/session_id/recorded_at/duration_ms)
        are surfaced when present so the recordings UI can show duration + when it
        was recorded; older library entries simply omit them.
        """
        entries = self.load_index()
        if source is not None:
            entries = [e for e in entries if e.get("source") == source]
        public_fields = ("library_id", "filename", "size_bytes", "uploaded_at",
                         "source", "session_id", "recorded_at", "duration_ms")
        result = [{k: e[k] for k in public_fields if k in e} for e in entries]
        return sorted(result, key=lambda e: e.get("uploaded_at", ""), reverse=True)

    def compute_sha256_prefix(self, path: Path) -> str:
        """SHA-256 of the first 4 MB of the file — fast dedup key."""
        h = hashlib.sha256()
        with path.open("rb") as f:
            h.update(f.read(_SHA256_PREFIX_BYTES))
        return h.hexdigest()

    def find_duplicate(self, sha256_prefix: str, size_bytes: int) -> Optional[dict]:
        """Return an existing entry if sha256_prefix + size_bytes match, else None."""
        for entry in self.load_index():
            if entry.get("sha256_prefix") == sha256_prefix and entry.get("size_bytes") == size_bytes:
                return entry
        return None

    def resolve_path(self, entry: dict) -> Path:
        """Actual on-disk file for an entry, resilient to a moved library dir.

        Prefer the stored absolute ``path`` while it exists, but fall back to
        ``<library_dir>/<library_id><ext>``. Index entries written before
        ENDOSCOPY_LIBRARY_DIR changed keep an old absolute path that no longer
        exists — trusting it blindly 404s the preview and crashes the GStreamer
        worker ("Resource not found"). Files are always named <library_id><ext>.
        """
        stored = entry.get("path")
        if stored and Path(stored).exists():
            return Path(stored)
        ext = Path(entry.get("filename", "") or "").suffix.lower() or ".mp4"
        return self._dir / f"{entry.get('library_id', '')}{ext}"

    def add_entry(self, entry: dict) -> None:
        entries = self.load_index()
        entries.append(entry)
        self.save_index(entries)
        logger.info(
            "Library entry added: {} | {} | {:.1f} MB",
            entry.get("library_id"),
            entry.get("filename"),
            entry.get("size_bytes", 0) / 1_048_576,
        )

    def remove_entry(self, library_id: str) -> None:
        entries = self.load_index()
        before = len(entries)
        entries = [e for e in entries if e.get("library_id") != library_id]
        if len(entries) == before:
            logger.warning("remove_entry: library_id not found: {}", library_id)
            return
        self.save_index(entries)
        logger.info("Library entry removed: {}", library_id)

    def make_entry(self, filename: str, size_bytes: int, dest: Path, sha256_prefix: str) -> dict:
        """Build a new LibraryEntry dict ready for add_entry()."""
        return {
            "library_id": uuid.uuid4().hex[:12],
            "filename": filename,
            "size_bytes": size_bytes,
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "sha256_prefix": sha256_prefix,
            "path": str(dest),
        }

    @staticmethod
    def is_allowed_extension(filename: str) -> bool:
        return Path(filename).suffix.lower() in _ALLOWED_EXTENSIONS
