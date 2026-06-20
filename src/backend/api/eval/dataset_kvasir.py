"""Load HyperKvasir labeled-images for evaluation.

HyperKvasir folder layout (labeled-images variant):
    <root>/
        barretts/
            images/
                *.jpg
        barretts-short-segment/
            images/
                *.jpg
        esophagitis-a/
            images/
                *.jpg
        ... (one folder per class)

Usage:
    from eval.dataset_kvasir import iter_samples
    for sample in iter_samples("/data/hyperkvasir", limit=50):
        print(sample["path"], sample["kvasir_class"])

Never imported at test-collection time with heavy deps — pure Path/IO logic.
"""
from __future__ import annotations

from pathlib import Path
from typing import Generator

# HyperKvasir classes included in the evaluation.
# Subset covers upper-GI pathological + landmark classes.
EVAL_CLASSES: tuple[str, ...] = (
    "barretts",
    "barretts-short-segment",
    "esophagitis-a",
    "esophagitis-b-d",
    "polyps",
    "pylorus",
    "retroflex-stomach",
    "z-line",
    "hemorrhoids",
    "ulcerative-colitis-grade-0-1",
    "ulcerative-colitis-grade-1",
    "ulcerative-colitis-grade-1-2",
    "ulcerative-colitis-grade-2",
    "ulcerative-colitis-grade-2-3",
    "ulcerative-colitis-grade-3",
)


def iter_samples(
    root: str | Path,
    limit: int | None = None,
    classes: tuple[str, ...] = EVAL_CLASSES,
    per_class: int | None = None,
) -> Generator[dict, None, None]:
    """Yield sample dicts from HyperKvasir labeled-images folder.

    Args:
        root: Path to the HyperKvasir labeled-images root directory.
        limit: Optional cap on total samples yielded (for pilot N=50 runs).
        classes: Tuple of class folder names to include.
        per_class: Optional cap on samples PER class — yields a balanced,
            stratified sample across all classes instead of front-loading the
            first class. Applied before `limit`.

    Yields:
        dict with keys:
            path (Path)        — absolute image path
            kvasir_class (str) — folder name (ground-truth class)

    Raises:
        FileNotFoundError: when root does not exist.
        ValueError: when root exists but contains no matching class folders.
    """
    root = Path(root)
    if not root.exists():
        raise FileNotFoundError(
            f"HyperKvasir root not found: {root}\n"
            "Download from https://datasets.simula.no/hyper-kvasir/ "
            "and set --kvasir-dir to the labeled-images/ subfolder."
        )

    found_any = False
    count = 0
    for cls in classes:
        # Real HyperKvasir nests class folders under organ/finding-type, e.g.
        # labeled-images/upper-gi-tract/pathological-findings/<class>/ and
        # lower-gi-tract/... — so locate each class folder ANYWHERE under root
        # (rglob), then collect images from it (recursively, covers an inner
        # images/ subdir or images directly inside).
        class_dirs = [d for d in root.rglob(cls) if d.is_dir()]
        cls_count = 0
        for cdir in class_dirs:
            imgs: list = []
            for pattern in ("*.jpg", "*.jpeg", "*.png"):
                imgs.extend(cdir.rglob(pattern))
            for img_path in sorted(imgs):
                found_any = True
                if per_class is not None and cls_count >= per_class:
                    break
                if limit is not None and count >= limit:
                    return
                yield {"path": img_path, "kvasir_class": cls}
                count += 1
                cls_count += 1
            if per_class is not None and cls_count >= per_class:
                break

    if not found_any:
        raise ValueError(
            f"No HyperKvasir class folders found under {root}. "
            f"Expected subdirectories like: {', '.join(classes[:3])}..."
        )
