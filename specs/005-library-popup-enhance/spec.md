# Feature Specification: Video Source Popup Redesign

**Feature Branch**: `005-library-popup-enhance`
**Created**: 2026-05-11
**Status**: Draft
**Input**: User description: "enhance thư viện, tôi không thích cơ chế này lắm. tôi muốn nó là trang popup riêng. như kiểu khi nhấn Tải video lên để phân tích thì có một trang popup hiện ra bao gồm upload video mới hoặc sử dụng lại các video"

**Context**: The current `VideoSourceModal` (spec 003) is a side-by-side dialog (library left ~58%, upload right ~42%, height 80vh). The user finds this cramped and wants the popup to feel like a dedicated *page* — a single, fullscreen-feeling overlay with clearer hierarchy between "upload new video" and "pick from library". This spec redesigns the popup UX while preserving the existing backend contracts from specs 002 and 003.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Open Source Popup as a Page (Priority: P1)

A clinician on the workspace clicks the primary "Tải video lên để phân tích" trigger. A near-fullscreen popup opens that visually feels like a dedicated *page* — wide layout, generous padding, prominent heading "Chọn nguồn video", and a clear visual separation between the two paths: "Tải video mới" and "Chọn từ thư viện". The popup is dismissible (Escape, backdrop click, ×).

**Why this priority**: This is the entire point of the redesign — the user explicitly said "tôi muốn nó là trang popup riêng" (I want it to be a separate popup page). Without a layout that feels page-like, the redesign delivers nothing.

**Independent Test**: From the idle workspace, click the upload trigger → popup opens covering ≥90% of viewport width and ≥85% of viewport height, with both upload zone and library list comfortably visible without horizontal scroll.

**Acceptance Scenarios**:

1. **Given** the workspace is idle, **When** the user clicks the trigger, **Then** the popup opens centered with width ≥90vw, height ≥85vh on desktop (≥1280px wide).
2. **Given** the popup is open, **When** the user presses Escape OR clicks the backdrop OR clicks ×, **Then** the popup closes and the workspace returns to idle.
3. **Given** the popup is open, **Then** the heading "Chọn nguồn video" is visible at the top, with both sections labelled and visually grouped.

---

### User Story 2 — Library as Primary Surface, Upload as Secondary (Priority: P1)

The popup leads with the library list (the user's stated motivation: *enhance thư viện*), giving it the dominant visual area with rich cards (filename, duration if available, size, upload date, optional thumbnail placeholder). The "Tải video mới" zone is present but secondary — either a header strip or a side rail — so users instinctively look at existing videos first and only upload when needed.

**Why this priority**: The user's motivation is library *reuse*. The current modal gives library 58% but the upload section visually competes (drop zone is large, has a checkbox, has its own header). The redesign rebalances toward library-first.

**Independent Test**: Open the popup with at least 3 library videos → the library list dominates the visible area, each video shown as a card (not a tight row). The upload zone is present and clickable but visually subordinate.

**Acceptance Scenarios**:

1. **Given** the popup is open and the library has ≥1 video, **Then** library entries are rendered as cards (not dense rows) with name, size, upload date.
2. **Given** the popup is open, **Then** the "Tải video mới" zone occupies ≤30% of the popup body area, with the library list filling the rest.
3. **Given** the popup is open and the library is empty, **Then** an empty-state illustration plus prompt is shown in the library area, and the upload zone gains visual emphasis as the only available action.

---

### User Story 3 — One-Click Selection Closes Popup (Priority: P1)

Clicking any library video card OR completing a new upload closes the popup automatically and starts the analysis session — no extra confirmation step. Errors (unsupported file, upload failure, library load error) stay inside the popup and never close it.

**Why this priority**: The flow must be frictionless to justify the redesign. Any extra confirm step undoes the UX win.

**Independent Test**: Click a library card → popup closes, session begins. Drop a video file → after upload completes, popup closes, session begins. Drop a non-video file → popup stays open with inline error.

**Acceptance Scenarios**:

1. **Given** the popup is open and the library has videos, **When** the user clicks a library card, **Then** the popup closes immediately and the session starts using that video.
2. **Given** the popup is open, **When** the user completes a successful new upload, **Then** the popup closes automatically and the session starts.
3. **Given** the popup is open, **When** an upload fails or an unsupported file is selected, **Then** the popup stays open and an inline error appears in the upload zone.

---

### User Story 4 — Library Search and Filter (Priority: P2)

When the library has more than ~6 videos, a search box at the top of the library section lets the user filter by filename. A simple sort control (newest / oldest / name / size) is also available. No backend changes — filtering and sorting happen on the already-loaded list.

**Why this priority**: The current modal lists everything as a scroll. Once the library has 20+ videos, scanning by eye becomes painful. Search is the obvious enhancement requested implicitly by "enhance thư viện".

**Independent Test**: With ≥10 library videos, type in the search box → list filters in real time. Toggle sort to "size descending" → largest video appears first.

**Acceptance Scenarios**:

1. **Given** the popup is open with ≥6 library videos, **Then** a search input and sort control are visible above the list.
2. **Given** the search input has text, **When** the user types, **Then** only videos whose filename matches are shown (case-insensitive substring match).
3. **Given** the user changes the sort dropdown, **Then** the list reorders without re-fetching from the server.

---

### User Story 5 — Save-to-Library Toggle Inline with Upload (Priority: P2)

The "Lưu vào thư viện" choice from the current modal is preserved but moves to a more obvious position directly under the drop zone, with explanatory helper text. When checked, a successful upload appears in the library list immediately on next popup open.

**Why this priority**: Existing functionality from spec 003 US4 must continue to work; this spec only refines its placement and labeling.

**Independent Test**: Check "Lưu vào thư viện" → upload a video → popup closes → reopen popup → uploaded video is in the library list.

**Acceptance Scenarios**:

1. **Given** the popup is open, **Then** the "Lưu vào thư viện" toggle is visible directly beneath the upload drop zone with helper text explaining the persistence behavior.
2. **Given** "Lưu vào thư viện" is checked, **When** the user uploads a video, **Then** the video is saved permanently AND used for the current session.
3. **Given** "Lưu vào thư viện" is checked AND the uploaded file is a duplicate, **Then** an inline notification informs the user the existing entry is reused, then the popup closes and the session starts.

---

### User Story 6 — Delete Library Entry from Popup (Priority: P3)

Each library card shows a small delete icon on hover. Clicking it asks for confirmation, then removes the video from the library (calls existing DELETE endpoint from spec 002). The deleted card disappears from the list immediately.

**Why this priority**: Library hygiene was P3 in spec 002 and remains P3 here. It's available but never gets in the way.

**Independent Test**: Hover a library card → delete icon appears. Click delete → confirm dialog. Confirm → card removed from list, server reflects deletion.

**Acceptance Scenarios**:

1. **Given** a library card is shown, **When** the user hovers over it, **Then** a delete icon (trash) appears in the corner.
2. **Given** the user clicks the delete icon, **Then** a confirmation dialog asks "Xóa video này khỏi thư viện?"
3. **Given** the deletion is confirmed AND the video is not in use by any session, **Then** the video is removed from the list and from server storage.
4. **Given** the deletion is confirmed AND the video IS in use by an active session, **Then** the deletion is blocked with an inline message ("Video đang được sử dụng, không thể xóa") and the card remains.

---

### Edge Cases

- **Library fetch fails on popup open**: Library section shows inline error with retry button; upload section remains fully functional.
- **Library is loading slowly**: Library section shows skeleton cards or spinner; upload section is already usable.
- **Popup opened during an active session**: The trigger button is disabled/hidden while a session is active (carried over from spec 003 FR-009). This spec does NOT add a "switch source mid-session" capability.
- **Very large library (100+ videos)**: Search makes scanning practical; the list virtualizes or paginates if rendering performance degrades. Initial fetch returns all metadata in one call (no server-side pagination introduced by this spec).
- **User starts upload then dismisses popup**: Upload is cancelled (HTTP request aborted), workspace stays idle. Same as spec 003 edge case.
- **User clicks library card while an upload-in-progress is happening (their own)**: The upload-in-progress blocks library clicks until it finishes or is cancelled — only one source action active at a time.
- **Mobile / narrow screen (<768px wide)**: Layout collapses to a single column with library list on top, upload zone below; popup occupies 100vw × 100vh. Save-to-library checkbox stays visible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workspace MUST keep a single trigger ("Tải video lên để phân tích") that opens this redesigned popup. The trigger replaces the current `VideoSourceModal` invocation; no new top-level entry point is added.
- **FR-002**: The popup MUST render at ≥90vw × ≥85vh on desktop screens (≥1280px wide), giving it a "page" feel rather than a small dialog.
- **FR-003**: The popup MUST display a clear top heading "Chọn nguồn video" and visually distinct sections labelled "Chọn từ thư viện" and "Tải video mới".
- **FR-004**: The library section MUST be the primary visual surface — at least 65% of the popup body area on desktop.
- **FR-005**: The library MUST render entries as cards (not tight rows) showing filename, file size, and upload date at minimum. Duration and thumbnail are optional and out of scope if backend data not available.
- **FR-006**: The popup MUST close automatically when an analysis session is successfully started (library card click OR upload completion).
- **FR-007**: The popup MUST stay open when an error occurs (unsupported file, upload failure, library load failure) and surface the error inline within the relevant section.
- **FR-008**: The popup MUST be dismissible via Escape key, backdrop click, or × button — except while a new upload is in progress (uploads block dismiss to prevent accidental cancellation; user must cancel explicitly).
- **FR-009**: When the library has ≥6 entries, the popup MUST provide a search input that filters the list client-side by filename (case-insensitive substring match).
- **FR-010**: When the library has ≥6 entries, the popup MUST provide a sort control with options "Mới nhất / Cũ nhất / Tên A-Z / Dung lượng giảm dần".
- **FR-011**: The "Lưu vào thư viện" toggle MUST be present directly below the upload zone with helper text. When checked, uploads use `POST /library/upload`; when unchecked, uploads use the ephemeral path. Behavior matches spec 002 FR-004 and spec 003 US4.
- **FR-012**: Each library card MUST expose a delete affordance (icon visible on hover or focus). Clicking it MUST require an explicit confirmation before calling the existing DELETE library endpoint.
- **FR-013**: The popup trigger MUST remain disabled/hidden while an analysis session is active (carried from spec 003 FR-009). This spec does not change session lifecycle.
- **FR-014**: All Vietnamese copy in the popup MUST be consistent with existing application tone — formal but friendly. Reuse existing strings where they exist.
- **FR-015**: Mobile / narrow viewports (<768px) MUST collapse the popup to a single-column layout (library on top, upload below) at 100vw × 100vh. No separate mobile component is built — same component, responsive layout.
- **FR-016**: This spec MUST NOT introduce backend changes. All network calls (`GET /library`, `POST /library/upload`, `POST /upload`, `DELETE /library/{id}`, `POST /sessions/from-library/{id}`) are reused as-is from specs 002 and 003.

### Key Entities

- **VideoSourcePopup** (replaces current `VideoSourceModal`): The redesigned overlay component with library-primary layout, search/sort, and inline upload. Reuses `VideoLibraryPanel` data-fetching logic but renders entries through a new card component.
- **LibraryCard**: A single video entry rendered as a card with filename, size, upload date, and a hover-revealed delete icon. Replaces the tight rows used by the current `VideoLibraryPanel`.
- **UploadDropZone**: The drop / click-to-pick zone for new uploads. Visually subordinate to the library section. Handles both ephemeral and library-saved upload paths via the "Lưu vào thư viện" toggle.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The popup body area dedicated to the library list is ≥65% of the popup body width on desktop screens (≥1280px). Measured by inspecting the rendered DOM.
- **SC-002**: From clicking the trigger to a usable popup (library list visible OR empty state shown) takes ≤1 second on the clinical network. Library fetch completes within 1.5 seconds for libraries with up to 100 entries.
- **SC-003**: With ≥10 library videos, a user can locate and start a previously-uploaded video in ≤3 actions (open popup → search/scan → click card). Measured by usability walkthrough with 3 typical users.
- **SC-004**: 100% of upload + library reuse flows that worked in spec 003's modal continue to work in the redesigned popup. Verified by running the existing manual test plan from spec 003 against the new component.
- **SC-005**: Mobile (375px wide) shows a usable popup — both library cards and upload zone fit on screen with vertical scroll only, no horizontal scroll.
- **SC-006**: Search filtering responds in <100ms for libraries with up to 200 entries (client-side filtering only).

## Assumptions

- The existing backend endpoints from specs 002 and 003 are sufficient — no new server-side capability is needed.
- The existing `VideoLibraryPanel` component will be replaced or significantly refactored; its callers (currently the modal in spec 003) will be updated to use the new popup. The standalone library page (if any) is out of scope for this spec.
- Thumbnails are out of scope — the backend does not currently produce thumbnails. If added later, library cards have a designated thumbnail slot but show a placeholder icon today.
- Duration is out of scope — backend metadata does not include duration. If added later, library cards have a designated duration slot.
- The "Trực tiếp" (live stream) source remains a separate workspace control unrelated to this popup, matching spec 003 FR-010.
- Mobile is supported for layout responsiveness only; touch gesture polish (long-press for delete, swipe to delete) is out of scope.
- Single-user/multi-tenant assumptions inherited from spec 002: all videos in the library are shared across users (no per-user library).
- This spec supersedes the layout decisions in spec 003 (FR-002 of 003: "two sections, both visible without scrolling") but preserves all functional requirements of 003 for upload flow, dismiss behavior, and active-session blocking.
