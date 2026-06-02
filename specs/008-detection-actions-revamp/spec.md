# Spec 008 — Detection Actions Revamp

**Status:** implemented (3 PRs)
**Branch trail:** `feat/detection-revamp-be` (PR #27) → `feat/detection-revamp-fe-state` (PR #28) → `feat/detection-revamp-zoom`

## Problem

The 5-button DetectionBar overlay paused the video on every YOLO detection — even when the doctor had already validated the lesion seconds earlier. Three buttons were also broken or weak in practice:

| Button | Old behaviour | Pain point |
|---|---|---|
| Xác nhận luôn | confirm + resume; next frame re-pauses on same lesion | spammy — doctor confirms same lesion 20× |
| Kiểm tra lại | re-run YOLO at lower threshold, emit top-1 only | only 1 box returned; broken end-to-end on some videos |
| Bỏ qua | session ignore (no real effect) | indistinguishable from "do nothing"; redundant |

## Solution — per-track session state + zoom inspect modal

1. **track_id propagation.** StrongSORT (already integrated via boxmot) now ships its stable per-lesion id in `DETECTION_FOUND.data.lesion.track_id`. Recheck-origin detections use `-1` as a manual-only sentinel.
2. **"Xác nhận luôn" → register track + auto-capture.** Worker keeps a `confirmed_track_ids: set[int]` per session. Subsequent frames carrying a confirmed id emit `CONFIRMED_CAPTURE` (silent, no pause) at 2 s cadence per track id. FE appends these to a "Đã xác nhận" thumbnail grid under the video; click-to-seek.
3. **"Bỏ qua" → register track + drop silently.** Symmetric `muted_track_ids: set[int]`. Worker fully drops further frames for those ids — no events, no pause, no capture.
4. **"Kiểm tra lại" → multi-bbox zoom inspect modal.** Worker re-runs YOLO at lower confidence and emits a new `RECHECK_RESULT` event carrying ALL bboxes (cap 10) + downscaled full-frame JPEG. FE opens a 2-pane modal: full frame with all bboxes overlaid (focused yellow, others blue), 3× zoom crop of focused bbox, ±5 s timeline scrubber (click-to-seek workspace video). MVP scope is visual inspection only; decisions return to the underlying DetectionBar.

## Behaviour matrix

| Action | Pause again on same lesion? | Capture to side panel? | Persist DB? | Use case |
|---|---|---|---|---|
| Xác nhận luôn | ✗ (silent auto-capture) | ✓ every 2 s | session only | "đúng rồi, đừng hỏi nữa, vẫn ghi nhận" |
| Bỏ qua | ✗ (silent drop) | ✗ | session only | "không quan trọng, đừng spam" |
| Báo sai | (BE skips region) | ✗ | **cross-session DB** | "sai thật — đừng detect video sau" |
| Giải thích | đợi LLM | ✓ (post-confirm) | depends | "cần phân tích sâu rồi mới quyết" |
| Kiểm tra lại | (open modal) | ✗ | — | "soi kỹ tổn thương + xem AI có miss gì không" |

## Wire protocol additions

```
Server → Client (new events)
  CONFIRMED_CAPTURE { ...DetectionData }    # same shape as DETECTION_FOUND
  RECHECK_RESULT    {
    frame_index, timestamp_ms, conf,
    frame_b64_full,                          # JPEG ≤1280 wide, q70
    boxes: [{ label, confidence, bbox: [x1,y1,x2,y2] }]   # cap 10
  }

Client → Server (new actions)
  ACTION_CONFIRM_TRACK { track_id: int }     # treated as ACTION_CONFIRM + register
  ACTION_MUTE_TRACK    { track_id: int }     # treated as ACTION_IGNORE + register
```

Lesion payload extended with `track_id: int` (`-1` = recheck-origin, no temporal context). Existing `DETECTION_FOUND` for recheck path still emitted alongside `RECHECK_RESULT` for back-compat — old FE handlers keep working.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ENDOSCOPY_CAPTURE_INTERVAL_MS` | `2000` | minimum gap between silent captures per track id |

Capture list capped at 200 per session in FE (`captures.slice(-200)`); `frame_b64` stripped before localStorage write.

## Files touched

**BE**
- `src/backend/pipeline/pipeline_controller.py` — worker state + cmd-drain + skip/capture + recheck refactor + prune
- `src/backend/api/endoscopy_ws_server.py` — `ACTION_CONFIRM_TRACK` / `ACTION_MUTE_TRACK` handlers

**FE**
- `frontend/lib/ws-client.ts` — event/action types + DetectionData.track_id
- `frontend/context/AnalysisContext.tsx` — Session state, handlers, actions, modal flags, capture sanitisation on save
- `frontend/components/confirmed-captures-panel.tsx` — new thumbnail grid component
- `frontend/components/zoom-inspect-modal.tsx` — new inspect modal
- `frontend/app/workspace/page.tsx` — handler memos, DetectionBar rewires, mount panel + modal

**Tests**
- `frontend/tests/detection-revamp.test.ts` — fallback logic + cadence + cap

## Out of scope (future work)

- Server-generated scrubber thumbnails for the modal (current MVP relies on the user-facing video element only).
- Modal action bar with 4 in-modal decision buttons targeting individual recheck bboxes (today decisions return to the underlying DetectionBar).
- Cross-session persistence of muted tracks (intentionally session-only).
- Live-stream behaviour (Case B from the design doc) — different mode where pausing for inspection isn't safe; deferred.