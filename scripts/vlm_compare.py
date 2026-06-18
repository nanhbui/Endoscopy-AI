#!/usr/bin/env python3
"""
Compare vision-language models on the SAME endoscopy lesion images, using the
project's real lesion-report prompt + JSON schema. Outputs a side-by-side
Markdown table so report quality can be judged qualitatively (no labels needed).

This is the harness for "Option A" — trying a different/medical VLM without any
fine-tuning. Point it at any models served by the local Ollama (OpenAI-compatible).

Usage:
  python scripts/vlm_compare.py --images data/crops --models qwen2.5vl:7b,minicpm-v \
      --label "Viêm dạ dày HP" --out /mnt/disk2/emie_ft/vlm_compare.md

The base model (qwen2.5vl:7b) is the current deployed default; add candidates to
compare. Images = a folder of JP/PNG lesion thumbnails (e.g. crops exported by the
worker, or frames you sampled).
"""
import argparse
import base64
import json
import sys
import time
from pathlib import Path

# Import the project's REAL prompt + schema so the comparison matches production.
_API = Path(__file__).resolve().parents[1] / "src" / "backend" / "api"
sys.path.insert(0, str(_API))
try:
    from llm_prompts import LESION_REPORT_PROMPT, LESION_REPORT_SCHEMA, build_lesion_user_message
except Exception as e:  # pragma: no cover
    print(f"[warn] could not import project prompt ({e}); using a minimal fallback")
    LESION_REPORT_PROMPT = "You are an endoscopy assistant. Describe the lesion in the image."
    LESION_REPORT_SCHEMA = None
    def build_lesion_user_message(label, confidence, timestamp_ms, frame_index):
        return f"Detected '{label}' (conf {confidence:.2f}). Describe and classify it."


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def run_one(client, model: str, img_b64: str, label: str) -> dict:
    user_text = build_lesion_user_message(label, 0.8, 0, 0)
    content = [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}", "detail": "high"}},
        {"type": "text", "text": user_text},
    ]
    kwargs = dict(model=model, messages=[
        {"role": "system", "content": LESION_REPORT_PROMPT},
        {"role": "user", "content": content},
    ], max_tokens=1200, temperature=0.2)
    if LESION_REPORT_SCHEMA:
        kwargs["response_format"] = {"type": "json_schema",
                                     "json_schema": {"name": "lesion_report", "schema": LESION_REPORT_SCHEMA}}
    t0 = time.monotonic()
    r = client.chat.completions.create(**kwargs)
    dt = time.monotonic() - t0
    return {"text": r.choices[0].message.content, "latency": dt}


def summarise(raw: str) -> str:
    """Pull the human-relevant fields out of the JSON report for the table."""
    try:
        d = json.loads(raw)
        c = d.get("conclusion", {})
        desc = d.get("description", {})
        diff = ", ".join(f"{x.get('dx')} {x.get('probability_pct')}%" for x in c.get("differential", [])[:3])
        return (f"**Dx:** {c.get('primary_dx','?')} · **sev:** {c.get('severity','?')} · "
                f"**Paris:** {desc.get('paris_class','?')}\\\n**DDx:** {diff}\\\n"
                f"**Conf:** {c.get('ai_confidence','?')}")
    except Exception:
        return (raw or "")[:400]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="folder of lesion JPG/PNG")
    ap.add_argument("--models", required=True, help="comma-separated ollama model names")
    ap.add_argument("--label", default="tổn thương", help="detector label hint")
    ap.add_argument("--base-url", default="http://localhost:11434/v1")
    ap.add_argument("--out", default="vlm_compare.md")
    args = ap.parse_args()

    from openai import OpenAI
    client = OpenAI(api_key="ollama", base_url=args.base_url)

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    imgs = sorted(p for p in Path(args.images).iterdir()
                  if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    print(f"{len(imgs)} images × {len(models)} models = {len(imgs)*len(models)} calls")

    lines = [f"# VLM comparison — label hint: {args.label}\n",
             f"Models: {', '.join(models)}\n"]
    for img in imgs:
        b64 = _b64(img)
        lines.append(f"\n## {img.name}\n")
        lines.append(f"![]({img.resolve()})\n")
        lines.append("| Model | Latency | Report |")
        lines.append("|---|---|---|")
        for m in models:
            try:
                res = run_one(client, m, b64, args.label)
                lines.append(f"| `{m}` | {res['latency']:.1f}s | {summarise(res['text'])} |")
                print(f"  {img.name} × {m}: {res['latency']:.1f}s")
            except Exception as e:
                lines.append(f"| `{m}` | — | ERROR: {e} |")
                print(f"  {img.name} × {m}: ERROR {e}")
    Path(args.out).write_text("\n".join(lines))
    print(f"→ written {args.out}")


if __name__ == "__main__":
    main()
