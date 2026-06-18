"""Browser-pushed live detection (Trực tuyến mode).

The browser captures the HDMI-capture device (it shows up as a normal webcam) or
a shared screen, displays it locally, and — only when the doctor presses
"Bắt đầu AI" — sends individual JPEG frames to the backend. This module runs YOLO
on those frames and returns boxes. No GStreamer here (the browser is the source),
so it runs safely in the main process (PyTorch releases the GIL during inference).

Returned boxes are normalized to a 1920×1080 virtual canvas so the frontend can
overlay them with the same percentage system used for uploaded video.
"""
from __future__ import annotations

import threading
from pathlib import Path

import cv2
import numpy as np
from loguru import logger

# Reuse the model path + thresholds from the pipeline so live detection matches
# the file/library path. Importing is cheap — pipeline_controller defers gi/torch
# imports to inside its worker function.
from pipeline_controller import (
    DEFAULT_MODEL, CLASS_CONF_THRESHOLDS, CONFIDENCE_THRESHOLD, FRAME_W, FRAME_H,
)

_model = None
_names: dict = {}
_lock = threading.Lock()


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


def detect_jpeg(jpeg: bytes) -> list[dict]:
    """Decode a JPEG frame, run YOLO, return boxes normalized to 1920×1080:
       [{label, confidence, bbox:[x1,y1,x2,y2]}], highest-confidence first."""
    if not jpeg:
        return []
    try:
        _ensure_model()
        arr = np.frombuffer(jpeg, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return []
        h, w = frame.shape[:2]
        if not h or not w:
            return []
        results = _model(frame, conf=CONFIDENCE_THRESHOLD, verbose=False)
        out: list[dict] = []
        for r in results:
            if r.boxes is None:
                continue
            for b in r.boxes:
                if b.conf is None or b.conf.shape[0] == 0:
                    continue
                x1, y1, x2, y2 = b.xyxy[0].tolist()
                conf = float(b.conf[0])
                cls = int(b.cls[0])
                label = _names.get(cls, f"class_{cls}")
                thr = CLASS_CONF_THRESHOLDS.get(label)
                if thr is not None and conf < thr:
                    continue
                out.append({
                    "label": label,
                    "confidence": round(conf, 4),
                    "bbox": [x1 / w * FRAME_W, y1 / h * FRAME_H, x2 / w * FRAME_W, y2 / h * FRAME_H],
                })
        out.sort(key=lambda d: d["confidence"], reverse=True)
        return out[:10]
    except Exception as e:
        logger.error("detect_jpeg failed: {}", e)
        return []
