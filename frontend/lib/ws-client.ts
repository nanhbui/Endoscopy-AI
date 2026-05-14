/**
 * ws-client.ts — Typed WebSocket wrapper for the endoscopy analysis server.
 *
 * Connects to: ws://localhost:8001/ws/analysis/{videoId}
 * Upload via:  POST http://localhost:8001/upload
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8001";
export const WS_BASE  = API_BASE.replace(/^http/, "ws");

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
  };
  frame_b64?: string;
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
}

export type ServerEvent =
  | { event: "DETECTION_FOUND";    data: DetectionData }
  | { event: "STATE_CHANGE";       data: { state: string } }
  | { event: "LLM_CHUNK";          data: { chunk: string } }
  | { event: "LLM_DONE";           data: Record<string, never> }
  | { event: "LESION_REPORT_DONE"; data: { frame_index: number; report: LesionReport } }
  | { event: "RECHECK_EMPTY";      data: { conf: number; error?: string } }
  | { event: "VIDEO_FINISHED";     data: { detections: DetectionData[] } }
  | { event: "ERROR";              data: { message: string } };

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
  | { action: "ACTION_RECHECK"; payload?: { conf?: number } };

// ── Video library types ───────────────────────────────────────────────────────

export interface LibraryVideo {
  library_id: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
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

export async function listLibraryVideos(): Promise<LibraryVideo[]> {
  const res = await fetch(`${API_BASE}/library`);
  if (!res.ok) throw new Error(`Library fetch failed: ${res.statusText}`);
  const data = await res.json() as { videos: LibraryVideo[] };
  return data.videos;
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
