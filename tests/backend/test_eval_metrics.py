"""Hermetic tests for eval/metrics.py and eval/judge_faithfulness.py.

Design:
- Entirely synthetic records — no HyperKvasir dataset, no GPU, no model download.
- Judge LLM call is injected via llm_call_fn so parse logic is tested in isolation.
- Covers: macro-F1 math, rubric scoring (0-3), faithfulness parse/aggregate,
  aggregation helpers, and edge cases (empty records, None faithfulness).
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

# ── Path setup ────────────────────────────────────────────────────────────────
API_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "backend" / "api"
sys.path.insert(0, str(API_DIR))


# ── Synthetic record factory ──────────────────────────────────────────────────

def _make_record(
    kvasir_class: str = "barretts",
    primary_dx: str = "Thực quản Barrett (Barrett's esophagus)",
    severity: str = "cao",
    paris_class: str = "0-IIa",
    recommendations: list | None = None,
    dx_match: bool = True,
    faithfulness: float | None = None,
) -> dict:
    return {
        "kvasir_class": kvasir_class,
        "primary_dx": primary_dx,
        "severity": severity,
        "paris_class": paris_class,
        "recommendations": recommendations if recommendations is not None else ["Sinh thiết bờ"],
        "dx_match": dx_match,
        "faithfulness": faithfulness,
    }


# ── Tests: diagnosis_accuracy (macro-F1) ─────────────────────────────────────

class TestDiagnosisAccuracy:
    def test_all_matched_single_class_f1_one(self):
        from eval.metrics import diagnosis_accuracy
        records = [_make_record(dx_match=True) for _ in range(5)]
        result = diagnosis_accuracy(records)
        # All TP, no FN → recall=1.0, precision=1.0 → F1=1.0
        assert result["macro_f1"] == 1.0
        assert result["n_matched"] == 5
        assert result["n_records"] == 5

    def test_none_matched_f1_zero(self):
        from eval.metrics import diagnosis_accuracy
        records = [_make_record(dx_match=False) for _ in range(4)]
        result = diagnosis_accuracy(records)
        assert result["macro_f1"] == 0.0
        assert result["n_matched"] == 0

    def test_partial_match_recall_correct(self):
        from eval.metrics import diagnosis_accuracy
        # 2 matched, 2 not matched for the same class → recall = 0.5
        records = [
            _make_record(kvasir_class="pylorus", dx_match=True),
            _make_record(kvasir_class="pylorus", dx_match=True),
            _make_record(kvasir_class="pylorus", dx_match=False),
            _make_record(kvasir_class="pylorus", dx_match=False),
        ]
        result = diagnosis_accuracy(records)
        per = result["per_class"]["pylorus"]
        assert per["tp"] == 2
        assert per["fn"] == 2
        assert abs(per["recall"] - 0.5) < 1e-4
        # precision = 1.0 (no FP tracking), recall = 0.5 → F1 = 2/3
        expected_f1 = 2 * 1.0 * 0.5 / (1.0 + 0.5)
        assert abs(per["f1"] - expected_f1) < 1e-4

    def test_two_classes_macro_average(self):
        from eval.metrics import diagnosis_accuracy
        # Class A: 3/3 matched → F1=1.0
        # Class B: 0/3 matched → F1=0.0
        # Macro average = 0.5
        records = (
            [_make_record(kvasir_class="barretts", dx_match=True)] * 3
            + [_make_record(kvasir_class="pylorus", dx_match=False)] * 3
        )
        result = diagnosis_accuracy(records)
        assert abs(result["macro_f1"] - 0.5) < 1e-4

    def test_empty_records_returns_zero(self):
        from eval.metrics import diagnosis_accuracy
        result = diagnosis_accuracy([])
        assert result["macro_f1"] == 0.0
        assert result["n_records"] == 0

    def test_custom_match_fn_used(self):
        from eval.metrics import diagnosis_accuracy
        # Inject match_fn that ignores dx_match and always returns True
        records = [_make_record(dx_match=False) for _ in range(3)]
        result = diagnosis_accuracy(records, match_fn=lambda r: True)
        assert result["n_matched"] == 3
        assert result["macro_f1"] == 1.0

    def test_per_class_keys_present(self):
        from eval.metrics import diagnosis_accuracy
        records = [_make_record()]
        result = diagnosis_accuracy(records)
        for cls_stats in result["per_class"].values():
            assert "tp" in cls_stats
            assert "fn" in cls_stats
            assert "precision" in cls_stats
            assert "recall" in cls_stats
            assert "f1" in cls_stats


# ── Tests: recommendation_score ──────────────────────────────────────────────

class TestRecommendationScore:
    def test_score_3_all_correct(self):
        from eval.metrics import recommendation_score
        # barretts: severity=cao, paris=non-trivial, recs non-empty → 3
        rec = _make_record(
            kvasir_class="barretts",
            severity="cao",
            paris_class="0-IIa",
            recommendations=["Sinh thiết bờ"],
        )
        assert recommendation_score(rec) == 3

    def test_score_2_severity_ok_no_paris(self):
        from eval.metrics import recommendation_score
        rec = _make_record(
            kvasir_class="barretts",
            severity="cao",
            paris_class="Không xác định",  # trivial → no Paris bonus
            recommendations=["Sinh thiết bờ"],
        )
        assert recommendation_score(rec) == 2

    def test_score_1_wrong_severity_has_recs(self):
        from eval.metrics import recommendation_score
        # pylorus expects severity=thấp; we give cao → wrong severity
        rec = _make_record(
            kvasir_class="pylorus",
            severity="cao",   # wrong
            paris_class="Không xác định",
            recommendations=["Theo dõi định kỳ"],
        )
        assert recommendation_score(rec) == 1

    def test_score_0_no_recommendations(self):
        from eval.metrics import recommendation_score
        rec = _make_record(
            kvasir_class="barretts",
            severity="cao",
            paris_class="0-IIa",
            recommendations=[],
        )
        assert recommendation_score(rec) == 0

    def test_score_0_empty_recs_list(self):
        from eval.metrics import recommendation_score
        rec = _make_record(recommendations=[])
        assert recommendation_score(rec) == 0

    def test_unknown_class_severity_mismatch(self):
        from eval.metrics import recommendation_score
        # Unknown class → expected_severity="" → pred never matches
        rec = _make_record(
            kvasir_class="unknown-class",
            severity="thấp",
            recommendations=["anything"],
        )
        # severity_ok = False (no schema), recs non-empty → score 1
        assert recommendation_score(rec) == 1

    def test_paris_empty_string_not_nontrivial(self):
        from eval.metrics import recommendation_score
        rec = _make_record(
            kvasir_class="barretts",
            severity="cao",
            paris_class="",
            recommendations=["Sinh thiết bờ"],
        )
        assert recommendation_score(rec) == 2  # severity ok + recs, but no Paris


# ── Tests: aggregate helpers ──────────────────────────────────────────────────

class TestAggregateHelpers:
    def test_aggregate_rec_scores_mean(self):
        from eval.metrics import aggregate_recommendation_scores
        records = [
            _make_record(kvasir_class="barretts", severity="cao",
                         paris_class="0-IIa", recommendations=["x"]),  # score 3
            _make_record(kvasir_class="pylorus", severity="thấp",
                         paris_class="Không xác định", recommendations=["x"]),  # score 2
        ]
        result = aggregate_recommendation_scores(records)
        # (3 + 2) / 2 = 2.5
        assert abs(result["mean"] - 2.5) < 1e-4
        assert result["n_records"] == 2

    def test_aggregate_rec_empty_records(self):
        from eval.metrics import aggregate_recommendation_scores
        result = aggregate_recommendation_scores([])
        assert result["mean"] == 0.0
        assert result["n_records"] == 0

    def test_aggregate_faithfulness_mean(self):
        from eval.metrics import aggregate_faithfulness
        records = [
            _make_record(faithfulness=0.8),
            _make_record(faithfulness=0.6),
            _make_record(faithfulness=None),  # skipped
        ]
        result = aggregate_faithfulness(records)
        assert abs(result["mean"] - 0.7) < 1e-4
        assert result["n_judged"] == 2
        assert result["n_skipped"] == 1

    def test_aggregate_faithfulness_all_none(self):
        from eval.metrics import aggregate_faithfulness
        records = [_make_record(faithfulness=None) for _ in range(3)]
        result = aggregate_faithfulness(records)
        assert result["mean"] is None
        assert result["n_judged"] == 0
        assert result["n_skipped"] == 3

    def test_summarize_returns_all_three_keys(self):
        from eval.metrics import summarize
        records = [_make_record(faithfulness=0.9)]
        result = summarize(records)
        assert "diagnosis_accuracy" in result
        assert "recommendation" in result
        assert "faithfulness" in result


# ── Tests: judge_faithfulness.parse_judge_response ───────────────────────────

class TestParseJudgeResponse:
    def test_valid_json_parses_correctly(self):
        from eval.judge_faithfulness import parse_judge_response
        raw = json.dumps({
            "faithfulness": 0.85,
            "hallucinated_claims": ["claim X"],
            "citation_correct": True,
        })
        result = parse_judge_response(raw)
        assert abs(result["faithfulness"] - 0.85) < 1e-6
        assert result["hallucinated_claims"] == ["claim X"]
        assert result["citation_correct"] is True

    def test_faithfulness_clamped_above_1(self):
        from eval.judge_faithfulness import parse_judge_response
        raw = json.dumps({"faithfulness": 1.5, "hallucinated_claims": [], "citation_correct": True})
        result = parse_judge_response(raw)
        assert result["faithfulness"] == 1.0

    def test_faithfulness_clamped_below_0(self):
        from eval.judge_faithfulness import parse_judge_response
        raw = json.dumps({"faithfulness": -0.5, "hallucinated_claims": [], "citation_correct": False})
        result = parse_judge_response(raw)
        assert result["faithfulness"] == 0.0

    def test_invalid_json_returns_none_faithfulness(self):
        from eval.judge_faithfulness import parse_judge_response
        result = parse_judge_response("not valid json {{{")
        assert result["faithfulness"] is None
        assert result.get("parse_error") is True

    def test_missing_fields_return_defaults(self):
        from eval.judge_faithfulness import parse_judge_response
        raw = json.dumps({"faithfulness": 0.7})
        result = parse_judge_response(raw)
        assert result["faithfulness"] == pytest.approx(0.7)
        assert result["hallucinated_claims"] == []
        assert result["citation_correct"] is False

    def test_empty_json_object(self):
        from eval.judge_faithfulness import parse_judge_response
        result = parse_judge_response("{}")
        assert result["faithfulness"] is None
        assert result["hallucinated_claims"] == []


# ── Tests: judge_report with injected llm_call_fn ────────────────────────────

class TestJudgeReport:
    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def _make_report(self) -> dict:
        return {
            "technique": {"method": "EGD", "device": "Olympus", "timestamp": "0s frame 0"},
            "description": {"size_mm": "5mm", "paris_class": "0-IIa", "surface": "trơn",
                            "color": "đỏ", "margin": "rõ", "vascular": "rõ", "fluid": "không"},
            "conclusion": {
                "primary_dx": "Thực quản Barrett (Barrett's esophagus)",
                "severity": "cao",
                "differential": [{"dx": "Barrett", "probability_pct": 70}],
                "recommendations": ["Sinh thiết bờ [Paris 2002]"],
                "ai_confidence": 85,
            },
        }

    def test_judge_with_mock_llm_returns_parsed_result(self):
        from eval.judge_faithfulness import judge_report

        fake_response = json.dumps({
            "faithfulness": 0.9,
            "hallucinated_claims": [],
            "citation_correct": True,
        })

        async def _mock_llm(messages, model, response_fmt):
            return fake_response

        result = self._run(judge_report(self._make_report(), "", llm_call_fn=_mock_llm))
        assert abs(result["faithfulness"] - 0.9) < 1e-6
        assert result["citation_correct"] is True

    def test_judge_llm_error_returns_none_faithfulness(self):
        from eval.judge_faithfulness import judge_report

        async def _failing_llm(messages, model, response_fmt):
            raise RuntimeError("model unavailable")

        result = self._run(judge_report(self._make_report(), "", llm_call_fn=_failing_llm))
        assert result["faithfulness"] is None
        assert "error" in result

    def test_judge_bad_json_from_llm_returns_parse_error(self):
        from eval.judge_faithfulness import judge_report

        async def _bad_json_llm(messages, model, response_fmt):
            return "NOT JSON <<<>>>"

        result = self._run(judge_report(self._make_report(), "", llm_call_fn=_bad_json_llm))
        assert result["faithfulness"] is None

    def test_build_judge_prompt_contains_claims(self):
        from eval.judge_faithfulness import build_judge_prompt
        report = self._make_report()
        prompt = build_judge_prompt(report, "")
        assert "Barrett" in prompt
        assert "cao" in prompt
        assert "0-IIa" in prompt
        assert "Sinh thiết" in prompt

    def test_build_judge_prompt_includes_evidence_block(self):
        from eval.judge_faithfulness import build_judge_prompt
        evidence = "## BẰNG CHỨNG (Evidence)\n[Paris 2002] Paris Workshop\nclassification text"
        prompt = build_judge_prompt(self._make_report(), evidence)
        assert "BẰNG CHỨNG" in prompt
        assert "[Paris 2002]" in prompt


# ── Tests: average_faithfulness ───────────────────────────────────────────────

class TestAverageFaithfulness:
    def test_averages_valid_scores(self):
        from eval.judge_faithfulness import average_faithfulness
        scores = [
            {"faithfulness": 0.8},
            {"faithfulness": 0.6},
            {"faithfulness": 1.0},
        ]
        avg = average_faithfulness(scores)
        assert abs(avg - round((0.8 + 0.6 + 1.0) / 3, 4)) < 1e-4

    def test_skips_none_faithfulness(self):
        from eval.judge_faithfulness import average_faithfulness
        scores = [
            {"faithfulness": 0.9},
            {"faithfulness": None},
            {"faithfulness": 0.5},
        ]
        avg = average_faithfulness(scores)
        assert abs(avg - round((0.9 + 0.5) / 2, 4)) < 1e-4

    def test_all_none_returns_none(self):
        from eval.judge_faithfulness import average_faithfulness
        scores = [{"faithfulness": None}, {"faithfulness": None}]
        assert average_faithfulness(scores) is None

    def test_empty_list_returns_none(self):
        from eval.judge_faithfulness import average_faithfulness
        assert average_faithfulness([]) is None
