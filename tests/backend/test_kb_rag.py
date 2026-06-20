"""Hermetic tests for Phase 2 — KB RAG retrieval, citation formatting, post-check.

Design principles:
- NEVER loads bge-m3 or any real SentenceTransformer model.
- All vector math uses small synthetic 4-dim vectors injected via embed_fn param
  or the _embed_fn_override hook in embeddings.py.
- Tests cosine top-k math, format_evidence_block output, hallucinated-citation
  post-check, no-evidence fallback, and prompt-builder backward compat.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Callable

import pytest

# ── Path setup ────────────────────────────────────────────────────────────────
API_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "backend" / "api"
sys.path.insert(0, str(API_DIR))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm(v: list[float]) -> list[float]:
    """L2-normalise a vector so cosine = dot product."""
    mag = math.sqrt(sum(x * x for x in v))
    return [x / mag for x in v] if mag > 0 else v


# Synthetic 4-dim chunk vectors (normalised for easy cosine prediction).
_VEC_PARIS   = _norm([1.0, 0.0, 0.0, 0.0])   # closest to query_paris
_VEC_SYDNEY  = _norm([0.0, 1.0, 0.0, 0.0])   # closest to query_sydney
_VEC_KYOTO   = _norm([0.0, 0.0, 1.0, 0.0])   # closest to query_kyoto
_VEC_ESGE    = _norm([0.0, 0.0, 0.0, 1.0])

# Synthetic chunks (matches the dict shape returned by load_kb_chunks / retrieve_evidence)
_CHUNKS = [
    {
        "citation_label": "[Paris 2002]",
        "source_guideline": "Paris Workshop 2002",
        "year": 2002,
        "body_region": "upper_gi",
        "text": "Paris classification 0-IIc",
        "vector": _VEC_PARIS,
        "dim": 4,
    },
    {
        "citation_label": "[Sydney 1994]",
        "source_guideline": "Updated Sydney System 1994",
        "year": 1994,
        "body_region": "stomach",
        "text": "Sydney gastritis classification",
        "vector": _VEC_SYDNEY,
        "dim": 4,
    },
    {
        "citation_label": "[Kyoto 2015]",
        "source_guideline": "Kyoto Global Consensus 2015",
        "year": 2015,
        "body_region": "stomach",
        "text": "Kyoto H. pylori gastritis",
        "vector": _VEC_KYOTO,
        "dim": 4,
    },
    {
        "citation_label": "[ESGE 2019]",
        "source_guideline": "ESGE Guideline 2019",
        "year": 2019,
        "body_region": "stomach",
        "text": "ESGE surveillance precancerous",
        "vector": _VEC_ESGE,
        "dim": 4,
    },
]


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_kb_rag_cache():
    """Reset kb_rag module cache between tests so injection is clean."""
    import kb_rag
    kb_rag._chunks = []
    kb_rag._loaded = False
    yield
    kb_rag._chunks = []
    kb_rag._loaded = False


def _inject_chunks(chunks: list[dict]) -> None:
    """Directly inject synthetic chunks into kb_rag module arrays."""
    import kb_rag
    kb_rag._chunks = list(chunks)
    kb_rag._loaded = True


# ── Tests: cosine top-k math ─────────────────────────────────────────────────

class TestRetrieveEvidence:
    def test_top1_returns_paris_for_paris_query(self):
        """Query vector identical to Paris vector → Paris chunk is rank-1."""
        import kb_rag
        _inject_chunks(_CHUNKS)

        # Embed fn returns Paris vector → cosine sim with Paris chunk = 1.0
        result = kb_rag.retrieve_evidence(
            "Paris 0-IIc",
            k=1,
            min_sim=0.3,
            embed_fn=lambda s: list(_VEC_PARIS),
        )
        assert len(result) == 1
        assert result[0]["citation_label"] == "[Paris 2002]"
        assert result[0]["similarity"] > 0.99

    def test_top3_returns_three_chunks_sorted_desc(self):
        """k=3 with query mixing Paris+Sydney+Kyoto → returns 3 in sim order."""
        import kb_rag
        _inject_chunks(_CHUNKS)

        # Query = mix of first 3 axes → Paris > Sydney > Kyoto
        q = _norm([0.9, 0.5, 0.2, 0.0])
        result = kb_rag.retrieve_evidence(
            "mixed query",
            k=3,
            min_sim=0.0,
            embed_fn=lambda s: list(q),
        )
        assert len(result) == 3
        # Must be sorted similarity descending
        sims = [r["similarity"] for r in result]
        assert sims == sorted(sims, reverse=True)
        assert result[0]["citation_label"] == "[Paris 2002]"

    def test_min_sim_filters_low_matches(self):
        """Chunks below min_sim threshold must not appear in results."""
        import kb_rag
        _inject_chunks(_CHUNKS)

        # Only Paris axis active → Sydney/Kyoto/ESGE cos sim = 0.0
        result = kb_rag.retrieve_evidence(
            "Paris query",
            k=4,
            min_sim=0.5,
            embed_fn=lambda s: list(_VEC_PARIS),
        )
        assert all(r["similarity"] >= 0.5 for r in result)
        labels = [r["citation_label"] for r in result]
        assert "[Paris 2002]" in labels
        # Others have 0 similarity and must be excluded
        assert "[Sydney 1994]" not in labels

    def test_empty_kb_returns_empty_list(self):
        """When no chunks loaded, retrieve_evidence returns []."""
        import kb_rag
        # Don't inject — _chunks stays []
        result = kb_rag.retrieve_evidence(
            "any query",
            embed_fn=lambda s: [0.0, 0.0, 0.0, 0.0],
        )
        assert result == []

    def test_embed_fn_exception_returns_empty(self):
        """If embed_fn raises, retrieve_evidence returns [] gracefully."""
        import kb_rag
        _inject_chunks(_CHUNKS)

        def _bad_embed(s: str) -> list[float]:
            raise RuntimeError("embed error")

        result = kb_rag.retrieve_evidence("q", embed_fn=_bad_embed)
        assert result == []

    def test_similarity_key_added_to_result_dicts(self):
        """Each result dict must have a 'similarity' key."""
        import kb_rag
        _inject_chunks(_CHUNKS)
        result = kb_rag.retrieve_evidence(
            "q", k=2, min_sim=0.0, embed_fn=lambda s: list(_VEC_PARIS)
        )
        for r in result:
            assert "similarity" in r


# ── Tests: format_evidence_block ─────────────────────────────────────────────

class TestFormatEvidenceBlock:
    def test_empty_chunks_returns_empty_string(self):
        from kb_rag import format_evidence_block
        assert format_evidence_block([]) == ""

    def test_contains_citation_label_tag(self):
        from kb_rag import format_evidence_block
        block = format_evidence_block(_CHUNKS[:1])
        assert "[Paris 2002]" in block

    def test_contains_source_guideline(self):
        from kb_rag import format_evidence_block
        block = format_evidence_block(_CHUNKS[:1])
        assert "Paris Workshop 2002" in block

    def test_contains_citation_rule_line(self):
        """The requirement line about citing must be present."""
        from kb_rag import format_evidence_block
        block = format_evidence_block(_CHUNKS[:2])
        assert "TRÍCH DẪN" in block or "citation_label" in block.lower() or "QUY TẮC" in block

    def test_multiple_chunks_all_labels_present(self):
        from kb_rag import format_evidence_block
        block = format_evidence_block(_CHUNKS[:3])
        assert "[Paris 2002]" in block
        assert "[Sydney 1994]" in block
        assert "[Kyoto 2015]" in block

    def test_contains_evidence_heading(self):
        from kb_rag import format_evidence_block
        block = format_evidence_block(_CHUNKS[:1])
        assert "BẰNG CHỨNG" in block


# ── Tests: valid_citation_labels ─────────────────────────────────────────────

class TestValidCitationLabels:
    def test_returns_set_of_labels(self):
        from kb_rag import valid_citation_labels
        labels = valid_citation_labels(_CHUNKS[:2])
        assert labels == {"[Paris 2002]", "[Sydney 1994]"}

    def test_empty_chunks_returns_empty_set(self):
        from kb_rag import valid_citation_labels
        assert valid_citation_labels([]) == set()


# ── Tests: hallucinated-citation post-check ───────────────────────────────────

class TestHallucinatedCitationPostCheck:
    """Simulate the post-check logic in _stream_lesion_report.

    The post-check: filter model_citations to keep only those whose label is
    in valid_citation_labels(retrieved_chunks).
    """

    def _post_check(self, model_cits: list[dict], chunks: list[dict]) -> list[dict]:
        """Mirror the post-check logic used in the WS server."""
        from kb_rag import valid_citation_labels
        valid = valid_citation_labels(chunks)
        return [c for c in model_cits if isinstance(c, dict) and c.get("label") in valid]

    def test_known_label_kept(self):
        model_cits = [{"label": "[Paris 2002]", "source_guideline": "Paris Workshop 2002"}]
        result = self._post_check(model_cits, _CHUNKS[:1])
        assert len(result) == 1
        assert result[0]["label"] == "[Paris 2002]"

    def test_hallucinated_label_dropped(self):
        model_cits = [
            {"label": "[Paris 2002]", "source_guideline": "OK"},
            {"label": "[Fake 2099]", "source_guideline": "Hallucinated"},
        ]
        result = self._post_check(model_cits, _CHUNKS[:1])
        assert len(result) == 1
        assert result[0]["label"] == "[Paris 2002]"

    def test_all_hallucinated_returns_empty(self):
        model_cits = [{"label": "[Ghost 9999]"}]
        result = self._post_check(model_cits, _CHUNKS[:2])
        assert result == []

    def test_no_evidence_post_check_returns_model_output_unchanged(self):
        """When no evidence retrieved (valid_labels empty), nothing to validate — keep all."""
        from kb_rag import valid_citation_labels
        valid = valid_citation_labels([])  # empty set
        model_cits = [{"label": "[Paris 2002]"}, {"label": "[Ghost]"}]
        # When valid is empty, the server skips the filter (if _valid_labels guard).
        # Test mirrors the `if _valid_labels:` guard — no filtering when empty.
        if valid:
            result = [c for c in model_cits if c.get("label") in valid]
        else:
            result = model_cits  # no-op — no evidence, no filter
        assert len(result) == 2  # all kept when no evidence retrieved


# ── Tests: no-evidence path / prompt-builder backward compat ─────────────────

class TestNoEvidencePath:
    """Verify that evidence_block="" leaves prompt builders unchanged vs no arg."""

    def test_lesion_message_empty_evidence_unchanged(self):
        """build_lesion_user_message with evidence_block='' == no arg."""
        from llm_prompts import build_lesion_user_message
        msg_no_arg = build_lesion_user_message("viêm", 0.9, 5000, 10)
        msg_empty  = build_lesion_user_message("viêm", 0.9, 5000, 10, evidence_block="")
        assert msg_no_arg == msg_empty

    def test_lesion_message_with_evidence_contains_block(self):
        """When evidence_block is non-empty it must appear in the message."""
        from llm_prompts import build_lesion_user_message
        ev = "## BẰNG CHỨNG (Evidence)\n[Paris 2002] Paris Workshop 2002\n..."
        msg = build_lesion_user_message("viêm", 0.9, 5000, 10, evidence_block=ev)
        assert ev in msg
        # Evidence AFTER patient section and BEFORE detection line
        assert msg.index(ev) < msg.index("YOLOv8m")

    def test_lesion_message_patient_then_evidence_then_detection_order(self):
        """When both patient_ctx and evidence_block set, order: patient → evidence → detection."""
        from llm_prompts import build_lesion_user_message
        ctx = "## Bệnh nhân (Patient)\n- Tuổi (Age): 60"
        ev  = "## BẰNG CHỨNG (Evidence)\n[Paris 2002] ..."
        msg = build_lesion_user_message("viêm", 0.9, 5000, 10,
                                        patient_ctx=ctx, evidence_block=ev)
        assert msg.index(ctx) < msg.index(ev) < msg.index("YOLOv8m")

    def test_summary_input_empty_evidence_unchanged(self):
        """build_session_summary_input with evidence_block='' == no arg."""
        from summary_prompts import build_session_summary_input
        text_no  = build_session_summary_input([])
        text_empty = build_session_summary_input([], evidence_block="")
        assert text_no == text_empty

    def test_summary_input_with_evidence_contains_block(self):
        from summary_prompts import build_session_summary_input
        ev = "## BẰNG CHỨNG (Evidence)\n[Kyoto 2015] Kyoto Consensus\n..."
        text = build_session_summary_input([], evidence_block=ev)
        assert ev in text
        # Evidence must appear before session stats
        assert text.index(ev) < text.index("Session statistics")

    def test_qa_messages_empty_evidence_unchanged(self):
        from summary_prompts import build_session_qa_messages
        msgs_no    = build_session_qa_messages(None, [], [], "Q?")
        msgs_empty = build_session_qa_messages(None, [], [], "Q?", evidence_block="")
        assert len(msgs_no) == len(msgs_empty)
        for a, b in zip(msgs_no, msgs_empty):
            assert a["role"] == b["role"]
            assert a["content"] == b["content"]


# ── Tests: embeddings lazy-loader contract ────────────────────────────────────

class TestEmbeddingsLazyLoader:
    def test_override_used_without_http_call(self):
        """When _embed_fn_override is set, embed_text uses it — no HTTP client created."""
        import embeddings
        original_override = embeddings._embed_fn_override
        original_client = embeddings._client
        try:
            embeddings._embed_fn_override = lambda s: [1.0, 2.0, 3.0]
            result = embeddings.embed_text("test")
            assert result == [1.0, 2.0, 3.0]
            # The real HTTP client must NOT have been created (no Ollama call).
            assert embeddings._client is original_client
        finally:
            embeddings._embed_fn_override = original_override

    def test_no_heavy_import_at_module_level(self):
        """embeddings module must import with no heavy ML/network deps at top level
        (httpx is deferred into _get_client). Loading the module must not raise."""
        import importlib.util
        # Reload the module in an isolated namespace to check top-level imports.
        spec = importlib.util.spec_from_file_location(
            "embeddings_check", API_DIR / "embeddings.py"
        )
        mod = importlib.util.module_from_spec(spec)
        # Module load must succeed using only os/typing — httpx is imported lazily
        # inside _get_client(), never at module level.
        spec.loader.exec_module(mod)
        assert mod._client is None  # client not created on import


# ── Tests: DB round-trip for kb_chunks (hermetic — uses tmp SQLite) ───────────

@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    """Isolated SQLite DB for kb_chunks tests."""
    db_file = str(tmp_path / "test_kb.db")
    monkeypatch.setenv("ENDOSCOPY_DB_PATH", db_file)
    import importlib
    import db as db_mod
    importlib.reload(db_mod)
    db_mod.init_db()
    return db_mod


class TestKbChunksDB:
    def test_save_and_load_roundtrip(self, tmp_db):
        db = tmp_db
        vec = [0.1, 0.2, 0.3, 0.4]
        ok = db.save_kb_chunk(
            citation_label="[Paris 2002]",
            source_guideline="Paris Workshop 2002",
            body_region="upper_gi",
            text="Paris classification",
            vector=vec,
        )
        assert ok is True
        rows = db.load_kb_chunks()
        assert len(rows) == 1
        assert rows[0]["citation_label"] == "[Paris 2002]"
        # Vector round-trip within float32 precision.
        for got, want in zip(rows[0]["vector"], vec):
            assert abs(got - want) < 1e-5

    def test_clear_kb_chunks(self, tmp_db):
        db = tmp_db
        db.save_kb_chunk("[A]", "src", "region", "text", [1.0, 0.0])
        db.save_kb_chunk("[B]", "src", "region", "text", [0.0, 1.0])
        removed = db.clear_kb_chunks()
        assert removed == 2
        assert db.load_kb_chunks() == []

    def test_load_empty_table_returns_empty_list(self, tmp_db):
        assert tmp_db.load_kb_chunks() == []
