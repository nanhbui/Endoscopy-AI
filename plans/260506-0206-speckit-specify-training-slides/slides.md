---
marp: true
theme: default
paginate: true
size: 16:9
header: 'Spec Kit Training • /speckit.specify'
footer: 'AI Engineering Team • 2026-05-06'
style: |
  section { font-size: 26px; }
  h1 { color: #1a73e8; }
  h2 { color: #0d47a1; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
  pre { font-size: 20px; }
  .small { font-size: 20px; }
  .tiny { font-size: 16px; }
  .highlight { background: #fff3cd; padding: 2px 6px; border-radius: 4px; }
  .red { color: #c62828; }
  .green { color: #2e7d32; }
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Spec-Driven Development
## Làm chủ `/speckit.specify` cho AI Engineers

**Từ "vibe coding" → spec đầu vào có cấu trúc cho LLM**

<br>

`Trainer:` AI Engineering Team
`Audience:` AI Engineers làm dự án
`Date:` 2026-05-06

---

## Agenda (45 phút)

1. **Tại sao** chúng ta cần spec? (5')
2. **Spec Kit là gì** — triết lý & workflow tổng quan (5')
3. **`/speckit.specify`** — vai trò, input, output (10')
4. **Anatomy** của 1 spec tốt — user stories, FR, edge cases (10')
5. **WHAT vs HOW** — nguyên tắc cốt lõi cho AI Engineer (5')
6. **Demo** — spec thực từ project endoscopy (5')
7. **Pitfalls + Best Practices** (3')
8. **Hands-on + Q&A** (2')

---

<!-- _class: lead -->

# Phần 1
## Vấn đề: Tại sao "Vibe Coding" thất bại với AI?

---

## Câu chuyện quen thuộc của AI Engineer

<div class="small">

**Ngày 1:** "Hey Claude, làm cho tôi cái RAG pipeline"
→ Claude code 500 dòng, chạy được trên 1 demo

**Ngày 7:** "Sửa lại để hỗ trợ multi-tenant"
→ Claude refactor toàn bộ, mất chunking strategy cũ

**Ngày 14:** "Khoan, sao retrieval kém thế?"
→ Không ai nhớ embedding model gì, chunk size bao nhiêu, vì sao chọn

**Ngày 30:** Code 3000 dòng, không ai dám đụng vào, "viết lại từ đầu nhanh hơn"

</div>

> **Vấn đề không phải LLM dở. Vấn đề là không có "source of truth"**

---

## "Vibe Coding" — định nghĩa thẳng

<div class="small">

| Vibe Coding | Spec-Driven |
|---|---|
| Prompt → Code → Hy vọng | Spec → Plan → Tasks → Code |
| Intent sống trong đầu dev | Intent sống trong file `spec.md` |
| LLM đoán requirement | LLM đọc requirement |
| Refactor = viết lại | Refactor = update spec rồi regenerate |
| Khó parallel (mỗi LLM 1 hướng) | Parallel-safe (chung spec) |
| Demo tốt, prod fail | Spec catch ambiguity sớm |

</div>

**AI Engineer đặc biệt dễ rơi vào vibe coding** vì LLM trả output rất nhanh
→ skip bước suy nghĩ, không spot được ambiguity

---

## Tại sao spec quan trọng *gấp đôi* khi dùng AI?

<div class="small">

🔁 **LLM forget context** — mỗi session, mỗi agent đều cần re-read intent
📋 **Spec = persistent memory** không phụ thuộc context window

🧑‍🤝‍🧑 **Multi-agent / parallel work** — 3 subagents cần chung 1 nguồn truth
📋 **Spec = shared contract** giữa agents

🤔 **AI hay đoán** — gặp ambiguity → tự fill in (sai)
📋 **Spec ép `[NEEDS CLARIFICATION]`** — LLM không được đoán

⚡ **Code ngày càng "throwaway"** — Claude regen 1000 dòng trong 30s
📋 **Spec là asset bền vững** — code chỉ là build artifact

</div>

---

<!-- _class: lead -->

# Phần 2
## Spec Kit là gì?

---

## Spec Kit — open-source by GitHub

<div class="small">

**Spec Kit** = bộ template + slash commands chuẩn hoá Spec-Driven Development

📦 Đã tích hợp sẵn trong project: `.specify/` directory
🔧 Version hiện tại: **v0.8.3**
🤖 Hoạt động với: Claude Code, Cursor, Copilot, GitHub Codespaces

**7 commands chính:**

```
/speckit.constitution    — nguyên tắc bất biến của project
/speckit.specify         — viết spec WHAT (slide này)
/speckit.clarify         — hỏi để xoá [NEEDS CLARIFICATION]
/speckit.plan            — kiến trúc kỹ thuật HOW
/speckit.tasks           — break thành tasks độc lập
/speckit.analyze         — cross-check spec/plan/tasks
/speckit.implement       — chạy tasks → code
```

</div>

---

## Triết lý cốt lõi

<div class="small">

> "**The code is the implementation. The spec is the source.**"
> — Spec Kit philosophy

🔁 **Inversion** truyền thống:
- Trước: Code = product, doc = afterthought
- Spec Kit: **Spec = product, code = build artifact**

🎯 Hệ quả với AI Engineer:
1. Refactor lớn → update spec → regen code
2. Onboard người mới → đọc `spec.md` thay vì đọc 50 file code
3. Multi-agent collaboration → spec là contract
4. Audit/compliance → spec là evidence (quan trọng cho medical AI, FinTech...)

</div>

---

## Workflow tổng quan

```
┌──────────────────┐
│ /constitution    │  ← Nguyên tắc bất biến (1 lần / project)
└────────┬─────────┘
         ↓
┌──────────────────┐
│ /specify         │  ← WHAT: User story + FR  ★ HÔM NAY
└────────┬─────────┘
         ↓
┌──────────────────┐
│ /clarify         │  ← Hỏi để xoá [NEEDS CLARIFICATION]
└────────┬─────────┘
         ↓
┌──────────────────┐
│ /plan            │  ← HOW: Stack, architecture, contracts
└────────┬─────────┘
         ↓
┌──────────────────┐
│ /tasks           │  ← Break thành tasks parallel-safe
└────────┬─────────┘
         ↓
┌──────────────────┐
│ /analyze         │  ← Cross-check 3 docs
└────────┬─────────┘
         ↓
┌──────────────────┐
│ /implement       │  ← Code (LLM execute)
└──────────────────┘
```

---

<!-- _class: lead -->

# Phần 3
## `/speckit.specify` — Trái tim của workflow

---

## Vai trò của `/speckit.specify`

<div class="small">

🎯 **Mục đích:** Biến **mô tả tự nhiên** → **spec có cấu trúc**

📥 **Input:** 1 đoạn mô tả feature bằng tiếng Anh/Việt thoải mái
📤 **Output:** File `spec.md` đầy đủ:
- User Stories (đã prioritize P1/P2/P3)
- Acceptance Scenarios (Given/When/Then)
- Functional Requirements (FR-001, FR-002...)
- Edge Cases
- Key Entities (nếu có data)
- `[NEEDS CLARIFICATION]` markers cho điểm mơ hồ

🔧 **Side effect:**
- Tạo branch tự động: `004-chatbot-llm-enhancement`
- Tạo folder: `specs/004-chatbot-llm-enhancement/`
- Tạo file: `specs/.../spec.md`

</div>

---

## Cú pháp & cách gọi

```bash
# Trong Claude Code:
/speckit.specify Tôi muốn thêm chatbot LLM hỗ trợ bác sĩ
hỏi đáp về ca nội soi đã ghi. Bot phải retrieve các
detection liên quan, trả lời bằng tiếng Việt, có citation
về frame-id và timestamp.
```

<div class="small">

**Lưu ý ngôn ngữ:**
- Có thể viết tiếng Việt hoặc Anh (LLM dịch và chuẩn hoá)
- **Không cần technical** — KHÔNG nói "dùng LangChain", "dùng pgvector"
- **Có thể nói** "phải nhanh", "phải private", "user khó tính"

**Mức độ chi tiết:**
- Càng chi tiết về **WHAT** càng tốt
- Càng chi tiết về **HOW** càng có hại (sẽ giải thích slide sau)

</div>

---

## Cấu trúc file `spec.md` được tạo ra

```markdown
# Feature Specification: [TÊN FEATURE]

**Feature Branch**: `004-chatbot-llm-enhancement`
**Created**: 2026-05-06
**Status**: Draft

## User Scenarios & Testing  (mandatory)

### User Story 1 — [Title] (Priority: P1)
[Plain language description]

**Why this priority**: [Value justification]
**Independent Test**: [How to test alone]
**Acceptance Scenarios**:
1. Given X, When Y, Then Z

### Edge Cases
- What if [boundary]?

## Requirements  (mandatory)

### Functional Requirements
- **FR-001**: System MUST [capability]
- **FR-006**: System MUST authenticate via
  [NEEDS CLARIFICATION: SSO? OAuth?]

### Key Entities
- **Patient**: ...
```

---

<!-- _class: lead -->

# Phần 4
## Anatomy của 1 Spec Tốt

---

## 1. User Stories — viết đúng cách

<div class="small">

**Quy tắc:**
- Mỗi story là **1 lát MVP độc lập** (independent slice)
- Có thể test riêng → có thể ship riêng
- Prioritize **P1 / P2 / P3** (P1 là blocker, không có không xong)

❌ **Sai:** "User có thể login, đổi password, xem lịch sử, xoá tài khoản"
→ 4 stories trộn lẫn, không slice được

✅ **Đúng (từ project endoscopy):**

> **US1 — Real-time Lesion Detection (P1)**
> Endoscopist uploads pre-recorded video. System plays it and pauses
> when a lesion is detected, showing bbox overlay + label.
>
> **Why P1:** Core value prop, không có cái này → product không tồn tại.
> **Independent Test:** Upload 1 file MP4 → verify auto-pause + bbox.

</div>

---

## 2. Acceptance Scenarios — Given/When/Then

<div class="small">

Format BDD ép viết **kiểm chứng được**, không "fluffy":

✅ Ví dụ thật từ baseline spec:

```
1. Given a valid MP4/MOV file,
   When uploaded and pipeline starts,
   Then video plays and YOLO runs inference every 3rd frame

2. Given YOLO confidence ≥ 0.45,
   When detection passes Smart Ignore check,
   Then pipeline pauses and DETECTION_FOUND event fires
   with frame, bbox, label, timestamp

3. Given same lesion previously ignored,
   When detected again with IoU > 0.8,
   Then pipeline does NOT pause (silent skip)
```

> Mỗi scenario sau này map 1-1 với integration test

</div>

---

## 3. Functional Requirements — FR-XXX

<div class="small">

**Format:** `FR-NNN: System MUST [verb] [object] [condition]`

✅ **Tốt:**
- `FR-012`: System MUST persist confirmed detections with frame thumbnail, timestamp, doctor's voice note, and Paris classification.
- `FR-018`: System MUST reject frames with brightness < 30 (out of 255) before YOLO inference.

❌ **Tệ:**
- "System should be fast" → fast là bao nhiêu?
- "Use FAISS for vector store" → đây là HOW, không phải FR
- "Login screen has email field" → quá UI, không phải capability

**Mẹo:** Mỗi FR phải trả lời được câu: *"Làm sao QA tester verify được requirement này pass?"*

</div>

---

## 4. `[NEEDS CLARIFICATION]` — vũ khí bí mật

<div class="small">

Khi viết spec gặp điểm **không chắc**, **KHÔNG ĐƯỢC ĐOÁN**.

❌ Đừng:
> "FR-006: System MUST authenticate via OAuth 2.0 with Google" *(bạn tự đoán)*

✅ Hãy:
> "FR-006: System MUST authenticate users via
> **[NEEDS CLARIFICATION: SSO? email/password? OAuth provider?]**"

**Tại sao quan trọng với AI Engineer?**
- LLM rất giỏi "nội suy hợp lý" → fill in giả định sai
- Marker này force `/speckit.clarify` hỏi user → đóng gap **trước** khi code
- Tiết kiệm 10-100x effort so với fix sau khi đã code

> **Rule:** Thà có 20 `[NEEDS CLARIFICATION]` còn hơn 0 (tức là bạn đang đoán)

</div>

---

## 5. Edge Cases — đừng skip

<div class="small">

Phần này hay bị bỏ qua nhất → bug production xuất phát từ đây.

**Checklist edge cases tối thiểu:**
- ⏱️ **Empty input** — file 0 byte, list rỗng
- 🌊 **Boundary** — max length, min size, timeout
- 🔌 **Failure modes** — network drop, service down, partial response
- 🌐 **Concurrency** — 2 user cùng action
- 🎭 **Adversarial** — input độc, injection, oversize
- 🧬 **Data quality** — null, duplicate, encoding lạ

✅ Ví dụ thật:
> "Given background noise / irrelevant speech, When no matching intent,
> Then system stays paused, no action taken"
> *(thay vì crash hoặc làm bừa)*

</div>

---

<!-- _class: lead -->

# Phần 5
## Nguyên tắc CỐT LÕI cho AI Engineer
## **WHAT vs HOW**

---

## Spec viết WHAT, Plan viết HOW

<div class="small">

| Thuộc về **`spec.md`** (WHAT) | Thuộc về **`plan.md`** (HOW) |
|---|---|
| User cần làm được X | Dùng React + Next.js |
| Phải xử lý 100 user/giây | Dùng Redis cache |
| Phải private (HIPAA) | Encrypt với AES-256 |
| Phải trả tiếng Việt | Dùng GPT-4o-mini |
| Lưu lịch sử ca khám | PostgreSQL với schema X |
| Detect chính xác ≥ 90% | YOLOv8m, conf=0.45 |

</div>

> **AI Engineer đặc biệt hay vi phạm** — vì quen suy nghĩ về tech stack
> Hãy hỏi: *"Nếu 5 năm sau migrate sang stack khác, dòng này còn đúng không?"*
> Nếu **CÒN ĐÚNG** → đó là WHAT (vào spec)
> Nếu **KHÔNG** → đó là HOW (vào plan)

---

## Bài test 30 giây

<div class="small">

Đoạn nào thuộc spec, đoạn nào thuộc plan?

```
A. Hệ thống phải retrieve được top-3 ca tương tự trong < 500ms
B. Embedding sinh bằng OpenAI text-embedding-3-small
C. Dùng pgvector với HNSW index, m=16, ef=64
D. Doctor có thể "đánh dấu sai" và bot phải học từ feedback đó
E. Feedback lưu vào table `false_positives`, retrain weekly
F. Bot phải trả lời tiếng Việt, có citation về frame-id
```

<br>

**Đáp án:**
- **Spec (WHAT):** A, D, F
- **Plan (HOW):** B, C, E

</div>

---

<!-- _class: lead -->

# Phần 6
## Demo — Spec thật từ project endoscopy

---

## Ví dụ thật: User Story trong baseline spec

<div class="small">

```markdown
### US2 — Voice-Controlled Response to Detection (P1)

After pipeline pauses on detection, endoscopist speaks
a Vietnamese command. System transcribes, classifies intent,
and executes without keyboard/mouse.

**Acceptance Scenarios**:
1. Given pipeline paused, When doctor says "bỏ qua" /
   "sai rồi" / "không phải", Then detection marked false
   positive and pipeline resumes

2. Given pipeline paused, When doctor says "giải thích" /
   "phân tích" / "xem nào", Then GPT-4o-mini streams Paris
   classification + actionable checklist

3. Given doctor says "kiểm tra lại", When intent classified
   as KIEM_TRA_LAI, Then current frame re-analyzed
   (intent defined in IntentClassifier but NOT yet wired
    to WS server or frontend action — gap)
```

📝 **Chú ý dòng cuối** — gap được ghi nhận ngay trong spec, không bị mất.

</div>

---

## Mô tả ban đầu của AI Engineer (input cho `/specify`)

<div class="small">

> "Tôi muốn thêm chatbot LLM cho bác sĩ.
> Sau khi xong ca nội soi, bác sĩ có thể chat hỏi về các
> tổn thương đã phát hiện, lịch sử các ca tương tự, gợi ý
> điều trị. Phải dùng được tiếng Việt. Phải có citation rõ
> ràng vì đây là medical, không được hallucinate."

</div>

`/speckit.specify` sẽ extract:

<div class="small">

- ✅ **3 user stories** rõ ràng (Q&A, similar cases, treatment suggestion)
- ✅ **FR-001..FR-015** với MUST/MUST NOT
- ✅ **`[NEEDS CLARIFICATION]`** chỗ "tổn thương đã phát hiện" — chỉ session hiện tại hay cross-session?
- ✅ **`[NEEDS CLARIFICATION]`** chỗ "lịch sử ca tương tự" — định nghĩa "tương tự" là gì? Cosine sim threshold? Same anatomy?
- ✅ **Edge cases** — bot không biết câu trả lời? doctor hỏi sai chuyên môn?

</div>

---

<!-- _class: lead -->

# Phần 7
## Pitfalls cho AI Engineer

---

## 7 lỗi phổ biến + cách fix

<div class="small">

| # | Lỗi | Fix |
|---|---|---|
| 1 | Viết tech stack vào spec ("dùng FAISS") | Đẩy xuống `/plan` |
| 2 | "System should be fast/secure/scalable" | Số cụ thể: <500ms, AES-256, 100 RPS |
| 3 | Skip `[NEEDS CLARIFICATION]`, tự đoán | Ép habit: gặp mơ hồ → marker |
| 4 | 1 user story khổng lồ | Split thành P1/P2/P3 slices |
| 5 | Acceptance scenarios kiểu "user happy" | Format Given/When/Then |
| 6 | Edge cases = 0 (chỉ happy path) | Min 5 edges: empty, boundary, fail, concurrent, adversarial |
| 7 | Bỏ qua `/clarify` chạy thẳng `/plan` | Workflow: specify → **clarify** → plan |

</div>

---

## Pitfall đặc thù cho AI Engineer

<div class="small">

🤖 **Pitfall: "Để Claude tự fill in"**
- Spec sơ sài → ép Claude nội suy → output không deterministic
- Fix: spend 30 phút viết spec kỹ → save 3 ngày debug

🎲 **Pitfall: ML metrics không cụ thể**
- ❌ "Model phải chính xác"
- ✅ "Precision ≥ 0.85 AND Recall ≥ 0.80 trên test set Y"

📦 **Pitfall: Quên data contract**
- AI feature thường có data dependency phức tạp
- Spec PHẢI nói: input shape, output shape, what entities exist

🔄 **Pitfall: Quên feedback loop**
- AI thường cần online learning / human-in-the-loop
- Spec PHẢI mô tả flow correction từ user

</div>

---

<!-- _class: lead -->

# Phần 8
## Best Practices

---

## 5 best practices đáng ghi sổ

<div class="small">

**1. ⏱️ Time-box write (15-30 phút) — không phải PRD đại trà**
Spec là living doc, không cần hoàn hảo lần đầu. Quan trọng là chạy chu trình.

**2. 🎯 Mỗi user story = 1 demo độc lập**
Nếu chỉ build P1, vẫn ship được? → đúng. Nếu không → split tiếp.

**3. 🚧 `[NEEDS CLARIFICATION]` là feature, không phải bug**
Spec có 15 markers > spec không có gì. Chạy `/clarify` ngay sau.

**4. 📐 Số cụ thể ở mọi non-functional requirement**
"Fast" → "P95 < 300ms"; "Accurate" → "F1 ≥ 0.85"; "Secure" → "PII encrypted at rest"

**5. 🔁 Re-spec khi requirements thay đổi, không patch code**
Workflow đúng: update spec → re-run `/plan` → re-run `/tasks` → `/implement`

</div>

---

## Workflow tích hợp với team hiện tại

```
┌──────────────────────────────────────────────────────┐
│ AI Engineer nhận task                                 │
└──────────────────────────────────────────────────────┘
                  ↓
   ┌─ /speckit.specify "<mô tả tự nhiên>"
   │     → spec.md  +  branch tự động
   ↓
   ┌─ Review spec — tự đọc, có hợp lý không?
   │     → tìm [NEEDS CLARIFICATION] còn sót
   ↓
   ┌─ /speckit.clarify
   │     → trả lời các câu hỏi → spec hoàn thiện
   ↓
   ┌─ Commit spec → push → tạo PR sớm cho team review
   │     (PR description = spec link)
   ↓
   ┌─ /speckit.plan → /speckit.tasks → /speckit.analyze
   ↓
   ┌─ /speckit.implement (LLM code, dev review)
   ↓
   ┌─ Test, ship
```

---

<!-- _class: lead -->

# Phần 9
## Hands-on Exercise (10 phút)

---

## Bài tập: Specify một feature thật

<div class="small">

**Đề bài:** Project hiện tại cần thêm tính năng:

> "Export PDF report sau session: bao gồm tất cả detection đã confirm,
> thumbnail frame, timestamp, voice note, classification của bác sĩ"

**Yêu cầu:**
1. Mở Claude Code trong project
2. Chạy: `/speckit.specify Export PDF report ...`
3. **5 phút:** đọc `spec.md` được tạo
4. **3 phút:** tìm
   - ⚪ Bao nhiêu user stories?
   - ⚪ Bao nhiêu `[NEEDS CLARIFICATION]`?
   - ⚪ Có FR nào *thực ra là HOW* lọt vào không?
5. **2 phút:** chạy `/speckit.clarify` để xử lý markers

</div>

> 💡 Lưu ý: spec đầu tiên hiếm khi hoàn hảo. Mục tiêu là **practice cycle**, không phải perfect spec.

---

## Checklist self-review trước khi commit spec

<div class="small">

- [ ] Mỗi user story có **priority P1/P2/P3** rõ ràng
- [ ] Mỗi user story có **Independent Test** description
- [ ] Mỗi user story có **≥ 2 acceptance scenarios** (Given/When/Then)
- [ ] **Functional Requirements** đánh số FR-001, FR-002...
- [ ] Mỗi FR dùng **MUST / MUST NOT** (tránh "should/may")
- [ ] **Edge Cases** có **≥ 5 mục** (empty/boundary/failure/concurrency/adversarial)
- [ ] **KHÔNG** có tech stack (React, FAISS, LangChain...) trong spec
- [ ] **KHÔNG** có metric mơ hồ ("fast", "secure" — phải có số)
- [ ] Đã chạy `/speckit.clarify` đến khi **0 markers còn lại**
- [ ] Spec đứng độc lập — người mới đọc xong hiểu feature

</div>

---

<!-- _class: lead -->

# Phần 10
## Resources & Q&A

---

## Tài liệu tham khảo

<div class="small">

📚 **Trong project:**
- Templates: `.specify/templates/spec-template.md`
- Commands: `.specify/commands/speckit.*.md`
- Ví dụ thật: `specs/001-baseline/spec.md`
- Constitution: `.specify/memory/constitution.md`

🌐 **External:**
- Spec Kit GitHub: github.com/github/spec-kit
- Spec-Driven Development manifesto (in repo README)

🛠️ **Slash commands cheatsheet:**
```
/speckit.constitution     /speckit.tasks
/speckit.specify   ★      /speckit.analyze
/speckit.clarify          /speckit.implement
/speckit.plan             /speckit.checklist
```

</div>

---

## Key Takeaways

<div class="small">

1. **Code is throwaway, spec is durable** — spec là source of truth, không phải comment trong code

2. **WHAT vs HOW** — spec không chứa tech stack; nếu 5 năm sau migrate stack vẫn đúng → đó là WHAT

3. **`[NEEDS CLARIFICATION]` là vũ khí** — đừng đoán, hãy đánh dấu

4. **User stories là MVP slices độc lập** — P1/P2/P3, mỗi cái ship được riêng

5. **Acceptance scenarios = Given/When/Then** — kiểm chứng được, không "fluffy"

6. **Spec → Clarify → Plan → Tasks → Implement** — đừng skip clarify

7. **Spec viết 30 phút tiết kiệm 3 ngày debug** — đặc biệt khi dùng AI agent

</div>

---

<!-- _class: lead -->

# Q & A
### Câu hỏi → liên hệ team
### Practical issues → ping `#ai-eng-spec-kit` Slack

<br>

**Cảm ơn — chúc các bạn ship spec tốt!** 🚀

---

<!-- _class: lead -->
<!-- _paginate: false -->

## Appendix
### Phụ lục cho người muốn đào sâu

---

## A. So sánh spec-kit với các framework khác

<div class="small">

| Tool | Triết lý | Khác biệt với Spec Kit |
|---|---|---|
| **PRD truyền thống** | PM viết doc Word/Notion | Không có cấu trúc, không actionable cho AI |
| **JIRA Stories** | Ticket-based | Mỗi ticket nhỏ, không có holistic view |
| **README-driven dev** | Viết README trước | Không separate WHAT/HOW; không có acceptance |
| **OpenAPI/AsyncAPI** | Spec at API level | Chỉ cover interface, không cover business logic |
| **Spec Kit** | Multi-phase, AI-native | Có constitution + spec + plan + tasks tách bạch |

</div>

---

## B. Khi nào KHÔNG dùng spec-kit?

<div class="small">

❌ **Bug fix nhỏ < 1 ngày**
→ Overhead lớn hơn lợi ích. Fix trực tiếp.

❌ **Throwaway prototype / hackathon**
→ Speed > rigor. Vibe code đi.

❌ **Pure refactor không thay đổi behavior**
→ Spec không đổi, không cần re-spec.

❌ **Tính năng đã rất rõ, code < 100 dòng**
→ 1 short PR description đủ rồi.

✅ **Khi nào DÙNG:**
- Feature ≥ 3 ngày work
- Có ≥ 2 dev/agent cùng touch
- Có dependency cross-team
- Compliance/audit yêu cầu (medical, finance)
- Cần resilient với LLM context loss

</div>

---

## C. Constitution — bối cảnh thêm

<div class="small">

`/speckit.constitution` là **đứng trước** specify, viết **1 lần duy nhất** cho project.

Nội dung **bất biến** xuyên suốt mọi feature:
- 🔒 Security baseline (PHI/PII handling)
- ⚖️ Compliance (HIPAA, GDPR, FDA SaMD...)
- 🌐 Language requirements (UI tiếng Việt cho doctor)
- 🚫 Hard constraints ("không gửi patient image qua public LLM API")
- 📐 Architecture invariants ("voice processing on-device only")

**Khi viết spec, mọi FR phải tương thích với constitution.**
`/speckit.analyze` cross-check tự động.

> Project này: constitution phản ánh medical-grade requirements
> → mọi spec mới (như chatbot LLM) phải tuân thủ.

</div>

---

## D. Mapping với Speckit khác trong workflow

<div class="small">

**Sau `/speckit.specify`, AI Engineer thường chạy theo thứ tự:**

```
specify  →  clarify (HỎI để xoá [NEEDS CLARIFICATION])
         →  plan    (chọn stack, kiến trúc — ★ phần quen thuộc của AI Eng)
         →  tasks   (break thành tasks parallel-safe, mỗi task có owner)
         →  analyze (cross-check spec vs plan vs tasks)
         →  implement (LLM code, dev review)
```

**Tiêu chí "xong" của `/specify`:**
- Spec đứng độc lập (đọc xong hiểu feature)
- 0 `[NEEDS CLARIFICATION]` (đã qua `/clarify`)
- User stories prioritized
- Đã commit + push
- PR opened cho team review (PR description trỏ tới spec)

</div>

---

<!-- _class: lead -->

# HẾT
## Thanks for attending!
## `/speckit.specify` happy! 🎯
