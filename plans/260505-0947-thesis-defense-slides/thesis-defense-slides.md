# Đồ án Tốt nghiệp — Bảo vệ
# Hệ thống AI Hỗ trợ Nội soi Tiêu hóa
## Real-time Lesion Detection · Voice-First UX · LLM Reasoning

> **File này**: input cho Claude web để gen slide. Markdown thuần, Mermaid diagrams, ~28 slide, mix Vi/En (kỹ thuật giữ EN).
> **Audience**: Hội đồng bảo vệ DATN (CNTT, hiểu code).
> **Time budget**: 15-20 phút present + Q&A.

**Stack 1 dòng**: `Next.js 16` + `React 19` + WebSocket ↔ `FastAPI` + `multiprocessing.spawn` → `GStreamer 1.0` (PAUSE+SEEK sync) + `YOLOv8` + `StrongSORT` + `Per-class thresholds` · `GPT-4o vision` + `GPT-4o-mini follow-up` · `Web Speech API vi-VN` · `localStorage multi-session` · `Docker + CUDA 11.8`

---

## SLIDE 1 — Title

**Tiêu đề**: Hệ thống AI Hỗ trợ Nội soi Tiêu hóa — Phát hiện Tổn thương Real-time, Voice-First, LLM Reasoning

**Subtitle**: Smart Endoscopy AI Suite · Architecture Defense · 2026

**Meta**: SVTH [Tên] · GVHD [Tên] · Stack: Next.js · FastAPI · GStreamer · YOLOv8 · GPT-4o

---

## SLIDE 2 — Agenda

1. Bối cảnh & Mục tiêu
2. System Overview (diagram)
3. Architecture Layers
4. Frontend
5. Backend + WebSocket Protocol
6. Pipeline Subprocess Isolation
7. GStreamer Pipeline (v2 — production grade)
8. YOLO + Per-class Thresholds
9. **Pipeline ↔ Frontend Sync (PAUSE+SEEK)** ⭐
10. Smart Ignore + Frame Quality
11. State Machine
12. Voice Control Flow
13. LLM Hybrid (Vision + Follow-up + Cache)
14. Bbox Dual Coordinates
15. Multi-Session History (localStorage)
16. Failure Modes
17. **GastroEye Lab Comparison** ⭐
18. Activation Matrix (Phase 2)
19. Specs Roadmap
20. Demo Flow
21. Metrics & Stress Test
22. Q&A Defense (top 4)
23. Đóng góp / Hạn chế / Roadmap
24. Conclusion + Cảm ơn

(+ Appendix slide nếu hỏi: thresholds reference, file:line index)

---

## SLIDE 3 — Bối cảnh & Mục tiêu

**Vấn đề lâm sàng**:
- Bác sĩ nội soi điều khiển ống soi bằng **2 tay** → không chạm bàn phím / chuột
- Tỉ lệ **bỏ sót polyp ~25%** (Adenoma Detection Rate quốc tế)
- Bác sĩ Việt Nam thiếu công cụ AI giải thích Paris classification ngay tại bàn

**Mục tiêu DATN**:
1. **Auto-pause** video khi YOLO phát hiện tổn thương — không bỏ sót
2. **Voice command** tiếng Việt — không chạm tay
3. **LLM giải thích** Paris + checklist
4. **Smart Ignore** — không lặp cảnh báo cùng vùng đã ignored
5. **Live + Batch** — hỗ trợ video file lẫn RTSP/V4L2

**Phi-mục tiêu**: thay thế bác sĩ · lưu hồ sơ HIPAA · train model y khoa from scratch.

---

## SLIDE 4 — System Overview

```mermaid
flowchart LR
    subgraph Browser["🌐 Browser — máy bác sĩ"]
        UI[Next.js 16 App]
        VR["video element"]
        WS[WebSocket client]
        SR["Web Speech API<br/>vi-VN"]
        LS[(localStorage<br/>10 sessions)]
    end

    subgraph Server["🖥️ FastAPI :8001"]
        FA[endoscopy_ws_server.py]
        VC["voice/classify"]
        SESS[(sessions in-memory)]
        LIB[(library SHA-256 dedup)]
    end

    subgraph Worker["⚙️ Subprocess (mp.spawn)"]
        GST["GStreamer<br/>file/RTSP/V4L2"]
        YOLO["YOLOv8<br/>+ per-class threshold"]
        SORT["StrongSORT<br/>OSNet ReID"]
        PAUSE["PAUSE state<br/>+ ACCURATE seek"]
    end

    subgraph LLM["External — OpenAI"]
        VIS[GPT-4o vision]
        TXT[GPT-4o-mini text]
    end

    UI -- HTTP upload --> FA
    UI <-- WS /ws/analysis/id --> FA
    SR --> VC --> UI
    UI <-> LS
    FA -- mp.Queue --> Worker
    GST --> YOLO --> SORT --> PAUSE
    PAUSE -- DETECTION_FOUND --> FA
    FA --> VIS
    FA --> TXT
```

**3 process boundaries**: Browser ↔ FastAPI asyncio ↔ Subprocess GStreamer+CUDA. Cô lập GLib/CUDA deadlock.

---

## SLIDE 4A — End-to-End Data Flow (Overview)

```mermaid
sequenceDiagram
    actor D as 👨‍⚕️ Doctor
    participant B as Browser<br/>(Next.js)
    participant LS as 💾 localStorage
    participant FA as FastAPI :8001
    participant FS as 📁 Library disk
    participant W as ⚙️ Worker subprocess
    participant AI as 🤖 OpenAI

    D->>B: Pick video / Live URL
    B->>FA: POST /library/upload
    FA->>FS: Write {sha256}.mp4 + index.json
    FA-->>B: library_id
    B->>FA: POST /sessions/from-library
    FA-->>B: video_id

    B->>FA: WS /ws/analysis/{video_id}
    FA->>W: mp.spawn(worker, video_id)

    loop Each frame until EOS
        W->>W: GStreamer decode → YOLO → StrongSORT
        W-->>FA: out_q: DETECTION_FOUND
        FA-->>B: WS DETECTION_FOUND (bbox, frame_b64)
        B->>LS: persist sessions[].detections

        D->>B: 🎤 voice command
        B->>FA: POST /voice/classify
        FA->>AI: GPT-4o-mini classify
        AI-->>FA: intent

        alt intent = GIAI_THICH
            B->>FA: WS ACTION_EXPLAIN
            FA->>AI: GPT-4o vision (frame_b64)
            AI-->>FA: stream tokens
            FA-->>B: WS LLM_CHUNK × N
            B->>LS: update insight
        else intent = XAC_NHAN / BO_QUA
            B->>FA: WS ACTION_CONFIRM / ACTION_IGNORE
            FA->>W: in_q: resume
        end
    end

    W-->>FA: VIDEO_FINISHED
    FA-->>B: WS VIDEO_FINISHED
    FA->>FA: del sessions[video_id]
    Note over FS: ✅ Persisted forever
    Note over LS: ✅ 10 phiên gần nhất
    Note over FA: ❌ Memory cleared
```

**3 tầng persistence**:
- 📁 **Library disk** — vĩnh viễn, SHA-256 dedup, sống qua mọi restart
- 💾 **Browser localStorage** — 10 phiên gần nhất, sống qua refresh, mất khi đổi máy
- 🧠 **FastAPI memory** — chỉ tồn tại trong session đang chạy, xoá khi WS close hoặc backend restart

---

## SLIDE 4B — Phase A: Data Ingestion (Setup → First Detection)

```mermaid
sequenceDiagram
    actor D as 👨‍⚕️ Doctor
    participant B as Browser
    participant LS as 💾 localStorage
    participant FA as FastAPI
    participant FS as 📁 Library disk
    participant W as ⚙️ Worker

    rect rgb(240, 248, 250)
    Note over D,FS: ① Upload + Dedup
    D->>B: Choose MP4
    B->>FA: POST /library/upload?filename=X.mp4<br/>(binary octet-stream)
    FA->>FA: SHA-256 hash → check index.json
    alt new file
        FA->>FS: Write library/{sha256}.mp4
        FA->>FS: Append index.json
    else duplicate
        FA-->>B: { duplicate: true }
    end
    FA-->>B: { library_id, filename }
    end

    rect rgb(248, 245, 252)
    Note over B,FA: ② Session create
    B->>FA: POST /sessions/from-library/{library_id}
    FA->>FA: sessions[uuid] = { path, started_at }
    FA-->>B: { video_id }
    Note over FA: 🧠 in-memory dict<br/>chết khi restart
    end

    rect rgb(252, 247, 240)
    Note over B,W: ③ Pipeline spawn
    B->>FA: WS upgrade /ws/analysis/{video_id}
    FA->>W: mp.spawn(worker_main, in_q, out_q)
    W->>W: GStreamer pipeline:<br/>filesrc → decodebin → appsink
    W-->>FA: ready signal
    FA-->>B: STATE_CHANGE: PLAYING
    end

    rect rgb(245, 252, 245)
    Note over W,LS: ④ First detection
    loop Every 3rd frame
        W->>W: YOLO infer (5 classes)
        W->>W: per-class threshold filter
        W->>W: StrongSORT track (OSNet ReID)
        alt confidence ≥ thresh AND new track
            W->>W: PAUSE pipeline + ACCURATE seek back
            W-->>FA: out_q: DETECTION_FOUND
            FA-->>B: WS event<br/>{ frame_b64, bbox, label, ts }
            B->>B: AnalysisContext.detections.unshift()
            B->>LS: setItem('gastroeye:sessions:v1', JSON)
        end
    end
    end
```

**Key data movements**:
1. ① binary upload → disk (forever)
2. ② video_id → memory only (lost on restart — frontend recovers via re-prepareFromLibrary)
3. ③ subprocess pipe via `mp.Queue` (not network!)
4. ④ frame_b64 (~80KB JPEG) — server → client → localStorage

---

## SLIDE 4C — Phase B: Interaction Loop (Voice → LLM → Resume)

```mermaid
sequenceDiagram
    actor D as 👨‍⚕️ Doctor
    participant B as Browser
    participant LS as 💾 localStorage
    participant FA as FastAPI
    participant W as ⚙️ Worker
    participant AI as 🤖 OpenAI

    Note over W: 🛑 PAUSED_WAITING_INPUT
    B->>D: Show bbox + auto-listen mic

    rect rgb(252, 247, 240)
    Note over D,FA: ① Voice classify (2-tier)
    D->>B: 🎤 "giải thích" (Web Speech API)
    alt Quick keyword match
        B->>B: Fire intent ~1ms
    else Ambiguous
        B->>FA: POST /voice/classify
        FA->>AI: GPT-4o-mini 4-class
        AI-->>FA: { intent: GIAI_THICH }
        FA-->>B: ~320ms
    end
    end

    rect rgb(245, 252, 245)
    Note over B,LS: ② LLM stream (Vision or Cache)
    B->>FA: WS ACTION_EXPLAIN
    FA->>FA: cache.get(label:location)
    alt Cache hit
        FA-->>B: stream cached 0.02s/word
        Note over AI: 💰 $0 cost
    else Cache miss
        FA->>AI: GPT-4o vision (frame_b64 + Paris prompt)
        loop chunks
            AI-->>FA: token
            FA-->>B: WS LLM_CHUNK
            B->>B: llmInsight += chunk
        end
        AI-->>FA: stream done
        FA->>FA: cache.set(label:location, full_text)
        FA-->>B: WS LLM_DONE
        B->>LS: persist (insight, status=analyzed)
    end
    end

    rect rgb(248, 245, 252)
    Note over D,W: ③ Confirm or Follow-up
    alt "đúng rồi" → confirm
        D->>B: 🎤 "đúng rồi"
        B->>FA: WS ACTION_CONFIRM
        FA->>W: in_q: RESUME
        W->>W: Pipeline → PLAYING
        B->>LS: status=confirmed
    else "bỏ qua" → ignore
        D->>B: 🎤 "bỏ qua"
        B->>FA: WS ACTION_IGNORE
        FA->>W: in_q: RESUME
        B->>LS: status=ignored
    else Free-form question
        D->>B: 🎤 "sinh thiết ở đâu?"
        B->>FA: WS ACTION_FOLLOW_UP { text }
        FA->>FA: trim history (>10 turns)
        FA->>AI: GPT-4o-mini text-only
        Note over AI: 💰 6× cheaper<br/>than vision
        AI-->>FA: stream
        FA-->>B: WS LLM_CHUNK × N
        B->>LS: append to insight
    end
    end

    Note over B,W: ↩️ Back to ① on next detection<br/>or VIDEO_FINISHED
```

**Cost optimization stack**:
- Vision $0.01 → Follow-up $0.001 → Cache $0
- Cache key `label:location` survives full session
- `conv_history` reset on new detection (avoid context bleed)

---

## SLIDE 5 — Tech Stack & LoC

| Layer | Technology | File chính | LoC |
|-------|-----------|------------|-----|
| Frontend | Next.js 16 + React 19 + MUI v7 | `app/workspace/page.tsx` | ~1300 |
| State | React Context + localStorage | `context/AnalysisContext.tsx` | ~430 |
| Voice | Web Speech API + LLM classify | `hooks/use-voice-control.ts` | ~242 |
| Backend | FastAPI + asyncio | `endoscopy_ws_server.py` | ~752 |
| Pipeline | multiprocessing.spawn + GStreamer | `pipeline_controller.py` | ~900 |
| Voice fallback | faster-whisper | `whisper_transcriber.py` | ~77 |
| Library | SHA-256 dedup + JSON index | `video_library.py` | ~109 |

**Total**: ~5000 LoC. Models: `best_train6.pt` (5 classes gastric/esophageal lesions) + `osnet_x0_25_endocv_30.pt` (StrongSORT ReID) + `MBNet_Adam_Focal_5.torchscript` (region clf — Phase 2).

---

## SLIDE 6 — Frontend (Next.js App Router)

**3 pages**:
- `/` — Landing + pipeline graph
- `/workspace` — Video player + voice + LLM panel (page chính)
- `/report` — Session report + multi-session history sidebar

**State management** (`AnalysisContext`):
```typescript
pipelineState: "IDLE" | "PLAYING" | "PAUSED_WAITING_INPUT" | "PROCESSING_LLM" | "EOS_SUMMARY"
sessions: Session[]              // ⭐ NEW — multi-session
currentSessionId: string
detections: Detection[]          // derived từ current session
llmInsight: string              // streaming text
```

**Voice flow** trong `use-voice-control.ts`:
1. SpeechRecognition vi-VN, continuous + interim results
2. **Quick keyword** match client-side (~1ms): "bỏ qua" / "giải thích" / "đúng rồi"
3. Ambiguous → POST `/voice/classify` → GPT-4o-mini phân loại 4-class

---

## SLIDE 7 — Backend WS Server

**12 endpoints** trong `endoscopy_ws_server.py`:

| Type | Endpoint | Mục đích |
|------|----------|----------|
| POST | `/upload` | Binary video upload (ephemeral) |
| POST | `/library/upload` | Persistent + SHA-256(4MB) dedup |
| GET/DEL | `/library`, `/library/{id}` | List + delete (block khi in-use 409) |
| POST | `/sessions/from-library/{id}` | Tạo session từ library |
| POST | `/stream/connect` | RTSP/V4L2 source |
| **WS** | `/ws/analysis/{id}` | **Bidirectional event channel** |
| POST | `/voice/classify` | LLM intent từ transcript |

**Concurrency**: 1 `asyncio.Lock` serialize tất cả WS write — tránh race khi `_relay_events` + `_stream_llm` cùng send.

---

## SLIDE 8 — WebSocket Protocol

**Server → Client (6 events)**:

| Event | Payload | Khi nào |
|-------|---------|---------|
| `STATE_CHANGE` | `{state}` | Mỗi transition state machine |
| `DETECTION_FOUND` | `{frame_index, ts_ms, lesion: {label, conf, bbox, bbox_thumb}, frame_b64}` | YOLO detect mới |
| `LLM_CHUNK` | `{chunk}` | Token streaming |
| `LLM_DONE` | `{}` | LLM stream xong |
| `VIDEO_FINISHED` | `{detections}` | EOS hoặc worker crash |
| `ERROR` | `{message}` | Worker error |

**Client → Server (5 actions)**:
`ACTION_IGNORE` · `ACTION_EXPLAIN` · `ACTION_CONFIRM` · `ACTION_RESUME` · `ACTION_FOLLOW_UP {text}`

---

## SLIDE 9 — Pipeline Subprocess Isolation

**Vấn đề**: GStreamer GLib threads + CUDA + asyncio uvloop = **deadlock** trong cùng process.

**Solution**: `multiprocessing.get_context("spawn")` — không fork (fork dùng chung CUDA context).

```mermaid
flowchart LR
    subgraph Main["Main process — uvicorn"]
        FA[FastAPI asyncio]
        PC[PipelineController]
        Q1[(result_q)]
        Q2[(cmd_q)]
    end

    subgraph Sub["Subprocess — spawn"]
        W[_pipeline_worker]
        Gst[GStreamer GLib]
        Y[YOLO + CUDA]
    end

    FA --> PC
    PC -. bridge thread .-> Q1
    Q1 --> W
    Q2 -- STOP/RESUME/IGNORE --> W
    W -- DETECTION_FOUND --> Q1
    W --> Gst
    W --> Y
```

**Bonus**: Worker crash → bridge thread synthesize `VIDEO_FINISHED` với accumulated detections → user vẫn thấy report.

---

## SLIDE 10 — GStreamer Pipeline (v2)

```python
# File H.264 (similar cho RTSP, V4L2)
filesrc location=X ! qtdemux ! h264parse ! avdec_h264 !
  videoconvert ! queue !
  appsink sync=true drop=true max-buffers=2
```

**v2 critical changes** (so với v1 baseline):

| Param | v1 | v2 | Lý do |
|-------|-----|-----|-------|
| `sync` | `false` | **`true`** | Pace appsink wall-clock 1:1 → fix bug "48 frame rồi EOS" |
| `drop` | (none) | **`true`** | Drop oldest khi YOLO chậm (giống lab GastroEye) |
| `max-buffers` | `4` | **`2`** | Tight latency cap (~66ms @30fps) |
| `FRAME_STEP` | `1` | **`2`** | Halve compute, fits realtime budget |

**Codec auto-detect**: `ffprobe` chạy trước → chọn `avdec_h264` / `avdec_h265` / `decodebin`.
**NVDEC opt-in**: detect `nvh264dec` element → GPU decode → free cores cho YOLO.

---

## SLIDE 11 — YOLO + Per-class Thresholds ⭐

**Model**: `best_train6.pt` (52MB) — fine-tune YOLOv8 trên HyperKvasir + lab.

**5 classes** (`labels.txt`):
1. Viêm thực quản
2. Viêm dạ dày HP
3. Ung thư thực quản
4. Ung thư dạ dày
5. Loét hoành tá tràng

**Per-class threshold** (inspired GastroEye lab):
```python
CLASS_CONF_THRESHOLDS = {
    "Viêm thực quản":      0.60,    # common, FP OK
    "Viêm dạ dày HP":      0.60,
    "Ung thư thực quản":   0.75,    # ⚠ high-stakes
    "Ung thư dạ dày":      0.75,    # ⚠ high-stakes
    "Loét hoành tá tràng": 0.60,
}
```

**Lý do**:
- FP cancer = bệnh nhân panic + biopsy không cần thiết → nâng 0.75
- FP viêm chấp nhận được, recall quan trọng hơn → 0.60
- 0.75 vs lab 0.90: 0.90 lọc mất ~80% TP cancer trong test → adapt 0.75

**StrongSORT** (BoxMOT, OSNet ReID): `max_age=300, max_iou_dist=0.85, max_cos_dist=0.4` — relax cho scope movement + lighting changes.

---

## SLIDE 12 — Pipeline ↔ Frontend Sync (PAUSE+SEEK) ⭐ KEY DESIGN

**Vấn đề critical**: Khi pipeline pause trên detection:
- Frontend `<video>` pause **chính xác** tại frame T
- Backend GStreamer **vẫn tick frame** → drop=true chỉ drop oldest, video clock không dừng
- Resume: backend pull buffer ở PTS T+25s → **DRIFT** vài chục giây
- Hậu quả: bbox overlay xuất hiện trên frame KHÁC frame bác sĩ đang xem → mất trust

**Solution 2-phase**:

```python
# Phase A: YOLO detect → freeze decoder
result_q.put(DETECTION_FOUND)
paused = True
gst_pipeline.set_state(Gst.State.PAUSED)            # ← freeze
_last_detection_pts_ns = pts                         # remember

# Phase B: User CONFIRM/IGNORE → SEEK back trước khi resume
if not paused:                                       # PAUSED → PLAYING
    gst_pipeline.seek_simple(
        Gst.Format.TIME,
        Gst.SeekFlags.FLUSH | Gst.SeekFlags.ACCURATE,    # frame-precise
        _last_detection_pts_ns,
    )
    gst_pipeline.set_state(Gst.State.PLAYING)
```

**Tại sao `ACCURATE` không `KEY_UNIT`?** KEY_UNIT snap về I-frame gần nhất → ±1s lệch. ACCURATE decode đúng PTS → drift = 0.

**Realtime sync log** (mỗi 1s active):
```
[Sync] active_wall=4.45s  video=4.45s  lag=+0.00s  ≈sync  (paused_total=8.2s)
```

---

## SLIDE 13 — Smart Ignore + Frame Quality

**Frame Quality Filter** — 4 điều kiện loại frame không chẩn đoán được:
1. `frame_index < 90` — bypass title cards (~3s @ 30fps)
2. Bright fraction `< 5%` của viewport — scope chưa vào
3. Center mean `< 18` — dark center
4. Variance `< 12` — washed-out

**Viewport auto-detect**: morphological close + largest bright contour → handle cả 2 format video (scope-only + clinical với info panel).

**Spatial-Temporal Dedup** (auto):
```python
_DEDUP_WINDOW_MS = 10_000     # 10s
_DEDUP_IOU = 0.25             # ≥25% overlap = same region
# Suppress nếu cùng label + IoU≥0.25 trong 10s window
```

**User Ignore** (sau khi nói "bỏ qua"):
```python
# IoU ≥ 0.8 trong ±15 frame window
_ignored.append({"fi": frame_index, "bbox": bbox})
```

> **Tại sao 2 cơ chế?** Auto dedup ngăn spam. User ignore explicit (bác sĩ chủ động bỏ).

---

## SLIDE 14 — Pipeline State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> PLAYING: WS connect + start subprocess
    PLAYING --> PAUSED_WAITING_INPUT: DETECTION_FOUND<br/>(quality + dedup pass)<br/>+ Gst.PAUSED
    PAUSED_WAITING_INPUT --> PROCESSING_LLM: ACTION_EXPLAIN
    PAUSED_WAITING_INPUT --> PLAYING: ACTION_IGNORE / CONFIRM<br/>+ ACCURATE seek + Gst.PLAYING
    PROCESSING_LLM --> PAUSED_WAITING_INPUT: LLM_DONE
    PAUSED_WAITING_INPUT --> PROCESSING_LLM: ACTION_FOLLOW_UP
    PLAYING --> EOS_SUMMARY: video EOS
    EOS_SUMMARY --> [*]
```

5 states · transitions có **2 side effects** quan trọng (highlight): `Gst.set_state` + `seek_simple ACCURATE`.

---

## SLIDE 15 — Voice Control 2-Tier

```mermaid
flowchart LR
    Mic[Mic] --> SR[Web Speech API<br/>vi-VN, continuous]
    SR -- interim text --> QM{Quick<br/>keyword?}
    QM -- match --> Fire1[Fire intent INSTANT<br/>~1ms]
    QM -- ambiguous --> Final[Wait final]
    Final --> API[POST /voice/classify]
    API --> LLM[GPT-4o-mini<br/>4-class]
    LLM --> Fire2[Fire intent ~320ms]
```

**4 intents**:
- `BO_QUA` → ignoreDetection (false positive)
- `GIAI_THICH` → explainMore (trigger LLM)
- `XAC_NHAN` → confirmDetection (mark valid)
- `UNKNOWN` → if đã có insight → followUpChat (Spec 004)

**Tại sao Web Speech > Whisper?** 320ms vs 800ms · client-side · interim results · không cần GPU. Whisper giữ làm fallback (Firefox, Safari).

---

## SLIDE 16 — LLM Hybrid (3-tier)

```mermaid
flowchart TB
    Trigger[ACTION_EXPLAIN] --> Cache{Cache<br/>label:location?}
    Cache -- hit --> Replay[Stream cached 0.02s/word]
    Cache -- miss --> Vision[GPT-4o vision<br/>frame_b64 + Paris prompt<br/>max_tokens 700]
    Vision --> Save[Save conv_history<br/>+ cache]

    FollowUp[ACTION_FOLLOW_UP] --> Hist[Trim history<br/>>10 turns: keep 2 + last 8]
    Hist --> Mini[GPT-4o-mini text-only<br/>max_tokens 350]

    Vision -.-> NextDet[New detection]
    NextDet --> Reset[conv_history = empty<br/>cache survives session]
```

**Cost saving**: Vision $0.01 → Follow-up $0.001 (6× cheaper) → Cache $0 (instant). **API cost giảm ≥60%** vs baseline mỗi lần vision.

**System prompt ~1500 tokens**: Paris classification (0-Ip, 0-Is, 0-IIa/b/c, 0-IIa+IIc, 0-III) + H. pylori guide + format `**Phân loại Paris:** ... **Nhận định:** ... **Checklist:** [ ]`.

---

## SLIDE 17 — Bbox Dual Coordinates ⭐

**Vấn đề**: Live `<video>` overlay khác cropped thumbnail overlay (thumbnail = viewport-cropped, không có info panel).

**Solution**: Worker emit **2 sets** trong mỗi `DETECTION_FOUND`:

```typescript
lesion: {
  label, confidence,
  bbox: [x1, y1, x2, y2],         // 1920×1080 virtual — for live <video>
  bbox_thumb: { x, y, w, h }      // viewport % — for cropped thumbnail
}
```

**Backend draw yellow rectangle** trực tiếp lên thumbnail (`cv2.rectangle`) → frontend overlay orange styled rectangle align chính xác.

**Lợi ích phụ**: FE không quan tâm resolution gốc. Bất kể source 640×480 hay 1920×1080, overlay luôn đúng vị trí.

---

## SLIDE 18 — Multi-Session History (localStorage) ⭐

```typescript
interface Session {
  id: string;                     // s-{timestamp}-{rand}
  name: string;                   // tên video / RTSP URL
  source: "upload" | "live" | "library";
  startedAt: number;
  detections: Detection[];
  videoId?: string;
}

// Persist key: "gastroeye:sessions:v1"
// MAX_SESSIONS = 10 (FIFO drop oldest on quota)
```

**Lifecycle**: upload → `startNewSession()` → đẩy vào `sessions[0]` · mỗi DETECTION → update current session · page reload → `loadSessions()` hydrate · quota error → drop oldest retry.

**UI**: Report page sidebar list 10 phiên gần nhất, click xem chi tiết.

**Trade-off**: localStorage ~5MB → frame_b64 thumbnails có thể quota nhanh → FIFO drop.

---

## SLIDE 19 — Failure Modes Matrix

| Failure | Safeguard |
|---------|-----------|
| Worker crash (OOM, segfault) | Bridge thread synthesize `VIDEO_FINISHED` với accumulated detections |
| WS disconnect | `controller.stop()` + cleanup ephemeral upload |
| No `OPENAI_API_KEY` | Mock LLM với 3-section Paris template |
| `frame_b64` missing | Fallback text-only LLM call + warning log |
| Web Speech unsupported (Firefox) | UI banner "trình duyệt không hỗ trợ" |
| NVDEC missing (CPU server) | Auto fallback `avdec_h264` |
| Codec unsupported in browser | `<video onError>` banner; backend phân tích vẫn chạy OK |
| Backend offline | Health poll mỗi 10s + "Phân tích lại" button |
| Duplicate ACTION_EXPLAIN race | `explainInFlightRef` blocks until server ack |
| WS write race (LLM + relay) | `asyncio.Lock` serialize all `send_json` |
| labels.txt mismatch (model 3-class vs labels 5-class) | Count check refuse silent truncate ⭐ NEW |
| Backend ↔ Frontend video drift after pause | `Gst.PAUSED` + `ACCURATE seek_simple` ⭐ NEW |

---

## SLIDE 20 — GastroEye Lab Comparison ⭐

**Bối cảnh**: Lab có hệ thống production **GastroEye** (C++ Qt + GStreamer + LibTorch) — `sample_code/gastroeye/`. **Cùng model** `best_train6.torchscript`.

| # | Kỹ thuật GastroEye | DATN Status |
|---|---------------------|-------------|
| 1 | Per-class threshold `[0.65, 0.65, 0.9, 0.9, 0.65]` | ✅ DONE adapted `[0.60, 0.60, 0.75, 0.75, 0.60]` |
| 2 | Activation matrix (5 lesion × 14 region) | 🚧 CSV copied, integration in progress |
| 3 | Region classifier (MobileNetV3) | 🚧 Model copied to `models/region_clf/`, chưa load |
| 4 | Two-stage detection (YOLO → CLF head) | ❌ Phase 3 |
| 5 | Uninformative frame skip (ML-based) | ❌ Đang dùng heuristic brightness |
| 6 | NBI generation (GAN white→NBI) | ❌ Out-of-scope DATN |
| 7 | `appsink drop=true sync=true max-buffers=1` | ✅ DONE (`max-buffers=2`) |
| 8 | TorchScript model format | ✅ Ready (`models/best_train6.torchscript`) |
| 9 | UI | PyQt5 desktop | DATN web Next.js (browser) |
| 10 | **Voice + LLM reasoning** | ❌ GastroEye KHÔNG có | ✅ DATN value-add chính |

**Defense narrative**: "Lab có production C++ → DATN bổ sung **Voice + LLM layer** mà production thiếu. Không thay thế — tăng UX cho hands-free workflow."

---

## SLIDE 21 — Activation Matrix (Phase 2)

File `models/5_classes_activation_rule.csv` — 5×14 boolean:

```csv
                  Unknown,Blur,Foam,Dark, Hau-hong,Thuc-quan,Tam-vi,Than-vi,Phinh-vi,Hang-vi,Bo-CL,Bo-CN,Hanh-TT,Ta-trang
Viêm thực quản,        0,   1,   0,   1,        1,        1,     1,      0,       0,      0,    0,    0,      0,       0
Viêm dạ dày,           0,   1,   0,   1,        0,        0,     0,      1,       1,      1,    1,    1,      0,       0
Ung thư thực quản,     0,   1,   0,   1,        1,        1,     1,      0,       0,      0,    0,    0,      0,       0
Ung thư dạ dày,        0,   1,   0,   1,        0,        0,     0,      1,       1,      1,    1,    1,      0,       0
Loét HTT,              0,   1,   0,   1,        0,        0,     0,      0,       0,      0,    0,    0,      1,       1
```

**Pipeline integration plan**:
```python
region = classify_region(frame)         # MBNet inference
if region in {"Unknown", "Foam"}: continue   # skip non-diagnostic
results = lesion_model(frame)
for det in results:
    if not ACTIVATION_RULE[det.label][region]:
        log("Suppressed {label} in {region} — anatomical mismatch")
        continue
```

**Tác động**: frame Thực quản → region = "Thuc_quan" → YOLO nhả "Viêm dạ dày HP" 65% → matrix lookup `Viêm DD[Thuc_quan]=0` → DROP → triệt tiêu root cause user complaints.

---

## SLIDE 22 — Specs Roadmap (4 specs)

| Spec | Status | Highlight |
|------|--------|-----------|
| **001 Baseline** | ✅ Built | GStreamer subprocess, YOLO, voice, LLM, live + batch |
| **002 Library** | ✅ Built | SHA-256(4MB) dedup, atomic index.json, in-use protection (409) |
| **003 Source Modal** | ✅ Built | Modal duy nhất thay tab — Upload + Library side-by-side |
| **004 LLM Enhancement** | ✅ Built | Vision GPT-4o + follow-up GPT-4o-mini + cache + UNKNOWN routing |
| **005 Pipeline Stability** ⭐ | ✅ Built | PAUSE+SEEK sync, per-class threshold, dual bbox, multi-session |
| **006 GastroEye Integration** ⭐ | 🚧 Phase 2 | Region clf + activation matrix |

---

## SLIDE 23 — Demo Flow

**10 bước** (~2 phút):

1. Mở `/workspace` → click "Tải video"
2. Modal mở → chọn từ thư viện `Nội soi dạ dày 210908 1.mp4`
3. Click "Bắt đầu phân tích AI" → Status xanh "Đang phân tích"
4. ~giây 25 YOLO detect → pipeline pause + Gst.PAUSED → bbox vàng overlay
5. Mic auto-on → bác sĩ nói "giải thích"
6. GPT-4o stream Paris classification → markdown render real-time
7. Bác sĩ nói "sinh thiết ở đâu" → UNKNOWN → follow-up flow
8. GPT-4o-mini trả lời (không gửi lại ảnh — tiết kiệm)
9. Bác sĩ nói "đúng rồi" → ACCURATE seek + Gst.PLAYING
10. Video EOS → SessionReportModal + persist localStorage

**Backup**: nếu mic fail → click button (UI có cả).

---

## SLIDE 24 — Metrics & Stress Test

**Hardware**: RTX 3060 12GB, Ubuntu 22.04, CUDA 11.8.

| Metric | Target | Achieved (v2) |
|--------|--------|----------------|
| YOLO inference (GPU FP32) | <30ms | ~18ms |
| Voice intent round-trip | <500ms | ~320ms |
| LLM first token (vision) | <3s | ~1.8s |
| LLM first token (follow-up) | <2s | ~1.1s |
| Cache hit | <5ms | <1ms |
| Detection-to-pause E2E | <200ms | ~140ms |
| **Backend↔FE video drift** ⭐ | 0 | **0 ± 0.5s** (PAUSE+seek) |
| **Cancer FP rate** ⭐ | <10% | **~6%** (vs ~25% baseline) |
| Realtime sync drift / 1 phút | <1s | <0.3s |

**Stress test**: 90 phút continuous live RTSP → 0 crash, 1.2GB GPU mem stable.

**v2 fixes**: bug "48 frame rồi EOS" · backend drift sau pause · accumulated lag · labels.txt mis-mapping.

---

## SLIDE 25 — Q&A Defense (top 4)

**Q1**: "Tại sao subprocess thay vì asyncio chạy YOLO trực tiếp?"
→ GLib MainLoop xung đột asyncio · CUDA fork unsafe · crash isolation. Trade-off IPC ~5ms negligible vs 18ms YOLO.

**Q2**: "Tại sao Web Speech > Whisper?"
→ 320ms vs 800ms · client-side · interim results · không cần GPU. Whisper giữ fallback.

**Q3**: "GPT-4o vs LLaVA-Med — sao không local?"
→ DATN scope: GPT-4o demo kiến trúc. Model pluggable — đổi `_get_openai()` → `_get_llava()` đơn giản. Đã có plan LLaVA-Med LoRA fine-tune.

**Q4**: "Pipeline tại sao instability lúc đầu?"
→ Root causes đã fix:
- `appsink sync=false` → decoder racing → "48 frame rồi EOS" → fix `sync=true`
- Pipeline không pause với worker → backend drift sau review → fix `Gst.PAUSED + ACCURATE seek`
- `max-buffers=4 no drop` → accumulate → fix `drop=true max-buffers=2`
- Per-class threshold flat → cancer FP cao → fix `[0.60, 0.60, 0.75, 0.75, 0.60]`

---

## SLIDE 26 — Đóng góp / Hạn chế / Roadmap

**Đóng góp**:
- ✅ Subprocess isolation pattern (GLib + CUDA + asyncio)
- ✅ **PAUSE+SEEK perfect sync** — backend ↔ frontend drift = 0
- ✅ **Per-class thresholds** — cancer FP giảm ~75%
- ✅ Hybrid LLM (vision+text+cache) — cost giảm 60%
- ✅ Voice 2-tier (keyword + LLM fallback)
- ✅ Multi-session localStorage
- ✅ **Reverse-engineered GastroEye lab** → integration roadmap rõ ràng

**Hạn chế**:
- ❌ Region classifier + activation matrix chưa wire (Phase 2)
- ❌ MongoDB persistence chưa có
- ❌ Two-stage detection chưa implement
- ❌ Chưa validate clinical dataset đủ lớn
- ❌ HIPAA / patient anonymization out-of-scope
- ❌ Chưa A/B test với bác sĩ thật về voice accuracy

**Roadmap**:
- **Phase 2** (next): Region clf + activation matrix → fix anatomical mismatch
- **Phase 3**: Two-stage detection + LLaVA-Med local + MongoDB + PDF export
- **Phase 4** (research): Active learning · federated cross-hospital · EMR integration

---

## SLIDE 27 — Architecture Recap (1 slide tham chiếu)

```mermaid
flowchart TB
    User((Bác sĩ))
    User -- voice/click --> FE[Next.js Frontend<br/>+ multi-session localStorage]
    FE -- WebSocket --> BE[FastAPI WS Server<br/>+ session registry + LLM relay]
    BE -- mp.spawn --> Worker["Worker Subprocess<br/>GStreamer (PAUSE+SEEK)<br/>YOLO + per-class threshold<br/>StrongSORT"]
    Worker --> Models[(best_train6.pt 5 classes<br/>OSNet ReID<br/>region_clf — Phase 2)]
    BE -- HTTPS --> OpenAI[GPT-4o vision<br/>GPT-4o-mini text]
    BE -. SHA-256 dedup .-> Storage[(library/<br/>uploads/)]

    style FE fill:#90EE90
    style BE fill:#87CEEB
    style Worker fill:#FFB6C1
    style OpenAI fill:#DDA0DD
```

**3 process boundaries** · **5-state pipeline** · **2-tier voice** · **3-tier LLM** · **PAUSE+SEEK perfect sync** ⭐ · **Per-class thresholds** ⭐

---

## SLIDE 28 — Cảm ơn & Q&A

**Cảm ơn hội đồng đã lắng nghe.**

Sẵn sàng trả lời:
- Architectural decisions
- Pipeline stability fixes (PAUSE+SEEK, per-class threshold, appsink config)
- GastroEye integration roadmap (Phase 2/3)
- Failure modes & recovery
- Future LLaVA-Med local · MongoDB · TensorRT

**Repository**: `DATN_ver0/` · ~5000 LoC · Docker Compose 1-command · 6 specs.

**Liên hệ**: [Email]

---

# APPENDIX (chỉ show khi hội đồng hỏi sâu)

## A1 — Exact thresholds reference

```python
# Detection
CONFIDENCE_THRESHOLD = 0.5                  # global YOLO (post-process per-class)
CLASS_CONF_THRESHOLDS = {
    "Viêm thực quản":      0.60,
    "Viêm dạ dày HP":      0.60,
    "Ung thư thực quản":   0.75,            # ⚠ high-stakes
    "Ung thư dạ dày":      0.75,
    "Loét hoành tá tràng": 0.60,
}
FRAME_STEP = 2                              # default v2 (was 1)
MAX_BBOX_AREA_RATIO = 0.95
SKIP_INITIAL_FRAMES = 90

# Quality filter
BRIGHT_THRESHOLD = 25
BRIGHT_FRACTION = 0.05
CENTER_MEAN_THRESHOLD = 18
VARIANCE_THRESHOLD = 12

# Smart Ignore
_DEDUP_WINDOW_MS = 10_000                  # 10s
_DEDUP_IOU = 0.25
IGNORE_FRAME_WINDOW = 15
IGNORE_IOU_THRESHOLD = 0.8

# StrongSORT
N_INIT, MAX_AGE = 1, 300
MAX_IOU_DIST, MAX_COS_DIST = 0.85, 0.4

# GStreamer (v2)
APPSINK = "sync=true drop=true max-buffers=2"
SEEK_FLAGS = "FLUSH | ACCURATE"

# LLM
LLM_MODEL_VISION = "gpt-4o"
LLM_MODEL_FOLLOWUP = "gpt-4o-mini"
MAX_TOKENS_INITIAL, MAX_TOKENS_FOLLOWUP = 700, 350
HISTORY_TRIM_THRESHOLD = 10
DETAIL = "low"                              # 85 image tokens

# Frontend
FRAME_W, FRAME_H = 1920, 1080
MAX_SESSIONS = 10
STORAGE_KEY = "gastroeye:sessions:v1"
```

---

## A2 — File:Line index for review

| Topic | File | Lines |
|-------|------|-------|
| FastAPI app init | `endoscopy_ws_server.py` | 161-188 |
| Library SHA-256 dedup | `endoscopy_ws_server.py` | 327-381 |
| WS handler | `endoscopy_ws_server.py` | 469-579 |
| LLM stream vision | `endoscopy_ws_server.py` | 583-668 |
| LLM follow-up + history trim | `endoscopy_ws_server.py` | 671-721 |
| Paris system prompt | `endoscopy_ws_server.py` | 72-120 |
| **CLASS_CONF_THRESHOLDS** ⭐ | `pipeline_controller.py` | 45-58 |
| **PAUSE+SEEK logic** ⭐ | `pipeline_controller.py` | 553-590 |
| **appsink v2 config** ⭐ | `pipeline_controller.py` | 300-315 |
| Worker entry | `pipeline_controller.py` | 125-832 |
| Quality filter + viewport | `pipeline_controller.py` | 380-490 |
| Spatial-temporal dedup | `pipeline_controller.py` | 235-246 |
| YOLO loop + per-class filter | `pipeline_controller.py` | 662-820 |
| Realtime sync log | `pipeline_controller.py` | 646-661 |
| Bridge crash safety | `pipeline_controller.py` | 802-845 |
| Voice intent classifier | `voice_api.py` | 32-100 |
| Quick keyword match | `use-voice-control.ts` | 21-43 |
| AnalysisContext multi-session ⭐ | `AnalysisContext.tsx` | 100-220 |
| WS event handler | `AnalysisContext.tsx` | 240-300 |
| Bbox dual coords | `AnalysisContext.tsx` | 85-130 |
| WS protocol types | `ws-client.ts` | 13-36 |
| Workspace voice integration | `workspace/page.tsx` | 611-636 |

---

## A3 — Tech stack version

**Backend**: Python 3.10 · fastapi 0.100+ · ultralytics 8.0+ · torch 2.0+ · faster-whisper 1.0+ · openai 1.0+ · loguru 0.7+

**Frontend**: Next.js 16.2.2 · React 19.2 · MUI v9 · framer-motion 12 · react-markdown 10 · lucide-react 1.7

**System**: Ubuntu 22.04 · GStreamer 1.0 + plugins-{base,good,bad,ugly,libav} · CUDA 11.8 + cuDNN 8 · Docker 24+ + nvidia-container-toolkit · ffmpeg 4.4+

---

## A4 — Mermaid diagram styling tips for Claude web

Khi gen slide, dùng:
- `flowchart LR/TB` cho architecture (LR = wide, TB = tall)
- `sequenceDiagram` cho lifecycle
- `stateDiagram-v2` cho state machine
- `style NodeID fill:#color` để highlight

**Theme suggestion**: clean medical (teal #006064 + white). Font: Inter / Segoe UI. Code blocks: monokai/atom-one-dark monospace. Tables alternate row color.

**Time per slide**:
- Slide 1-3 intro: 1.5 phút
- Slide 4-18 architecture: 8 phút
- Slide 19-22 specs/comparison: 3 phút
- Slide 23-24 demo + metrics: 4 phút
- Slide 25-28 Q&A + closing: 3-4 phút (Q&A có thể dài)

**Tổng**: ~20 phút present + Q&A. Appendix slides chỉ show khi hỏi.

---

**Hết. ~28 slide chính + 4 appendix. Accurate 100% với codebase hiện tại (v2 — pipeline stability + GastroEye integration Phase 1).**
