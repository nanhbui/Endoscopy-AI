"""Browser-pushed live detection (Trực tuyến mode).

The browser captures the HDMI-capture device (it shows up as a normal webcam) or
a shared screen, displays it locally, and — only when the doctor presses
"Bắt đầu AI" — sends individual JPEG frames to the backend. This module runs YOLO
on those frames and returns boxes. No GStreamer here (the browser is the source),
so it runs safely in the main process (PyTorch releases the GIL during inference).

Returned boxes are normalized to a 1920×1080 virtual canvas so the frontend can
overlay them with the same percentage system used for uploaded video.

The raw YOLO output can optionally be filtered (viewport-centre + whole-frame
suppression) and de-duplicated (spatial-temporal + diffuse cooldown), but these are
OPT-IN for the live path (env LIVE_VIEWPORT_FILTER / LIVE_DEDUP, default OFF): on
screen-mirror / capture-card sources the auto viewport detector is unreliable and was
cropping real lesions, so by default live behaves like permissive per-frame YOLO and
does not miss detections. Each call returns both the boxes to OVERLAY and the subset
that is a genuinely NEW detection to CAPTURE/report (identical when dedup is off).
"""
from __future__ import annotations

import os as _os
import threading
import time
from pathlib import Path

import cv2
import numpy as np
from loguru import logger

# Reuse the model path + thresholds from the pipeline so live detection matches
# the file/library path. Importing is cheap — pipeline_controller defers gi/torch
# imports to inside its worker function.
from pipeline_controller import (
    DEFAULT_MODEL, CLASS_CONF_THRESHOLDS, CONFIDENCE_THRESHOLD, FRAME_W, FRAME_H,
    MAX_BBOX_AREA_RATIO,
)

_model = None
_names: dict = {}
_lock = threading.Lock()

# ── Dedup / filter config — same env vars + defaults as the upload worker ──────
_DEDUP_WINDOW_MS = int(_os.environ.get("DEDUP_WINDOW_MS", "10000"))      # 10 s
_DEDUP_IOU = 0.25                                                        # ≥25% overlap = same region
_DIFFUSE_COOLDOWN_MS = int(_os.environ.get("ENDOSCOPY_DIFFUSE_COOLDOWN_MS", "7000"))  # 7 s
_DIFFUSE_CENTER_FRAC = float(_os.environ.get("ENDOSCOPY_DIFFUSE_CENTER_FRAC", "0.18"))
_DIFFUSE_KW = [k.strip().lower()
               for k in _os.environ.get("ENDOSCOPY_DIFFUSE_KEYWORDS", "viêm").split(",")
               if k.strip()]
# Filters are OPT-IN for live (default OFF). Screen-mirror / capture-card sources
# confuse the auto viewport detector, which then crops real lesions and inflates the
# whole-frame ratio, so the streaming feed under-detected. By default live behaves like
# permissive per-frame YOLO and does not miss detections; set the env var to 1 to
# re-enable a given filter on a clean scope-on-black feed.
_LIVE_DEDUP = _os.environ.get("LIVE_DEDUP", "0").lower() in ("1", "true", "yes", "on")
_LIVE_VIEWPORT = _os.environ.get("LIVE_VIEWPORT_FILTER", "0").lower() in ("1", "true", "yes", "on")


def _ensure_model() -> None:
    global _model, _names
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return
        from ultralytics import YOLO
        m = YOLO(str(DEFAULT_MODEL))
        try:
            m.fuse()
        except Exception:
            pass
        names = dict(m.names or {})
        # Prefer the Vietnamese labels in labels.txt (same as the worker) so the
        # per-class thresholds (keyed by VN label) line up.
        lt = Path(DEFAULT_MODEL).parent / "labels.txt"
        if lt.exists():
            try:
                lines = [x.strip() for x in lt.read_text(encoding="utf-8").splitlines() if x.strip()]
                if len(names) >= len(lines):
                    names = {i: lines[i] for i in range(len(lines))}
            except Exception as e:
                logger.warning("live_detect labels.txt load failed: {}", e)
        _model, _names = m, names
        logger.info("Live-detect model ready: {} ({} classes)", DEFAULT_MODEL.name, len(names))


def _iou(a: list, b: list) -> float:
    ix1 = max(a[0], b[0]); iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2]); iy2 = min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def _detect_viewport(frame: np.ndarray) -> tuple[int, int, int, int]:
    """Auto-detect the scope viewport (bright contiguous region). Same logic as
    the upload worker: a screen-mirror that is bright everywhere resolves to the
    full frame (so nothing is filtered); a scope-on-black-border frame resolves
    to the circle. Falls back to full frame on any failure."""
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            x, y, w, h = cv2.boundingRect(max(contours, key=cv2.contourArea))
            if w * h >= frame.shape[0] * frame.shape[1] * 0.3:
                return (x, y, w, h)
    except Exception as e:
        logger.warning("live viewport detection failed: {} — using full frame", e)
    return (0, 0, frame.shape[1], frame.shape[0])


def _is_diffuse(label: str) -> bool:
    _l = label.lower()
    return any(k in _l for k in _DIFFUSE_KW)


class LiveDetector:
    """Per-WS-connection stateful detector. Holds the viewport cache + the
    report history so dedup spans the whole live session (one instance per
    browser connection)."""

    def __init__(self) -> None:
        self._viewport: tuple[int, int, int, int] | None = None  # grab-frame px coords
        self._history: list[dict] = []  # {ts_ms, bbox(1920×1080), label}

    # ── dedup predicates (mirror pipeline_controller) ─────────────────────────
    def _recently_reported(self, ts_ms: int, bbox: list, label: str) -> bool:
        for r in self._history:
            if (ts_ms - r["ts_ms"] < _DEDUP_WINDOW_MS and r["label"] == label
                    and _iou(r["bbox"], bbox) >= _DEDUP_IOU):
                return True
        return False

    def _diffuse_same_spot(self, ts_ms: int, bbox: list, label: str) -> bool:
        """Diffuse (viêm) same-spot judged by box-CENTRE distance — robust to the
        box-size jitter that breaks IoU as the scope pans over inflamed mucosa."""
        cx, cy = (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0
        max_d = _DIFFUSE_CENTER_FRAC * float(FRAME_W)
        for r in self._history:
            if ts_ms - r["ts_ms"] < _DIFFUSE_COOLDOWN_MS and r["label"] == label:
                rb = r["bbox"]
                rx, ry = (rb[0] + rb[2]) / 2.0, (rb[1] + rb[3]) / 2.0
                if ((cx - rx) ** 2 + (cy - ry) ** 2) ** 0.5 <= max_d:
                    return True
        return False

    def _is_dup(self, ts_ms: int, bbox: list, label: str) -> bool:
        if _is_diffuse(label):
            return self._diffuse_same_spot(ts_ms, bbox, label)
        return self._recently_reported(ts_ms, bbox, label)

    def detect(self, jpeg: bytes) -> dict:
        """Decode a JPEG frame, run YOLO, return:
           {"boxes":   [...],   # filtered survivors to OVERLAY (highest-conf first)
            "captures":[...]}   # subset that is a NEW detection to snapshot/report
           bbox is normalized to 1920×1080: [x1,y1,x2,y2]."""
        if not jpeg:
            return {"boxes": [], "captures": []}
        try:
            _ensure_model()
            arr = np.frombuffer(jpeg, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                return {"boxes": [], "captures": []}
            h, w = frame.shape[:2]
            if not h or not w:
                return {"boxes": [], "captures": []}

            if self._viewport is None:
                self._viewport = _detect_viewport(frame)
            vx, vy, vw, vh = self._viewport
            ts_ms = int(time.monotonic() * 1000.0)

            results = _model(frame, conf=CONFIDENCE_THRESHOLD, verbose=False)
            boxes: list[dict] = []
            captures: list[dict] = []
            for r in results:
                if r.boxes is None:
                    continue
                for b in r.boxes:
                    if b.conf is None or b.conf.shape[0] == 0:
                        continue
                    x1, y1, x2, y2 = b.xyxy[0].tolist()
                    conf = float(b.conf[0])
                    label = _names.get(int(b.cls[0]), f"class_{int(b.cls[0])}")

                    # Per-class confidence threshold (cancer 0.75, others 0.60).
                    thr = CLASS_CONF_THRESHOLDS.get(label)
                    if thr is not None and conf < thr:
                        continue
                    # Drop detections whose centre is outside the scope viewport
                    # (info-panel / edge FPs in clinical-recording mirrors).
                    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                    if _LIVE_VIEWPORT and not (vx <= cx <= vx + vw and vy <= cy <= vy + vh):
                        continue
                    # Suppress egregious whole-frame detections. Size the cap against
                    # the viewport only when the viewport filter is on/trusted; else use
                    # the full frame so a mis-detected viewport cannot drop real boxes.
                    _wf_base = (vw * vh) if _LIVE_VIEWPORT else (w * h)
                    if (x2 - x1) * (y2 - y1) / max(_wf_base, 1) > MAX_BBOX_AREA_RATIO:
                        continue

                    bbox = [x1 / w * FRAME_W, y1 / h * FRAME_H,
                            x2 / w * FRAME_W, y2 / h * FRAME_H]
                    det = {"label": label, "confidence": round(conf, 4), "bbox": bbox}
                    boxes.append(det)

                    # Dedup gate: a NEW detection (not the same lingering lesion)
                    # is the only thing the frontend should snapshot/report.
                    if not _LIVE_DEDUP or not self._is_dup(ts_ms, bbox, label):
                        captures.append(det)
                        self._history.append({"ts_ms": ts_ms, "bbox": bbox, "label": label})

            boxes.sort(key=lambda d: d["confidence"], reverse=True)
            captures.sort(key=lambda d: d["confidence"], reverse=True)
            # Prune history outside the longest window to bound memory on long sessions.
            cutoff = ts_ms - max(_DEDUP_WINDOW_MS, _DIFFUSE_COOLDOWN_MS)
            self._history = [r for r in self._history if r["ts_ms"] >= cutoff]
            return {"boxes": boxes[:10], "captures": captures}
        except Exception as e:
            logger.error("LiveDetector.detect failed: {}", e)
            return {"boxes": [], "captures": []}


def detect_jpeg(jpeg: bytes) -> list[dict]:
    """Stateless single-frame YOLO (no dedup). Kept for ad-hoc callers; the live
    WS path uses LiveDetector for per-session filtering + dedup."""
    return LiveDetector().detect(jpeg)["boxes"]
