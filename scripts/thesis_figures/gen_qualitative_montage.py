#!/usr/bin/env python3
"""gen_qualitative_montage.py — Build the Chapter-5 qualitative-results montage
(fig:qual-results) from REAL detection logs.

Source: sample_code/gastroeye/videologs/<session>/NNNNNN.{jpg,yaml}. Each per-frame
YAML carries the detector's output (label + confidence + bbox) for that real clinical
frame. For each of the five lesion classes this script picks the highest-confidence
detection, draws the severity-coloured box + label chip, and tiles them into one
figure. These are genuine system detections on real gastroscopy frames (not synthetic).

Usage:
    python3 scripts/thesis_figures/gen_qualitative_montage.py [OUT_DIR]
"""
from __future__ import annotations

import glob
import sys
from pathlib import Path

import cv2
import yaml

ROOT = Path(__file__).resolve().parents[2]
LOGS = ROOT / "sample_code/gastroeye/videologs"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "GRADUATION_THESIS_TEMPLATE__ENG_VER_/Figures")

# Five target classes → (English label, severity colour BGR). Palette matches the
# bounding-box language used elsewhere: cancer red, inflammation orange, ulcer green.
CLASSES = {
    "Ung thư thực quản":   ("Esophageal cancer", (82, 78, 196)),   # #C44E52
    "Ung thư dạ dày":      ("Gastric cancer",    (82, 78, 196)),
    "Viêm thực quản":      ("Esophagitis",       (82, 132, 221)),  # #DD8452
    "Viêm dạ dày HP":      ("H. pylori gastritis",(82, 132, 221)),
    "Loét hoành tá tràng": ("Duodenal-bulb ulcer",(104, 168, 85)), # #55A868
}


# Keep boxes that are localised lesions, not near-whole-frame detections (which the
# production pipeline suppresses via MAX_BBOX_AREA_RATIO=0.95). A representative
# qualitative example has a box covering a sensible fraction of the frame.
AREA_MIN, AREA_MAX = 0.004, 0.60


def best_per_class() -> dict:
    """For each class, pick the highest-confidence detection whose box is a
    localised lesion (area fraction within [AREA_MIN, AREA_MAX])."""
    cand: dict = {}
    for y in glob.glob(str(LOGS / "*" / "0*.yaml")):
        try:
            with open(y, "r", encoding="utf-8") as f:
                doc = yaml.safe_load(f)
        except Exception:
            continue
        res = ((doc or {}).get("lesion_det") or {}).get("result") or []
        if isinstance(res, dict):
            res = [res]
        for r in res:
            lab = r.get("label")
            img = Path(y).with_suffix(".jpg")
            if lab in CLASSES and img.exists():
                cand.setdefault(lab, []).append(
                    (float(r.get("confidence", 0)), img, r.get("bbox") or {}))

    best: dict = {}
    for lab, items in cand.items():
        for conf, img, bbox in sorted(items, key=lambda t: -t[0]):
            im = cv2.imread(str(img))
            if im is None:
                continue
            H, W = im.shape[0], im.shape[1]
            bx, by = bbox.get("x", 0), bbox.get("y", 0)
            bw, bh = bbox.get("width", 0), bbox.get("height", 0)
            area = (bw * bh) / (W * H)
            aspect = (bw / bh) if bh else 0       # reject sliver boxes
            # fully contained (not hugging a frame border → not whole-frame / edge sliver)
            contained = (bx >= 0.01 * W and by >= 0.01 * H
                         and bx + bw <= 0.99 * W and by + bh <= 0.99 * H)
            if AREA_MIN <= area <= AREA_MAX and 0.4 <= aspect <= 2.5 and contained:
                best[lab] = (conf, img, bbox)
                break
    return best


def draw(img_path: Path, bbox: dict, eng: str, conf: float, color) -> "any":
    im = cv2.imread(str(img_path))
    x, y = int(bbox.get("x", 0)), int(bbox.get("y", 0))
    w, h = int(bbox.get("width", 0)), int(bbox.get("height", 0))
    # draw the raw detected box (no display padding) so large lesions don't inflate
    # to the frame border
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(im.shape[1], x + w), min(im.shape[0], y + h)
    cv2.rectangle(im, (x1, y1), (x2, y2), color, 4)
    chip = f"{eng} {conf*100:.0f}%"
    (tw, th), _ = cv2.getTextSize(chip, cv2.FONT_HERSHEY_SIMPLEX, 0.9, 2)
    cv2.rectangle(im, (x1, max(0, y1 - th - 12)), (x1 + tw + 10, y1), color, -1)
    cv2.putText(im, chip, (x1 + 5, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    return cv2.cvtColor(im, cv2.COLOR_BGR2RGB)


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    best = best_per_class()
    found = [(k, v) for k, v in CLASSES.items() if k in best]
    if not found:
        print("No detections found in logs — aborting.")
        return
    n = len(found)
    cols = 3
    rows = (n + cols - 1) // cols
    fig, axs = plt.subplots(rows, cols, figsize=(cols * 4.2, rows * 3.6))
    axs = axs.ravel() if hasattr(axs, "ravel") else [axs]
    for ax in axs:
        ax.axis("off")
    for ax, (vi_lab, (eng, color)) in zip(axs, found):
        conf, img, bbox = best[vi_lab]
        ax.imshow(draw(img, bbox, eng, conf, color))
        ax.set_title(eng, fontsize=11)
        print(f"  {eng:<22} conf={conf:.2f}  {img.name}")
    fig.tight_layout()
    out = OUT / "fig_5_7_qual_results.pdf"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[fig] {out}")


if __name__ == "__main__":
    main()
