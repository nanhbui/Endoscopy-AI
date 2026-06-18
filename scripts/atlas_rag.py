#!/usr/bin/env python3
"""
Multimodal RAG over a reference ATLAS of labelled endoscopy images ("Option D").

Idea: instead of fine-tuning the VLM, ground its image analysis by retrieving the
most visually-similar CONFIRMED reference cases and injecting them into the prompt
("this lesion resembles these known Paris-classified cases ..."). Needs only a small
labelled atlas (dozens–hundreds of images), NOT a training set.

Pipeline:
  1. build_index(atlas_dir)  → embed every reference image with a (Biomed)CLIP
     encoder, save embeddings + metadata to disk.
  2. retrieve(query_image)   → cosine top-k similar reference cases.
  3. format_for_prompt(hits) → a text block to prepend to the lesion-report prompt.

Atlas layout (one of):
  atlas/<label>/<image>.jpg                      # label = folder name
  atlas/<image>.jpg + atlas/<image>.json         # sidecar {label, paris, note}

Embedding model: default OpenAI CLIP (general). For medical retrieval, set
ATLAS_CLIP_MODEL to a biomedical CLIP (e.g. microsoft/BiomedCLIP via open_clip) —
better at endoscopy similarity. Cosine search is plain NumPy (no FAISS needed;
fine for a few thousand vectors).

CLI:
  python scripts/atlas_rag.py build  --atlas /mnt/disk2/atlas --out /mnt/disk2/atlas_index
  python scripts/atlas_rag.py query  --index /mnt/disk2/atlas_index --image crop.jpg --k 3
"""
import argparse
import json
import os
from pathlib import Path

import numpy as np

_MODEL = os.environ.get("ATLAS_CLIP_MODEL", "openai/clip-vit-base-patch32")
_clip = {"model": None, "proc": None}


def _load_clip():
    if _clip["model"] is None:
        import torch
        from transformers import CLIPModel, CLIPProcessor
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        _clip["model"] = CLIPModel.from_pretrained(_MODEL).to(dev).eval()
        _clip["proc"] = CLIPProcessor.from_pretrained(_MODEL)
        _clip["dev"] = dev
    return _clip


def embed_images(paths: list[Path]) -> np.ndarray:
    import torch
    from PIL import Image
    c = _load_clip()
    vecs = []
    for p in paths:
        img = Image.open(p).convert("RGB")
        inp = c["proc"](images=img, return_tensors="pt").to(c["dev"])
        with torch.no_grad():
            v = c["model"].get_image_features(**inp)[0]
        v = v / v.norm()
        vecs.append(v.cpu().numpy())
    return np.vstack(vecs).astype("float32")


def _atlas_items(atlas_dir: Path) -> list[dict]:
    items = []
    for p in atlas_dir.rglob("*"):
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        meta = {"path": str(p), "label": p.parent.name}  # label = folder by default
        side = p.with_suffix(".json")
        if side.exists():
            try:
                meta.update(json.loads(side.read_text()))
            except Exception:
                pass
        items.append(meta)
    return items


def build_index(atlas_dir: str, out_dir: str) -> None:
    atlas_dir, out = Path(atlas_dir), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    items = _atlas_items(atlas_dir)
    if not items:
        print(f"[atlas] no images under {atlas_dir}"); return
    print(f"[atlas] embedding {len(items)} reference images with {_MODEL} ...")
    emb = embed_images([Path(i["path"]) for i in items])
    np.save(out / "emb.npy", emb)
    (out / "meta.json").write_text(json.dumps(items, ensure_ascii=False, indent=2))
    print(f"[atlas] index → {out} ({emb.shape[0]} vectors, dim {emb.shape[1]})")


def retrieve(index_dir: str, image: str, k: int = 3) -> list[dict]:
    out = Path(index_dir)
    emb = np.load(out / "emb.npy")
    meta = json.loads((out / "meta.json").read_text())
    q = embed_images([Path(image)])[0]
    sims = emb @ q                       # cosine (vectors are L2-normalised)
    top = np.argsort(-sims)[:k]
    return [{**meta[i], "score": float(sims[i])} for i in top]


def format_for_prompt(hits: list[dict]) -> str:
    """Text block to prepend to the lesion-report prompt for grounding."""
    if not hits:
        return ""
    lines = ["Tham khảo các ca đã xác nhận có hình ảnh TƯƠNG TỰ (chỉ để đối chiếu, "
             "không thay thế quan sát trực tiếp):"]
    for h in hits:
        bits = [f"nhãn={h.get('label','?')}"]
        if h.get("paris"):
            bits.append(f"Paris={h['paris']}")
        if h.get("note"):
            bits.append(h["note"])
        lines.append(f"  - ({h['score']:.2f}) " + ", ".join(bits))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--atlas", required=True); b.add_argument("--out", required=True)
    q = sub.add_parser("query"); q.add_argument("--index", required=True); q.add_argument("--image", required=True); q.add_argument("--k", type=int, default=3)
    a = ap.parse_args()
    if a.cmd == "build":
        build_index(a.atlas, a.out)
    else:
        hits = retrieve(a.index, a.image, a.k)
        print(format_for_prompt(hits))


if __name__ == "__main__":
    main()
