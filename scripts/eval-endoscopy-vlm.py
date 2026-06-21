#!/usr/bin/env python3
"""Evaluation CLI for the endoscopy VLM pipeline over HyperKvasir.

Usage:
    python scripts/eval-endoscopy-vlm.py \\
        --kvasir-dir /data/hyperkvasir/labeled-images \\
        --output-dir /data/eval-results \\
        --llm-backend ollama \\
        --limit 50

Outputs (in --output-dir):
    metrics.csv        — per-sample scores
    metrics-table.md   — aggregated results table (thesis-ready)
    per-sample.json    — full record list with all fields

Dataset download:
    https://datasets.simula.no/hyper-kvasir/
    Use the "labeled-images" split (~10,600 images, ~1.1 GB).

NOT run in pytest — requires Ollama/OpenAI live + HyperKvasir on disk.
Run the N=50 pilot first via --limit 50 to validate before a full run (~6-20h).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import csv
import json
import os
import sys
import time
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent
_API_DIR = _REPO_ROOT / "src" / "backend" / "api"
sys.path.insert(0, str(_API_DIR))

from dotenv import load_dotenv
load_dotenv(_API_DIR / ".env")


def _setup_llm(backend: str, model: str | None) -> tuple:
    """Return (client, model_name) for the requested backend."""
    from openai import AsyncOpenAI  # noqa: PLC0415
    if backend == "ollama":
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
        mdl = model or os.getenv("OLLAMA_MODEL", "medgemma-4b")
        client = AsyncOpenAI(api_key="ollama", base_url=base_url)
        print(f"[eval] LLM backend: ollama @ {base_url} model={mdl}")
    else:
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            print("[eval] WARNING: OPENAI_API_KEY not set", file=sys.stderr)
        mdl = model or os.getenv("OPENAI_MODEL_VISION", "gpt-4o")
        client = AsyncOpenAI(api_key=api_key)
        print(f"[eval] LLM backend: openai model={mdl}")
    return client, mdl


async def _run_report(client, model: str, frame_b64: str, label: str, conf: float,
                      timestamp_ms: int, frame_index: int,
                      patient_ctx: str = "", evidence_block: str = "") -> dict:
    """Call the production prompt builders + LLM to produce a lesion report.

    Reuses LESION_REPORT_PROMPT, LESION_REPORT_SCHEMA, build_lesion_user_message
    directly (DRY — no prompt duplication). Returns the parsed report dict or {}
    on error.
    """
    from llm_prompts import (  # noqa: PLC0415
        LESION_REPORT_PROMPT, LESION_REPORT_SCHEMA, build_lesion_user_message,
    )
    user_text = build_lesion_user_message(
        label, conf, timestamp_ms, frame_index,
        patient_ctx=patient_ctx, evidence_block=evidence_block,
    )
    messages = [
        {"role": "system", "content": LESION_REPORT_PROMPT},
        {"role": "user", "content": [
            {"type": "image_url",
             "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}", "detail": "high"}},
            {"type": "text", "text": user_text},
        ]},
    ]
    response_format = {
        "type": "json_schema",
        "json_schema": {"name": "endoscopy_lesion_report", "schema": LESION_REPORT_SCHEMA},
    }
    try:
        completion = await asyncio.wait_for(
            client.chat.completions.create(
                model=model, messages=messages,
                response_format=response_format, max_tokens=1500,
            ),
            timeout=float(os.getenv("LLM_CALL_TIMEOUT_SEC", "180")),
        )
        raw = completion.choices[0].message.content or "{}"
        return json.loads(raw)
    except Exception as exc:
        print(f"[eval] LLM error: {exc}", file=sys.stderr)
        return {}


async def _process_sample(
    sample: dict,
    client,
    model: str,
    judge_model: str,
    skip_judge: bool,
    no_rag: bool = False,
) -> dict:
    """Process one HyperKvasir sample end-to-end and return a scored record."""
    import kb_rag  # noqa: PLC0415
    from eval.schema_mapping import match_report, severity_match  # noqa: PLC0415
    from eval.judge_faithfulness import judge_report  # noqa: PLC0415

    img_path: Path = sample["path"]
    kvasir_class: str = sample["kvasir_class"]

    # Load image → base64 JPEG
    raw_bytes = img_path.read_bytes()
    frame_b64 = base64.b64encode(raw_bytes).decode()

    # Use class name as the detection label (no YOLO inference over HyperKvasir —
    # we evaluate the LLM report quality given the ground-truth class as the label).
    label = kvasir_class.replace("-", " ")
    conf = 1.0  # ground-truth label → 100% "confidence" for prompt context

    # Retrieve KB evidence (same as production path). For the RAG ablation
    # (--no-rag) we suppress the evidence block to measure its contribution.
    if no_rag:
        evidence_block = ""
    else:
        evidence_chunks = kb_rag.retrieve_evidence(label, k=3, min_sim=0.3)
        evidence_block = kb_rag.format_evidence_block(evidence_chunks)

    t0 = time.monotonic()
    report = await _run_report(
        client, model, frame_b64, label, conf,
        timestamp_ms=0, frame_index=0,
        evidence_block=evidence_block,
    )
    latency = time.monotonic() - t0

    conclusion = report.get("conclusion", {})
    description = report.get("description", {})
    primary_dx = conclusion.get("primary_dx", "")
    severity = conclusion.get("severity", "")
    paris_class = description.get("paris_class", "")
    recommendations = conclusion.get("recommendations", [])
    differential = conclusion.get("differential", [])

    # Dx match over primary_dx + differential (fairer: the VLM's primary_dx is often
    # a Paris morphology code while the disease name surfaces in the differential).
    dx_matched = match_report(report, kvasir_class) if report else False
    # Severity (risk-stratification) match — the fairer headline for a morphology
    # model: the report schema is designed to produce a severity, not a class label.
    sev_matched = severity_match(severity, kvasir_class)

    # LLM-as-judge faithfulness (expensive — skip with --no-judge)
    faithfulness_result: dict = {}
    if not skip_judge and report:
        faithfulness_result = await judge_report(
            report, evidence_block, model=judge_model,
        )

    record = {
        "image_path": str(img_path),
        "kvasir_class": kvasir_class,
        "primary_dx": primary_dx,
        "severity": severity,
        "paris_class": paris_class,
        "recommendations": recommendations,
        "differential": [d.get("dx", "") for d in differential if isinstance(d, dict)],
        "dx_match": dx_matched,
        "severity_match": sev_matched,
        "faithfulness": faithfulness_result.get("faithfulness"),
        "hallucinated_claims": faithfulness_result.get("hallucinated_claims", []),
        "citation_correct": faithfulness_result.get("citation_correct"),
        "latency_s": round(latency, 2),
    }
    return record


def _write_outputs(records: list[dict], output_dir: Path) -> None:
    """Write metrics.csv, metrics-table.md, and per-sample.json."""
    from eval.metrics import summarize  # noqa: PLC0415

    output_dir.mkdir(parents=True, exist_ok=True)

    # per-sample.json
    per_sample_path = output_dir / "per-sample.json"
    per_sample_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2, default=str)
    )
    print(f"[eval] Written: {per_sample_path}")

    # metrics.csv
    csv_path = output_dir / "metrics.csv"
    fieldnames = [
        "image_path", "kvasir_class", "primary_dx", "severity",
        "paris_class", "dx_match", "faithfulness", "citation_correct", "latency_s",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
    print(f"[eval] Written: {csv_path}")

    # Aggregate metrics
    summary = summarize(records)
    dx = summary["diagnosis_accuracy"]
    sev = summary["severity_accuracy"]
    rec = summary["recommendation"]
    faith = summary["faithfulness"]

    # metrics-table.md (thesis-ready)
    lines = [
        "# Evaluation Results — Endoscopy VLM Pipeline",
        "",
        "## Summary",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Samples evaluated | {dx['n_records']} |",
        f"| Diagnosis accuracy (macro-F1) | **{dx['macro_f1']:.4f}** |",
        f"| Severity accuracy (risk stratification) | **{sev['accuracy']:.4f}** ({sev['n_correct']}/{sev['n_records']}) |",
        f"| Mean recommendation score (0-3) | **{rec['mean']:.4f}** |",
        f"| Mean faithfulness (0-1) | **{faith['mean'] if faith['mean'] is not None else 'N/A'}** |",
        f"| Faithfulness judged / skipped | {faith['n_judged']} / {faith['n_skipped']} |",
        "",
        "## Per-Class Diagnosis Accuracy",
        "",
        "| Class | TP | FN | Recall | F1 |",
        "|-------|----|----|--------|----|",
    ]
    for cls, stats in sorted(dx["per_class"].items()):
        lines.append(
            f"| {cls} | {stats['tp']} | {stats['fn']} "
            f"| {stats['recall']:.4f} | {stats['f1']:.4f} |"
        )

    lines += [
        "",
        "## Recommendation Score Distribution",
        "",
        "| Score | Count |",
        "|-------|-------|",
    ]
    for score, count in sorted(rec["distribution"].items()):
        lines.append(f"| {score} | {count} |")

    md_path = output_dir / "metrics-table.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[eval] Written: {md_path}")

    # Print summary to console
    print(f"\n[eval] === RESULTS ===")
    print(f"  Diagnosis macro-F1:    {dx['macro_f1']:.4f}")
    print(f"  Severity accuracy:     {sev['accuracy']:.4f} ({sev['n_correct']}/{sev['n_records']})")
    print(f"  Mean rec score (0-3):  {rec['mean']:.4f}")
    print(f"  Mean faithfulness:     {faith['mean']}")


async def _main(args: argparse.Namespace) -> None:
    import kb_rag  # noqa: PLC0415
    kb_rag.warm()  # pre-load KB chunks

    from eval.dataset_kvasir import iter_samples, EVAL_CLASSES  # noqa: PLC0415

    client, model = _setup_llm(args.llm_backend, args.model)
    judge_model = args.judge_model or model

    classes = (tuple(c.strip() for c in args.classes.split(",") if c.strip())
               if args.classes else EVAL_CLASSES)
    samples = list(iter_samples(args.kvasir_dir, limit=args.limit,
                                classes=classes, per_class=args.per_class))
    print(f"[eval] {len(samples)} samples to evaluate "
          f"(limit={args.limit}, per_class={args.per_class})")

    records: list[dict] = []
    for i, sample in enumerate(samples, 1):
        print(f"[eval] {i}/{len(samples)}: {sample['kvasir_class']} — {sample['path'].name}")
        try:
            record = await _process_sample(
                sample, client, model, judge_model,
                skip_judge=args.no_judge, no_rag=args.no_rag,
            )
            records.append(record)
        except Exception as exc:
            print(f"[eval] ERROR on {sample['path']}: {exc}", file=sys.stderr)
            records.append({
                "image_path": str(sample["path"]),
                "kvasir_class": sample["kvasir_class"],
                "primary_dx": "", "severity": "", "paris_class": "",
                "recommendations": [], "differential": [], "dx_match": False,
                "severity_match": False,
                "faithfulness": None, "hallucinated_claims": [],
                "citation_correct": None, "latency_s": 0.0, "error": str(exc),
            })

    _write_outputs(records, Path(args.output_dir))


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Evaluate endoscopy VLM pipeline over HyperKvasir dataset."
    )
    p.add_argument("--kvasir-dir", required=True,
                   help="Path to HyperKvasir labeled-images root")
    p.add_argument("--output-dir", default="data/eval-results",
                   help="Directory for output files (default: data/eval-results)")
    p.add_argument("--llm-backend", default=os.getenv("LLM_BACKEND", "ollama"),
                   choices=["ollama", "openai"],
                   help="LLM backend (default: ollama or LLM_BACKEND env)")
    p.add_argument("--model", default=None,
                   help="Override model name (default: OLLAMA_MODEL / OPENAI_MODEL_VISION env)")
    p.add_argument("--judge-model", default=None,
                   help="Model for faithfulness judge (default: same as --model)")
    p.add_argument("--limit", type=int, default=50,
                   help="Max samples to evaluate (default: 50 for pilot; use None for full run)")
    p.add_argument("--per-class", type=int, default=None,
                   help="Cap samples PER class for a balanced, stratified sample "
                        "(e.g. --per-class 10 across all classes). Applied before --limit.")
    p.add_argument("--classes", default=None,
                   help="Comma-separated subset of HyperKvasir classes to evaluate "
                        "(e.g. in-domain: barretts,esophagitis-a). Default: all EVAL_CLASSES.")
    p.add_argument("--no-judge", action="store_true",
                   help="Skip LLM-as-judge faithfulness scoring (faster for dx/rec-only runs)")
    p.add_argument("--no-rag", action="store_true",
                   help="Suppress KB evidence block (RAG ablation — measure RAG's contribution)")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(_main(args))
