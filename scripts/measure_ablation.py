#!/usr/bin/env python3
"""measure_ablation.py — Ablation of the application-level design decisions, on real
video, in a SINGLE YOLO pass (detector run once per frame at FRAME_STEP=1; the
FRAME_STEP and de-dup policies are then evaluated analytically on the cached
detections, so every ablation cell is consistent and cheap).

Varies:
  * FRAME_STEP   ∈ {1, 2, 3}  — detection coverage vs compute
  * de-dup mode  ∈ {off, spatial+cooldown (production), once-per-label}

Rules/constants mirror src/backend/pipeline/pipeline_controller.py.

Usage (GPU host):  python3 measure_ablation.py VIDEO [VIDEO ...]
"""
import os
import sys

import cv2
import numpy as np
from ultralytics import YOLO

MODEL = os.environ.get("MODEL", "/home/emie/DATN_ver0/models/best_train6.pt")
MAX_FRAMES = int(os.environ.get("MAX_FRAMES", "4000"))

CLEAN = {0: "Viêm thực quản", 1: "Viêm dạ dày HP", 2: "Ung thư thực quản",
         3: "Ung thư dạ dày", 4: "Loét hoành tá tràng"}
CONF = {"Viêm thực quản": 0.60, "Viêm dạ dày HP": 0.60, "Ung thư thực quản": 0.75,
        "Ung thư dạ dày": 0.75, "Loét hoành tá tràng": 0.60}
MAX_BBOX_AREA_RATIO = 0.95
DEDUP_IOU, DEDUP_WINDOW_MS = 0.25, 10000
DIFFUSE_CENTER_FRAC, DIFFUSE_COOLDOWN_MS = 0.18, 7000


def detect_viewport(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    H, W = frame.shape[:2]
    if not cnts:
        return (0, 0, W, H)
    x, y, w, h = cv2.boundingRect(max(cnts, key=cv2.contourArea))
    return (x, y, w, h) if w * h >= 0.3 * W * H else (0, 0, W, H)


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if not inter:
        return 0.0
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua else 0.0


def collect(model, path):
    """One YOLO pass at every frame → list of (frame_idx, ts_ms, label, bbox1080)."""
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    vp = None
    dets = []
    fi = -1
    n = 0
    while n < MAX_FRAMES:
        ok, frame = cap.read()
        if not ok:
            break
        fi += 1
        n += 1
        H, W = frame.shape[:2]
        if vp is None:
            vp = detect_viewport(frame)
        vx, vy, vw, vh = vp
        res = model(frame, conf=0.25, verbose=False, device=0)
        for b in res[0].boxes:
            cls = int(b.cls[0]); conf = float(b.conf[0])
            label = CLEAN.get(cls, str(cls))
            x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
            cx, cy = (x1+x2)/2, (y1+y2)/2
            if not (vx <= cx <= vx+vw and vy <= cy <= vy+vh):
                continue                       # outside viewport
            if conf < CONF.get(label, 0.5):
                continue
            if (x2-x1)*(y2-y1) > MAX_BBOX_AREA_RATIO*vw*vh:
                continue
            bb = [x1*1920/W, y1*1080/H, x2*1920/W, y2*1080/H]
            dets.append((fi, fi/fps*1000.0, label, bb))
    cap.release()
    return dets


def surfaced(dets, frame_step, mode):
    """Count surfaced alerts under a FRAME_STEP subsample and a de-dup mode."""
    hist = []                  # (ts, bbox, label)
    once = set()
    n = 0
    for fi, ts, label, bb in dets:
        if fi % frame_step:
            continue
        if mode == "off":
            n += 1
            continue
        if mode == "once":
            if label in once:
                continue
            once.add(label); n += 1
            continue
        # production: focal spatial-temporal + diffuse position cooldown
        diffuse = "viêm" in label.lower()
        dup = False
        for (rts, rbb, rlab) in hist:
            if rlab != label:
                continue
            if diffuse:
                if ts - rts < DIFFUSE_COOLDOWN_MS:
                    c = ((bb[0]+bb[2])/2, (bb[1]+bb[3])/2)
                    r = ((rbb[0]+rbb[2])/2, (rbb[1]+rbb[3])/2)
                    if ((c[0]-r[0])**2 + (c[1]-r[1])**2) ** 0.5 <= DIFFUSE_CENTER_FRAC*1920:
                        dup = True; break
            elif ts - rts < DEDUP_WINDOW_MS and iou(rbb, bb) >= DEDUP_IOU:
                dup = True; break
        if not dup:
            n += 1; hist.append((ts, bb, label))
    return n


def main():
    model = YOLO(MODEL)
    all_dets = []
    for path in sys.argv[1:]:
        d = collect(model, path)
        all_dets += d
        print(f"{os.path.basename(path)}: {len(d)} qualifying detections (FRAME_STEP=1)")
    print(f"\n=== ABLATION (aggregate, {len(all_dets)} detections) ===")
    print(f"{'FRAME_STEP':>10} | {'raw(off)':>9} | {'production':>10} | {'once/label':>10}")
    for fs in (1, 2, 3):
        raw = surfaced(all_dets, fs, "off")
        prod = surfaced(all_dets, fs, "default")
        once = surfaced(all_dets, fs, "once")
        print(f"{fs:>10} | {raw:>9} | {prod:>10} | {once:>10}")
    print("\n(raw=no dedup; production=spatial+diffuse-cooldown; once=one alert/label/session)")
    print("FRAME_STEP raw count also shows detection coverage lost by subsampling.")


if __name__ == "__main__":
    main()
