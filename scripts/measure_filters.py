#!/usr/bin/env python3
"""measure_filters.py — Quantify two application-level contributions of the system,
on real videos, without needing detection ground truth:

  (#2) Viewport filter  — fraction of full-frame detections that fall OUTSIDE the
       auto-detected scope viewport (i.e. in the info panel / UI chrome) and are
       therefore never seen by the production pipeline, which runs the detector on
       the viewport crop only.

  (#1) Alert de-duplication — number of raw qualifying detections (per-class
       confidence + area filter) versus the number of alerts actually surfaced after
       the spatial-temporal (focal) and position-aware cooldown (diffuse) de-dup
       rules. NOTE: track-id de-dup (UTR-Track ReID) is an ADDITIONAL layer not
       reproduced here, so the real reduction is at least this large.

Rules and constants mirror src/backend/pipeline/pipeline_controller.py.

Usage (on the GPU host):
    python3 measure_filters.py VIDEO [VIDEO ...]   # model path can be overridden via MODEL=
"""
import os
import sys

import cv2
import numpy as np
from ultralytics import YOLO

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
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    vp = None
    total, out_panel, raw, surfaced = 0, 0, 0, 0
    history = []  # (ts_ms, bbox_1080, label)
    fi = -1
    n_inf = 0
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
        res = model(frame, conf=0.25, verbose=False, device=0)
        for b in res[0].boxes:
            cls = int(b.cls[0]); conf = float(b.conf[0])
            label = CLEAN.get(cls, str(cls))
            x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            total += 1
            inside = (vx <= cx <= vx + vw) and (vy <= cy <= vy + vh)
            if not inside:
                out_panel += 1            # viewport crop suppresses this (#2)
                continue
            if conf < CONF.get(label, 0.5):
                continue
            if (x2 - x1) * (y2 - y1) > MAX_BBOX_AREA_RATIO * vp_area:
                continue
            raw += 1                       # qualifying alert candidate (pre-dedup)
            bb = [x1 * 1920 / W, y1 * 1080 / H, x2 * 1920 / W, y2 * 1080 / H]
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
                else:
                    if ts - rts < DEDUP_WINDOW_MS and iou(rbb, bb) >= DEDUP_IOU:
                        dup = True; break
            if dup:
                continue
            surfaced += 1
            history.append((ts, bb, label))
    cap.release()
    return dict(name=os.path.basename(path), vp=vp, frames=n_inf, total=total,
                out_panel=out_panel, raw=raw, surfaced=surfaced)


def main():
    model = YOLO(MODEL)
    agg = dict(total=0, out_panel=0, raw=0, surfaced=0)
    print(f"model={MODEL}  FRAME_STEP={FRAME_STEP}  MAX_FRAMES={MAX_FRAMES}\n")
    for path in sys.argv[1:]:
        r = measure(model, path)
        for k in agg:
            agg[k] += r[k]
        panel_pct = 100*r["out_panel"]/r["total"] if r["total"] else 0
        ded_pct = 100*(r["raw"]-r["surfaced"])/r["raw"] if r["raw"] else 0
        print(f"{r['name']}: vp={r['vp']} frames={r['frames']}")
        print(f"  [#2 viewport] full-frame dets={r['total']}  in-panel(suppressed)={r['out_panel']} ({panel_pct:.1f}%)")
        print(f"  [#1 dedup]    raw alerts={r['raw']}  surfaced={r['surfaced']}  reduction={ded_pct:.1f}%\n")
    if agg["total"]:
        print("=== AGGREGATE ===")
        print(f"[#2] full-frame dets={agg['total']}  in-panel suppressed={agg['out_panel']} "
              f"({100*agg['out_panel']/agg['total']:.1f}%)")
        if agg["raw"]:
            print(f"[#1] raw alerts={agg['raw']}  surfaced={agg['surfaced']}  "
                  f"reduction={100*(agg['raw']-agg['surfaced'])/agg['raw']:.1f}% "
                  f"(excl. track-id dedup)")


if __name__ == "__main__":
    main()
