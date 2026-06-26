/**
 * ws-client.ts — Typed WebSocket wrapper for the endoscopy analysis server.
 *
 * Connects to: ws://localhost:8001/ws/analysis/{videoId}
 * Upload via:  POST http://localhost:8001/upload
 */

// Backend base URL. If NEXT_PUBLIC_API_BASE is baked at build time, use it.
// Otherwise (the portable default) derive it from the page's host with the
// backend on NEXT_PUBLIC_API_PORT (default 8003) — so ONE published image works
// on ANY single-host deploy (backend + frontend on the same server, different
// ports). Override the port via the NEXT_PUBLIC_API_PORT build-arg.
const API_PORT = process.env.NEXT_PUBLIC_API_PORT || "8003";
function resolveApiBase(): string {
  const explicit = process.env.NEXT_PUBLIC_API_BASE;
  if (explicit) return explicit;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  }
  return `http://localhost:${API_PORT}`; // SSR fallback — the client re-resolves in the browser
}

export const API_BASE = resolveApiBase();
// ws:// or wss:// tracks the page's http/https automatically.
export const WS_BASE = API_BASE.replace(/^http/, "ws");

// Skip ngrok's browser-warning interstitial for fetch + XHR when API goes via ngrok.
if (typeof window !== "undefined" && API_BASE.includes("ngrok") && !(window as unknown as { __NGROK_PATCHED__?: boolean }).__NGROK_PATCHED__) {
  (window as unknown as { __NGROK_PATCHED__?: boolean }).__NGROK_PATCHED__ = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("ngrok-skip-browser-warning", "1");
    return origFetch(input, { ...init, headers });
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    (origOpen as (...a: unknown[]) => void).apply(this, args);
    try { this.setRequestHeader("ngrok-skip-browser-warning", "1"); } catch { /* state may not allow */ }
  } as typeof XMLHttpRequest.prototype.open;
}

// ── Inbound event types (server → client) ────────────────────────────────────

export interface DetectionData {
  frame_index: number;
  timestamp_ms: number;
  lesion: {
    label: string;
    confidence: number;
    bbox: [number, number, number, number];
    /** bbox in VIEWPORT-relative percentages (0-100), aligned with the yellow
     *  reference rectangle that backend draws on frame_b64. Used for the styled
     *  overlay on the cropped thumbnail. */
    bbox_thumb?: { x: number; y: number; width: number; height: number };
    /** StrongSORT track id, stable per-lesion within a session.
     *  `-1` = recheck-origin detection (no temporal context — not auto-trackable). */
    track_id?: number;
  };
  frame_b64?: string;
}

// Phase 3 — guideline citation shape (Phase 2 persists these into report/summary JSON).
export interface Citation {
  label: string;
  source_guideline?: string;
  year?: number;
}

// Structured lesion report (Phase A) — 3-section bilingual VN+EN format.
// Backend sends this as a single LESION_REPORT_DONE event after the LLM
// finishes; no chunk streaming for JSON-schema responses.
export interface LesionReport {
  technique: { method: string; device: string; timestamp: string };
  description: {
    size_mm: string; paris_class: string; surface: string; color: string;
    margin: string; vascular: string; fluid: string;
  };
  conclusion: {
    primary_dx: string;
    severity: "thấp" | "trung bình" | "cao";
    differential: { dx: string; probability_pct: number }[];
    recommendations: string[];
    ai_confidence: number;
  };
  /** Phase 3 — optional guideline citations from Phase-2 grounding. */
  citations?: Citation[];
  /** "Báo sai phân tích" — doctor's manual rewrite of the AI analysis. When set,
   *  it's shown instead of the structured card and sent verbatim to the summary. */
  edited_text?: string;
  /** "Báo sai phân tích" — doctor removed the (wrong) AI analysis. The lesion is
   *  still a real finding (counted) but carries no detailed analysis. */
  analysis_cleared?: boolean;
}

// Session summary (Phase B) — emitted once when VIDEO_FINISHED fires.
// Mirrors SESSION_SUMMARY_SCHEMA in src/backend/api/summary_prompts.py.
export interface SessionSummary {
  overview: {
    total_findings: number;
    duration_seconds: number;
    confirmed_count: number;
    ignored_count: number;
  };
  priority_findings: {
    frame_index: number;
    severity: "thấp" | "trung bình" | "cao";
    primary_dx: string;
    rationale: string;
  }[];
  patterns: string[];
  checklist: {
    category: "sinh_thiet" | "test" | "dieu_tri" | "tai_kham";
    action: string;
  }[];
  overall_risk: "thấp" | "trung bình" | "cao";
  /** Phase 3 — optional guideline citations from Phase-2 grounding. */
  citations?: Citation[];
}

export type ServerEvent =
  | { event: "DETECTION_FOUND";       data: DetectionData }
  // Phase 02 — silent thumbnail capture for tracks marked "Xác nhận luôn".
  // Same shape as DETECTION_FOUND but pipeline does NOT pause; FE appends
  // to the captures side panel instead of opening DetectionBar.
  | { event: "CONFIRMED_CAPTURE";     data: DetectionData }
  | { event: "STATE_CHANGE";          data: { state: string } }
  | { event: "LLM_CHUNK";             data: { chunk: string } }
  | { event: "LLM_DONE";              data: Record<string, never> }
  | { event: "LESION_REPORT_DONE";    data: { frame_index: number; report: LesionReport } }
  | { event: "RECHECK_EMPTY";         data: { conf: number; error?: string } }
  // Phase 03 — recheck returns ALL bboxes (not just top-1) for the zoom modal.
  // `boxes` is sorted desc by confidence, capped at 10. `frame_b64_full` is the
  // downscaled paused frame (≤1280 wide, JPEG q70). Legacy DETECTION_FOUND
  // with top-1 is still emitted alongside for back-compat with older FE.
  | { event: "RECHECK_RESULT";        data: {
      frame_index: number;
      timestamp_ms: number;
      frame_b64_full?: string;
      conf: number;
      boxes: { label: string; confidence: number; bbox: [number, number, number, number] }[];
    } }
  | { event: "VIDEO_FINISHED";        data: { detections: DetectionData[] } }
  // Phase B — session summary + Q&A chatbot events:
  | { event: "SESSION_SUMMARY_DONE";  data: { summary: SessionSummary | null; reason?: string } }
  | { event: "SESSION_QA_USER_SAVED"; data: { text: string } }
  | { event: "SESSION_QA_CHUNK";      data: { chunk: string } }
  | { event: "SESSION_QA_DONE";       data: Record<string, never> }
  | { event: "SESSION_QA_REPLAY";     data: { messages: { role: "user" | "assistant"; content: string; ts: number }[] } }
  // Phase C1 — ERROR now carries machine-readable `code` + which feature
  // surface it came from. Frontend picks UI based on code/context.
  | { event: "ERROR";                 data: {
      message: string;
      code?: string;       // LLM_TIMEOUT | LLM_UNAVAILABLE | LLM_CRASHED | LLM_BAD_JSON | LLM_ERROR
      context?: string;    // lesion_report | session_summary | session_qa
      frame_index?: number;
    } };

// ── Outbound action types (client → server) ───────────────────────────────────

export type ClientAction =
  | { action: "ACTION_IGNORE" }
  | { action: "ACTION_EXPLAIN" }
  | { action: "ACTION_RESUME" }
  | { action: "ACTION_CONFIRM" }
  | { action: "ACTION_FOLLOW_UP"; payload: { text: string } }
  // Phase D — three new doctor actions:
  //   REPORT_FALSE_POSITIVE: mark this detection as wrong AND persist so future
  //     sessions auto-skip the same (label + bbox region).
  //   RECHECK: re-run YOLO on the paused frame at a lower confidence threshold.
  //     New finding arrives as a fresh DETECTION_FOUND, or RECHECK_EMPTY if none.
  //   (Quick-confirm reuses ACTION_CONFIRM — we just expose the button pre-LLM.)
  | { action: "ACTION_REPORT_FALSE_POSITIVE" }
  | { action: "ACTION_RECHECK"; payload?: { conf?: number } }
  // Phase 02 — track-id-based auto-handling. Once registered, subsequent
  // frames carrying that track id either auto-capture (confirm-luôn) or
  // are dropped silently (mute), without further DetectionBar pauses.
  | { action: "ACTION_CONFIRM_TRACK"; payload: { track_id: number } }
  | { action: "ACTION_MUTE_TRACK";    payload: { track_id: number } }
  // Phase B — session-level Q&A (distinct from per-detection ACTION_FOLLOW_UP).
  | { action: "ACTION_SESSION_QA"; payload: { text: string } };

// ── Video library types ───────────────────────────────────────────────────────

export interface LibraryVideo {
  library_id: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  /** Set to "live_recording" for videos recorded from a live (Trực tiếp) session. */
  source?: string;
  session_id?: string;
  recorded_at?: string;
  duration_ms?: number;
}

export interface LibraryUploadResult {
  library_id: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  duplicate: boolean;
}

// ── Upload / connect helpers ──────────────────────────────────────────────────

/**
 * Register a live source (RTSP URL or device path) with the server.
 * Returns a video_id that can be used to open a WebSocket session.
 */
export async function connectLiveStream(source: string): Promise<{ video_id: string }> {
  const res = await fetch(`${API_BASE}/stream/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) throw new Error(`Stream connect failed: ${res.statusText}`);
  return res.json() as Promise<{ video_id: string }>;
}

/**
 * Upload a video file with optional progress callback (0–100).
 * Uses XHR so we get real upload progress events.
 */
export function uploadVideo(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ video_id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid JSON response"));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload network error"));

    // Send raw binary — avoids python-multipart size limits
    const params = new URLSearchParams({ filename: file.name });
    xhr.open("POST", `${API_BASE}/upload?${params}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.send(file);
  });
}

// ── Video library API helpers ─────────────────────────────────────────────────

export async function listLibraryVideos(source?: string): Promise<LibraryVideo[]> {
  const qs = source ? `?${new URLSearchParams({ source }).toString()}` : "";
  const res = await fetch(`${API_BASE}/library${qs}`);
  if (!res.ok) throw new Error(`Library fetch failed: ${res.statusText}`);
  const data = await res.json() as { videos: LibraryVideo[] };
  return data.videos;
}

/** Direct stream URL for inline replay of a library video (recordings UI). */
export function libraryVideoUrl(libraryId: string): string {
  return `${API_BASE}/library/${libraryId}/video`;
}

/**
 * Upload a finished live-session recording (webm Blob) to the library, tagged
 * with source=live_recording so it shows under "Bản ghi trực tiếp".
 */
export function uploadRecording(
  blob: Blob,
  filename: string,
  opts: { sessionId?: string; durationMs?: number; onProgress?: (pct: number) => void } = {},
): Promise<LibraryUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Invalid JSON response")); }
      } else {
        reject(Object.assign(new Error(`Upload failed: ${xhr.statusText}`), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    const params = new URLSearchParams({ filename, source: "live_recording" });
    if (opts.sessionId) params.set("session_id", opts.sessionId);
    if (opts.durationMs && opts.durationMs > 0) params.set("duration_ms", String(Math.round(opts.durationMs)));
    xhr.open("POST", `${API_BASE}/library/upload?${params.toString()}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.send(blob);
  });
}

export function uploadToLibrary(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<LibraryUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Invalid JSON response")); }
      } else {
        reject(Object.assign(new Error(`Upload failed: ${xhr.statusText}`), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    const params = new URLSearchParams({ filename: file.name });
    xhr.open("POST", `${API_BASE}/library/upload?${params}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.send(file);
  });
}

export async function selectLibraryVideo(libraryId: string): Promise<{ video_id: string }> {
  const res = await fetch(`${API_BASE}/sessions/from-library/${libraryId}`, { method: "POST" });
  if (!res.ok) throw new Error(`Session create failed: ${res.statusText}`);
  return res.json() as Promise<{ video_id: string }>;
}

export async function deleteLibraryVideo(libraryId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/library/${libraryId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = Object.assign(new Error(`Delete failed: ${res.statusText}`), { status: res.status });
    throw err;
  }
}

// ── DB-backed session history (Report page durability) ────────────────────────

export interface DbSessionRow {
  session_id: string;
  started_at: number;       // unix ms
  detections: { frame_index: number; label: string; severity: string; report: LesionReport | null }[];
  summary: SessionSummary | null;
}

/** Fetch the persisted session list from the backend DB. Returns [] on failure
 *  so the Report page falls back gracefully to its localStorage list. */
export async function listDbSessions(): Promise<DbSessionRow[]> {
  try {
    const res = await fetch(`${API_BASE}/sessions`);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.sessions) ? (j.sessions as DbSessionRow[]) : [];
  } catch {
    return [];
  }
}

/** Fetch a single session's persisted AI summary from the DB. Used by the Report
 *  page to recover a summary that finished generating AFTER the user left the
 *  workspace mid-generation — the WS push (SESSION_SUMMARY_DONE) was lost, but
 *  the backend saves the summary to the DB before sending it, so it's here.
 *  Returns null when not (yet) available or on any error. */
export async function fetchSessionSummary(sessionId: string): Promise<SessionSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/session/${sessionId}/summary`);
    if (!res.ok) return null;
    const j = await res.json();
    return (j.summary ?? null) as SessionSummary | null;
  } catch {
    return null;
  }
}

/** Delete a session's durable DB rows (reports, summary, Q&A). Returns true on
 *  success. Logs a warning on failure (e.g. backend not restarted with the
 *  DELETE endpoint) — otherwise the session silently reappears on reload. */
export async function deleteDbSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: "DELETE" });
    if (!res.ok) {
      console.warn(`[deleteDbSession] ${res.status} ${res.statusText} — DB row not deleted (restart backend?)`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[deleteDbSession] request failed:", e);
    return false;
  }
}

// ── EndoscopyWsClient ─────────────────────────────────────────────────────────

export class EndoscopyWsClient {
  private ws: WebSocket | null = null;
  private readonly videoId: string;
  onMessage: (evt: ServerEvent) => void = () => {};
  onClose: () => void = () => {};

  constructor(videoId: string) {
    this.videoId = videoId;
  }

  connect(): void {
    const url = `${WS_BASE}/ws/analysis/${this.videoId}`;
    this.ws = new WebSocket(url);

    this.ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as ServerEvent;
        this.onMessage(evt);
      } catch { /* ignore malformed frames */ }
    };

    this.ws.onclose = () => this.onClose();
    this.ws.onerror = (e) => console.warn("[WS] connection error", (e as ErrorEvent).message ?? "no detail");
  }

  send(action: ClientAction): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(action));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
