#!/usr/bin/env python3
"""Replace generated-figure placeholders in the thesis .tex files with
\\includegraphics, keyed by each figure's \\label. Placeholders whose label is
not in the mapping (figures still pending real data/screenshots) are left intact."""
import re
from pathlib import Path

TEX_DIR = Path(__file__).resolve().parents[2] / "GRADUATION_THESIS_TEMPLATE__ENG_VER_"

# label -> (pdf basename, includegraphics width)
MAP = {
    "fig:yolo-arch":      ("fig_2_2_yolo_arch", "0.85\\textwidth"),
    "fig:strongsort":     ("fig_2_3_strongsort", "0.9\\textwidth"),
    "fig:gst-elements":   ("fig_2_4_gstreamer", "\\textwidth"),
    "fig:usecase":        ("fig_3_1_usecase", "0.8\\textwidth"),
    "fig:architecture":   ("fig_3_2_architecture", "\\textwidth"),
    "fig:subprocess-ipc": ("fig_3_3_subprocess_ipc", "\\textwidth"),
    "fig:fsm":            ("fig_3_4_fsm", "\\textwidth"),
    "fig:er-schema":      ("fig_3_5_er", "0.85\\textwidth"),
    "fig:detect-pipeline":("fig_4_1_detection_flow", "0.52\\textwidth"),
    "fig:bench-method":   ("fig_5_1_bench_method", "0.9\\textwidth"),
    "fig:viewport":       ("fig_4_3_viewport", "\\textwidth"),
    "fig:ws-sequence":    ("fig_4_6_ws_sequence", "0.9\\textwidth"),
    "fig:voice-flow":     ("fig_4_7_voice_flow", "\\textwidth"),
    "fig:vlm-factory":    ("fig_4_8_vlm_factory", "0.9\\textwidth"),
    "fig:deploy":         ("fig_4_17_deploy", "\\textwidth"),
    "fig:latency-dist":   ("fig_5_2_latency_dist", "0.75\\textwidth"),
    "fig:throughput":     ("fig_5_3_throughput", "0.75\\textwidth"),
    "fig:lora-pipeline":  ("fig_6_1_lora", "\\textwidth"),
}

FIG_BLOCK = re.compile(r"\\begin\{figure\}.*?\\end\{figure\}", re.DOTALL)
PLACEHOLDER = re.compile(r"\\fbox\{\\parbox.*?\]\}\}", re.DOTALL)
LABEL = re.compile(r"\\label\{([^}]+)\}")

total = 0
for tex in sorted(TEX_DIR.glob("Chapter *.tex")):
    text = tex.read_text()
    changed = 0

    def repl(m):
        global changed
        block = m.group(0)
        lab = LABEL.search(block)
        if not lab or lab.group(1) not in MAP:
            return block
        fname, width = MAP[lab.group(1)]
        inc = f"\\includegraphics[width={width}]{{Figures/{fname}.pdf}}"
        new_block, n = PLACEHOLDER.subn(lambda _: inc, block)
        if n:
            changed += 1
        return new_block

    text = FIG_BLOCK.sub(repl, text)
    if changed:
        tex.write_text(text)
        print(f"{tex.name}: wired {changed} figure(s)")
        total += changed
print(f"Total wired: {total}")