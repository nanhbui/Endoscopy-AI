"""RAG retrieval over the curated GI-endoscopy guideline knowledge base.

Design:
- KB chunks + vectors are loaded once from SQLite into module-level arrays.
- Cosine similarity (numpy, in-memory) — corpus is ~5 chunks, KISS wins.
- Embedder is dependency-injectable via `embed_fn` param (tests use fake fn).
- `format_evidence_block` is the ONE shared formatter (DRY) used by both
  lesion-report and session-summary prompt builders.

Startup:
    kb_rag.warm()  # called in _warm_vlm hook; best-effort, never blocks boot.

Test injection:
    evidence = retrieve_evidence("query", k=3, embed_fn=lambda s: [0.0]*4)
"""
from __future__ import annotations

import math
from typing import Callable, Optional

from loguru import logger

# Module-level cache: populated lazily on first retrieve_evidence call or warm().
_chunks: list[dict] = []          # each dict: {citation_label, source_guideline, body_region, text, vector, ...}
_loaded: bool = False


def _load_kb() -> None:
    """Load KB chunks from SQLite into module arrays. Idempotent."""
    global _chunks, _loaded
    if _loaded:
        return
    try:
        from db import load_kb_chunks  # noqa: PLC0415
        _chunks = load_kb_chunks()
        _loaded = True
        logger.info("kb_rag: loaded {} chunks from kb_chunks table", len(_chunks))
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning("kb_rag: failed to load KB chunks: {}", exc)
        _chunks = []
        _loaded = False


def warm() -> None:
    """Pre-load KB into memory at startup — best-effort, never raises."""
    try:
        _load_kb()
    except Exception as exc:  # pragma: no cover
        logger.warning("kb_rag.warm: {}", exc)


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two equal-length float vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def retrieve_evidence(
    query: str,
    k: int = 3,
    min_sim: float = 0.3,
    embed_fn: Optional[Callable[[str], list[float]]] = None,
) -> list[dict]:
    """Return top-k KB chunks most similar to `query` (cosine ≥ min_sim).

    Args:
        query: text to embed and compare against KB vectors.
        k: maximum number of chunks to return.
        min_sim: minimum cosine similarity threshold (0.0–1.0).
        embed_fn: optional override for the embed function (used in tests to
                  avoid loading the 2.2 GB bge-m3 model).

    Returns:
        List of chunk dicts sorted by similarity descending. Each dict has:
        citation_label, source_guideline, body_region, text, similarity (added).
        Empty list when KB is empty or no chunk meets min_sim.
    """
    _load_kb()
    if not _chunks:
        return []

    # Resolve embed function: injected override → embeddings module default.
    if embed_fn is None:
        from embeddings import embed_text as _embed  # noqa: PLC0415
        embed_fn = _embed

    try:
        q_vec = embed_fn(query)
    except Exception as exc:
        logger.warning("kb_rag.retrieve_evidence: embed failed: {}", exc)
        return []

    scored: list[tuple[float, dict]] = []
    for chunk in _chunks:
        c_vec = chunk.get("vector", [])
        if len(c_vec) != len(q_vec):
            continue
        sim = _cosine(q_vec, c_vec)
        if sim >= min_sim:
            scored.append((sim, chunk))

    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[:k]
    return [
        {**ch, "similarity": round(sim, 4)}
        for sim, ch in top
    ]


def format_evidence_block(chunks: list[dict]) -> str:
    """Format retrieved chunks into a bilingual evidence block for LLM prompts.

    This is the ONE shared formatter (DRY) — both lesion-report and session-
    summary builders call this. Returns "" when chunks is empty so callers can
    use `if evidence_block:` to skip insertion.

    Output structure:
        ## BẰNG CHỨNG (Evidence)
        [citation_label] source_guideline (year) — body_region
        <text>

        ... (repeated for each chunk)

        [CITATION RULE] ...
    """
    if not chunks:
        return ""

    lines: list[str] = ["## BẰNG CHỨNG (Evidence)"]
    for ch in chunks:
        label = ch.get("citation_label", "?")
        source = ch.get("source_guideline", "")
        year = ch.get("year", "")
        region = ch.get("body_region", "")
        text = ch.get("text", "")
        header = f"{label} {source}"
        if year:
            header += f" ({year})"
        if region:
            header += f" — {region}"
        lines.append(header)
        lines.append(text)
        lines.append("")  # blank separator between chunks

    lines.append(
        "[QUY TẮC TRÍCH DẪN] Khi đưa khuyến nghị cụ thể (số mảnh sinh thiết, "
        "khoảng cách theo dõi surveillance interval, phân loại cụ thể) BẮT BUỘC "
        "trích dẫn [citation_label] tương ứng từ BẰNG CHỨNG trên. "
        "Nếu không có evidence phù hợp, giữ khuyến nghị chung chung (không trích dẫn bịa đặt)."
    )
    return "\n".join(lines)


def valid_citation_labels(chunks: list[dict]) -> set[str]:
    """Return the set of citation_label strings present in retrieved chunks.

    Used by the post-check in endoscopy_ws_server to drop any model-hallucinated
    [label] tags that were NOT in the injected evidence block.
    """
    return {ch["citation_label"] for ch in chunks if ch.get("citation_label")}
