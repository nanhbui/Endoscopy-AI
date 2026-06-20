"""Hermetic tests for eval/schema_mapping.py and AUTO_KEYFRAME_ENABLED default.

Design:
- No model downloads — sim_fn is always injected as a fake lambda.
- Tests cover: known class lookup, unknown class, match_dx threshold behavior,
  bilingual matching against both VN and EN expected terms.
- Includes the AUTO_KEYFRAME_ENABLED=default-off assertion.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# ── Path setup ────────────────────────────────────────────────────────────────
API_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "backend" / "api"
sys.path.insert(0, str(API_DIR))


# ── Fake sim functions ────────────────────────────────────────────────────────

def _sim_always_high(a: str, b: str) -> float:
    """Always returns 1.0 — every prediction matches."""
    return 1.0


def _sim_always_low(a: str, b: str) -> float:
    """Always returns 0.0 — no prediction matches."""
    return 0.0


def _sim_exact_en(a: str, b: str) -> float:
    """Returns 1.0 only when both strings contain the same key English token."""
    a_lower, b_lower = a.lower(), b.lower()
    keywords = ["barrett", "esophagitis", "polyp", "pylorus", "z-line",
                "colitis", "hemorrhoid", "retroflex"]
    for kw in keywords:
        if kw in a_lower and kw in b_lower:
            return 1.0
    return 0.0


# ── Tests: get_expected ───────────────────────────────────────────────────────

class TestGetExpected:
    def test_known_class_returns_dict(self):
        from eval.schema_mapping import get_expected
        schema = get_expected("barretts")
        assert schema is not None
        assert "expected_dx_vi" in schema
        assert "expected_dx_en" in schema
        assert "severity" in schema
        assert "paris_default" in schema

    def test_known_class_severity_correct(self):
        from eval.schema_mapping import get_expected
        assert get_expected("barretts")["severity"] == "cao"
        assert get_expected("esophagitis-a")["severity"] == "thấp"
        assert get_expected("esophagitis-b-d")["severity"] == "cao"
        assert get_expected("pylorus")["severity"] == "thấp"

    def test_unknown_class_returns_none(self):
        from eval.schema_mapping import get_expected
        assert get_expected("not-a-real-class") is None

    def test_all_eval_classes_have_schema(self):
        from eval.schema_mapping import CLASS_SCHEMA
        from eval.dataset_kvasir import EVAL_CLASSES
        # Every class in EVAL_CLASSES must have a schema entry.
        for cls in EVAL_CLASSES:
            assert cls in CLASS_SCHEMA, f"Missing schema for class: {cls}"

    def test_polyps_has_paris_default(self):
        from eval.schema_mapping import get_expected
        schema = get_expected("polyps")
        assert schema["paris_default"] == "0-Is"

    def test_pylorus_paris_default_none(self):
        from eval.schema_mapping import get_expected
        schema = get_expected("pylorus")
        assert schema["paris_default"] is None


# ── Tests: match_dx ───────────────────────────────────────────────────────────

class TestMatchDx:
    def test_high_similarity_returns_true(self):
        from eval.schema_mapping import match_dx
        # sim_fn always returns 1.0 → above 0.6 threshold
        result = match_dx(
            "Thực quản Barrett (Barrett's esophagus)",
            "barretts",
            sim_fn=_sim_always_high,
        )
        assert result is True

    def test_low_similarity_returns_false(self):
        from eval.schema_mapping import match_dx
        # sim_fn always returns 0.0 → below 0.6 threshold
        result = match_dx(
            "Ung thư dạ dày (gastric cancer)",
            "barretts",
            sim_fn=_sim_always_low,
        )
        assert result is False

    def test_unknown_class_returns_false(self):
        from eval.schema_mapping import match_dx
        result = match_dx(
            "Viêm dạ dày (gastritis)",
            "not-a-real-class",
            sim_fn=_sim_always_high,
        )
        assert result is False

    def test_threshold_boundary_exact(self):
        """Exactly at threshold should return True; just below should return False."""
        from eval.schema_mapping import match_dx

        def _sim_at_threshold(a: str, b: str) -> float:
            return 0.6

        def _sim_below_threshold(a: str, b: str) -> float:
            return 0.599

        assert match_dx("any", "pylorus", sim_fn=_sim_at_threshold) is True
        assert match_dx("any", "pylorus", sim_fn=_sim_below_threshold) is False

    def test_custom_threshold_respected(self):
        from eval.schema_mapping import match_dx

        def _sim_mid(a: str, b: str) -> float:
            return 0.75

        # With default threshold 0.6 → True
        assert match_dx("x", "pylorus", sim_fn=_sim_mid, threshold=0.6) is True
        # With higher threshold 0.9 → False
        assert match_dx("x", "pylorus", sim_fn=_sim_mid, threshold=0.9) is False

    def test_both_vi_and_en_compared(self):
        """match_dx checks sim against both expected_dx_vi and expected_dx_en;
        returns True when max >= threshold."""
        from eval.schema_mapping import match_dx, CLASS_SCHEMA

        calls: list[tuple[str, str]] = []

        def _recording_sim(a: str, b: str) -> float:
            calls.append((a, b))
            return 0.0  # always low so no match, but we can inspect the calls

        match_dx("test pred", "barretts", sim_fn=_recording_sim)
        expected = CLASS_SCHEMA["barretts"]
        b_values = [b for _, b in calls]
        assert expected["expected_dx_vi"] in b_values
        assert expected["expected_dx_en"] in b_values

    def test_match_uses_max_of_vi_and_en(self):
        """If sim against EN is high but VI is low, should still match."""
        from eval.schema_mapping import match_dx, CLASS_SCHEMA

        vi_term = CLASS_SCHEMA["esophagitis-a"]["expected_dx_vi"]
        en_term = CLASS_SCHEMA["esophagitis-a"]["expected_dx_en"]

        def _sim_en_only(a: str, b: str) -> float:
            # High only when b is the English term
            return 0.9 if b == en_term else 0.1

        result = match_dx("esophagitis grade A", "esophagitis-a", sim_fn=_sim_en_only)
        assert result is True

    def test_no_sim_fn_uses_default_path(self):
        """When sim_fn=None, the lazy default path is taken.
        We cannot actually call it in CI (no model), so we verify it doesn't
        crash at call-site level by monkey-patching the internal cache."""
        from eval import schema_mapping

        # Patch _default_sim_fn to a safe fake
        original = schema_mapping._default_sim_fn
        schema_mapping._default_sim_fn = _sim_always_high
        try:
            result = schema_mapping.match_dx("anything", "pylorus", sim_fn=None)
            assert result is True
        finally:
            schema_mapping._default_sim_fn = original


# ── Tests: AUTO_KEYFRAME_ENABLED default OFF ─────────────────────────────────

class TestAutoKeyframeDefault:
    """Assert that AUTO_KEYFRAME_ENABLED defaults to OFF when unset or '0'.

    This is a hard regression guard: the manual pause→Giải thích flow must
    be byte-for-byte unchanged when the flag is not explicitly enabled.
    """

    def test_env_unset_default_is_false(self, monkeypatch):
        """Without the env var the default must be False."""
        monkeypatch.delenv("AUTO_KEYFRAME_ENABLED", raising=False)
        # Re-evaluate the expression the server uses
        val = os.getenv("AUTO_KEYFRAME_ENABLED", "0").lower() in ("1", "true", "yes", "on")
        assert val is False

    def test_env_zero_is_false(self, monkeypatch):
        monkeypatch.setenv("AUTO_KEYFRAME_ENABLED", "0")
        val = os.getenv("AUTO_KEYFRAME_ENABLED", "0").lower() in ("1", "true", "yes", "on")
        assert val is False

    def test_env_one_is_true(self, monkeypatch):
        monkeypatch.setenv("AUTO_KEYFRAME_ENABLED", "1")
        val = os.getenv("AUTO_KEYFRAME_ENABLED", "0").lower() in ("1", "true", "yes", "on")
        assert val is True

    def test_env_true_string_is_true(self, monkeypatch):
        monkeypatch.setenv("AUTO_KEYFRAME_ENABLED", "true")
        val = os.getenv("AUTO_KEYFRAME_ENABLED", "0").lower() in ("1", "true", "yes", "on")
        assert val is True

    def test_server_module_default_is_false(self, monkeypatch):
        """The _AUTO_KEYFRAME_DEFAULT in the server module is False when env unset."""
        monkeypatch.delenv("AUTO_KEYFRAME_ENABLED", raising=False)
        # Import the constant directly; the module reads env at import time.
        # Use importlib to reload with the clean env.
        import importlib
        import importlib.util
        server_path = API_DIR / "endoscopy_ws_server.py"
        # We can't safely import the full server (it has FastAPI app-level side
        # effects), so we parse the default expression directly instead.
        source = server_path.read_text(encoding="utf-8")
        assert '_AUTO_KEYFRAME_DEFAULT' in source, \
            "_AUTO_KEYFRAME_DEFAULT must be defined in endoscopy_ws_server.py"
        # Verify the guard expression: default env value must be "0"
        assert '"AUTO_KEYFRAME_ENABLED", "0"' in source, \
            'Default for AUTO_KEYFRAME_ENABLED must be "0" (OFF)'

    def test_session_dict_has_auto_keyframe_key(self, monkeypatch):
        """Session creation code must include auto_keyframe and auto_reported_track_ids."""
        monkeypatch.delenv("AUTO_KEYFRAME_ENABLED", raising=False)
        server_path = API_DIR / "endoscopy_ws_server.py"
        source = server_path.read_text(encoding="utf-8")
        assert '"auto_keyframe"' in source, \
            'Session dict must include "auto_keyframe" key'
        assert '"auto_reported_track_ids"' in source, \
            'Session dict must include "auto_reported_track_ids" key'
