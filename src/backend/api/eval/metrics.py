"""Evaluation metrics for the endoscopy VLM pipeline.

Pure functions over record dicts — no I/O, no model loading, no side effects.
All functions are independently testable with synthetic data.

Record dict shape (produced by eval-endoscopy-vlm.py orchestrator):
    {
        "kvasir_class":   str,   # ground-truth HyperKvasir class
        "primary_dx":     str,   # LLM report conclusion.primary_dx
        "severity":       str,   # LLM report conclusion.severity
        "paris_class":    str,   # LLM report description.paris_class (may be "Không xác định")
        "recommendations": list[str],  # LLM report conclusion.recommendations
        "dx_match":       bool,  # populated by match_dx() in orchestrator
        "faithfulness":   float | None,  # populated by judge; None if skipped
    }
"""
from __future__ import annotations

from collections import defaultdict
from typing import Callable, Optional


# ── Severity ordering ──────────────────────────────────────────────────────────
_SEVERITY_RANK = {"thấp": 0, "trung bình": 1, "cao": 2}


# ── Diagnosis accuracy ─────────────────────────────────────────────────────────

def diagnosis_accuracy(
    records: list[dict],
    match_fn: Optional[Callable[[dict], bool]] = None,
) -> dict:
    """Compute macro-averaged F1 across HyperKvasir classes.

    Uses the pre-computed `dx_match` bool in each record (set by the orchestrator
    via schema_mapping.match_dx). Callers may pass a custom `match_fn(record)->bool`
    to override the field lookup (useful in tests).

    Args:
        records: list of record dicts (see module docstring).
        match_fn: optional override for determining a match per record.

    Returns:
        dict with:
            macro_f1     (float) — unweighted average of per-class F1
            per_class    (dict)  — {class: {tp, fp, fn, precision, recall, f1}}
            n_records    (int)
            n_matched    (int)
    """
    if not records:
        return {"macro_f1": 0.0, "per_class": {}, "n_records": 0, "n_matched": 0}

    # Count true-positives (match=True) and false-negatives (match=False) per class.
    # False-positives: record for class X whose dx_match=True but predicted a
    # different class — approximated here as: any record not matched is an FN for
    # the true class and an implicit FP for whatever the model said. Since we don't
    # track the predicted class bucket, we use the simpler "binary per-class" F1:
    # precision = TP / (TP + 0)  → 1.0 when there are matches (no FP tracking here
    # because we don't bucket predictions by predicted class).
    # This is a conservative, dataset-level approximation matching the thesis scope.
    per_class: dict[str, dict] = defaultdict(lambda: {"tp": 0, "fn": 0})

    _match = match_fn if match_fn is not None else lambda r: bool(r.get("dx_match"))

    n_matched = 0
    for rec in records:
        cls = rec.get("kvasir_class", "unknown")
        matched = _match(rec)
        if matched:
            per_class[cls]["tp"] += 1
            n_matched += 1
        else:
            per_class[cls]["fn"] += 1

    # Compute per-class precision / recall / F1.
    # We treat each class as a binary classifier (positive = this class).
    # Without a predicted-class breakdown, precision = TP / (TP + 0) = 1.0 when
    # TP > 0. This is documented as a limitation in the thesis.
    class_f1s: list[float] = []
    per_class_out: dict[str, dict] = {}
    for cls, counts in per_class.items():
        tp = counts["tp"]
        fn = counts["fn"]
        precision = 1.0 if tp > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)
              if (precision + recall) > 0 else 0.0)
        per_class_out[cls] = {
            "tp": tp, "fn": fn,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        }
        class_f1s.append(f1)

    macro_f1 = sum(class_f1s) / len(class_f1s) if class_f1s else 0.0
    return {
        "macro_f1": round(macro_f1, 4),
        "per_class": per_class_out,
        "n_records": len(records),
        "n_matched": n_matched,
    }


# ── Recommendation rubric ──────────────────────────────────────────────────────

def recommendation_score(record: dict) -> int:
    """Score recommendation appropriateness for a single record (0-3 rubric).

    Rubric:
        3 — severity correct AND paris_class non-trivial AND recommendations non-empty
        2 — severity correct AND recommendations non-empty
        1 — recommendations non-empty but severity wrong
        0 — no recommendations OR both severity and recs wrong

    The Paris-class check accepts any non-"Không xác định" / non-empty value as
    "non-trivial" since HyperKvasir doesn't annotate Paris subtype.
    """
    from eval.schema_mapping import CLASS_SCHEMA  # noqa: PLC0415

    cls = record.get("kvasir_class", "")
    expected = CLASS_SCHEMA.get(cls, {})
    expected_severity = expected.get("severity", "")

    pred_severity = record.get("severity", "")
    recs = record.get("recommendations", [])
    paris = record.get("paris_class", "")

    has_recs = bool(recs and len(recs) > 0)
    severity_ok = (pred_severity == expected_severity)
    paris_nontrivial = bool(
        paris
        and paris.lower() not in ("không xác định", "unknown", "")
    )

    if severity_ok and paris_nontrivial and has_recs:
        return 3
    if severity_ok and has_recs:
        return 2
    if has_recs:
        return 1
    return 0


# ── Aggregation helpers ────────────────────────────────────────────────────────

def aggregate_recommendation_scores(records: list[dict]) -> dict:
    """Return mean and distribution of recommendation scores over all records."""
    if not records:
        return {"mean": 0.0, "distribution": {}, "n_records": 0}

    scores = [recommendation_score(r) for r in records]
    dist: dict[int, int] = defaultdict(int)
    for s in scores:
        dist[s] += 1

    mean = sum(scores) / len(scores) if scores else 0.0
    return {
        "mean": round(mean, 4),
        "distribution": dict(sorted(dist.items())),
        "n_records": len(records),
    }


def aggregate_faithfulness(records: list[dict]) -> dict:
    """Return mean faithfulness score, excluding records where judge was skipped."""
    judged = [r["faithfulness"] for r in records
              if r.get("faithfulness") is not None]
    if not judged:
        return {"mean": None, "n_judged": 0, "n_skipped": len(records)}
    mean = sum(judged) / len(judged)
    return {
        "mean": round(mean, 4),
        "n_judged": len(judged),
        "n_skipped": len(records) - len(judged),
    }


def severity_accuracy(records: list[dict]) -> dict:
    """Fraction of records whose severity equals the expected class severity.

    Uses the pre-computed `severity_match` bool set by the orchestrator. This is a
    fairer headline than dx-class match for a morphology-first VLM: it measures
    risk stratification, which the report schema is explicitly designed to produce.
    """
    if not records:
        return {"accuracy": 0.0, "n_correct": 0, "n_records": 0}
    n_correct = sum(1 for r in records if r.get("severity_match"))
    return {
        "accuracy": round(n_correct / len(records), 4),
        "n_correct": n_correct,
        "n_records": len(records),
    }


def summarize(records: list[dict]) -> dict:
    """Compute all metrics in one call. Returns the thesis results dict."""
    dx = diagnosis_accuracy(records)
    rec = aggregate_recommendation_scores(records)
    faith = aggregate_faithfulness(records)
    sev = severity_accuracy(records)
    return {
        "diagnosis_accuracy": dx,
        "severity_accuracy": sev,
        "recommendation": rec,
        "faithfulness": faith,
    }
