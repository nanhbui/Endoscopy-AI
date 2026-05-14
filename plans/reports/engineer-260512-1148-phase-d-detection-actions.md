# Engineer Log — Phase D: Detection Action Extensions

**Date**: 2026-05-12
**Branch**: `006-detection-actions`
**Scope**: 3 detection action mới ngoài plan Phase A/B/C — đã hứa GVHD trong demo
trước. Mục tiêu giảm friction cho bác sĩ khi review detection: skip LLM nếu rõ
ràng, re-detect nếu nghi miss, persist false positive cross-session.

---

## TL;DR

3 action mới hoạt động end-to-end:
- **Xác nhận luôn** — confirm tổn thương đúng mà KHÔNG cần LLM giải thích (tiết kiệm 4-5s/case)
- **Kiểm tra lại** — BE re-run YOLO trên frame paused với conf threshold thấp hơn (0.4 vs default per-class)
- **Báo sai** — persist (label + bbox) vào SQLite, mọi phiên sau auto-skip nếu match IoU > 0.6

Backend verified qua DB (3 FP entries saved during testing). UI redesign 2 lần
sau feedback "xấu quá" — final layout: 2 primary CTA + 3 icon-only tools.

---

## Đã làm

### D1 — `ACTION_QUICK_CONFIRM` (Xác nhận luôn)
Action layer-thin — wrap `ACTION_CONFIRM` có sẵn nhưng expose ở state pre-LLM
(trước khi user bấm Giải thích). Backend handler không đổi (đã dùng cho
post-LLM confirm). FE thêm `quickConfirm()` để gọi rõ ràng.

**Trade-off**: Phase B session summary sẽ KHÔNG có structured report cho
detection được quick-confirm. Acceptable — summary chỉ cần label + bbox + status
"confirmed".

### D2 — `ACTION_REPORT_FALSE_POSITIVE` (Báo sai)
Cross-session persistent FP filtering.

**Backend** (`src/backend/api/db.py`):
- Table `false_positives (id, label, bbox_x1, y1, x2, y2, reported_at, session_id_source)`
- `save_false_positive()` — INSERT mới mỗi lần báo (cho phép trùng để track history)
- `load_all_false_positives()` — fetch toàn bộ ở WS connect
- `matches_false_positive(label, bbox, fps, iou=0.6)` — check match
- `_iou()` helper, kept inside db module để self-contained

**Wiring** (`endoscopy_ws_server.py`):
- WS connect: `sess["false_positives"] = load_all_false_positives()` (load 1 lần)
- `_relay_events`: pre-filter `DETECTION_FOUND` trước khi forward FE
- Match found → send `ACTION_IGNORE` to controller để pipeline tiếp tục, drop event
- Handler `ACTION_REPORT_FALSE_POSITIVE`: extract pending det's (label+bbox),
  persist DB, append vào in-memory list, send IGNORE

IoU threshold 0.6 cross-session (vs 0.8 cùng session) vì video khác nhau bbox
không pixel-perfect — anatomical region chỉ cần overlap 60%.

### D3 — `ACTION_RECHECK` (Kiểm tra lại)
Re-run YOLO trên frame đang paused với confidence threshold thấp hơn.

**Worker** (`pipeline_controller.py`):
- Save `_last_paused_frame` (numpy copy) + `_last_paused_frame_index` + `_last_paused_timestamp_ms`
  ngay sau khi emit DETECTION_FOUND + set `paused = True`
- IPC command mới `RECHECK:<conf>` trong cmd_q drain loop
- Re-run `model(frame, conf=<conf>)`, skip StrongSORT (no temporal context for 1 frame),
  skip per-class thresholds (the whole point is to bypass them)
- Áp dụng filter: viewport center, MAX_BBOX_AREA_RATIO
- Emit highest-conf detection as fresh DETECTION_FOUND (reuses frame_index)
- Stay paused — user reviews + decides
- Empty result: emit `RECHECK_EMPTY` event

Clamp conf 0.2-0.6 ở WS layer để tránh flood FP nếu user gửi 0.05.

### Frontend
- `frontend/lib/ws-client.ts`: 2 new `ClientAction` (`ACTION_REPORT_FALSE_POSITIVE`,
  `ACTION_RECHECK`) + event type `RECHECK_EMPTY`. `ACTION_CONFIRM` reused for
  quick confirm.
- `frontend/context/AnalysisContext.tsx`: methods `quickConfirm()`, `reportFalsePositive()`,
  `recheck(conf?)`. Each updates session detection status accordingly.
- `frontend/app/workspace/page.tsx`: DetectionBar (under video) + right-panel
  "AI phát hiện bất thường" both updated với layout mới.

---

## UI iteration — 2 vòng sửa sau "xấu quá"

### V1 (failed)
5 text buttons cùng hàng / 2×2 grid. Text dài, button bị nén, "Xác nhận luôn"
wrap 2 dòng. Visual hierarchy lẫn — 5 button cùng size, mắt không biết focus đâu.

### V2 (failed)
Icon buttons cho 3 action phụ — đúng hướng nhưng wrap-Box parent ở right panel
dùng `flex direction: row` mặc định → 2 box (CTA + icon row) bị xếp ngang →
"Xác nhận luôn" vẫn nén.

### V3 (final)
- Parent: `flexDirection: 'column'` để 2 row stack đúng vertical
- Row 1: 2 primary CTA fullWidth (Giải thích cam, Xác nhận luôn xanh) cùng icon
- Row 2: 3 icon button center-aligned (RefreshCw / Flag / X) với MUI Tooltip
- DetectionBar dưới video: cùng pattern, có `<Box>` divider 1px giữa primary
  và secondary actions

Final visual hierarchy:
- **Primary** (must-do choices): 2 CTA to, có shadow, fullWidth
- **Divider**: vạch dọc 1px tách primary với secondary
- **Secondary** (advanced tools): 3 icon-only, có Tooltip giải thích

---

## Bugs gặp + cách fix

### Bug 1: FP cache stale sau khi xóa DB
**Hiện tượng**: Xóa FP table xong, session đang mở vẫn auto-skip detection.
**Nguyên nhân**: `sess["false_positives"]` được cache ở RAM WS connect, không
re-load tự động khi DB thay đổi.
**Fix**: Document — reload FE để tạo WS session mới → BE load lại FP. Không tự
sync DB→cache vì cost cao mà ít khi user xóa giữa session.

### Bug 2: FP full-frame bbox over-aggressive filtering
**Hiện tượng**: User "Báo sai" cho 1 detection có bbox phủ ~98% frame (whole-frame
HP gastritis). Sau đó MỌI detection "Viêm dạ dày HP" với bbox bất kỳ đều auto-skip
vì IoU > 0.6 với entry full-frame đó.
**Cách hiện tại**: Pipeline đã có `MAX_BBOX_AREA_RATIO = 0.95` filter trước khi
emit detection, nhưng KHÔNG filter ở save_false_positive. User vẫn báo sai được
cho bbox dù lớn cỡ nào.
**Fix tạm**: Xóa entry full-frame thủ công khi gặp.
**Fix dài hạn** (chưa làm — listed unresolved): refuse save_false_positive nếu
bbox area > 70% frame, hoặc shrink bbox về kích thước trung tâm hợp lý.

### Bug 3: Layout xấu — flex direction default row
**Hiện tượng**: 2 row buttons bị xếp ngang thay vì dọc.
**Nguyên nhân**: Parent `<Box>` chỉ có `display: 'flex', gap: 1` — không set
direction, default row.
**Fix**: Thêm `flexDirection: 'column'`.

### Bug 4: SSH tunnel forget
**Hiện tượng**: User chạy `make be` trên SSH OK nhưng FE báo "Backend offline".
**Nguyên nhân**: BE listen ở remote `10.8.0.7:8001`, FE point `localhost:8001`,
local không có tunnel forward.
**Fix**: Document workflow 3 terminal — BE remote / `make tunnel` local / FE local.

---

## Testing

### Backend verification
1. Click "Báo sai" → log "False-positive persisted: <label> bbox=[..]" → DB
   `false_positives` có entry mới ✅
2. Session sau cùng label + bbox tương tự → log "Auto-skip false-positive" →
   detection KHÔNG forward FE ✅
3. Click "Kiểm tra lại" → log "[Worker] RECHECK frame N at conf=0.40" → emit
   detection mới (hoặc RECHECK_EMPTY) ✅
4. Click "Xác nhận luôn" → status="confirmed", resume pipeline, không gọi LLM ✅

### DB inspection
```bash
ssh emie@10.8.0.7 "cd ~/DATN_ver0/src/backend/api && python3 -c \"
import sys; sys.path.insert(0,'.')
from db import _connect
with _connect() as c:
    for r in c.execute('SELECT id, label, bbox_x1, bbox_y1, bbox_x2, bbox_y2 FROM false_positives'):
        print(r)
\""
```

Đã verify 3 FP entries được save trong test (session `b4c86d1e1145`) — sau đó
xóa cho clean trạng thái pre-merge.

---

## File touched

```
src/backend/api/db.py                       (+~80 lines: FP table + 4 helpers)
src/backend/api/endoscopy_ws_server.py      (+~70 lines: load FP, filter, 2 action handlers)
src/backend/pipeline/pipeline_controller.py (+~80 lines: _last_paused_frame snapshot + RECHECK handler)
frontend/lib/ws-client.ts                   (+10 lines: 2 actions + RECHECK_EMPTY event)
frontend/context/AnalysisContext.tsx        (+~40 lines: quickConfirm, reportFalsePositive, recheck)
frontend/app/workspace/page.tsx             (+~80 lines: 2 redesign rounds for DetectionBar + right panel)
```

---

## Unresolved questions / future work

1. **FP full-frame bbox guard chưa implement**. Tạm phải xóa thủ công khi gặp.
   Nên thêm check `bbox_area / frame_area < 0.7` trong `save_false_positive` handler.
2. **RECHECK trên empty result**: BE emit `RECHECK_EMPTY` event, FE chưa render
   toast/notification. User không biết có sự kiện gì xảy ra — chỉ thấy detection
   cũ giữ nguyên. Cần thêm UI feedback.
3. **FP cache invalidation**: hiện cần reload FE để pickup. Có thể thêm
   `ACTION_REFRESH_FP_LIST` để force reload từ FE → BE.
4. **FP DELETE UI**: hiện chỉ có cách xóa qua python script SSH. Nên thêm tab
   "Quản lý case sai" trong Settings để bác sĩ tự manage list.
5. **Per-user FP** (multi-tenant): hiện tất cả user share 1 FP list. Khi multi
   tenant cần thêm `user_id` column.

---

## Bước tiếp theo

1. Tạo PR `006-detection-actions` → main
2. User test thêm 3-5 phiên với 3 action mới trước khi merge
3. (Optional) Fix unresolved #1 (full-frame guard) trước merge nếu thấy đáng
4. Sau merge → quay lại Phase B (session summary + Q&A chatbot)
