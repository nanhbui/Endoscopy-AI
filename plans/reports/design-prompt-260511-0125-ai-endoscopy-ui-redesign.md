# Design Prompt — AI Endoscopy Suite UI Redesign

> Paste toàn bộ phần dưới (từ `## ROLE` trở đi) vào Claude (skill `ui-ux-pro-max` hoặc Claude Design) để redesign lại UI hệ thống.

---

## ROLE

You are a **senior UI/UX designer specialized in medical AI / clinical workflow tools**. Redesign the frontend of an existing Vietnamese-language web app called **AI Endoscopy Suite** — a real-time, voice-first endoscopy analysis dashboard for Vietnamese clinicians.

## PROJECT CONTEXT

**Product:** Hệ thống Phân tích Nội soi Thông minh — bác sĩ nội soi tải/stream video, AI (YOLO + Whisper + LLM) phát hiện tổn thương real-time, dừng video tại điểm phát hiện, đọc nhãn + chỉ số, bác sĩ nói "giải thích / bỏ qua / xác nhận" → hệ thống tiếp tục.

**Users:** bác sĩ nội soi tiêu hoá Việt Nam — tay đang cầm thiết bị nội soi, **hands-free là bắt buộc**, đọc tiếng Việt, môi trường phòng nội soi (ánh sáng dịu, có thể tối).

**Tech stack (must be preserved):**
- Next.js 15 (App Router) + React 19 + TypeScript
- MUI v7 (`@mui/material` Box/Grid/Typography/Button/Dialog/Chip)
- Tailwind v4 + shadcn/ui (`Dialog`, `Button`, `Card`, `Table`, `Badge`)
- framer-motion (đang dùng `motion(Box)` pattern)
- lucide-react icons
- `react-markdown` + `remark-gfm` cho LLM output

**Locale:** 100% Vietnamese (giữ nguyên copy hiện tại, chỉ tinh chỉnh nếu mơ hồ).

## CURRENT STATE (đang hoạt động — cần được tôn trọng)

### Routes
- `/` — Dashboard: hero gradient teal, 3 feature cards, current-session summary, detection table, GStreamer pipeline graph
- `/workspace` — **trang chính**: video player 16:9 + bbox overlay + DetectionBar overlay, voice transcript panel, LLM Smart Log panel, control buttons (Bắt đầu / Dừng), Session Report Modal khi EOS
- `/report` — grid session cards với 3-thumbnail strip, Session Detail Modal → Detection Modal (frame + bbox + LLM markdown), nút export PDF (placeholder)
- `/docs` — **TRANG MỚI** thay thế `/train` (đã bỏ) — giới thiệu hệ thống cho bác sĩ + người đánh giá đề tài (xem mục **NEW: /docs page** bên dưới)

### Design tokens hiện tại
- **Primary:** teal `#006064` / `#00838F` / `#004D40` / `#004044` (gradient hero `linear-gradient(135deg, #004044 0%, #006064 45%, #00838F 100%)`)
- **Surface:** `background.default` rất nhạt, `background.paper` trắng, border `#E2EAE8`, hover bg `#F8FAFB`/`#FAFCFB`, dashed empty `#C8D8D6`
- **Severity (lesion class — KHÔNG ĐƯỢC ĐỔI ý nghĩa):**
  - Ung thư → đỏ `#C44E52`
  - Viêm / default → cam `#DD8452`
  - Loét → xanh `#55A868`
- **Status badges:**
  - confirmed `#059669` (xanh), analyzed `#0277BD` (lam), ignored `#9AA5B1` (xám), detected `#D97706` (cam)
- **Severity chart (confidence-based):** ≥0.8 nghiêm trọng `#DC2626`, ≥0.6 trung bình `#D97706`, <0.6 nhẹ `#059669`
- **Radii:** 6/7/8/10/12/14/16/18/20/24px (thiếu nhất quán — CẦN system hoá)
- **Shadows:** `0 2px 12px rgba(13,27,42,0.06)`, hover `0 6-10px 18-32px rgba(13,27,42,0.1-0.12)`
- **Font:** Inter (Vietnamese subset), weights 400-800
- **Bbox overlay:** 3px solid border + 12% fill alpha + rounded 5%, label chip có `Zap` icon + label + confidence + timestamp

### Feature surfaces phải có lại
1. **Video panel** với toggle nguồn `[Tải video] [Trực tiếp]`, status pill (5 states: Chờ video / Video đã tải / Đang phân tích / AI phát hiện bất thường / Đang phân tích LLM / Hoàn tất), bbox overlay khi paused, DetectionBar action bar (Giải thích / Bỏ qua / Xác nhận)
2. **Voice transcript panel** với mic icon, audio level meter (RMS bar), timeline log
3. **LLM Smart Log** — markdown render với section dividers (`p:has(strong:first-of-type)` → border-left teal)
4. **Detection notification card** (side panel) — vàng cam shimmer header, pulse ring icon, action buttons
5. **Session Report Modal** (EOS) — left list (260px) + right detail (frame + bbox + markdown insight)
6. **Backend offline banner** + **Backend came-back-online banner**
7. **Live source input zone** — dashed border, RTSP/V4L2 text field
8. **Session card grid** — 3-thumbnail strip header, source chip (Upload/Live/Library), count badge, severity pill
9. **Pipeline graph + metrics sections** (GStreamer visualization — tôn trọng layout hiện có)
10. **`/docs` page (NEW)** — landing-style giới thiệu hệ thống (xem spec riêng bên dưới)

## PAIN POINTS (cần fix)

1. **Inconsistent radii** — 6/7/8/10/12/14/16/18/20/24px scattered → cần scale 4/8/12/16/24
2. **Color sprawl** — quá nhiều rgba inline, không có semantic token system, dark mode chưa thực sự dùng
3. **Hierarchy mờ** trên Workspace — video panel, voice panel, LLM panel ngang hàng visual weight, mắt không biết focus đâu
4. **Status pill rối** — 6 states với 6 màu khác nhau, không rõ progression
5. **Empty states đơn điệu** — chỉ là dashed box + icon xám
6. **Mobile unscaled** — 1440px max width là OK nhưng workspace layout vỡ < lg
7. **Severity vs status confusion** — 2 hệ thống màu (Ung thư/Viêm/Loét) và (confirmed/analyzed/ignored/detected) đang chen chúc nhau, bác sĩ scan nhanh không phân biệt
8. **Hands-free affordance yếu** — voice là feature chính nhưng UI không show được "đang nghe" đủ rõ; mic chỉ là 1 icon nhỏ
9. **No dark mode** dù phòng nội soi thường tối
10. **PDF export** chỉ là dialog placeholder

## DELIVERABLES

### 1. Design system (tokens)
- **Color**: 1 ramp primary (teal), 1 ramp neutral, semantic (success/warn/error/info), severity (cancer/inflammation/ulcer), status (confirmed/analyzed/ignored/detected/processing). Cho cả light & dark.
- **Radius scale**: `--r-sm 4 / --r-md 8 / --r-lg 12 / --r-xl 16 / --r-2xl 24`. Thay tất cả 6/7/10/14/18/20 hiện tại về scale này.
- **Shadow scale**: `--shadow-sm / --shadow-md / --shadow-lg / --shadow-glow-warning` (cho detection alert).
- **Spacing**: 4px grid (đang OK, document lại).
- **Typography**: 1 type scale chính thức (Display / H1-H3 / Body / Caption / Mono), define Vietnamese line-height (cao hơn để dấu không cắt).
- Output dưới dạng **CSS variables trong `globals.css`** + theme override cho MUI ở `lib/theme.ts`.

### 2. Layout redesign per route
Cho mỗi route, deliver:
- **ASCII wireframe** (desktop ≥1280, tablet 768, mobile 375)
- **Component breakdown** với prop interface
- **Behavior notes** (states, animations, keyboard, voice cues)

Đặc biệt cho `/workspace`:
- Đề xuất **focus mode** khi `pipelineState === 'PAUSED_WAITING_INPUT'` — video bự lên, dim mọi thứ khác, action bar nổi rõ, voice indicator thành banner full-width
- Voice listening visualization mạnh hơn (waveform thay vì single bar?)
- Detection notification card vs DetectionBar overlay — chọn 1 không trùng, hoặc làm rõ vai trò khác nhau
- Status pill → 1 timeline component thay vì 6 chip khác nhau

### 3. Specific components to redesign
1. **NavBar** — đổi 4 nav từ `[Dashboard / Workspace / Báo cáo / Train]` thành `[Dashboard / Workspace / Báo cáo / Tài liệu]` (icon `BookOpen` cho Docs). Thêm dark-mode toggle, thêm "kết nối backend" indicator (dot xanh/đỏ thay vì để mỗi page tự handle banner)
2. **Hero (dashboard)** — đẹp hơn, không phải chỉ gradient + 2 button. Đưa key stats lên (số phiên / tổn thương / accuracy?)
3. **Detection bbox overlay** — giữ severity color, nhưng cho phép multiple bbox cùng lúc (hiện tại chỉ render `currentDetection`)
4. **Session card** — thumbnail strip OK, nhưng card meta lộn xộn → re-grid (date / source pill / counts) thành 1 row metric clean
5. **Detection Modal** — markdown render hiện tại có border-left teal, tinh chỉnh thành **SOAP-style** sections (Subjective / Objective / Assessment / Plan) vì LLM đã sinh checklist
6. **Empty states** — illustrated (SVG nhẹ inline), không chỉ icon xám
7. **PDF export dialog** — design real flow (chọn phiên, preview, format options)

### 3.5. NEW: `/docs` page — Trang giới thiệu hệ thống

Thay thế hoàn toàn `/train` (chỉ là placeholder). Đây là **landing page giới thiệu** dành cho 2 audience:
- **Bác sĩ mới**: hiểu workflow, voice command, ý nghĩa màu bbox, cách bắt đầu
- **Hội đồng đánh giá đề tài tốt nghiệp**: hiểu kiến trúc, tech stack, đóng góp khoa học

**File:** `frontend/app/docs/page.tsx` (rename từ `train/`).

**Sections (theo thứ tự, scroll-spy sidebar):**

1. **Hero** — tên hệ thống + 1 dòng tagline + 2 CTA (`Bắt đầu phân tích` → `/workspace`, `Xem báo cáo mẫu` → `/report`). Background dùng cùng gradient teal như Dashboard hero để consistent.
2. **Hệ thống làm gì?** — 3 cột: Vấn đề (bác sĩ nội soi mệt mỏi, dễ miss tổn thương) / Giải pháp (AI real-time + voice) / Kết quả (giảm miss rate, hands-free).
3. **Kiến trúc pipeline** — diagram horizontal: `Video source → GStreamer → YOLO detection → Pause + Whisper STT → LLM (Ollama/local) → Voice intent → Resume`. Render bằng SVG inline hoặc tận dụng `pipeline-graph-section.tsx` đã có. Mỗi node hover hiện tooltip giải thích.
4. **Workflow bác sĩ** — stepper 5 bước (Tải video / Bắt đầu / AI dừng tại tổn thương / Nói lệnh / Xem báo cáo) với screenshot thumbnail mỗi bước.
5. **Voice commands reference** — table 2 cột:
   | Lệnh | Hành động |
   |------|-----------|
   | "giải thích" / "phân tích" | LLM mô tả tổn thương |
   | "bỏ qua" / "không liên quan" | Đánh dấu ignored, tiếp tục |
   | "xác nhận" / "đúng rồi" | Đánh dấu confirmed, lưu báo cáo |
   | (câu hỏi tự do) | Follow-up chat với LLM |
6. **Bảng màu tổn thương (severity legend)** — 3 swatch lớn: Ung thư đỏ / Viêm cam / Loét xanh — kèm giải thích y khoa ngắn để hội đồng hiểu là medical convention không phải arbitrary.
7. **Tech stack** — grid logo: Next.js / React / MUI / GStreamer / YOLO / Whisper / Ollama / WebSocket. Mỗi logo + 1 dòng vai trò.
8. **Đóng góp & giới hạn** — 2 cột: Đóng góp (real-time + voice-first + local LLM) / Giới hạn (chỉ tiếng Việt, cần GPU, dataset hạn chế).
9. **Tác giả & lời cảm ơn** — tên SV, GVHD, trường, năm. Footer link tới repo (nếu có).

**Layout:**
- Container max-width `lg`
- Left sticky sidebar (≥md) với scroll-spy navigation 9 sections, ẩn ở mobile (thay bằng top tab scroll)
- Right content column với generous spacing (`py: 8` mỗi section)
- Mỗi section có anchor id để deep-link (`#kien-truc`, `#voice-commands`, ...)

**Tone:**
- Tiêu đề tiếng Việt clear, dùng "bạn" với bác sĩ và "chúng tôi" với hội đồng
- Có 1-2 sketch/illustration nhẹ (SVG), không quá nặng
- Print-friendly CSS để hội đồng có thể in nguyên trang để chấm

### 4. Dark mode
Light là default trong giờ hành chính, dark cho phòng tối. Define palette dark trong `globals.css` (đã có biến CSS sẵn — chỉ cần fill số). Đảm bảo bbox color, severity vẫn distinguishable trong dark.

### 5. Motion
Giữ framer-motion. Define motion tokens:
- `enter` (opacity+y 0→1, 0.25s easeOut)
- `exit` (faster, 0.15s)
- `pulse-alert` (cho detection notification — đã có shimmer + pulseRing, document lại)
- `bbox-appear` (scale 0.94→1, 0.2s)

### 6. Accessibility (WCAG AA cho medical context)
- Contrast 4.5:1 cho mọi text (severity colors phải pass cho cả light + dark)
- Focus visible cho mọi interactive element (hiện tại MUI default OK, verify)
- Keyboard shortcuts cho hands-busy fallback: `B` = bỏ qua, `G` = giải thích, `X` = xác nhận, `Space` = pause/resume
- Voice listening status announce qua `aria-live`

## CONSTRAINTS

- **KHÔNG đổi tech stack** — vẫn MUI + Tailwind + shadcn/ui hybrid (đã có dependencies, đừng xoá Tailwind hay MUI).
- **KHÔNG đổi data shape** — `Detection { label, confidence, timestamp, bbox{x,y,width,height}, frame_b64, status, llmInsight }` và `Session { id, name, source, startedAt, detections }` giữ nguyên.
- **KHÔNG đổi route paths** của 3 trang chính (`/`, `/workspace`, `/report`) hoặc component file structure. Riêng `/train` được phép xoá và thay bằng `/docs`.
- **KHÔNG mock data** — UI redesign phải hoạt động với data hiện có (rỗng / 1 detection / nhiều detection / live stream).
- Vietnamese copy giữ nguyên unless mơ hồ.
- Bbox color semantic (đỏ ung thư / cam viêm / xanh loét) là medical convention — không được đổi mapping.

## OUTPUT FORMAT

Deliver theo thứ tự:

1. **Executive summary** (5 dòng — đề xuất chính)
2. **Design system tokens** (full CSS variables + MUI theme override snippet, ready-to-paste)
3. **Per-route wireframes** (ASCII desktop/tablet/mobile)
4. **Component spec table** — `Component | File | Key changes | Props delta`
5. **Code skeleton** cho 3 components quan trọng nhất (Workspace video panel, Detection notification, Session card) — TypeScript + MUI, không full implementation chỉ structure + critical styles
6. **Migration plan** — thứ tự refactor (tokens trước, layout sau, components cuối) để không vỡ sản xuất
7. **Open questions** ở cuối

## KEY FILES (đọc trước khi design)

- `frontend/app/layout.tsx` — root, MUI ThemeProvider + Inter Vietnamese
- `frontend/app/page.tsx` — dashboard (277 lines)
- `frontend/app/workspace/page.tsx` — main app (1451 lines — đọc kỹ)
- `frontend/app/report/page.tsx` — báo cáo (704 lines)
- `frontend/app/train/page.tsx` — placeholder 19 dòng → **xoá**, tạo mới `frontend/app/docs/page.tsx`
- `frontend/components/NavBar.tsx` (132 lines) — đổi nav item `Train`→`Tài liệu`, `href: /train`→`/docs`, icon `Activity`→`BookOpen`
- `frontend/components/pipeline-graph-section.tsx` (283 lines)
- `frontend/app/globals.css` — đã có CSS variables nhưng chưa được dùng (MUI theme đè)
- `frontend/lib/theme.ts` — MUI theme (chưa đọc — verify tồn tại)
- `frontend/context/AnalysisContext.tsx` — types `Detection`, `Session`, `DetectionStatus`, `PipelineState`

Đọc xong nắm được: data shape, state machine của pipeline (`IDLE / PLAYING / PAUSED_WAITING_INPUT / PROCESSING_LLM / EOS_SUMMARY`), và voice intent set (`BO_QUA / GIAI_THICH / XAC_NHAN / UNKNOWN`).

## SUCCESS CRITERIA

Một bác sĩ Việt Nam đeo găng tay, tay đang cầm endoscope, mắt nhìn màn hình, có thể:
1. Nhìn 1 giây biết AI đang ở state nào (chờ / chạy / phát hiện / xử lý)
2. Khi AI dừng, **không cần nhìn xuống** vẫn biết có phát hiện (audio + visual peripheral cue)
3. Đọc lesion label + confidence ở khoảng cách 60cm trong phòng tối
4. Nói "giải thích" / "bỏ qua" / "xác nhận" và thấy feedback tức thì (< 200ms visual)
5. Sau buổi nội soi, mở `/report`, click 1 phiên, thấy ngay 3 thumbnail nổi bật + severity tổng quan, click 1 detection thấy frame + bbox + clinical insight cấu trúc rõ ràng
6. Switch dark mode trong phòng tối mà không bị chói

---

Bắt đầu bằng đọc 6 file quan trọng nhất ở trên, rồi deliver theo thứ tự output đã yêu cầu. Tiếng Việt cho mọi UI copy, English cho code/comments/spec.
