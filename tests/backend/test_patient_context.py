"""Tests for Phase 1 — patient context: formatter, DB round-trip, prompt injection.

Hermetic — no Ollama/LLM required.  DB isolation: set ENDOSCOPY_DB_PATH to a
tmp file before importing db (mirrors the pattern used in this test suite).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "backend" / "api"
sys.path.insert(0, str(API_DIR))


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    """Point ENDOSCOPY_DB_PATH at a fresh temp file and re-initialise the DB."""
    db_file = str(tmp_path / "test_endoscopy.db")
    monkeypatch.setenv("ENDOSCOPY_DB_PATH", db_file)
    # Force db module to reload with the new path.
    import importlib
    import db as db_mod
    importlib.reload(db_mod)
    db_mod.init_db()
    return db_mod


# ── patient_context.py ────────────────────────────────────────────────────────

class TestFormatPatientContext:
    def setup_method(self):
        from patient_context import PatientContext, format_patient_context
        self.PC = PatientContext
        self.fmt = format_patient_context

    def test_none_returns_empty(self):
        assert self.fmt(None) == ""

    def test_all_empty_returns_empty(self):
        ctx = self.PC()
        assert self.fmt(ctx) == ""

    def test_full_context_contains_bilingual_labels(self):
        ctx = self.PC(age=54, sex="Nam", indication="đau thượng vị",
                      history="viêm dạ dày mãn", meds="omeprazole 20 mg")
        result = self.fmt(ctx)
        assert "## Bệnh nhân (Patient)" in result
        assert "Tuổi (Age): 54" in result
        assert "Giới (Sex): Nam" in result
        assert "Lý do nội soi (Indication): đau thượng vị" in result
        assert "Tiền sử (History): viêm dạ dày mãn" in result
        assert "Thuốc đang dùng (Current meds): omeprazole 20 mg" in result

    def test_omits_empty_fields(self):
        ctx = self.PC(age=30, sex="Nữ")  # no indication/history/meds
        result = self.fmt(ctx)
        assert "Lý do nội soi" not in result
        assert "Tiền sử" not in result
        assert "Thuốc đang dùng" not in result
        assert "30" in result

    def test_only_indication_no_age_sex(self):
        ctx = self.PC(indication="xuất huyết")
        result = self.fmt(ctx)
        assert "Lý do nội soi (Indication): xuất huyết" in result
        assert "Tuổi" not in result
        assert "Giới" not in result

    def test_age_clamped_to_120(self):
        ctx = self.PC(age=200)
        assert ctx.age == 120

    def test_age_clamped_to_zero(self):
        ctx = self.PC(age=-5)
        assert ctx.age == 0

    def test_empty_string_fields_treated_as_none(self):
        ctx = self.PC(sex="  ", indication="")
        assert ctx.sex is None
        assert ctx.indication is None

    def test_from_dict_round_trip(self):
        from patient_context import PatientContext
        original = PatientContext(age=42, sex="Nam", indication="test", history="h", meds="m")
        restored = PatientContext.from_dict(original.to_dict())
        assert restored.age == 42
        assert restored.sex == "Nam"
        assert restored.indication == "test"

    def test_to_dict_keys(self):
        from patient_context import PatientContext
        ctx = PatientContext(age=10)
        d = ctx.to_dict()
        assert set(d.keys()) == {"age", "sex", "indication", "history", "meds"}


# ── db.py patient context round-trip ─────────────────────────────────────────

class TestPatientContextDB:
    def test_save_and_get(self, tmp_db):
        db = tmp_db
        ctx_dict = {"age": 54, "sex": "Nam", "indication": "đau", "history": None, "meds": None}
        assert db.save_patient_context("sess1", ctx_dict, 1000) is True
        result = db.get_patient_context("sess1")
        assert result is not None
        assert result["age"] == 54
        assert result["sex"] == "Nam"

    def test_get_missing_returns_none(self, tmp_db):
        assert tmp_db.get_patient_context("nonexistent") is None

    def test_upsert_overwrites(self, tmp_db):
        db = tmp_db
        db.save_patient_context("sess2", {"age": 30, "sex": "Nữ", "indication": None, "history": None, "meds": None}, 1000)
        db.save_patient_context("sess2", {"age": 55, "sex": "Nam", "indication": "pain", "history": None, "meds": None}, 2000)
        result = db.get_patient_context("sess2")
        assert result["age"] == 55
        assert result["sex"] == "Nam"


# ── db.py lesion_reports frame_b64 round-trip ────────────────────────────────

class TestLesionReportFrameB64:
    def _sample_report(self):
        return {
            "technique": {"method": "NBI", "device": "scope", "timestamp": "00:01"},
            "description": {"surface": "smooth", "color": "red", "margin": "clear",
                            "vascular": "normal", "fluid": "none", "size_mm": "5",
                            "paris_class": "0-IIa"},
            "conclusion": {"primary_dx": "viêm", "severity": "thấp",
                           "ai_confidence": 75, "differential": [],
                           "recommendations": []},
        }

    def test_save_with_thumbnail_and_get(self, tmp_db):
        db = tmp_db
        report = self._sample_report()
        ok = db.save_lesion_report("sessA", 1, report, "model-x", 9999, frame_b64="abc123==")
        assert ok is True
        rows = db.get_lesion_reports_for_session("sessA")
        assert len(rows) == 1
        assert rows[0]["frame_b64"] == "abc123=="

    def test_save_without_thumbnail_returns_none(self, tmp_db):
        db = tmp_db
        report = self._sample_report()
        db.save_lesion_report("sessB", 2, report, "model-x", 9999)
        rows = db.get_lesion_reports_for_session("sessB")
        assert rows[0]["frame_b64"] is None

    def test_old_row_key_present(self, tmp_db):
        """frame_b64 key must always be present in returned dicts (even for NULL rows)."""
        db = tmp_db
        db.save_lesion_report("sessC", 3, self._sample_report(), "m", 1)
        rows = db.get_lesion_reports_for_session("sessC")
        assert "frame_b64" in rows[0]


# ── Prompt builder injection ──────────────────────────────────────────────────

class TestPromptBuilderInjection:
    CTX_STR = "## Bệnh nhân (Patient)\n- Tuổi (Age): 54 | Giới (Sex): Nam"

    def test_lesion_message_with_context(self):
        from llm_prompts import build_lesion_user_message
        msg = build_lesion_user_message("viêm", 0.9, 5000, 10, patient_ctx=self.CTX_STR)
        assert self.CTX_STR in msg
        # Context must come BEFORE the detection line.
        assert msg.index(self.CTX_STR) < msg.index("YOLOv8m")

    def test_lesion_message_without_context_unchanged(self):
        from llm_prompts import build_lesion_user_message
        msg_no_ctx = build_lesion_user_message("viêm", 0.9, 5000, 10)
        msg_empty  = build_lesion_user_message("viêm", 0.9, 5000, 10, patient_ctx="")
        assert msg_no_ctx == msg_empty
        assert "Bệnh nhân" not in msg_no_ctx

    def test_summary_input_with_context(self):
        from summary_prompts import build_session_summary_input
        text = build_session_summary_input([], patient_ctx=self.CTX_STR)
        assert self.CTX_STR in text
        # Context must precede session stats.
        assert text.index(self.CTX_STR) < text.index("Session statistics")

    def test_summary_input_without_context_unchanged(self):
        from summary_prompts import build_session_summary_input
        text_no  = build_session_summary_input([])
        text_empty = build_session_summary_input([], patient_ctx="")
        assert text_no == text_empty
        assert "Bệnh nhân" not in text_no

    def test_qa_messages_with_context(self):
        from summary_prompts import build_session_qa_messages
        msgs = build_session_qa_messages(None, [], [], "Hỏi gì đó?", patient_ctx=self.CTX_STR)
        # Context should appear in one of the system messages.
        system_content = " ".join(m["content"] for m in msgs if m["role"] == "system")
        assert self.CTX_STR in system_content

    def test_qa_messages_without_context_unchanged(self):
        from summary_prompts import build_session_qa_messages
        msgs_no    = build_session_qa_messages(None, [], [], "Q?")
        msgs_empty = build_session_qa_messages(None, [], [], "Q?", patient_ctx="")
        # Same number of messages, same system content.
        assert len(msgs_no) == len(msgs_empty)
        for a, b in zip(msgs_no, msgs_empty):
            assert a["role"] == b["role"]
            assert a["content"] == b["content"]
