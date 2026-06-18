#!/usr/bin/env python3
"""
Generate thesis figures (block/flow/FSM/ER/use-case diagrams via Graphviz, and
data plots via Matplotlib) as vector PDFs for the LaTeX report.

Usage:
    python3 gen_diagrams.py [OUT_DIR]

Diagrams need only `dot` (graphviz CLI). The latency histogram additionally needs
ultralytics + a model + a video; the viewport montage needs cv2 + a clinical frame.
Each data-dependent figure is skipped (with a message) if its inputs are absent, so
the diagram set always renders.
"""
import os
import subprocess
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "_figs_out")
OUT.mkdir(parents=True, exist_ok=True)

# Optional inputs for the data-driven figures (overridable via env).
MODEL = os.environ.get("FIG_MODEL", str(Path.home() / "DATN_ver0/models/best_train6.pt"))
VIDEO = os.environ.get("FIG_VIDEO", "/tmp/endoscope2_short.mp4")
CLINICAL_FRAME = os.environ.get("FIG_CLINICAL_FRAME", "/tmp/clinical_frame.png")

# Shared Graphviz preamble.
HEAD = (
    'graph [fontname="Helvetica", bgcolor="white"];\n'
    'node [fontname="Helvetica", fontsize=11];\n'
    'edge [fontname="Helvetica", fontsize=10];\n'
)
BOX = 'node [shape=box, style="rounded,filled", fillcolor="#eef3fb", color="#2c5fa8"];\n'


def render_dot(name: str, body: str, engine: str = "dot", graph_attrs: str = ""):
    src = f"digraph G {{\n{HEAD}{graph_attrs}{body}\n}}\n"
    dot_path = OUT / f"{name}.dot"
    pdf_path = OUT / f"{name}.pdf"
    dot_path.write_text(src)
    subprocess.run([engine, "-Tpdf", str(dot_path), "-o", str(pdf_path)], check=True)
    print(f"  [dot] {pdf_path.name}")


# ── 2.2 YOLOv8 architecture ────────────────────────────────────────────────────
def fig_yolo():
    body = (
        'rankdir=LR;\n' + BOX +
        'inp [label="Input frame\\n640 px", fillcolor="#f5f5f5", color="#888888"];\n'
        'bb  [label="Backbone\\n(CSP)"];\n'
        'nk  [label="Neck\\n(PAN-FPN)"];\n'
        'hd  [label="Decoupled head\\n(anchor-free)"];\n'
        'subgraph cluster_out {\n style=dashed; color="#888888"; label="Multi-scale detections";\n'
        '  p3 [label="P3 / small", shape=note, fillcolor="#fff3e0", color="#e08a2c"];\n'
        '  p4 [label="P4 / medium", shape=note, fillcolor="#fff3e0", color="#e08a2c"];\n'
        '  p5 [label="P5 / large", shape=note, fillcolor="#fff3e0", color="#e08a2c"];\n'
        '}\n'
        'inp -> bb -> nk -> hd;\n'
        'hd -> p3; hd -> p4; hd -> p5;\n'
    )
    render_dot("fig_2_2_yolo_arch", body)


# ── 2.3 StrongSORT association loop ─────────────────────────────────────────────
def fig_strongsort():
    body = (
        'rankdir=LR;\n' + BOX +
        'det  [label="Detection\\n(YOLO box)", fillcolor="#f5f5f5", color="#888888"];\n'
        'reid [label="OSNet / OSNet-DCN\\nRe-ID embedding"];\n'
        'kf   [label="Kalman motion\\n(+ virtual trajectory\\non detection gaps)"];\n'
        'match[label="Hungarian\\nmatching", shape=diamond, fillcolor="#fdeaea", color="#c0392b"];\n'
        'trk  [label="Track\\n(persistent track_id)", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'dedup[label="track-id dedup\\n(report once per track)", fillcolor="#fff3e0", color="#e08a2c"];\n'
        'det -> reid -> match;\n'
        'kf -> match;\n'
        'match -> trk;\n'
        'trk -> dedup;\n'
        'trk -> kf [label="predict next", style=dashed, constraint=false];\n'
    )
    render_dot("fig_2_3_strongsort", body)


# ── 2.4 GStreamer pipeline ──────────────────────────────────────────────────────
def fig_gstreamer():
    els = ["filesrc", "qtdemux", "h264parse", "avdec_h264", "videoconvert", "appsink"]
    nodes = "".join(
        f'e{i} [label="{e}"];\n' for i, e in enumerate(els)
    )
    chain = " -> ".join(f"e{i}" for i in range(len(els))) + ";\n"
    body = (
        'rankdir=LR;\n'
        'node [shape=box, style=filled, fillcolor="#eef3fb", color="#2c5fa8"];\n'
        + nodes +
        'app [label="Python / YOLO", shape=box, style="filled", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        + chain +
        'e5 -> app [label="decoded BGR frame"];\n'
    )
    render_dot("fig_2_4_gstreamer", body)


# ── 3.1 Use-case diagram ────────────────────────────────────────────────────────
def fig_usecase():
    ucs = [
        ("u1", "Start session\\n(upload / library / live)"),
        ("u2", "Respond to detection\\n(confirm / ignore / explain /\\nre-check / report-FP)"),
        ("u3", "Voice command"),
        ("u4", "View session summary"),
        ("u5", "Ask chatbot"),
        ("u6", "Export PDF report"),
        ("u7", "Review false positives"),
    ]
    uc_nodes = "".join(
        f'{i} [label="{l}", shape=ellipse, style=filled, fillcolor="#eef3fb", color="#2c5fa8"];\n'
        for i, l in ucs
    )
    body = (
        'rankdir=LR;\n'
        'node [fontsize=11];\n'
        'phys [label="Physician\\n(endoscopist)", shape=box, style="rounded,filled", '
        'fillcolor="#fffde7", color="#b8860b"];\n'
        'worker [label="GStreamer + YOLO\\nworker", shape=box, style="rounded,filled", '
        'fillcolor="#f0f0f0", color="#888888"];\n'
        'vlm [label="VLM backend\\n(OpenAI / Ollama)", shape=box, style="rounded,filled", '
        'fillcolor="#f0f0f0", color="#888888"];\n'
        'subgraph cluster_sys {\n label="AI-assisted endoscopy system"; style=dashed; color="#2c5fa8";\n'
        + uc_nodes +
        '}\n'
        + "".join(f'phys -> {i} [dir=none];\n' for i, _ in ucs)
        + 'u2 -> worker [dir=none, style=dashed];\n'
        + 'u2 -> vlm [dir=none, style=dashed];\n'
        + 'u4 -> vlm [dir=none, style=dashed];\n'
        + 'u5 -> vlm [dir=none, style=dashed];\n'
    )
    render_dot("fig_3_1_usecase", body)


# ── 3.2 Overall architecture ────────────────────────────────────────────────────
def fig_architecture():
    body = (
        'rankdir=LR; nodesep=0.5; ranksep=0.8;\n' + BOX +
        'fe [label="Next.js frontend\\n(port 3000)\\ndashboard / workspace /\\nreport / analytics", '
        'fillcolor="#e3f2fd", color="#1565c0"];\n'
        'be [label="FastAPI backend\\n(port 8001)\\nREST + WebSocket,\\nVLM client, persistence, voice"];\n'
        'wk [label="GStreamer + YOLO worker\\n(spawned subprocess)\\nGLib threads + CUDA", '
        'fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'db [label="SQLite (WAL)", shape=cylinder, fillcolor="#f5f5f5", color="#888888"];\n'
        'vlm [label="VLM backend\\nOpenAI / Ollama", shape=box, style="rounded,filled", '
        'fillcolor="#f0f0f0", color="#888888"];\n'
        'fe -> be [label="WebSocket (live loop)\\n+ REST", dir=both];\n'
        'be -> wk [label="2 IPC queues\\nresult / command", dir=both];\n'
        'be -> db [dir=both];\n'
        'be -> vlm [label="OpenAI-compatible", dir=both];\n'
    )
    render_dot("fig_3_2_architecture", body)


# ── 3.3 Subprocess isolation + IPC ──────────────────────────────────────────────
def fig_subprocess_ipc():
    body = (
        'rankdir=LR; ranksep=1.0;\n'
        'node [shape=box, style="rounded,filled", fontsize=11];\n'
        'subgraph cluster_srv {\n label="Web-server process (asyncio / uvloop)"; style=filled; '
        'fillcolor="#e3f2fd"; color="#1565c0";\n'
        '  evloop [label="event loop\\n(WebSocket / REST)", fillcolor="white", color="#1565c0"];\n'
        '  bridge [label="bridge thread\\n(drains result queue)", fillcolor="white", color="#1565c0"];\n'
        '}\n'
        'subgraph cluster_wk {\n label="Worker process (spawn): GLib threads + CUDA"; style=filled; '
        'fillcolor="#e8f5e9"; color="#2e7d32";\n'
        '  gst [label="GStreamer decode", fillcolor="white", color="#2e7d32"];\n'
        '  yolo [label="YOLO inference", fillcolor="white", color="#2e7d32"];\n'
        '}\n'
        'gst -> yolo;\n'
        'yolo -> bridge [label="result queue\\n(events out)", color="#2e7d32"];\n'
        'bridge -> evloop;\n'
        'evloop -> gst [label="command queue\\nRESUME / IGNORE /\\nRECHECK / STOP", color="#1565c0"];\n'
    )
    render_dot("fig_3_3_subprocess_ipc", body)


# ── 3.4 Finite state machine ────────────────────────────────────────────────────
def fig_fsm():
    body = (
        'rankdir=LR; ranksep=0.7;\n'
        'node [shape=ellipse, style=filled, fillcolor="#eef3fb", color="#2c5fa8", fontsize=11];\n'
        'IDLE; PLAYING;\n'
        'PWI [label="PAUSED_\\nWAITING_INPUT", fillcolor="#fdeaea", color="#c0392b"];\n'
        'LLM [label="PROCESSING_LLM", fillcolor="#fff3e0", color="#e08a2c"];\n'
        'EOS [label="EOS_SUMMARY", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'IDLE -> PLAYING [label="start video"];\n'
        'PLAYING -> PWI [label="detection\\npasses filters\\n(pause + record PTS)"];\n'
        'PWI -> PLAYING [label="resume / ignore\\n(accurate seek)"];\n'
        'PWI -> LLM [label="explain"];\n'
        'LLM -> PWI [label="report done"];\n'
        'PLAYING -> EOS [label="video ends"];\n'
        'PWI -> EOS [label="video ends"];\n'
    )
    render_dot("fig_3_4_fsm", body)


# ── 3.5 ER diagram ──────────────────────────────────────────────────────────────
def fig_er():
    body = (
        'rankdir=LR; node [shape=record, fontsize=10, style=filled, fillcolor="#eef3fb", color="#2c5fa8"];\n'
        'lr [label="{lesion_reports|PK (session_id, frame_index)\\lreport_json\\llabel, severity (denorm.)\\lmodel, generated_at\\l}"];\n'
        'fp [label="{false_positives|PK id\\llabel\\lbbox_x1..y2 (1920x1080)\\lframe_b64 (thumbnail)\\lreported_at, session_id_source\\l}", '
        'fillcolor="#fdeaea", color="#c0392b"];\n'
        'cl [label="{confirmed_lesions|PK id\\llabel\\lbbox_x1..y2 (1920x1080)\\lframe_b64 (thumbnail)\\lreported_at, session_id_source\\l}", '
        'fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'ss [label="{session_summaries|PK session_id\\lsummary_json\\lmodel, generated_at\\l}"];\n'
        'qa [label="{qa_messages|PK (session_id, sequence)\\lrole (user/assistant)\\lcontent\\lcreated_at\\l}"];\n'
        'sess [label="{session|session_id (PK)\\l}", fillcolor="#fffde7", color="#b8860b"];\n'
        'sess -> lr [label="1..*", dir=both, arrowtail=none];\n'
        'sess -> fp [label="cross-session (rejected)", dir=both, arrowtail=none];\n'
        'sess -> cl [label="cross-session (confirmed)", dir=both, arrowtail=none];\n'
        'sess -> ss [label="1..1", dir=both, arrowtail=none];\n'
        'sess -> qa [label="1..*", dir=both, arrowtail=none];\n'
    )
    render_dot("fig_3_5_er", body)


# ── 4.1 Detection data flow ─────────────────────────────────────────────────────
def fig_dedup():
    body = (
        'rankdir=TB; nodesep=0.4; ranksep=0.45;\n'
        'node [shape=box, style="rounded,filled", fillcolor="#eef3fb", color="#2c5fa8", fontsize=10];\n'
        'det [label="Surviving detection\\n(label, bbox, track_id)", fillcolor="#f5f5f5", color="#888888"];\n'
        'wf [label="Box spans > 95%\\nof viewport?", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'diff [label="Diffuse label?\\n(\\"viêm\\" keyword)", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'spot [label="Same spot?\\n(centre near a recent\\nreport, within cooldown)", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'tid [label="track_id already\\nreported this session?", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'drop [label="Suppress", fillcolor="#fdeaea", color="#c0392b"];\n'
        'rep [label="Report\\n(pause + DETECTION_FOUND)", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'det -> wf;\n'
        'wf -> drop [label="yes (frame-level)"];\n'
        'wf -> diff [label="no"];\n'
        'diff -> spot [label="yes\\n(diffuse)"];\n'
        'diff -> tid [label="no\\n(focal)"];\n'
        'spot -> drop [label="yes"]; spot -> rep [label="no"];\n'
        'tid -> drop [label="yes"]; tid -> rep [label="no"];\n'
    )
    render_dot("fig_4_1b_dedup", body)


def fig_detection_flow():
    steps = [
        ("s0", "ffprobe codec probe", "#f5f5f5", "#888888"),
        ("s1", "GStreamer decode\\n(appsink sync / drop)", "#eef3fb", "#2c5fa8"),
        ("s2", "Viewport detection\\n(scope circle, ≥ 30%)", "#eef3fb", "#2c5fa8"),
        ("s3", "Frame-quality filter\\n(dark / uniform / skip-initial)", "#eef3fb", "#2c5fa8"),
        ("s4", "YOLO inference\\n(every FRAME_STEP-th frame)", "#eef3fb", "#2c5fa8"),
        ("s5", "Per-class thresholds\\n(cancer 0.75 / infl. 0.60)", "#eef3fb", "#2c5fa8"),
        ("s6", "Tracker (UTR-Track + OSNet-DCN)\\n→ track-id / diffuse dedup", "#eef3fb", "#2c5fa8"),
        ("s7", "Whole-frame suppression\\n(area > 95%)", "#eef3fb", "#2c5fa8"),
        ("s8", "DETECTION_FOUND\\n(pause + emit event)", "#e8f5e9", "#2e7d32"),
    ]
    nodes = "".join(
        f'{i} [label="{l}", fillcolor="{f}", color="{c}"];\n' for i, l, f, c in steps
    )
    chain = " -> ".join(s[0] for s in steps) + ";\n"
    body = (
        'rankdir=TB; node [shape=box, style="rounded,filled", fontsize=11];\n'
        + nodes + chain
    )
    render_dot("fig_4_1_detection_flow", body)


# ── 4.7 Voice-control flow ──────────────────────────────────────────────────────
def fig_voice():
    body = (
        'rankdir=LR;\n'
        'node [shape=box, style="rounded,filled", fillcolor="#eef3fb", color="#2c5fa8", fontsize=11];\n'
        'mic [label="Microphone", shape=box, fillcolor="#fffde7", color="#b8860b"];\n'
        'wsa [label="Web Speech API\\n(vi-VN, continuous)"];\n'
        'fast [label="Fast path:\\ninterim → keyword table", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'slow [label="Slow path:\\nfinal → /voice/classify"];\n'
        'llm [label="keyword classifier\\nor LLM fallback"];\n'
        'intent [label="Clinical intent\\n(BO_QUA / GIAI_THICH /\\nXAC_NHAN / KIEM_TRA_LAI)", '
        'fillcolor="#fff3e0", color="#e08a2c"];\n'
        'ws [label="WebSocket action", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'fw [label="server-side\\nfaster-whisper\\n(/voice/command)", fillcolor="#f0f0f0", color="#888888"];\n'
        'mic -> wsa;\n wsa -> fast; wsa -> slow;\n slow -> llm -> intent;\n fast -> intent;\n'
        'intent -> ws;\n mic -> fw [style=dashed, label="raw audio"];\n fw -> intent [style=dashed];\n'
    )
    render_dot("fig_4_7_voice_flow", body)


# ── 4.8 VLM factory ─────────────────────────────────────────────────────────────
def fig_vlm():
    body = (
        'rankdir=LR;\n'
        'node [shape=box, style="rounded,filled", fillcolor="#eef3fb", color="#2c5fa8", fontsize=11];\n'
        'env [label="LLM_BACKEND\\n(env switch)", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'cli [label="single AsyncOpenAI\\nclient + model factory"];\n'
        'oai [label="OpenAI\\ngpt-4o (vision)\\ngpt-4o-mini (text)\\n(cloud fallback)", fillcolor="#e3f2fd", color="#1565c0"];\n'
        'oll [label="Ollama\\nmedgemma-4b\\n(local, primary)", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'rep [label="schema-constrained\\nJSON report", shape=note, fillcolor="#f5f5f5", color="#888888"];\n'
        'strm [label="streamed summary /\\nQ&A (token-by-token)", shape=note, fillcolor="#f5f5f5", color="#888888"];\n'
        'env -> cli;\n cli -> oai [label="cloud"]; cli -> oll [label="local"];\n'
        'cli -> rep; cli -> strm;\n'
    )
    render_dot("fig_4_8_vlm_factory", body)


# ── 4.17 Deployment topology ────────────────────────────────────────────────────
def fig_deploy():
    body = (
        'rankdir=LR; node [shape=box, style="rounded,filled", fontsize=10];\n'
        'subgraph cluster_a {\n label="(a) Docker Compose"; style=filled; fillcolor="#e3f2fd"; color="#1565c0";\n'
        '  a_be [label="CUDA backend :8001\\n(GStreamer + Python)", fillcolor="white"];\n'
        '  a_fe [label="Node frontend :3000", fillcolor="white"];\n'
        '  a_vol [label="volumes:\\nuploads / models (ro) / logs", fillcolor="#f5f5f5"];\n'
        '  a_fe -> a_be [label="health-gated"]; a_be -> a_vol [dir=none];\n'
        '}\n'
        'subgraph cluster_b {\n label="(b) Remote-GPU dev"; style=filled; fillcolor="#e8f5e9"; color="#2e7d32";\n'
        '  b_dev [label="local editor", fillcolor="white"];\n'
        '  b_gpu [label="remote GPU host", fillcolor="white"];\n'
        '  b_dev -> b_gpu [label="WireGuard VPN\\nrsync + SSH tunnel", dir=both];\n'
        '}\n'
        'subgraph cluster_c {\n label="(c) Public demo"; style=filled; fillcolor="#fff3e0"; color="#e08a2c";\n'
        '  c_ng [label="ngrok tunnel", fillcolor="white"];\n'
        '  c_cad [label="Caddy reverse proxy", fillcolor="white"];\n'
        '  c_bf [label="backend / frontend", fillcolor="white"];\n'
        '  c_ng -> c_cad -> c_bf;\n'
        '}\n'
    )
    render_dot("fig_4_17_deploy", body)


# ── 6.1 LoRA pipeline ───────────────────────────────────────────────────────────
def fig_lora():
    body = (
        'rankdir=LR;\n' + BOX +
        'hk [label="HyperKvasir +\\nlabelled endoscopy", fillcolor="#f5f5f5", color="#888888"];\n'
        'gen [label="instruction-pair\\ngenerator"];\n'
        'vqa [label="ShareGPT\\nVQA pairs", shape=note, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'ft [label="4-bit LoRA\\nfine-tune (MedGemma 4B)"];\n'
        'off [label="local offline\\nreporting", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'hk -> gen -> vqa -> ft -> off;\n'
    )
    render_dot("fig_6_1_lora", body)


# ── Dual-modality (video + audio) system architecture ───────────────────────────
def fig_dual_modality():
    body = (
        'rankdir=LR; nodesep=0.4; ranksep=0.7;\n'
        'node [shape=box, style="rounded,filled", fontsize=10];\n'
        'cam [label="Endoscopy camera /\\nvideo source", fillcolor="#fffde7", color="#b8860b"];\n'
        'mic [label="Microphone", fillcolor="#fffde7", color="#b8860b"];\n'
        'gst [label="GStreamer\\ndecode", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'yolo [label="YOLOv8 +\\nUTR-Track / StrongSORT", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'asr [label="ASR\\n(Web Speech /\\nfaster-whisper)", fillcolor="#e3f2fd", color="#1565c0"];\n'
        'intent [label="Intent classifier\\n(keyword / LLM)", fillcolor="#e3f2fd", color="#1565c0"];\n'
        'ctrl [label="Central controller\\n(FSM / pipeline)", shape=box, style="filled", fillcolor="#fff3e0", color="#e08a2c", penwidth=2];\n'
        'vlm [label="VLM report\\n(MedGemma 4B / GPT-4o)", fillcolor="#eef3fb", color="#2c5fa8"];\n'
        'ui [label="Frontend UI", fillcolor="#eef3fb", color="#2c5fa8"];\n'
        'db [label="SQLite", shape=cylinder, fillcolor="#f5f5f5", color="#888888"];\n'
        'cam -> gst [label="video"]; gst -> yolo [label="frames"]; yolo -> ctrl [label="detections"];\n'
        'mic -> asr [label="audio"]; asr -> intent [label="transcript"]; intent -> ctrl [label="voice intent"];\n'
        'ctrl -> vlm [label="explain"]; vlm -> ctrl [style=dashed];\n'
        'ctrl -> ui [dir=both, label="events / actions"];\n'
        'ctrl -> db;\n'
    )
    render_dot("fig_3_8_dual_modality", body)


# ── Physical hardware / deployment ──────────────────────────────────────────────
def fig_hardware():
    body = (
        'rankdir=LR; nodesep=0.5; ranksep=0.8;\n'
        'node [shape=box, style="rounded,filled", fillcolor="#eef3fb", color="#2c5fa8", fontsize=10];\n'
        'scope [label="Endoscopy tower\\n+ scope\\n(video output)", fillcolor="#fffde7", color="#b8860b"];\n'
        'cap [label="Local capture host\\n(USB capture card,\\nH.264 encoder)"];\n'
        'gpu [label="GPU workstation\\nRTX 4080 SUPER\\n(backend + YOLO + VLM)", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'clin [label="Clinician workstation\\n(browser UI + microphone)", fillcolor="#e3f2fd", color="#1565c0"];\n'
        'scope -> cap [label="HDMI / SDI cable"];\n'
        'cap -> gpu [label="RTP/H.264 over\\nUDP (WireGuard VPN)"];\n'
        'clin -> gpu [dir=both, label="WebSocket / HTTPS\\n(Caddy + ngrok);\\nvoice via Web Speech API"];\n'
    )
    render_dot("fig_4_19_hardware", body)


# ── Clinical session activity / user flow ───────────────────────────────────────
def fig_userflow():
    body = (
        'rankdir=TB; nodesep=0.35; ranksep=0.45;\n'
        'node [shape=box, style="rounded,filled", fillcolor="#eef3fb", color="#2c5fa8", fontsize=10];\n'
        'start [label="Start", shape=ellipse, fillcolor="#fffde7", color="#b8860b"];\n'
        'src [label="Choose source\\n(upload / library / live)"];\n'
        'play [label="Play + real-time detection"];\n'
        'dec [label="Lesion detected\\n& passes filters?", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'pause [label="Auto-pause + show finding\\n(record PTS)"];\n'
        'choice [label="Physician decision\\n(touch / voice)", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'explain [label="Explain ->\\nstreaming VLM report"];\n'
        'confirm [label="Confirm\\n(save / auto-capture)", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'ignore [label="Ignore /\\nreport false positive", fillcolor="#fdeaea", color="#c0392b"];\n'
        'recheck [label="Re-check\\n(lower threshold)"];\n'
        'resume [label="Resume\\n(accurate seek)"];\n'
        'eos [label="Video ended?", shape=diamond, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'summary [label="Session summary"];\n'
        'qa [label="Q&A chatbot"];\n'
        'export [label="Export PDF"];\n'
        'end [label="End", shape=ellipse, fillcolor="#fffde7", color="#b8860b"];\n'
        'start -> src -> play -> dec;\n'
        'dec -> play [label="no", style=dashed];\n'
        'dec -> pause [label="yes"];\n'
        'pause -> choice;\n'
        'choice -> explain [label="explain"]; explain -> choice [style=dashed];\n'
        'choice -> recheck [label="re-check"]; recheck -> choice [style=dashed];\n'
        'choice -> confirm [label="confirm"]; choice -> ignore [label="ignore / FP"];\n'
        'confirm -> resume; ignore -> resume; resume -> eos;\n'
        'eos -> play [label="no", style=dashed];\n'
        'eos -> summary [label="yes"]; summary -> qa -> export -> end;\n'
    )
    render_dot("fig_3_7_userflow", body)


# ── Frontend sitemap ────────────────────────────────────────────────────────────
def fig_sitemap():
    body = (
        'rankdir=TB; nodesep=0.4; ranksep=0.55;\n'
        'node [shape=box, style="rounded,filled", fillcolor="#eef3fb", color="#2c5fa8", fontsize=10];\n'
        'app [label="Web application\\n(Next.js, port 3000)", fillcolor="#e3f2fd", color="#1565c0"];\n'
        'dash [label="Dashboard  /\\nkey metrics, recent sessions"];\n'
        'work [label="Workspace  /workspace\\nlive video + overlay, voice,\\naction bar, lesion report"];\n'
        'rep [label="Report  /report\\nsummary, chatbot, PDF export"];\n'
        'ana [label="Analytics  /analytics\\ncharts, false-positive review"];\n'
        'docs [label="Docs  /docs\\nusage guide"];\n'
        'app -> dash; app -> work; app -> rep; app -> ana; app -> docs;\n'
    )
    render_dot("fig_4_18_sitemap", body)


# ── Project schedule (Gantt) ────────────────────────────────────────────────────
def fig_gantt():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    # (task, start_week, duration_weeks, phase-colour-key)
    tasks = [
        ("Literature review", 0, 4, 0),
        ("Requirements & use-case modelling", 3, 3, 0),
        ("Dataset prep + YOLOv8 training", 5, 7, 1),
        ("GStreamer decode pipeline", 10, 4, 1),
        ("Subprocess isolation + IPC", 13, 3, 1),
        ("Detection filtering + de-duplication", 15, 4, 1),
        ("FSM + WebSocket protocol", 17, 4, 2),
        ("Vietnamese voice control", 20, 3, 2),
        ("VLM reporting + chatbot", 22, 4, 2),
        ("Frontend (dashboard/workspace/...)", 18, 9, 2),
        ("Persistence + analytics", 24, 4, 2),
        ("Deployment + benchmarking", 27, 3, 3),
        ("Evaluation + thesis writing", 28, 4, 3),
    ]
    colours = ["#1565c0", "#2e7d32", "#2c5fa8", "#e08a2c"]
    phase_lbl = ["Research", "Core pipeline", "Subsystems & UI", "Eval & deploy"]
    fig, ax = plt.subplots(figsize=(10, 5))
    for i, (name, s, d, c) in enumerate(tasks):
        y = len(tasks) - i
        ax.barh(y, d, left=s, height=0.6, color=colours[c], alpha=0.9, zorder=3)
        ax.text(s + d + 0.2, y, name, va="center", fontsize=9)
    ax.set_yticks([])
    ax.set_xlabel("Project week")
    ax.set_xlim(0, 46)
    ax.set_ylim(0.3, len(tasks) + 0.7)
    ax.grid(axis="x", ls=":", alpha=0.5, zorder=0)
    ax.legend(handles=[Patch(color=colours[i], label=phase_lbl[i]) for i in range(4)],
              loc="lower right", fontsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "fig_gantt.pdf")
    plt.close(fig)
    print("  [plt] fig_gantt.pdf")


# ── 4.0 Backend module / component diagram ──────────────────────────────────────
def fig_modules():
    body = (
        'rankdir=TB; nodesep=0.45; ranksep=0.6;\n'
        'node [shape=component, style="filled", fillcolor="#eef3fb", color="#2c5fa8", fontsize=10];\n'
        'fe [label="Next.js frontend", shape=box, style="rounded,filled", fillcolor="#e3f2fd", color="#1565c0"];\n'
        'ws [label="endoscopy_ws_server\\n(FastAPI: REST + WebSocket,\\nLLM client + error mapping)"];\n'
        'pc [label="pipeline_controller\\n(FSM + IPC queues +\\nworker management)"];\n'
        'wk [label="worker (spawn)\\nGStreamer decode + YOLO +\\nUTR-Track / StrongSORT (OSNet-DCN)", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'db [label="db\\n(SQLite, WAL)", shape=cylinder, fillcolor="#f5f5f5", color="#888888"];\n'
        'voice [label="voice_api\\nintent_classifier /\\nfaster-whisper"];\n'
        'prompts [label="llm_prompts\\n(report / summary\\nJSON schemas)", shape=note, fillcolor="#fff3e0", color="#e08a2c"];\n'
        'vlm [label="VLM backend\\nOpenAI / Ollama", shape=box, style="rounded,filled", fillcolor="#f0f0f0", color="#888888"];\n'
        'fe -> ws [label="WS / REST", dir=both];\n'
        'ws -> pc [label="control / events", dir=both];\n'
        'pc -> wk [label="2 IPC queues", dir=both];\n'
        'ws -> db [dir=both]; ws -> voice; ws -> prompts [style=dashed];\n'
        'ws -> vlm [label="OpenAI-compatible", dir=both];\n'
    )
    render_dot("fig_4_0_modules", body)


# ── 4.2 Live capture from an endoscopy tower ────────────────────────────────────
def fig_capture():
    body = (
        'rankdir=LR; nodesep=0.4;\n'
        'node [shape=box, style="rounded,filled", fontsize=10];\n'
        'tower [label="Endoscopy tower\\n(video output)", fillcolor="#fffde7", color="#b8860b"];\n'
        'card [label="USB capture card\\n/dev/videoN (V4L2)", fillcolor="#f5f5f5", color="#888888"];\n'
        'subgraph cluster_local {\n label="Local host (near the tower)"; style=filled; fillcolor="#e3f2fd"; color="#1565c0";\n'
        '  enc [label="GStreamer:\\nv4l2src (MJPEG 720p30)\\njpegdec -> x264enc\\n(zerolatency)\\nrtph264pay", fillcolor="white", color="#1565c0"];\n'
        '}\n'
        'subgraph cluster_srv {\n label="GPU server"; style=filled; fillcolor="#e8f5e9"; color="#2e7d32";\n'
        '  rx [label="udpsrc :5000\\nrtph264depay -> h264parse\\n-> decode", fillcolor="white", color="#2e7d32"];\n'
        '  det [label="YOLO detection\\npipeline", fillcolor="white", color="#2e7d32"];\n'
        '  rx -> det;\n'
        '}\n'
        'tower -> card [label="HDMI / SDI\\ncable"];\n'
        'card -> enc;\n'
        'enc -> rx [label="RTP/H.264 over\\nUDP (WireGuard VPN)"];\n'
    )
    render_dot("fig_4_2_capture", body)


# ── 4.4 Browser-capture live mode (capture-and-accumulate) ──────────────────────
def fig_browser_live():
    body = (
        'rankdir=LR; nodesep=0.4; ranksep=0.7;\n'
        'node [shape=box, style="rounded,filled", fontsize=10];\n'
        'subgraph cluster_browser {\n'
        '  label="Browser (clinician laptop)"; style=dashed; color="#2c5fa8"; fontcolor="#2c5fa8";\n'
        '  dongle [label="HDMI dongle\\n(getUserMedia)", fillcolor="#fffde7", color="#b8860b"];\n'
        '  mirror [label="Live mirror\\n<video> (continuous)", fillcolor="#eef3fb", color="#2c5fa8"];\n'
        '  snap [label="Auto-snapshot\\non detection\\n(canvas + boxes)", fillcolor="#eef3fb", color="#2c5fa8"];\n'
        '  panel [label="Captures panel\\nthumbnail + report", fillcolor="#eef3fb", color="#2c5fa8"];\n'
        '  report [label="Session report\\n(/report)", fillcolor="#fff3e0", color="#e08a2c", penwidth=2];\n'
        '}\n'
        'subgraph cluster_server {\n'
        '  label="GPU server"; style=dashed; color="#2e7d32"; fontcolor="#2e7d32";\n'
        '  yolo [label="YOLO detector\\n/ws/live-detect", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        '  vlm [label="VLM\\n/live/explain", fillcolor="#e8f5e9", color="#2e7d32"];\n'
        '}\n'
        'dongle -> mirror [label="capture"];\n'
        'mirror -> yolo [label="JPEG ~5 fps"];\n'
        'yolo -> mirror [label="boxes", style=dashed, constraint=false];\n'
        'mirror -> snap [label="on detect\\n(cooldown 4 s)"];\n'
        'snap -> panel [label="thumbnail"];\n'
        'snap -> vlm [label="explain (parallel)"];\n'
        'vlm -> panel [label="report", style=dashed];\n'
        'panel -> report [label="create report\\n(when all VLM settle)"];\n'
    )
    render_dot("fig_4_4_browser_live", body)


# ── 5.1 Benchmark methodology ───────────────────────────────────────────────────
def fig_bench_method():
    body = (
        'rankdir=LR;\n' + BOX +
        'prod [label="Production decode path\\n(GStreamer appsink,\\ncodec-aware, model\\nfused / FP32 / warm-up)", '
        'fillcolor="#e8f5e9", color="#2e7d32"];\n'
        'd1 [label="sync=false\\n(run flat-out,\\nnot paced to real time)", shape=note, '
        'fillcolor="#fff3e0", color="#e08a2c"];\n'
        'd2 [label="no application filters\\n(viewport / quality /\\nper-class / dedup omitted)", shape=note, '
        'fillcolor="#fff3e0", color="#e08a2c"];\n'
        'rec [label="record per frame:\\ndecode/IO time +\\nUltralytics inference time", fillcolor="#eef3fb", color="#2c5fa8"];\n'
        'stat [label="report:\\nmean / p50 / p90 / p95 / max,\\nthroughput (FPS),\\nper-class counts", '
        'fillcolor="#e3f2fd", color="#1565c0"];\n'
        'prod -> rec; d1 -> rec [style=dashed]; d2 -> rec [style=dashed];\n'
        'rec -> stat;\n'
    )
    render_dot("fig_5_1_bench_method", body)


# ── 4.6 WebSocket sequence (matplotlib) ─────────────────────────────────────────
def fig_ws_sequence():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyArrowPatch

    actors = ["Worker", "Server", "Browser"]
    x = {a: i for i, a in enumerate(actors)}
    msgs = [
        ("Worker", "Server", "DETECTION_FOUND"),
        ("Server", "Browser", "DETECTION_FOUND (pause)"),
        ("Browser", "Server", "ACTION_EXPLAIN"),
        ("Server", "Browser", "LESION_REPORT_DONE"),
        ("Browser", "Server", "ACTION_CONFIRM"),
        ("Server", "Browser", "STATE_CHANGE(PLAYING)"),
        ("Worker", "Server", "VIDEO_FINISHED"),
        ("Server", "Browser", "SESSION_SUMMARY_DONE"),
        ("Browser", "Server", "ACTION_SESSION_QA"),
        ("Server", "Browser", "SESSION_QA_CHUNK *"),
    ]
    fig, ax = plt.subplots(figsize=(8.5, 6.2))
    top, dy = len(msgs) + 1, 1.0
    for a in actors:
        ax.plot([x[a], x[a]], [0, top], color="#9aa7bd", lw=1.2, zorder=1)
        ax.text(x[a], top + 0.25, a, ha="center", va="bottom", fontsize=12,
                fontweight="bold", bbox=dict(boxstyle="round", fc="#eef3fb", ec="#2c5fa8"))
    for i, (src, dst, label) in enumerate(msgs):
        y = top - (i + 1) * dy
        x0, x1 = x[src], x[dst]
        color = "#2e7d32" if x1 > x0 else "#c0392b"
        ax.add_patch(FancyArrowPatch((x0, y), (x1, y), arrowstyle="-|>",
                     mutation_scale=14, color=color, lw=1.4, zorder=3))
        ax.text((x0 + x1) / 2, y + 0.12, label, ha="center", va="bottom", fontsize=9)
    ax.set_xlim(-0.6, len(actors) - 0.4)
    ax.set_ylim(0, top + 0.9)
    ax.axis("off")
    fig.tight_layout()
    fig.savefig(OUT / "fig_4_6_ws_sequence.pdf")
    plt.close(fig)
    print("  [plt] fig_4_6_ws_sequence.pdf")


# ── 5.3 Throughput bar chart (real measured data) ───────────────────────────────
def fig_throughput():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    devices = ["CPU\n(i7-10700K)", "GPU FP32\n(RTX 4080 SUPER)", "GPU FP16\n(RTX 4080 SUPER)"]
    fps = [5.8, 56.6, 56.4]
    colors = ["#888888", "#2c5fa8", "#2e7d32"]
    fig, ax = plt.subplots(figsize=(7, 4.2))
    bars = ax.bar(devices, fps, color=colors, width=0.6, zorder=3)
    ax.axhline(30, color="#c0392b", ls="--", lw=1.4, zorder=2)
    ax.text(2.45, 31.5, "30 fps real-time", color="#c0392b", ha="right", fontsize=10)
    for b, v in zip(bars, fps):
        ax.text(b.get_x() + b.get_width() / 2, v + 1, f"{v:.1f}", ha="center", fontsize=11,
                fontweight="bold")
    ax.set_ylabel("End-to-end throughput (FPS)")
    ax.set_ylim(0, 64)
    ax.grid(axis="y", ls=":", alpha=0.5, zorder=0)
    fig.tight_layout()
    fig.savefig(OUT / "fig_5_3_throughput.pdf")
    plt.close(fig)
    print("  [plt] fig_5_3_throughput.pdf")


# ── 5.2 Per-frame latency distribution (live measurement) ───────────────────────
def fig_latency():
    if not (Path(MODEL).exists() and Path(VIDEO).exists()):
        print(f"  [skip] fig_5_2_latency: missing model/video ({MODEL} / {VIDEO})")
        return
    try:
        import cv2
        import numpy as np
        from ultralytics import YOLO
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:
        print(f"  [skip] fig_5_2_latency: {e}")
        return

    model = YOLO(MODEL)
    try:
        model.fuse()
    except Exception:
        pass
    dummy = np.zeros((640, 640, 3), dtype=np.uint8)
    for _ in range(5):
        model(dummy, verbose=False, device=0)

    cap = cv2.VideoCapture(VIDEO)
    infer = []
    n = 0
    while n < 500:
        ok, frame = cap.read()
        if not ok:
            break
        r = model(frame, conf=0.5, verbose=False, device=0)
        infer.append(float(r[0].speed.get("inference", 0.0)))
        n += 1
    cap.release()
    infer = np.array(infer[3:])  # drop residual warm-up
    if infer.size == 0:
        print("  [skip] fig_5_2_latency: no frames")
        return

    mean, p50, p90, p95 = infer.mean(), np.percentile(infer, 50), np.percentile(infer, 90), np.percentile(infer, 95)
    fig, ax = plt.subplots(figsize=(7, 4.2))
    ax.hist(infer, bins=40, color="#2c5fa8", alpha=0.85, zorder=3)
    for v, c, lbl in [(mean, "#c0392b", f"mean {mean:.1f}"),
                      (p95, "#e08a2c", f"p95 {p95:.1f}")]:
        ax.axvline(v, color=c, ls="--", lw=1.4, zorder=4)
        ax.text(v, ax.get_ylim()[1] * 0.92, lbl, color=c, rotation=90, va="top", ha="right", fontsize=9)
    ax.set_xlabel("Per-frame YOLO inference time (ms)")
    ax.set_ylabel("Frame count")
    ax.grid(axis="y", ls=":", alpha=0.5, zorder=0)
    fig.tight_layout()
    fig.savefig(OUT / "fig_5_2_latency_dist.pdf")
    plt.close(fig)
    print(f"  [plt] fig_5_2_latency_dist.pdf  (n={infer.size}, mean={mean:.2f}, p95={p95:.2f})")


# ── 5.x Detector training curves (from checkpoint train_results) ────────────────
def fig_training_curve():
    if not Path(MODEL).exists():
        print(f"  [skip] fig_training_curve: missing model {MODEL}")
        return
    try:
        import torch
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:
        print(f"  [skip] fig_training_curve: {e}")
        return
    ck = torch.load(MODEL, map_location="cpu", weights_only=False)
    tr = ck.get("train_results")
    if not isinstance(tr, dict) or "epoch" not in tr:
        print("  [skip] fig_training_curve: no train_results")
        return
    ep = tr["epoch"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.2))
    for key, lab in [("train/box_loss", "box"), ("train/cls_loss", "cls"), ("train/dfl_loss", "dfl")]:
        if key in tr:
            ax1.plot(ep, tr[key], label=lab, lw=1.6)
    ax1.set_xlabel("epoch"); ax1.set_ylabel("training loss")
    ax1.legend(); ax1.grid(ls=":", alpha=0.5); ax1.set_title("Training losses")
    for key, lab, st in [("metrics/mAP50(B)", "mAP@0.5", "-"),
                          ("metrics/mAP50-95(B)", "mAP@0.5:0.95", "-"),
                          ("metrics/precision(B)", "precision", "--"),
                          ("metrics/recall(B)", "recall", "--")]:
        if key in tr:
            ax2.plot(ep, tr[key], label=lab, ls=st, lw=1.5)
    ax2.set_xlabel("epoch"); ax2.set_ylabel("validation metric")
    ax2.set_ylim(0, 1); ax2.legend(fontsize=8); ax2.grid(ls=":", alpha=0.5)
    ax2.set_title("Validation precision / recall / mAP")
    fig.tight_layout()
    fig.savefig(OUT / "fig_5_9_training_curve.pdf")
    plt.close(fig)
    print(f"  [plt] fig_5_9_training_curve.pdf  ({len(ep)} epochs)")


# ── 4.3 Viewport detection montage (cv2 on a real clinical frame) ───────────────
def fig_viewport():
    if not Path(CLINICAL_FRAME).exists():
        print(f"  [skip] fig_4_3_viewport: missing frame {CLINICAL_FRAME}")
        return
    try:
        import cv2
        import numpy as np
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:
        print(f"  [skip] fig_4_3_viewport: {e}")
        return

    img = cv2.imread(CLINICAL_FRAME)
    if img is None:
        print("  [skip] fig_4_3_viewport: unreadable frame")
        return
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
    kernel = np.ones((15, 15), np.uint8)
    closed = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel)
    cnts, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    rectimg = img.copy()
    if cnts:
        c = max(cnts, key=cv2.contourArea)
        if cv2.contourArea(c) >= 0.30 * img.shape[0] * img.shape[1]:
            x, y, w, h = cv2.boundingRect(c)
            cv2.rectangle(rectimg, (x, y), (x + w, y + h), (0, 255, 0), 6)

    panels = [
        ("Raw clinical frame", cv2.cvtColor(img, cv2.COLOR_BGR2RGB)),
        ("Binary threshold (>25)", th),
        ("Morphological close (15x15)", closed),
        ("Largest contour -> viewport", cv2.cvtColor(rectimg, cv2.COLOR_BGR2RGB)),
    ]
    fig, axs = plt.subplots(1, 4, figsize=(15, 4))
    for ax, (title, im) in zip(axs, panels):
        cmap = "gray" if im.ndim == 2 else None
        ax.imshow(im, cmap=cmap)
        ax.set_title(title, fontsize=11)
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(OUT / "fig_4_3_viewport.pdf", dpi=140)
    plt.close(fig)
    print("  [plt] fig_4_3_viewport.pdf")


def main():
    print(f"Output dir: {OUT.resolve()}")
    print("Graphviz diagrams:")
    fig_yolo(); fig_strongsort(); fig_gstreamer(); fig_usecase()
    fig_architecture(); fig_subprocess_ipc(); fig_fsm(); fig_er()
    fig_detection_flow(); fig_voice(); fig_vlm(); fig_deploy(); fig_lora()
    fig_bench_method(); fig_capture(); fig_browser_live(); fig_dedup(); fig_modules(); fig_userflow(); fig_sitemap()
    fig_dual_modality(); fig_hardware()
    print("Matplotlib figures:")
    fig_ws_sequence(); fig_throughput(); fig_latency(); fig_viewport(); fig_training_curve(); fig_gantt()
    print("Done.")


if __name__ == "__main__":
    main()
