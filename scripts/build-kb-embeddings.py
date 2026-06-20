"""Offline one-shot script: embed KB JSON files → store vectors in SQLite.

Run once at deploy time (or after editing KB files):
    python scripts/build-kb-embeddings.py

Requires a running Ollama with an embedding model pulled (default: bge-m3 →
`ollama pull bge-m3`). Set KB_EMBED_MODEL / KB_EMBED_OLLAMA_URL to override.
Point ENDOSCOPY_DB_PATH at the target DB before running.

Idempotent: clears existing kb_chunks rows before reinserting so reruns are safe.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Make src/backend/api importable from repo root.
REPO_ROOT = Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "src" / "backend" / "api"
sys.path.insert(0, str(API_DIR))

from db import init_db, clear_kb_chunks, save_kb_chunk  # noqa: E402
from embeddings import embed_text  # noqa: E402

KB_DIR = API_DIR / "kb"


def _load_kb_files() -> list[dict]:
    """Read all *.json files from kb/ directory, skip metadata-only keys."""
    chunks = []
    for fp in sorted(KB_DIR.glob("*.json")):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  WARN: skipping {fp.name}: {e}")
            continue
        # Each file is one chunk — validate required fields.
        required = {"citation_label", "source_guideline", "body_region", "text_vi", "text_en"}
        missing = required - set(data.keys())
        if missing:
            print(f"  WARN: {fp.name} missing fields {missing} — skipping")
            continue
        chunks.append({"file": fp.name, **data})
    return chunks


def main() -> None:
    print("=== build-kb-embeddings: start ===")
    init_db()

    chunks = _load_kb_files()
    if not chunks:
        print("ERROR: no valid KB files found in", KB_DIR)
        sys.exit(1)
    print(f"  Loaded {len(chunks)} KB chunks from {KB_DIR}")

    # Idempotent: clear old rows first.
    removed = clear_kb_chunks()
    print(f"  Cleared {removed} old kb_chunks rows")

    for ch in chunks:
        # Embed combined bilingual text (vi + en) for bilingual retrieval.
        combined = ch["text_vi"] + " " + ch["text_en"]
        print(f"  Embedding {ch['citation_label']} ({ch['file']}) …", end=" ", flush=True)
        vector = embed_text(combined)
        ok = save_kb_chunk(
            citation_label=ch["citation_label"],
            source_guideline=ch["source_guideline"],
            body_region=ch["body_region"],
            text=combined,
            vector=vector,
            lang="bilingual",
        )
        status = "OK" if ok else "FAILED"
        print(f"{status}  dim={len(vector)}")

    print(f"=== build-kb-embeddings: done ({len(chunks)} chunks) ===")


if __name__ == "__main__":
    main()
