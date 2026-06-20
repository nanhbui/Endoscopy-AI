"""Map HyperKvasir class labels to expected clinical diagnosis fields.

Design:
- Pure dict lookup for deterministic fields (expected_dx_vi, expected_dx_en,
  severity, paris_default).
- Semantic dx match via injectable sim_fn (default = multilingual embedder lazy-
  loaded on first call). Tests inject a fake sim fn — no model download in CI.
- Threshold 0.6: chosen to accept bilingual paraphrases ("Viêm thực quản" vs
  "esophagitis") while rejecting unrelated terms.

The coarse class→dx mapping is an intentional simplification: HyperKvasir has no
Paris subtype annotation, so evaluation measures class-level dx match only.
This gap is documented in the thesis methods section.
"""
from __future__ import annotations

from typing import Callable, Optional

# ── Ground-truth schema per HyperKvasir class ─────────────────────────────────
# Keys:
#   expected_dx_vi  — Vietnamese primary diagnosis (matches bilingual format in reports)
#   expected_dx_en  — English term (for semantic matching against report primary_dx)
#   severity        — expected severity enum ("thấp" / "trung bình" / "cao")
#   paris_default   — expected Paris class or None when not applicable
CLASS_SCHEMA: dict[str, dict] = {
    "barretts": {
        "expected_dx_vi": "Thực quản Barrett (Barrett's esophagus)",
        "expected_dx_en": "Barrett's esophagus",
        "severity": "cao",
        "paris_default": None,
    },
    "barretts-short-segment": {
        "expected_dx_vi": "Thực quản Barrett đoạn ngắn (short-segment Barrett's esophagus)",
        "expected_dx_en": "short-segment Barrett's esophagus",
        "severity": "trung bình",
        "paris_default": None,
    },
    "esophagitis-a": {
        "expected_dx_vi": "Viêm thực quản độ A (esophagitis grade A, Los Angeles)",
        "expected_dx_en": "esophagitis grade A",
        "severity": "thấp",
        "paris_default": None,
    },
    "esophagitis-b-d": {
        "expected_dx_vi": "Viêm thực quản độ B-D (esophagitis grade B-D, Los Angeles)",
        "expected_dx_en": "esophagitis grade B-D",
        "severity": "cao",
        "paris_default": None,
    },
    "polyps": {
        "expected_dx_vi": "Polyp đại tràng (colorectal polyp)",
        "expected_dx_en": "colorectal polyp",
        "severity": "trung bình",
        "paris_default": "0-Is",
    },
    "pylorus": {
        "expected_dx_vi": "Môn vị bình thường (normal pylorus)",
        "expected_dx_en": "normal pylorus",
        "severity": "thấp",
        "paris_default": None,
    },
    "retroflex-stomach": {
        "expected_dx_vi": "Dạ dày nhìn ngược (retroflex stomach view)",
        "expected_dx_en": "retroflex stomach view",
        "severity": "thấp",
        "paris_default": None,
    },
    "z-line": {
        "expected_dx_vi": "Đường Z bình thường (normal Z-line)",
        "expected_dx_en": "normal Z-line",
        "severity": "thấp",
        "paris_default": None,
    },
    "hemorrhoids": {
        "expected_dx_vi": "Trĩ (hemorrhoids)",
        "expected_dx_en": "hemorrhoids",
        "severity": "thấp",
        "paris_default": None,
    },
    "ulcerative-colitis-grade-0-1": {
        "expected_dx_vi": "Viêm loét đại tràng độ 0-1 (ulcerative colitis grade 0-1)",
        "expected_dx_en": "ulcerative colitis",
        "severity": "thấp",
        "paris_default": None,
    },
    "ulcerative-colitis-grade-1": {
        "expected_dx_vi": "Viêm loét đại tràng độ 1 (ulcerative colitis grade 1)",
        "expected_dx_en": "ulcerative colitis",
        "severity": "thấp",
        "paris_default": None,
    },
    "ulcerative-colitis-grade-1-2": {
        "expected_dx_vi": "Viêm loét đại tràng độ 1-2 (ulcerative colitis grade 1-2)",
        "expected_dx_en": "ulcerative colitis",
        "severity": "trung bình",
        "paris_default": None,
    },
    "ulcerative-colitis-grade-2": {
        "expected_dx_vi": "Viêm loét đại tràng độ 2 (ulcerative colitis grade 2)",
        "expected_dx_en": "ulcerative colitis",
        "severity": "trung bình",
        "paris_default": None,
    },
    "ulcerative-colitis-grade-2-3": {
        "expected_dx_vi": "Viêm loét đại tràng độ 2-3 (ulcerative colitis grade 2-3)",
        "expected_dx_en": "ulcerative colitis",
        "severity": "cao",
        "paris_default": None,
    },
    "ulcerative-colitis-grade-3": {
        "expected_dx_vi": "Viêm loét đại tràng độ 3 (ulcerative colitis grade 3)",
        "expected_dx_en": "ulcerative colitis",
        "severity": "cao",
        "paris_default": None,
    },
}

# Lazy singleton for the default multilingual embedder.
# Tests bypass this by injecting sim_fn — the model is NEVER loaded in CI.
_embedder_cache: Optional[object] = None


def _default_sim_fn(text_a: str, text_b: str) -> float:
    """Cosine similarity between two texts using the multilingual embedder.

    Lazily loads the model on first call. Tests MUST inject sim_fn to avoid
    this code path entirely.
    """
    global _embedder_cache
    if _embedder_cache is None:
        # Import inside function so module-level import never loads SentenceTransformer.
        from embeddings import embed_text  # noqa: PLC0415
        _embedder_cache = embed_text
    embed_fn = _embedder_cache
    import math  # noqa: PLC0415
    vec_a = embed_fn(text_a)
    vec_b = embed_fn(text_b)
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# Distinctive disease keywords per class (lowercased, VN + EN). A report "names"
# the class if any keyword appears in its primary_dx or differential — fairer than
# requiring an exact semantic match to the full class name, since the model's
# primary_dx is often a Paris morphology code while the disease name (when the model
# recognises it) tends to surface in the differential.
_CLASS_KEYWORDS: dict[str, tuple[str, ...]] = {
    "barretts": ("barrett",),
    "barretts-short-segment": ("barrett",),
    "esophagitis-a": ("esophagit", "viêm thực quản"),
    "esophagitis-b-d": ("esophagit", "viêm thực quản"),
    "polyps": ("polyp",),
    "pylorus": ("môn vị", "pylorus", "bình thường", "normal"),
    "retroflex-stomach": ("retroflex", "nhìn ngược", "bình thường", "normal"),
    "z-line": ("z-line", "đường z", "bình thường", "normal"),
    "hemorrhoids": ("hemorrhoid", "trĩ"),
    "ulcerative-colitis-grade-0-1": ("colitis", "viêm loét đại tràng"),
    "ulcerative-colitis-grade-1": ("colitis", "viêm loét đại tràng"),
    "ulcerative-colitis-grade-1-2": ("colitis", "viêm loét đại tràng"),
    "ulcerative-colitis-grade-2": ("colitis", "viêm loét đại tràng"),
    "ulcerative-colitis-grade-2-3": ("colitis", "viêm loét đại tràng"),
    "ulcerative-colitis-grade-3": ("colitis", "viêm loét đại tràng"),
}


def get_expected(kvasir_class: str) -> Optional[dict]:
    """Return expected schema dict for a HyperKvasir class, or None if unknown."""
    return CLASS_SCHEMA.get(kvasir_class)


def _report_candidates(report: dict) -> list[str]:
    """Collect dx-bearing text from a report: primary_dx + every differential dx."""
    concl = report.get("conclusion", {}) or {}
    cands: list[str] = []
    pd = concl.get("primary_dx", "")
    if pd:
        cands.append(pd)
    for d in (concl.get("differential", []) or []):
        dx = (d or {}).get("dx", "") if isinstance(d, dict) else ""
        if dx:
            cands.append(dx)
    return cands


def match_report(
    report: dict,
    kvasir_class: str,
    sim_fn: Optional[Callable[[str, str], float]] = None,
    threshold: float = 0.6,
) -> bool:
    """True if the report names the expected diagnosis in primary_dx OR differential.

    Fairer than match_dx (which only sees primary_dx): matches by disease keyword
    first (cheap, no model), then falls back to semantic similarity over each
    candidate against the bilingual expected terms.
    """
    schema = CLASS_SCHEMA.get(kvasir_class)
    if schema is None:
        return False
    cands = _report_candidates(report)
    if not cands:
        return False

    blob = " ".join(cands).lower()
    for kw in _CLASS_KEYWORDS.get(kvasir_class, ()):
        if kw in blob:
            return True

    _sim = sim_fn if sim_fn is not None else _default_sim_fn
    for c in cands:
        if max(_sim(c, schema["expected_dx_vi"]), _sim(c, schema["expected_dx_en"])) >= threshold:
            return True
    return False


def severity_match(pred_severity: str, kvasir_class: str) -> bool:
    """True when the report's severity equals the class's expected severity."""
    schema = CLASS_SCHEMA.get(kvasir_class)
    if schema is None:
        return False
    return pred_severity == schema.get("severity")


def match_dx(
    pred_primary_dx: str,
    kvasir_class: str,
    sim_fn: Optional[Callable[[str, str], float]] = None,
    threshold: float = 0.6,
) -> bool:
    """Return True when the predicted primary_dx semantically matches the expected.

    Args:
        pred_primary_dx: The `primary_dx` string from the LLM report (bilingual VN).
        kvasir_class: HyperKvasir class folder name (ground-truth label).
        sim_fn: Optional similarity function (str, str) -> float.
                Defaults to multilingual cosine via embeddings.embed_text.
                Inject a fake fn in tests to avoid model download.
        threshold: Minimum cosine similarity to count as a match (default 0.6).

    Returns:
        True if similarity to either expected_dx_vi or expected_dx_en >= threshold.
    """
    schema = CLASS_SCHEMA.get(kvasir_class)
    if schema is None:
        return False

    _sim = sim_fn if sim_fn is not None else _default_sim_fn

    # Check against both Vietnamese and English expected terms — take the max.
    sim_vi = _sim(pred_primary_dx, schema["expected_dx_vi"])
    sim_en = _sim(pred_primary_dx, schema["expected_dx_en"])
    return max(sim_vi, sim_en) >= threshold
