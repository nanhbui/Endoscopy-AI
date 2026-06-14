#!/usr/bin/env python3
"""Auto-build a lesion ReID dataset (Market-1501 layout) from endoscopy videos.

Pipeline: YOLO detect → StrongSORT track → each track = one lesion *identity* →
crop its bbox across frames. Crops are saved as Market-1501-style filenames
`{id:04d}_c{cam}s1_{frame:06d}_{idx:02d}.jpg` so they merge straight into the
existing `reid_dataset/endocv/bounding_box_train`.

Run on the GPU server (has model + boxmot + the library videos):

  python scripts/build_reid_dataset.py \
      --videos data/library \
      --out    data/reid_auto \
      --model  models/best_train6.pt \
      --reid   sample_code/endocv_2024/osnet_x0_25_endocv_30.pt \
      --id-offset 100

Then merge:  cp data/reid_auto/bounding_box_train/* \
                sample_code/endocv_2024/reid_dataset/endocv/bounding_box_train/

NOTE: track IDs are imperfect (StrongSORT can split/merge identities) — a manual
cleaning pass (drop bad crops, merge/split IDs) is recommended before final training.
"""
from __future__ import annotations

import argparse
import glob
import os
from pathlib import Path

import cv2
import numpy as np


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--videos", required=True, help="dir of *.mp4 (one camera per video) or a single file")
    ap.add_argument("--out", default="data/reid_auto")
    ap.add_argument("--model", default="models/best_train6.pt")
    ap.add_argument("--reid", default="sample_code/endocv_2024/osnet_x0_25_endocv_30.pt")
    ap.add_argument("--conf", type=float, default=0.5)
    ap.add_argument("--frame-step", type=int, default=3, help="run detection every Nth frame")
    ap.add_argument("--per-track-step", type=int, default=6, help="save 1 crop every Nth detection of a track")
    ap.add_argument("--max-per-track", type=int, default=40)
    ap.add_argument("--min-size", type=int, default=40, help="min bbox side (px) to keep")
    ap.add_argument("--pad", type=float, default=0.10, help="bbox padding fraction")
    ap.add_argument("--id-offset", type=int, default=100, help="start identity numbering here (avoid colliding with existing IDs)")
    ap.add_argument("--min-track-crops", type=int, default=2, help="drop identities with fewer than this many crops")
    return ap.parse_args()


def main():
    args = parse_args()
    import torch
    from ultralytics import YOLO
    from boxmot.trackers.strongsort.strongsort import StrongSort

    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model = YOLO(args.model)
    try:
        model.fuse()
    except Exception:
        pass

    if os.path.isdir(args.videos):
        vids = sorted(v for v in glob.glob(os.path.join(args.videos, "*.mp4"))
                      if not v.endswith("_proxy.mp4"))   # skip the low-res playback proxies
    else:
        vids = [args.videos]
    if not vids:
        raise SystemExit(f"No videos found under {args.videos}")

    out_dir = Path(args.out) / "bounding_box_train"
    out_dir.mkdir(parents=True, exist_ok=True)

    reid_abs = os.path.abspath(args.reid)
    next_global_id = args.id_offset
    total_crops = 0
    kept_ids = 0

    for cam, vid in enumerate(vids, start=1):
        # Fresh tracker per video — a lesion's identity never carries across videos.
        tracker = StrongSort(
            reid_weights=reid_abs, device=device, half=torch.cuda.is_available(),
            n_init=1, max_age=60, max_iou_dist=0.85, max_cos_dist=0.4,
        )
        cap = cv2.VideoCapture(vid)
        if not cap.isOpened():
            print(f"[skip] cannot open {vid}", flush=True)
            continue

        fi = 0
        det_seen: dict[int, int] = {}     # track_id → # detections seen (for throttle)
        saved: dict[int, int] = {}        # track_id → # crops saved
        idmap: dict[int, int] = {}        # local track_id → global identity
        # Buffer crops per local id so we can drop identities with too few crops.
        buf: dict[int, list[tuple[str, np.ndarray]]] = {}

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if fi % args.frame_step != 0:
                fi += 1
                continue

            results = model(frame, conf=args.conf, verbose=False)
            dets = []
            for r in results:
                if r.boxes is None:
                    continue
                for b in r.boxes:
                    if b.conf is None or b.conf.shape[0] == 0:
                        continue
                    x1, y1, x2, y2 = b.xyxy[0].tolist()
                    dets.append([x1, y1, x2, y2, float(b.conf[0]), int(b.cls[0])])
            dets_np = np.array(dets, dtype=np.float32) if dets else np.empty((0, 6), dtype=np.float32)

            try:
                tracks = tracker.update(dets_np, frame)
            except Exception as e:
                print(f"[warn] tracker error frame {fi}: {e}", flush=True)
                fi += 1
                continue

            for t in tracks:
                x1, y1, x2, y2 = map(int, t[:4])
                tid = int(t[4])
                w, h = x2 - x1, y2 - y1
                if w < args.min_size or h < args.min_size:
                    continue
                det_seen[tid] = det_seen.get(tid, 0) + 1
                if det_seen[tid] % args.per_track_step != 0:
                    continue
                if saved.get(tid, 0) >= args.max_per_track:
                    continue
                px, py = int(w * args.pad), int(h * args.pad)
                X1, Y1 = max(0, x1 - px), max(0, y1 - py)
                X2, Y2 = min(frame.shape[1], x2 + px), min(frame.shape[0], y2 + py)
                crop = frame[Y1:Y2, X1:X2]
                if crop.size == 0 or crop.mean() < 25 or crop.std() < 12:
                    continue  # too dark / uniform
                if tid not in idmap:
                    idmap[tid] = next_global_id
                    next_global_id += 1
                gid = idmap[tid]
                cnt = saved.get(tid, 0)
                fname = f"{gid:04d}_c{cam}s1_{fi:06d}_{cnt:02d}.jpg"
                buf.setdefault(tid, []).append((fname, crop))
                saved[tid] = cnt + 1
            fi += 1
        cap.release()

        # Flush buffered crops, dropping identities with too few samples.
        for tid, items in buf.items():
            if len(items) < args.min_track_crops:
                continue
            kept_ids += 1
            for fname, crop in items:
                cv2.imwrite(str(out_dir / fname), crop)
                total_crops += 1
        print(f"[{cam}/{len(vids)}] {os.path.basename(vid)}: "
              f"{len([1 for v in buf.values() if len(v) >= args.min_track_crops])} ids kept "
              f"(next global id {next_global_id})", flush=True)

    print(f"\nDone. {total_crops} crops · {kept_ids} identities → {out_dir}")
    print("Merge into the training set with:")
    print(f"  cp {out_dir}/* sample_code/endocv_2024/reid_dataset/endocv/bounding_box_train/")


if __name__ == "__main__":
    main()
