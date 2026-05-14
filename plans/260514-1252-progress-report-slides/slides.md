---
title: AI Endoscopy Suite — Báo cáo tiến độ
author: Nguyễn Anh Bùi
date: 2026-05-14
marp: true
theme: default
paginate: true
---

# AI Endoscopy Suite
## Báo cáo tiến độ đồ án

**Đề tài**: Hệ thống nội soi tiêu hóa hỗ trợ chẩn đoán bằng AI thời gian thực

- GVHD: *(tên thầy/cô)*
- Sinh viên: Nguyễn Anh Bùi
- 2026-05-14

> Detection thời gian thực (YOLOv8m + StrongSORT) +
> structured medical report + Q&A chatbot (Qwen2.5-VL 7B local)

---

## Tổng quan kiến trúc hệ thống

```mermaid
flowchart LR
  subgraph FE[Frontend — Next.js]
    UI[Workspace + Report UI]
  end
  subgraph BE[Backend — FastAPI WS]
    WS[ws_analysis handler]
    REST[REST endpoints]
  end
  subgraph WORKER[Pipeline subprocess]
    GST[GStreamer decode]
    YOLO[YOLOv8m + StrongSORT]
  end
  subgraph LLM[Ollama local]
    QWEN[Qwen2.5-VL 7B]
  end
  subgraph DB[SQLite]
    LR[lesion_reports]
    SS[session_summaries]
    QA[qa_messages]
    FP[false_positives]
  end

  UI -- WebSocket --> WS
  UI -- HTTP --> REST
  WS <--> WORKER
  WS --> QWEN
  WS --> DB
```

Stack: GStreamer · YOLOv8m · Qwen2.5-VL 7B · FastAPI · Next.js · SQLite

---

## Phase A — Per-detection structured report

**Luồng**: Detection → Pause → User bấm "Giải thích" → LLM phân tích ảnh → 3-section report

```mermaid
sequenceDiagram
  Worker->>FE: DETECTION_FOUND (bbox + frame_b64)
  FE->>User: Pause + hiện 5 nút action
  User->>BE: ACTION_EXPLAIN
  BE->>Ollama: image + prompt (json_schema)
  Note over Ollama: ~4-5s
  Ollama->>BE: LesionReport JSON
  BE->>DB: INSERT lesion_reports
  BE->>FE: LESION_REPORT_DONE
  FE->>User: Render <LesionReportCard>
```

**Output schema** (3 sections):
- `technique` — phương pháp, thiết bị, thời điểm
- `description` — Paris class, size, surface, color, margin, vascular, fluid
- `conclusion` — primary_dx, severity (thấp/trung bình/cao), differential, recommendations, ai_confidence

---

## Phase A — Sample structured report

```json
{
  "technique": {
    "method": "Nội soi dạ dày-tá tràng AI-assisted",
    "device": "Olympus EG-760Z",
    "timestamp": "15 giây — frame #214"
  },
  "description": {
    "size_mm": "5-7 mm",
    "paris_class": "0-IIa+IIc",
    "surface": "gồ ghề, có fibrin",
    "color": "đỏ-trắng không đều",
    "margin": "không rõ", "vascular": "bị fibrin che", "fluid": "không thấy"
  },
  "conclusion": {
    "primary_dx": "Loét bờ fibrin (fibrin-margin ulcer)",
    "severity": "cao", "ai_confidence": 80,
    "differential": [
      {"dx": "Loét bờ fibrin", "probability_pct": 80},
      {"dx": "Adenocarcinoma dạ dày sớm", "probability_pct": 60}
    ],
    "recommendations": ["Sinh thiết bờ tổn thương", "Hội chẩn chuyên khoa"]
  }
}
```

**Verified**: 20+ reports thật · schema validation 100% pass · latency 4.3-4.6s

---

## Phase D — 5 doctor actions

```mermaid
stateDiagram-v2
  [*] --> PAUSED_AT_DETECTION
  PAUSED_AT_DETECTION --> EXPLAINING: Giải thích
  PAUSED_AT_DETECTION --> CONFIRMED: Xác nhận luôn
  PAUSED_AT_DETECTION --> RECHECKING: Kiểm tra lại
  PAUSED_AT_DETECTION --> FP_PERSISTED: Báo sai
  PAUSED_AT_DETECTION --> IGNORED: Bỏ qua

  EXPLAINING --> SHOW_REPORT: LLM xong
  RECHECKING --> NEW_DETECTION: YOLO @ conf 0.4
  FP_PERSISTED --> [*]: + SQLite false_positives
  CONFIRMED --> [*]: skip LLM
  IGNORED --> [*]: 1 lần
```

| Action | Persist DB? | Latency |
|---|---|---|
| Giải thích | ✅ lesion_reports | ~5s |
| Xác nhận luôn | — | tức thì |
| Kiểm tra lại | — | ~2s YOLO re-run |
| **Báo sai** | ✅ **false_positives** (cross-session auto-skip IoU>0.6) | tức thì |
| Bỏ qua | — | tức thì |

---

## Phase B — Session summary + Q&A chatbot

**Luồng tổng hợp tự động khi video kết thúc**:

```mermaid
sequenceDiagram
  Worker->>BE: VIDEO_FINISHED
  BE->>DB: SELECT * FROM lesion_reports
  BE->>FE: VIDEO_FINISHED → mở EOS modal
  Note over BE: Background task fired
  BE->>Ollama: gộp reports → SESSION_SUMMARY_SCHEMA
  Note over Ollama: ~13-15s
  Ollama->>BE: structured summary
  BE->>DB: INSERT session_summaries
  BE->>FE: SESSION_SUMMARY_DONE
  FE->>User: 3 tabs (Tổng quan / Chi tiết / Hỏi AI)
```

**Summary có 5 phần**: overview · priority_findings (top-5) · patterns · checklist (4 categories) · overall_risk

---

## Phase B — Q&A architecture

```mermaid
flowchart TB
  User[Bác sĩ gõ câu hỏi]
  User --> Decision{WS connected?}
  Decision -- Yes workspace --> WS[ACTION_SESSION_QA]
  Decision -- No /report --> HTTP[POST /session/id/qa]

  WS --> Stream[Streaming chunks]
  HTTP --> Blocking[Blocking response]

  Stream --> FilterIn{Câu hỏi y tế?}
  Blocking --> FilterIn

  FilterIn -- Yes --> Build[Build context]
  FilterIn -- No --> Refuse[Refuse template VN]

  Build --> Ctx[Summary + 5 findings + visual fields + history]
  Ctx --> LLM[Ollama qwen2.5vl:7b<br/>num_ctx 6144]
  LLM --> Save[DB qa_messages]
  Save --> User
  Refuse --> User
```

**Scope filter**: 5 case test ✅ (in-scope · off-topic · jailbreak)
**Reconnect**: WS đóng + mở lại → BE replay summary + qa history

---

## Phase C — Robustness layer

**C1 — Error handling**:

```mermaid
flowchart LR
  LLM[LLM call] --> Wait{wait_for 90s}
  Wait -- timeout --> Cls[_classify_llm_error]
  Wait -- exception --> Cls
  Cls --> Code5{5 codes}
  Code5 --> UI[FE route theo context]
  UI -- session_qa --> Bubble[Red bubble in chat]
  UI -- lesion_report --> Inline[Markdown retry CTA]
  UI -- session_summary --> Banner[Red banner top]
```

5 error codes: `LLM_TIMEOUT` · `LLM_UNAVAILABLE` · `LLM_CRASHED` · `LLM_BAD_JSON` · `LLM_ERROR`

**C2 — Loading skeletons**: lesion report card (hero + 3 sections) · session summary panel (badge + counts + 3 priorities) — shimmer animation thay vì spinner đơn

---

## Metrics & test results

| Metric | Phase A | Phase B summary | Phase B Q&A | Phase D FP |
|---|---|---|---|---|
| Latency P50 | 4.5s | 13.6s | 2.7s | tức thì |
| Latency P90 | 4.8s | 18s | 5s | — |
| Verified runs | 20+ | 4 | 6+ | 3 |
| Schema pass | 100% | 100% | N/A | — |

**Prompt verification** (post-tune):
- Method/timestamp đúng format VN: **100%**
- Recommendations no leak: **100%**
- Primary↔differential consistent: **100%** (backend post-process)
- Bilingual VN+EN: **66%** — chấp nhận với 7B model
- Scope filter (in-scope/off-topic/jailbreak): **5/5 pass**

**Tài nguyên**: RTX 4080 SUPER 16GB · VRAM 14GB / 16GB · Disk 600GB free

---

## Lộ trình còn lại

```mermaid
gantt
  title Roadmap còn lại
  dateFormat YYYY-MM-DD
  section Done
  Phase A (lesion report)      :done, 2026-05-09, 4d
  Phase D (5 actions)          :done, 2026-05-11, 1d
  Phase B (summary + Q&A)      :done, 2026-05-12, 2d
  Phase C1 + C2 (robustness)   :done, 2026-05-14, 1d
  section To do
  C4 — PDF export              :active, 2026-05-15, 1d
  C5 — /health/ollama          :2026-05-16, 1d
  Spec 005 — popup redesign    :2026-05-17, 2d
  E2E test + demo prep         :2026-05-19, 2d
```

**Open PRs**: #22 spec popup · #23 Phase D · #24 Phase B+C — chờ merge

**Risks**: bilingual 66% (giới hạn 7B) · cần dataset thật để verify diff models

---

## Demo flow cho hôm thuyết trình

1. Upload video nội soi → AI detect realtime
2. Pause at detection → bấm 5 nút (Giải thích / Xác nhận luôn / Kiểm tra lại / Báo sai / Bỏ qua)
3. "Giải thích" → Card 3 section hiện ra (skeleton trong khi chờ)
4. Tiếp tục video → 2-3 detection
5. Video kết thúc → modal danh sách detection
6. Vào /report → click session → tab "Tổng hợp AI"
7. Đọc Overview / Chi tiết → bấm "Hỏi AI"
8. Hỏi: *"Tổn thương nguy hiểm nhất?"* → AI trả lời streaming
9. Hỏi off-topic: *"Thời tiết hôm nay?"* → AI refuse
10. (Sau C4) Bấm "Xuất PDF" → tải báo cáo đầy đủ

**Cảm ơn — câu hỏi?**
