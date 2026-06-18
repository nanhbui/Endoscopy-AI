#!/usr/bin/env python3
"""eval_voice_intents.py — Reproducible evaluation of the Vietnamese voice-command
intent classifier (src/voice/intent_classifier.py).

Measures the keyword-based ``IntentClassifier`` (the low-latency, offline fast-path
used in the procedure room) on a curated set of realistic Vietnamese doctor
utterances. Reports overall accuracy, per-intent precision/recall/F1, and a
confusion matrix; optionally writes the confusion-matrix figure as a PDF for the
thesis.

Usage:
    python3 scripts/eval_voice_intents.py [--fig OUT_DIR]

The test set deliberately mixes (a) utterances that contain a registered keyword and
(b) harder paraphrases with no keyword, so the score reflects real recognition rather
than a tautological keyword lookup. Ground-truth labels are the author's intent.
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.voice.intent_classifier import IntentClassifier, VoiceIntent  # noqa: E402

# (utterance, ground-truth intent). Vietnamese, as a clinician would speak mid-session.
TEST_SET: list[tuple[str, str]] = [
    # BO_QUA — false positive / dismiss
    ("cái này bắt sai rồi", "BO_QUA"),
    ("chỉ là bọt thôi mà", "BO_QUA"),
    ("không phải tổn thương đâu", "BO_QUA"),
    ("ánh sáng phản chiếu ấy mà", "BO_QUA"),
    ("bỏ qua đi tiếp tục", "BO_QUA"),
    ("đây là dịch nhầy", "BO_QUA"),
    ("nhầm rồi không đúng", "BO_QUA"),
    ("chỗ này nhận sai", "BO_QUA"),
    ("loại bỏ cái này", "BO_QUA"),
    ("bọt trắng thôi", "BO_QUA"),
    # GIAI_THICH — explain
    ("giải thích thêm cho tôi", "GIAI_THICH"),
    ("tại sao lại phát hiện chỗ này", "GIAI_THICH"),
    ("cho tôi biết chi tiết hơn", "GIAI_THICH"),
    ("phân tích thêm đi", "GIAI_THICH"),
    ("nói thêm về tổn thương này", "GIAI_THICH"),
    ("vì sao lại đánh dấu đây", "GIAI_THICH"),
    ("thêm thông tin về ca này", "GIAI_THICH"),
    ("giải thích xem nào", "GIAI_THICH"),
    # KIEM_TRA_LAI — re-check / re-analyse
    ("kiểm tra lại frame này", "KIEM_TRA_LAI"),
    ("phân tích lại đi", "KIEM_TRA_LAI"),
    ("xem lại chỗ đó", "KIEM_TRA_LAI"),
    ("đánh giá lại lần nữa", "KIEM_TRA_LAI"),
    ("check lại cho chắc", "KIEM_TRA_LAI"),
    ("nhìn lại xem có gì không", "KIEM_TRA_LAI"),
    # XAC_NHAN — confirm
    ("đúng rồi xác nhận", "XAC_NHAN"),
    ("chính xác lưu lại đi", "XAC_NHAN"),
    ("ghi nhận ca này", "XAC_NHAN"),
    ("chuẩn rồi", "XAC_NHAN"),
    ("xác nhận tổn thương", "XAC_NHAN"),
    ("đúng đấy", "XAC_NHAN"),
    # UNKNOWN — out of scope
    ("hôm nay trời đẹp nhỉ", "UNKNOWN"),
    ("bệnh nhân tên gì", "UNKNOWN"),
    ("mấy giờ rồi", "UNKNOWN"),
    ("chuẩn bị máy nội soi", "UNKNOWN"),

    # ── extended set ──────────────────────────────────────────────────────────
    # BO_QUA
    ("cái này là bọt khí thôi", "BO_QUA"),
    ("phản xạ ánh sáng ấy mà", "BO_QUA"),
    ("không phải tổn thương gì đâu", "BO_QUA"),
    ("AI bắt nhầm rồi", "BO_QUA"),
    ("loại cái này ra", "BO_QUA"),
    ("đây chỉ là dịch nhầy bám", "BO_QUA"),
    ("sai rồi bỏ qua", "BO_QUA"),
    ("không đúng đâu tiếp tục đi", "BO_QUA"),
    ("nhận diện sai chỗ này", "BO_QUA"),
    ("chỗ này bị loáng sáng", "BO_QUA"),
    ("bọt với nhầy thôi mà", "BO_QUA"),
    ("không phải đâu bỏ qua nhé", "BO_QUA"),
    # GIAI_THICH
    ("giải thích kỹ hơn cho tôi", "GIAI_THICH"),
    ("tại sao chỗ này lại được đánh dấu", "GIAI_THICH"),
    ("cho tôi thêm thông tin về tổn thương", "GIAI_THICH"),
    ("phân tích chi tiết chỗ này đi", "GIAI_THICH"),
    ("nói thêm về cái vừa phát hiện", "GIAI_THICH"),
    ("vì sao lại nghi ngờ ung thư", "GIAI_THICH"),
    ("giải thích thêm tí nữa", "GIAI_THICH"),
    ("chi tiết hơn được không", "GIAI_THICH"),
    ("cho biết thêm về vùng này", "GIAI_THICH"),
    ("lý do phát hiện là gì", "GIAI_THICH"),
    # KIEM_TRA_LAI
    ("kiểm tra lại vùng này", "KIEM_TRA_LAI"),
    ("phân tích lại lần nữa đi", "KIEM_TRA_LAI"),
    ("xem lại cho kỹ", "KIEM_TRA_LAI"),
    ("đánh giá lại chỗ đó", "KIEM_TRA_LAI"),
    ("nhìn lại xem nào", "KIEM_TRA_LAI"),
    ("check lại giúp tôi", "KIEM_TRA_LAI"),
    ("rà lại frame này", "KIEM_TRA_LAI"),
    ("soi lại chỗ vừa rồi", "KIEM_TRA_LAI"),
    ("kiểm tra lại với ngưỡng thấp hơn", "KIEM_TRA_LAI"),
    ("phân tích lại đoạn này", "KIEM_TRA_LAI"),
    # XAC_NHAN
    ("xác nhận đây là tổn thương", "XAC_NHAN"),
    ("đúng rồi ghi lại đi", "XAC_NHAN"),
    ("chính xác lưu vào", "XAC_NHAN"),
    ("chuẩn ghi nhận lại", "XAC_NHAN"),
    ("đúng rồi đấy", "XAC_NHAN"),
    ("ghi nhận trường hợp này", "XAC_NHAN"),
    ("lưu lại kết quả này", "XAC_NHAN"),
    ("xác nhận phát hiện", "XAC_NHAN"),
    ("ừ đúng rồi", "XAC_NHAN"),
    ("ok lưu lại", "XAC_NHAN"),
    # UNKNOWN
    ("y tá đâu rồi", "UNKNOWN"),
    ("cho xin cốc nước", "UNKNOWN"),
    ("tăng độ sáng màn hình lên", "UNKNOWN"),
    ("bệnh nhân tiếp theo là ai", "UNKNOWN"),
    ("ghi chú vào hồ sơ bệnh án", "UNKNOWN"),
    ("gọi bác sĩ trưởng khoa", "UNKNOWN"),
    ("rút ống soi ra từ từ", "UNKNOWN"),
    ("hôm nay đông bệnh nhân quá", "UNKNOWN"),
    ("bơm thêm hơi đi", "UNKNOWN"),
    ("lát nữa hội chẩn nhé", "UNKNOWN"),
]

LABELS = ["BO_QUA", "GIAI_THICH", "KIEM_TRA_LAI", "XAC_NHAN", "UNKNOWN"]


def evaluate() -> dict:
    clf = IntentClassifier()
    conf = {g: defaultdict(int) for g in LABELS}
    misses = []
    correct = 0
    for text, gt in TEST_SET:
        intent, c = clf.classify(text)
        pred = intent.name
        conf[gt][pred] += 1
        if pred == gt:
            correct += 1
        else:
            misses.append((text, gt, pred, round(c, 2)))
    n = len(TEST_SET)
    # Per-intent precision / recall / F1
    per = {}
    for lab in LABELS:
        tp = conf[lab][lab]
        fp = sum(conf[g][lab] for g in LABELS if g != lab)
        fn = sum(conf[lab][p] for p in LABELS if p != lab)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        per[lab] = (prec, rec, f1, conf[lab][lab] + fn)  # support
    return {"n": n, "correct": correct, "acc": correct / n,
            "conf": conf, "per": per, "misses": misses}


def print_report(r: dict) -> None:
    print(f"Voice intent classifier — keyword fast-path")
    print(f"Test cases: {r['n']} | Accuracy: {r['correct']}/{r['n']} = {r['acc']*100:.1f}%\n")
    print("Per-intent  precision  recall   f1     support")
    for lab in LABELS:
        p, rec, f1, sup = r["per"][lab]
        print(f"  {lab:<13} {p:6.2f}   {rec:6.2f}  {f1:6.2f}    {sup}")
    print("\nConfusion (rows=ground truth, cols=pred):")
    print("gt\\pred".ljust(14) + "".join(l[:6].ljust(8) for l in LABELS))
    for g in LABELS:
        print(g.ljust(14) + "".join(str(r["conf"][g][p]).ljust(8) for p in LABELS))
    print("\nMisclassifications:")
    if r["misses"]:
        for t, gt, pred, c in r["misses"]:
            print(f"  '{t}'  gt={gt} -> {pred} (conf {c})")
    else:
        print("  (none)")


def save_figure(r: dict, out_dir: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    mat = np.array([[r["conf"][g][p] for p in LABELS] for g in LABELS], dtype=float)
    fig, ax = plt.subplots(figsize=(6.2, 5.2))
    im = ax.imshow(mat, cmap="Blues")
    ax.set_xticks(range(len(LABELS))); ax.set_xticklabels(LABELS, rotation=35, ha="right", fontsize=9)
    ax.set_yticks(range(len(LABELS))); ax.set_yticklabels(LABELS, fontsize=9)
    ax.set_xlabel("Predicted intent"); ax.set_ylabel("Ground-truth intent")
    thr = mat.max() / 2 if mat.max() else 0.5
    for i in range(len(LABELS)):
        for j in range(len(LABELS)):
            v = int(mat[i, j])
            if v:
                ax.text(j, i, v, ha="center", va="center",
                        color="white" if mat[i, j] > thr else "#1a1a1a", fontsize=11)
    ax.set_title(f"Voice intent confusion (acc {r['acc']*100:.1f}%, n={r['n']})", fontsize=11)
    fig.tight_layout()
    out = out_dir / "fig_5_10_voice_intents.pdf"
    fig.savefig(out)
    plt.close(fig)
    print(f"\n[fig] {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fig", metavar="OUT_DIR", help="write confusion-matrix PDF here")
    args = ap.parse_args()
    r = evaluate()
    print_report(r)
    if args.fig:
        save_figure(r, Path(args.fig))


if __name__ == "__main__":
    main()
