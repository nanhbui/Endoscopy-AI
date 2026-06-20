"""Ollama-backed text embedding helper for the KB RAG layer.

Why Ollama instead of sentence-transformers:
  - The server's tracker (boxmot) pins regex<2025, while transformers (pulled in
    by sentence-transformers) pins regex>=2025 — irreconcilable in one process.
  - Ollama already runs locally with its models on /mnt/disk2, so embeddings via
    its /api/embeddings endpoint avoid the heavy Python ML stack and the disk hit
    on the (near-full) root volume entirely.

embed_text(s) -> list[float]. The HTTP client is created lazily on first real
call; tests inject `_embed_fn_override` to stay hermetic (no network, no model).

Config (env):
  KB_EMBED_MODEL       embedding model name in Ollama   (default: bge-m3)
  KB_EMBED_OLLAMA_URL  Ollama base URL                  (default: OLLAMA_BASE_URL
                       or http://localhost:11434)
  KB_EMBED_TIMEOUT     per-request timeout seconds      (default: 30)

Test injection:
    import embeddings as emb
    emb._embed_fn_override = lambda s: [0.0] * 4
"""
from __future__ import annotations

import os
from typing import Callable, Optional

# Public override hook — tests set this to a fake fn to stay hermetic.
# None means "use the real Ollama endpoint".
_embed_fn_override: Optional[Callable[[str], list[float]]] = None

# Lazily-created HTTP client singleton (populated on first real call).
_client = None


def _ollama_url() -> str:
    """Resolve the Ollama base URL at call time so runtime env is honored.

    OLLAMA_BASE_URL is usually the OpenAI-compatible base (…:11434/v1) used by the
    chat client, but Ollama's native embeddings live at the ROOT (…/api/embeddings),
    not under /v1 — so strip a trailing /v1 to avoid the 404 …/v1/api/embeddings."""
    url = os.getenv("KB_EMBED_OLLAMA_URL") or os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434"
    url = url.rstrip("/")
    if url.endswith("/v1"):
        url = url[:-len("/v1")].rstrip("/")
    return url


def _get_client():
    """Return a lazily-created httpx.Client. Import is deferred so the module
    loads with zero heavy imports (keeps tests fast and hermetic)."""
    global _client
    if _client is None:
        import httpx  # noqa: PLC0415 — deferred so module import stays light
        _client = httpx.Client(timeout=float(os.getenv("KB_EMBED_TIMEOUT", "30")))
    return _client


def embed_text(text: str) -> list[float]:
    """Embed a single string → list[float] via Ollama /api/embeddings using
    KB_EMBED_MODEL (default bge-m3).

    If _embed_fn_override is set (tests), delegates to it without any network
    call. Raises on HTTP error or empty embedding so the caller (kb_rag) can
    fall back to an empty evidence block.
    """
    if _embed_fn_override is not None:
        return _embed_fn_override(text)
    model = os.getenv("KB_EMBED_MODEL", "bge-m3")
    resp = _get_client().post(
        f"{_ollama_url()}/api/embeddings",
        json={"model": model, "prompt": text},
    )
    resp.raise_for_status()
    vec = resp.json().get("embedding")
    if not vec:
        raise RuntimeError(f"Ollama returned no embedding for model '{model}'")
    return vec
