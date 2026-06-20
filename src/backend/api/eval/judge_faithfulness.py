"""LLM-as-judge for grounding faithfulness of lesion reports.

Design:
- Builds a judge prompt from: report text claims + retrieved KB evidence.
- Expects JSON response: {faithfulness: 0-1, hallucinated_claims: [], citation_correct: bool}
- The LLM call is injectable/mockable via `llm_call_fn` — tests never hit a real model.
- parse_judge_response() is pure and fully unit-testable without a live model.

Judge cost: ~5-10s per sample → pilot N=50 first (see eval-endoscopy-vlm.py --limit).
"""
from __future__ import annotations

import json
from typing import Callable, Optional

# Judge JSON schema (sent as response_format to the LLM)
_JUDGE_SCHEMA = {
    "type": "object",
    "required": ["faithfulness", "hallucinated_claims", "citation_correct"],
    "properties": {
        "faithfulness": {
            "type": "number",
            "minimum": 0.0,
            "maximum": 1.0,
            "description": "Overall grounding score 0-1 (1 = every claim supported by evidence or image)",
        },
        "hallucinated_claims": {
            "type": "array",
            "items": {"type": "string"},
            "description": "List of claims in the report NOT supported by the evidence block",
        },
        "citation_correct": {
            "type": "boolean",
            "description": "True when all cited [labels] in recommendations exist in the evidence block",
        },
    },
}

_JUDGE_SYSTEM = """\
You are a medical AI evaluator. Your task is to assess whether a clinical endoscopy
report is grounded in the provided evidence and image findings.

Evaluate faithfulness: does every factual claim in the report (diagnosis, Paris
classification, recommendations) follow from the evidence block or what is visually
observable in an endoscopy image? Flag any claim that cannot be supported.

Respond ONLY with valid JSON matching the provided schema. No preamble or extra text.
"""


def build_judge_prompt(report: dict, evidence_block: str) -> str:
    """Format the user-turn judge prompt from a lesion report dict + evidence.

    Args:
        report: The structured LLM report dict (technique / description / conclusion).
        evidence_block: Pre-formatted evidence string from kb_rag.format_evidence_block().

    Returns:
        Formatted user-turn string for the judge LLM.
    """
    conclusion = report.get("conclusion", {})
    description = report.get("description", {})

    claims_lines = [
        f"- Primary diagnosis: {conclusion.get('primary_dx', 'N/A')}",
        f"- Severity: {conclusion.get('severity', 'N/A')}",
        f"- Paris classification: {description.get('paris_class', 'N/A')}",
    ]
    recs = conclusion.get("recommendations", [])
    for rec in recs:
        claims_lines.append(f"- Recommendation: {rec}")

    prompt_parts = [
        "## REPORT CLAIMS",
        "\n".join(claims_lines),
    ]
    if evidence_block:
        prompt_parts.append("")
        prompt_parts.append(evidence_block)
    else:
        prompt_parts.append("\n(No KB evidence was retrieved for this sample.)")

    prompt_parts.append("")
    prompt_parts.append(
        "Assess whether the report claims above are grounded in the evidence "
        "and consistent with what is typically observable in an endoscopy image. "
        "Return JSON with faithfulness (0-1), hallucinated_claims (list), "
        "and citation_correct (bool)."
    )
    return "\n".join(prompt_parts)


def parse_judge_response(raw_json: str) -> dict:
    """Parse and validate the judge LLM response.

    Args:
        raw_json: Raw JSON string from the judge LLM.

    Returns:
        Dict with faithfulness (float), hallucinated_claims (list), citation_correct (bool).
        On parse failure, returns a safe default with faithfulness=None.
    """
    try:
        data = json.loads(raw_json)
    except (json.JSONDecodeError, ValueError):
        return {
            "faithfulness": None,
            "hallucinated_claims": [],
            "citation_correct": False,
            "parse_error": True,
        }

    faithfulness = data.get("faithfulness")
    # Clamp to [0, 1] and ensure float
    if faithfulness is not None:
        try:
            faithfulness = max(0.0, min(1.0, float(faithfulness)))
        except (TypeError, ValueError):
            faithfulness = None

    return {
        "faithfulness": faithfulness,
        "hallucinated_claims": list(data.get("hallucinated_claims") or []),
        "citation_correct": bool(data.get("citation_correct", False)),
    }


async def judge_report(
    report: dict,
    evidence_block: str,
    llm_call_fn: Optional[Callable] = None,
    model: str = "medgemma-4b",
) -> dict:
    """Run the judge LLM on a single report and return parsed scores.

    Args:
        report: Structured lesion report dict.
        evidence_block: Evidence string from kb_rag.format_evidence_block().
        llm_call_fn: Async callable(messages, model, response_format) -> str.
                     Defaults to the production Ollama/OpenAI client.
                     Inject a mock in tests.
        model: Model name to pass to the LLM.

    Returns:
        Parsed judge dict (faithfulness, hallucinated_claims, citation_correct).
        Returns {"faithfulness": None, ...} on any LLM or parse error.
    """
    user_prompt = build_judge_prompt(report, evidence_block)
    messages = [
        {"role": "system", "content": _JUDGE_SYSTEM},
        {"role": "user", "content": user_prompt},
    ]

    if llm_call_fn is None:
        # Default: use production client (requires Ollama/OpenAI running).
        # Imported inside function so module-level import never touches openai in tests.
        from openai import AsyncOpenAI  # noqa: PLC0415
        import os  # noqa: PLC0415
        backend = os.getenv("LLM_BACKEND", "openai").lower()
        if backend == "ollama":
            client = AsyncOpenAI(
                api_key="ollama",
                base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            )
            model = os.getenv("OLLAMA_MODEL", model)
        else:
            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

        async def _default_call(msgs, mdl, response_fmt):
            completion = await client.chat.completions.create(
                model=mdl,
                messages=msgs,
                response_format=response_fmt,
                max_tokens=512,
            )
            return completion.choices[0].message.content or "{}"

        llm_call_fn = _default_call

    response_format = {
        "type": "json_schema",
        "json_schema": {"name": "faithfulness_judge", "schema": _JUDGE_SCHEMA},
    }

    try:
        raw = await llm_call_fn(messages, model, response_format)
        return parse_judge_response(raw)
    except Exception as exc:
        return {
            "faithfulness": None,
            "hallucinated_claims": [],
            "citation_correct": False,
            "error": str(exc),
        }


def average_faithfulness(scores: list[dict]) -> Optional[float]:
    """Average faithfulness scores over a list of judge results, skipping None."""
    valid = [s["faithfulness"] for s in scores if s.get("faithfulness") is not None]
    return round(sum(valid) / len(valid), 4) if valid else None
