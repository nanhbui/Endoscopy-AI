#!/usr/bin/env python3
"""measure_memory.py — Quantify the cross-session "ignore" / "confirm" memory.

When the clinician marks a lesion as a false positive ("Bỏ qua" -> false_positives)
or confirms it ("Xác nhận luôn" -> confirmed_lesions), the matching rule applied in
a LATER session is: same label AND IoU >= threshold on the normalised 1920x1080
canvas (FP: 0.6, confirmed: 0.5 — mirrors db.matches_false_positive / pipeline
_matches_confirmed). This harness measures, on real clips, with no ground truth:

  (A) Targeted suppression  — after the surfaced lesions of a clip are rejected,
      what fraction of that clip's qualifying detections a subsequent session would
      auto-suppress (the memory's reach across natural bbox drift).
  (B) Specificity / safety  — the SAME memory applied to a DIFFERENT clip: fraction
      of that clip's detections wrongly suppressed (should be ~0: different lesions
      at different locations must NOT be hidden).
  (C) Auto-capture (confirm) — same as (A) but with the confirmed-lesion rule (0.5).

Detection, viewport, per-class and de-dup rules mirror measure_filters.py /
pipeline_controller.py exactly. Run on the GPU host:
    python3 measure_memory.py CLIP [CLIP ...]
"""
import os
import sys

import cv2
import numpy as np
import torch
from ultralytics import YOLO

DEVICE = 0 if torch.cuda.is_available() else "cpu"
MODEL = os.environ.get("MODEL", "/home/emie/DATN_ver0/models/best_train6.pt")
MAX_FRAMES = int(os.environ.get("MAX_FRAMES", "4000"))
FRAME_STEP = 2
CLEAN = {0: "Viêm thực quản", 1: "Viêm dạ dày HP", 2: "Ung thư thực quản",
         3: "Ung thư dạ dày", 4: "Loét hoành tá tràng"}
CONF = {"Viêm thực quản": 0.60, "Viêm dạ dày HP": 0.60, "Ung thư thực quản": 0.75,
        "Ung thư dạ dày": 0.75, "Loét hoành tá tràng": 0.60}
MAX_BBOX_AREA_RATIO = 0.95
DEDUP_IOU, DEDUP_WINDOW_MS = 0.25, 10000
DIFFUSE_CENTER_FRAC, DIFFUSE_COOLDOWN_MS = 0.18, 7000
FP_IOU = 0.6        # db.matches_false_positive
CONFIRM_IOU = 0.5   # pipeline _CONFIRM_IOU
MAX_FP_AREA_RATIO = 0.7  # db._MAX_FP_AREA_RATIO — a rejected bbox bigger than this is not stored


def detect_viewport(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    H, W = frame.shape[0], frame.shape[1]
    if not cnts:
        return (0, 0, W, H)
    x, y, w, h = cv2.boundingRect(max(cnts, key=cv2.contourArea))
    return (x, y, w, h) if w * h >= 0.3 * W * H else (0, 0, W, H)


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua else 0.0


def measure(model, path):
    """Return (surfaced, raw) lists of (label, bbox_1080) — surfaced = post-dedup
    alerts the clinician acts on; raw = every qualifying detection (the lesion's
    recurring appearances)."""
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    vp = None
    surfaced, raw = [], []
    history = []
    fi, n_inf = -1, 0
    while n_inf < MAX_FRAMES:
        ok, frame = cap.read()
        if not ok:
            break
        fi += 1
        if fi % FRAME_STEP:
            continue
        n_inf += 1
        H, W = frame.shape[0], frame.shape[1]
        if vp is None:
            vp = detect_viewport(frame)
        vx, vy, vw, vh = vp
        vp_area = vw * vh
        ts = fi / fps * 1000.0
        res = model(frame, conf=0.25, verbose=False, device=DEVICE)
        for b in res[0].boxes:
            cls = int(b.cls[0]); conf = float(b.conf[0])
            label = CLEAN.get(cls, str(cls))
            x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            if not ((vx <= cx <= vx + vw) and (vy <= cy <= vy + vh)):
                continue
            if conf < CONF.get(label, 0.5):
                continue
            if (x2 - x1) * (y2 - y1) > MAX_BBOX_AREA_RATIO * vp_area:
                continue
            bb = [x1 * 1920 / W, y1 * 1080 / H, x2 * 1920 / W, y2 * 1080 / H]
            raw.append((label, bb))
            diffuse = "viêm" in label.lower()
            dup = False
            for (rts, rbb, rlab) in history:
                if rlab != label:
                    continue
                if diffuse:
                    if ts - rts < DIFFUSE_COOLDOWN_MS:
                        rcx, rcy = (rbb[0]+rbb[2])/2, (rbb[1]+rbb[3])/2
                        ccx, ccy = (bb[0]+bb[2])/2, (bb[1]+bb[3])/2
                        if ((ccx-rcx)**2 + (ccy-rcy)**2) ** 0.5 <= DIFFUSE_CENTER_FRAC*1920:
                            dup = True; break
                elif ts - rts < DEDUP_WINDOW_MS and iou(rbb, bb) >= DEDUP_IOU:
                    dup = True; break
            if dup:
                continue
            history.append((ts, bb, label))
            # only store as a rejectable FP if not near-full-frame (db._MAX_FP_AREA_RATIO)
            if (bb[2]-bb[0])*(bb[3]-bb[1]) <= MAX_FP_AREA_RATIO * 1920 * 1080:
                surfaced.append((label, bb))
    cap.release()
    return surfaced, raw


def matched(det, memory, thr):
    lab, bb = det
    return any(mlab == lab and iou(mbb, bb) >= thr for (mlab, mbb) in memory)


def main():
    model = YOLO(MODEL)
    clips = sys.argv[1:]
    data = {}
    print(f"model={MODEL}  FP_IoU={FP_IOU}  confirm_IoU={CONFIRM_IOU}\n")
    for p in clips:
        surfaced, raw = measure(model, p)
        data[p] = (surfaced, raw)
        # (A) targeted suppression: reject this clip's surfaced lesions -> coverage over its own raw stream
        supp = sum(1 for d in raw if matched(d, surfaced, FP_IOU))
        cap_ = sum(1 for d in raw if matched(d, surfaced, CONFIRM_IOU))
        n = os.path.basename(p)
        print(f"{n}: surfaced lesions={len(surfaced)}  qualifying dets={len(raw)}")
        print(f"  [ignore]  reject {len(surfaced)} surfaced -> auto-suppress {supp}/{len(raw)} "
              f"({100*supp/len(raw) if raw else 0:.1f}%) of recurring detections")
        print(f"  [confirm] auto-capture {cap_}/{len(raw)} "
              f"({100*cap_/len(raw) if raw else 0:.1f}%)\n")
    # (B) cross-clip specificity: memory from clip A applied to clip B's detections
    print("=== cross-clip specificity (memory from row-clip applied to col-clip's dets) ===")
    names = [os.path.basename(p) for p in clips]
    tot_self_supp = tot_self = tot_cross_supp = tot_cross = 0
    for pa in clips:
        memA = data[pa][0]
        row = []
        for pb in clips:
            rawB = data[pb][1]
            wrong = sum(1 for d in rawB if matched(d, memA, FP_IOU))
            pct = 100*wrong/len(rawB) if rawB else 0
            row.append(f"{pct:5.1f}%")
            if pa == pb:
                tot_self_supp += wrong; tot_self += len(rawB)
            else:
                tot_cross_supp += wrong; tot_cross += len(rawB)
        print(f"  {os.path.basename(pa)[:22]:22} -> " + " ".join(row))
    print(f"\n=== AGGREGATE ===")
    print(f"[ignore] targeted (same clip) auto-suppressed {tot_self_supp}/{tot_self} "
          f"({100*tot_self_supp/tot_self if tot_self else 0:.1f}%)")
    print(f"[ignore] cross-clip false suppression {tot_cross_supp}/{tot_cross} "
          f"({100*tot_cross_supp/tot_cross if tot_cross else 0:.2f}%)  <- specificity")


if __name__ == "__main__":
    main()
