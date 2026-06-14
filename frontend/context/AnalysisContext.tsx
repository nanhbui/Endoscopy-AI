"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  API_BASE,
  EndoscopyWsClient,
  uploadVideo,
  connectLiveStream,
  selectLibraryVideo,
  type DetectionData,
  type ServerEvent,
  type LesionReport,
  type SessionSummary,
} from "@/lib/ws-client";

// Phase B — Q&A chat message shape (mirrors qa_messages SQLite rows).
export interface QaMessage {
  role: "user" | "assistant";
  content: string;
  /** Local timestamp ms. Used for ordering during streaming. */
  ts: number;
}

// Phase A bridge: render structured lesion report as markdown until the
// dedicated <LesionReportCard> component (task A4) lands. Keeps the existing
// ReactMarkdown render path in workspace alive.
function lesionReportToMarkdown(r: LesionReport): string {
  const sevEmoji = r.conclusion.severity === "cao" ? "🔴"
                 : r.conclusion.severity === "trung bình" ? "🟡" : "🟢";
  const diff = r.conclusion.differential
    .map((d) => `- ${d.dx} — **${d.probability_pct}%**`).join("\n");
  const recs = r.conclusion.recommendations.map((s) => `- ${s}`).join("\n");
  return [
    `### 🔬 Kỹ thuật`,
    `- **Phương pháp:** ${r.technique.method}`,
    `- **Thiết bị:** ${r.technique.device}`,
    `- **Thời điểm:** ${r.technique.timestamp}`,
    ``,
    `### 📋 Mô tả tổn thương`,
    `- **Kích thước:** ${r.description.size_mm}`,
    `- **Phân loại Paris:** ${r.description.paris_class}`,
    `- **Bề mặt:** ${r.description.surface}`,
    `- **Màu sắc:** ${r.description.color}`,
    `- **Bờ:** ${r.description.margin}`,
    `- **Mạch máu:** ${r.description.vascular}`,
    `- **Dịch:** ${r.description.fluid}`,
    ``,
    `### 🩺 Kết luận`,
    `**Chẩn đoán chính:** ${r.conclusion.primary_dx}`,
    ``,
    `**Mức độ:** ${sevEmoji} ${r.conclusion.severity}`,
    ``,
    `**Chẩn đoán phân biệt:**`,
    diff,
    ``,
    `**Khuyến nghị:**`,
    recs,
    ``,
    `*AI confidence: ${r.conclusion.ai_confidence}%*`,
  ].join("\n");
}

// ── Domain types ──────────────────────────────────────────────────────────────

/** Outcome of a detection after doctor interaction. */
export type DetectionStatus = "detected" | "ignored" | "confirmed" | "analyzed";

/** Detection as used internally by the context (mirrors DetectionData). */
export interface Detection {
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  timestamp: number;
  /** StrongSORT track id, stable per-lesion in current session.
   *  `-1` = recheck-origin (manual inspection, not auto-trackable).
   *  `undefined` = legacy detection from older BE. */
  trackId?: number;
  frame_b64?: string;
  /** Markdown rendering of the structured lesion report (legacy fallback +
   *  Phase A bridge). Kept for ReactMarkdown surfaces and history that
   *  predate <LesionReportCard>. */
  llmInsight?: string;
  /** Structured lesion report from backend LESION_REPORT_DONE event. When
   *  present, UI renders <LesionReportCard>; falls back to llmInsight markdown
   *  when only the legacy field exists. */
  lesionReport?: LesionReport;
  status?: DetectionStatus;
}

export type SessionSource = "upload" | "live" | "library";

/** Phase 02 — silent capture appended to side panel when a confirmed-luôn
 *  track is re-detected. Mirrors Detection but is session-only (not
 *  persisted) and click-to-seek via `timestamp`. */
export interface CapturedDetection {
  trackId: number;
  label: string;
  confidence: number;
  timestamp: number;       // seconds, same scale as Detection.timestamp
  bbox: { x: number; y: number; width: number; height: number };
  frame_b64?: string;      // dropped before localStorage write
}

/** Phase 03 — RECHECK_RESULT payload, consumed by zoom modal (Phase 05). */
export interface RecheckResultPayload {
  frameIndex: number;
  timestampSec: number;
  frameB64Full?: string;
  conf: number;
  boxes: { label: string; confidence: number; bbox: [number, number, number, number] }[];
}

/** A single analysis session — one video / live stream run. */
export interface Session {
  id: string;
  name: string;
  source: SessionSource;
  startedAt: number;
  detections: Detection[];
  videoId?: string;
  /** Phase B — populated when SESSION_SUMMARY_DONE arrives. */
  summary?: SessionSummary;
  /** Phase B — Q&A chat history (live ↔ persisted server-side). */
  qaMessages?: QaMessage[];
  /** Phase B — true while the LLM is streaming a Q&A response. */
  qaStreaming?: boolean;
  /** Phase 02 — StrongSORT track ids the doctor "Xác nhận luôn"-ed.
   *  Worker emits CONFIRMED_CAPTURE for these instead of pausing. */
  confirmedTrackIds?: number[];
  /** Phase 02 — track ids the doctor "Bỏ qua"-ed. Silent in worker. */
  mutedTrackIds?: number[];
  /** Phase 02 — captures appended on CONFIRMED_CAPTURE events. */
  captures?: CapturedDetection[];
}

export type PipelineState =
  | "IDLE"
  | "PLAYING"
  | "PAUSED_WAITING_INPUT"
  | "PROCESSING_LLM"
  | "EOS_SUMMARY";

interface AnalysisContextType {
  // ── connection state ──
  isConnected: boolean;
  pipelineState: PipelineState;
  videoId: string | null;

  // ── session state ──
  sessions: Session[];
  currentSessionId: string | null;

  // ── legacy UI compat props (alias to current session detections) ──
  isPlaying: boolean;
  currentDetection: Detection | null;
  detections: Detection[];
  /** Live LLM stream value lives in a SEPARATE context (useLlmStream) so the
   *  whole tree doesn't re-render on every streamed token. This stable ref
   *  mirrors it for logic that needs the current value without subscribing
   *  (e.g. the voice "UNKNOWN → follow-up" decision). */
  llmInsightRef: { readonly current: string };

  // ── actions ──
  uploadOnly: (file: File, onProgress?: (pct: number) => void) => Promise<void>;
  uploadAndConnect: (file: File, onProgress?: (pct: number) => void) => Promise<void>;
  connectLive: (source: string) => Promise<void>;
  prepareFromLibrary: (libraryId: string, name?: string) => Promise<string>;
  selectFromLibrary: (libraryId: string, name?: string) => Promise<void>;
  startMockAnalysis: () => void;
  /** Reset WS + pipeline state to IDLE while keeping videoId — allows re-running analysis on the same video. */
  resetPipeline: () => void;
  ignoreDetection: () => void;
  explainMore: () => void;
  followUpChat: (text: string) => void;
  /** Confirm detection as valid → resume pipeline. */
  confirmDetection: () => void;
  resumePlayback: () => void;
  /** Phase D — confirm pre-LLM (skip Giải thích, mark detection valid, resume). */
  quickConfirm: () => void;
  /** Phase D — flag this detection as persistent false positive in DB. */
  reportFalsePositive: () => void;
  /** Phase D — re-run YOLO on paused frame at lower conf (default 0.4). */
  recheck: (conf?: number) => void;
  /** Phase 02 — "Xác nhận luôn": register this track id so subsequent frames
   *  carrying it auto-capture (silent, 2s cadence) instead of pausing. */
  addConfirmedTrack: (trackId: number) => void;
  /** Phase 02 — "Bỏ qua": register this track id so subsequent frames carrying
   *  it are silently dropped (no events, no pause, no capture). */
  addMutedTrack: (trackId: number) => void;
  /** Phase 03 — last RECHECK_RESULT payload (consumed by zoom modal). */
  recheckResult: RecheckResultPayload | null;
  isRecheckModalOpen: boolean;
  openRecheckModal: () => void;
  closeRecheckModal: () => void;
  /** Phase 02 — remove a single capture from the current session's grid. */
  removeCapture: (timestamp: number) => void;
  /** Phase B — send a chat question. Uses WS streaming when available,
   *  HTTP fallback when WS closed (e.g. browsing /report page). Optional
   *  `sessionId` targets a specific session — default is currentSessionId. */
  sendSessionQA: (text: string, sessionId?: string) => void;
  /** Phase C1 — latest LLM/system error for UI surfacing. Cleared via dismissError(). */
  lastError: { message: string; code?: string; context?: string } | null;
  dismissError: () => void;
  setIsPlaying: (v: boolean) => void;
  addDetection: (d: Detection) => void;
  removeDetection: (timestamp: number) => void;
  resetAnalysis: () => void;
  /** Delete an entire session by id (from report history). */
  removeSession: (sessionId: string) => void;
  /** Clear all stored sessions. */
  clearSessions: () => void;
}

const AnalysisContext = createContext<AnalysisContextType | undefined>(undefined);

// High-frequency LLM stream state lives in its own context so that streaming a
// report token-by-token only re-renders the components that actually display it
// (DetectionBar + the insight panel), not every useAnalysis() consumer.
interface LlmStreamContextType {
  llmInsight: string;
  isListeningVoice: boolean;
}
const LlmStreamContext = createContext<LlmStreamContextType | undefined>(undefined);

// ── helpers ───────────────────────────────────────────────────────────────────

const FRAME_W = 1920;
const FRAME_H = 1080;

const STORAGE_KEY = "gastroeye:sessions:v1";
const MAX_SESSIONS = 10;

// Demo/offline mock is OFF by default so fabricated detections + LLM text never
// leak into real sessions (and persisted history). Enable explicitly with
// NEXT_PUBLIC_ENABLE_MOCK=1 only for UI demos without a backend.
const MOCK_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MOCK === "1";

function toDetection(d: DetectionData): Detection {
  const [x1, y1, x2, y2] = d.lesion.bbox;
  return {
    label: d.lesion.label,
    confidence: d.lesion.confidence,
    bbox: {
      x: (x1 / FRAME_W) * 100,
      y: (y1 / FRAME_H) * 100,
      width: ((x2 - x1) / FRAME_W) * 100,
      height: ((y2 - y1) / FRAME_H) * 100,
    },
    timestamp: d.timestamp_ms / 1000,
    trackId: d.lesion.track_id,
    frame_b64: d.frame_b64,
  };
}

function genSessionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist sessions; on quota error, drop oldest entries until it fits. */
function saveSessions(sessions: Session[]): void {
  if (typeof window === "undefined") return;
  // Strip captures[].frame_b64 (~30 KB each) before write — quota too small
  // to hold them; captures remain in-memory only for the current session UX.
  const stripped = sessions.map((s) =>
    s.captures && s.captures.length
      ? { ...s, captures: s.captures.map(({ frame_b64: _omit, ...rest }) => rest) }
      : s,
  );
  let payload = stripped.slice(0, MAX_SESSIONS);
  while (payload.length > 0) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return;
    } catch {
      payload = payload.slice(0, -1);
    }
  }
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [pipelineState, setPipelineState] = useState<PipelineState>("IDLE");
  const [isConnected, setIsConnected] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [currentDetection, setCurrentDetection] = useState<Detection | null>(null);
  const [isListeningVoice, setIsListeningVoice] = useState(false);
  const [llmInsight, setLlmInsight] = useState("");

  // Phase C1 — latest LLM error surface (banner/toast). Cleared by
  // dismissError() or by a successful subsequent LLM event.
  const [lastError, setLastError] = useState<
    { message: string; code?: string; context?: string } | null
  >(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Phase 03 — RECHECK_RESULT payload + modal open flag (consumed by Phase 05 zoom modal).
  const [recheckResult, setRecheckResult] = useState<RecheckResultPayload | null>(null);
  const [isRecheckModalOpen, setIsRecheckModalOpen] = useState(false);

  const wsRef = useRef<EndoscopyWsClient | null>(null);
  const llmInsightRef = useRef("");
  // Prevents duplicate ACTION_EXPLAIN before server STATE_CHANGE PROCESSING_LLM arrives
  const explainInFlightRef = useRef(false);

  const detectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmTypingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate from localStorage on mount. `hydratedRef` gates persistence so we
  // NEVER write before the initial load completes — otherwise the empty initial
  // state could clobber the stored sessions (e.g. under React StrictMode's
  // double-mount in dev).
  const hydratedRef = useRef(false);
  useEffect(() => {
    setSessions(loadSessions());
    hydratedRef.current = true;
  }, []);

  // Persist sessions — DEBOUNCED. saveSessions() does a synchronous JSON
  // stringify + localStorage.setItem of the whole session list; running it on
  // every state change (e.g. each CONFIRMED_CAPTURE / streaming token) blocks
  // the main thread and makes the video stutter. Coalesce bursts into one write
  // ~800ms after the last change. No unmount-flush (it risked writing an empty
  // list during StrictMode mount churn); losing <800ms on a hard close is fine.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydratedRef.current) return;            // never persist pre-hydration
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => saveSessions(sessions), 800);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [sessions]);

  const clearMockTimers = useCallback(() => {
    if (detectionTimerRef.current) { clearTimeout(detectionTimerRef.current); detectionTimerRef.current = null; }
    if (llmTypingTimerRef.current) { clearInterval(llmTypingTimerRef.current); llmTypingTimerRef.current = null; }
  }, []);

  const isPlaying = pipelineState === "PLAYING";

  // Derived: current session detections (legacy alias for workspace/home pages).
  const detections = useMemo<Detection[]>(() => {
    if (!currentSessionId) return [];
    return sessions.find((s) => s.id === currentSessionId)?.detections ?? [];
  }, [sessions, currentSessionId]);

  // ── Session helpers ──

  const startNewSession = useCallback(
    (opts: { name: string; source: SessionSource; videoId?: string }): string => {
      const id = genSessionId();
      const newSession: Session = {
        id,
        name: opts.name,
        source: opts.source,
        startedAt: Date.now(),
        detections: [],
        videoId: opts.videoId,
      };
      setSessions((prev) => [newSession, ...prev].slice(0, MAX_SESSIONS));
      setCurrentSessionId(id);
      return id;
    },
    [],
  );

  const updateCurrentSession = useCallback(
    (updater: (s: Session) => Session) => {
      setSessions((prev) => {
        if (!currentSessionId) return prev;
        return prev.map((s) => (s.id === currentSessionId ? updater(s) : s));
      });
    },
    [currentSessionId],
  );

  // ── WebSocket event handler ───────────────────────────────────────────────

  const handleServerEvent = useCallback((evt: ServerEvent) => {
    switch (evt.event) {
      case "STATE_CHANGE": {
        const s = evt.data.state as PipelineState;
        setPipelineState(s);
        if (s === "PLAYING") {
          setCurrentDetection(null);
          setIsListeningVoice(false);
        }
        if (s === "PROCESSING_LLM") {
          setIsListeningVoice(true);
          llmInsightRef.current = ""; setLlmInsight("");
        }
        break;
      }
      case "DETECTION_FOUND": {
        const det = toDetection(evt.data);
        setCurrentDetection(det);
        updateCurrentSession((sess) => ({ ...sess, detections: [det, ...sess.detections] }));
        break;
      }
      case "LLM_CHUNK":
        llmInsightRef.current += evt.data.chunk;
        setLlmInsight(llmInsightRef.current);
        break;
      case "LLM_DONE": {
        explainInFlightRef.current = false;
        setIsListeningVoice(false);
        setPipelineState("PAUSED_WAITING_INPUT");
        const insight = llmInsightRef.current;
        updateCurrentSession((sess) => ({
          ...sess,
          detections: sess.detections.map((d, i) =>
            i === 0 ? { ...d, llmInsight: insight || d.llmInsight, status: "analyzed" } : d,
          ),
        }));
        break;
      }
      case "LESION_REPORT_DONE": {
        // Store both the structured report (for <LesionReportCard>) and a
        // markdown rendering (for ReactMarkdown surfaces + voice history).
        // The card prefers `lesionReport`; falls back to `llmInsight` when
        // only the legacy field exists.
        explainInFlightRef.current = false;
        setIsListeningVoice(false);
        setPipelineState("PAUSED_WAITING_INPUT");
        const report = evt.data.report;
        const md = lesionReportToMarkdown(report);
        llmInsightRef.current = md;
        setLlmInsight(md);
        // Also patch the in-view detection so the workspace's center panels
        // (which read currentDetection, not the session list) re-render with
        // the new structured report — without this they fall through to the
        // markdown branch and the Card never appears.
        setCurrentDetection((prev) =>
          prev ? { ...prev, lesionReport: report, llmInsight: md, status: "analyzed" } : prev,
        );
        updateCurrentSession((sess) => ({
          ...sess,
          detections: sess.detections.map((d, i) =>
            i === 0
              ? { ...d, lesionReport: report, llmInsight: md, status: "analyzed" }
              : d,
          ),
        }));
        break;
      }
      case "RECHECK_EMPTY": {
        // Recheck pass returned no new detection (or the worker threw). User
        // stays on the original paused detection — log so devs can correlate
        // with backend output; no state mutation needed.
        if (evt.data.error) {
          console.warn(`[WS] RECHECK failed at conf=${evt.data.conf}: ${evt.data.error}`);
        } else {
          console.info(`[WS] RECHECK at conf=${evt.data.conf} found nothing`);
        }
        break;
      }
      case "CONFIRMED_CAPTURE": {
        // Phase 02 — silent thumbnail capture from a confirmed-luôn track.
        // Append to current session's captures (capped 200, drop oldest).
        const det = evt.data;
        const [x1, y1, x2, y2] = det.lesion.bbox;
        const cap: CapturedDetection = {
          trackId: det.lesion.track_id ?? -1,
          label: det.lesion.label,
          confidence: det.lesion.confidence,
          timestamp: det.timestamp_ms / 1000,
          bbox: {
            x: (x1 / FRAME_W) * 100,
            y: (y1 / FRAME_H) * 100,
            width: ((x2 - x1) / FRAME_W) * 100,
            height: ((y2 - y1) / FRAME_H) * 100,
          },
          frame_b64: det.frame_b64,
        };
        updateCurrentSession((sess) => {
          const list = [...(sess.captures ?? []), cap];
          return { ...sess, captures: list.slice(-200) };
        });
        break;
      }
      case "RECHECK_RESULT": {
        // Phase 03 — stash payload + open modal (Phase 05 modal consumes).
        setRecheckResult({
          frameIndex: evt.data.frame_index,
          timestampSec: evt.data.timestamp_ms / 1000,
          frameB64Full: evt.data.frame_b64_full,
          conf: evt.data.conf,
          boxes: evt.data.boxes,
        });
        setIsRecheckModalOpen(true);
        break;
      }
      case "VIDEO_FINISHED": {
        // Keep WS alive — Phase B fires SESSION_SUMMARY_DONE and later
        // SESSION_QA_* events on the same socket. WS is disconnected only
        // when user explicitly resets (resetPipeline / removeSession).
        setPipelineState("EOS_SUMMARY");
        break;
      }
      case "SESSION_SUMMARY_DONE": {
        // Save into the current session so the SessionSummaryPanel can render.
        const summary = evt.data.summary ?? undefined;
        updateCurrentSession((sess) => ({ ...sess, summary }));
        break;
      }
      case "SESSION_QA_USER_SAVED": {
        // Optional ack — useful for UI to clear the input the moment the
        // backend confirms it persisted the user turn. Currently a no-op.
        break;
      }
      case "SESSION_QA_CHUNK": {
        // Token-stream append. Maintain a "live" assistant message at the
        // tail of qaMessages — if none exists yet, create one; otherwise
        // append the chunk to its content.
        const chunk = evt.data.chunk;
        updateCurrentSession((sess) => {
          const list = sess.qaMessages ?? [];
          const last = list[list.length - 1];
          if (last && last.role === "assistant" && sess.qaStreaming) {
            return {
              ...sess,
              qaMessages: [
                ...list.slice(0, -1),
                { ...last, content: last.content + chunk },
              ],
            };
          }
          return {
            ...sess,
            qaStreaming: true,
            qaMessages: [...list, { role: "assistant", content: chunk, ts: Date.now() }],
          };
        });
        break;
      }
      case "SESSION_QA_DONE": {
        updateCurrentSession((sess) => ({ ...sess, qaStreaming: false }));
        break;
      }
      case "SESSION_QA_REPLAY": {
        // Reconnect recovery — server sends full saved chat history once.
        updateCurrentSession((sess) => ({
          ...sess,
          qaMessages: evt.data.messages.map((m) => ({
            role: m.role, content: m.content, ts: m.ts,
          })),
          qaStreaming: false,
        }));
        break;
      }
      case "ERROR": {
        const { message, code, context } = evt.data;

        if (message?.includes("Session not found")) {
          console.warn("[WS] session expired (likely backend restart) — resetting state");
          wsRef.current?.disconnect();
          wsRef.current = null;
          setIsConnected(false);
          setPipelineState("IDLE");
          setVideoId(null);
          break;
        }

        // Phase C1 — route LLM errors to a visible surface based on context.
        console.error("[WS] LLM error", { code, context, message });

        if (context === "session_qa") {
          // Show inline error bubble in chat + unblock the input.
          updateCurrentSession((sess) => ({
            ...sess,
            qaStreaming: false,
            qaMessages: [
              ...(sess.qaMessages ?? []),
              { role: "assistant", content: `⚠️ ${message}`, ts: Date.now() },
            ],
          }));
          break;
        }

        if (context === "lesion_report") {
          // Free the LLM panel state so user can retry / explain again.
          explainInFlightRef.current = false;
          setIsListeningVoice(false);
          setPipelineState("PAUSED_WAITING_INPUT");
          // Surface as a one-line markdown error in the legacy insight panel.
          llmInsightRef.current = `⚠️ **${message}**\n\nNhấn "Giải thích thêm" để thử lại.`;
          setLlmInsight(llmInsightRef.current);
          break;
        }

        // session_summary or unknown context — set lastError so workspace
        // can render a banner. We don't have a dedicated state for that yet,
        // so for now toast via console + the FE summary panel's loading
        // state will just stay; user can refresh or retry session.
        setLastError({ message, code, context });
        break;
      }
    }
  }, [updateCurrentSession]);

  // ── WebSocket connect ─────────────────────────────────────────────────────

  const connectWs = useCallback((vid: string) => {
    wsRef.current?.disconnect();
    const client = new EndoscopyWsClient(vid);
    client.onMessage = handleServerEvent;
    client.onClose = () => setIsConnected(false);
    client.connect();
    wsRef.current = client;
    setIsConnected(true);
    setPipelineState("PLAYING");
  }, [handleServerEvent]);

  // ── Public actions ────────────────────────────────────────────────────────

  const uploadOnly = useCallback(async (
    file: File,
    onProgress?: (pct: number) => void,
  ) => {
    const { video_id } = await uploadVideo(file, onProgress);
    setVideoId(video_id);
    startNewSession({ name: file.name, source: "upload", videoId: video_id });
  }, [startNewSession]);

  const uploadAndConnect = useCallback(async (
    file: File,
    onProgress?: (pct: number) => void,
  ) => {
    const { video_id } = await uploadVideo(file, onProgress);
    setVideoId(video_id);
    startNewSession({ name: file.name, source: "upload", videoId: video_id });
    connectWs(video_id);
  }, [connectWs, startNewSession]);

  const connectLive = useCallback(async (source: string) => {
    const { video_id } = await connectLiveStream(source);
    setVideoId(video_id);
    startNewSession({ name: source, source: "live", videoId: video_id });
    connectWs(video_id);
  }, [connectWs, startNewSession]);

  const prepareFromLibrary = useCallback(async (libraryId: string, name?: string): Promise<string> => {
    const { video_id } = await selectLibraryVideo(libraryId);
    setVideoId(video_id);
    startNewSession({ name: name ?? libraryId, source: "library", videoId: video_id });
    return video_id;
  }, [startNewSession]);

  const selectFromLibrary = useCallback(async (libraryId: string, name?: string) => {
    const { video_id } = await selectLibraryVideo(libraryId);
    setVideoId(video_id);
    startNewSession({ name: name ?? libraryId, source: "library", videoId: video_id });
    connectWs(video_id);
  }, [connectWs, startNewSession]);

  const startMockAnalysis = useCallback(() => {
    if (videoId) {
      connectWs(videoId);
      return;
    }
    // No real video + mock disabled → do nothing rather than inject fake data.
    if (!MOCK_ENABLED) return;
    clearMockTimers();
    setPipelineState("PLAYING");
    setCurrentDetection(null);
    setIsListeningVoice(false);
    llmInsightRef.current = ""; setLlmInsight("");

    if (!currentSessionId) {
      startNewSession({ name: "Phiên mô phỏng", source: "upload" });
    }

    detectionTimerRef.current = setTimeout(() => {
      const mock: Detection = {
        label: "Viêm loét",
        confidence: 0.92,
        bbox: { x: 29, y: 34, width: 23, height: 19 },
        timestamp: 25.7,
      };
      setPipelineState("PAUSED_WAITING_INPUT");
      setCurrentDetection(mock);
      updateCurrentSession((sess) => ({ ...sess, detections: [mock, ...sess.detections] }));
    }, 5000);
  }, [videoId, connectWs, clearMockTimers, currentSessionId, startNewSession, updateCurrentSession]);

  const ignoreDetection = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send({ action: "ACTION_IGNORE" });
      updateCurrentSession((sess) => ({
        ...sess,
        detections: sess.detections.map((d, i) => (i === 0 ? { ...d, status: "ignored" } : d)),
      }));
      setPipelineState("PLAYING");
      setCurrentDetection(null);
      llmInsightRef.current = ""; setLlmInsight("");
      setIsListeningVoice(false);
    } else {
      updateCurrentSession((sess) => ({
        ...sess,
        detections: sess.detections.map((d, i) => (i === 0 ? { ...d, status: "ignored" } : d)),
      }));
      setCurrentDetection(null);
      llmInsightRef.current = ""; setLlmInsight("");
      setIsListeningVoice(false);
      if (!videoId) startMockAnalysis();
    }
  }, [startMockAnalysis, videoId, updateCurrentSession]);

  const explainMore = useCallback(() => {
    if (wsRef.current) {
      if (explainInFlightRef.current) return;
      explainInFlightRef.current = true;
      setPipelineState("PROCESSING_LLM");
      setIsListeningVoice(true);
      llmInsightRef.current = ""; setLlmInsight("");
      wsRef.current.send({ action: "ACTION_EXPLAIN" });
      return;
    }
    // Offline demo only — never fabricate LLM analysis in real (no-WS) sessions.
    if (!MOCK_ENABLED) return;
    clearMockTimers();
    setIsListeningVoice(true);
    llmInsightRef.current = ""; setLlmInsight("");
    const text =
`**Phân loại Paris:** 0-III (loét) — Tổn thương lõm sâu, bờ viền không đều, có vùng sung huyết xung quanh, kích thước ước tính 8–12mm.

**Nhận định lâm sàng:** Tiền ung thư / nghi ngờ — bờ fibrin không đều, sung huyết lan toả gợi ý nguy cơ loét ác tính. Cần phân biệt với ung thư dạ dày type 0-III sớm.

**Checklist hành động:**
- [ ] Sinh thiết ≥ 5 mảnh từ bờ và đáy tổn thương
- [ ] Nhuộm CLO-test tại chỗ để kiểm tra H. pylori
- [ ] Chụp ảnh NBI/ChromoEndoscopy nếu có thiết bị
- [ ] Ghi nhận vị trí (hang vị / thân vị / tâm vị) trong biên bản
- [ ] Hẹn tái khám 6–8 tuần sau điều trị ức chế acid`;
    let idx = 0;
    llmTypingTimerRef.current = setInterval(() => {
      idx++;
      setLlmInsight(text.slice(0, idx));
      if (idx >= text.length) {
        clearInterval(llmTypingTimerRef.current!);
        llmTypingTimerRef.current = null;
        setIsListeningVoice(false);
        setPipelineState("PAUSED_WAITING_INPUT");
      }
    }, 22);
  }, [clearMockTimers]);

  const followUpChat = useCallback((text: string) => {
    if (wsRef.current) {
      wsRef.current.send({ action: "ACTION_FOLLOW_UP", payload: { text } });
      llmInsightRef.current = ""; setLlmInsight("");
    }
  }, []);

  const confirmDetection = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send({ action: "ACTION_CONFIRM" });
    updateCurrentSession((sess) => ({
      ...sess,
      detections: sess.detections.map((d, i) => (i === 0 ? { ...d, status: "confirmed" } : d)),
    }));
    setPipelineState("PLAYING");
    setCurrentDetection(null);
    llmInsightRef.current = ""; setLlmInsight("");
  }, [updateCurrentSession]);

  const resumePlayback = useCallback(() => {
    wsRef.current?.send({ action: "ACTION_RESUME" });
    setPipelineState("PLAYING");
    setCurrentDetection(null);
  }, []);

  // Phase D — quick-confirm without invoking the LLM. Wraps confirmDetection
  // since the wire-level action is identical; exposed as its own name for
  // call-site clarity (the button appears pre-LLM, while confirmDetection's
  // button appears post-LLM after Giải thích).
  const quickConfirm = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send({ action: "ACTION_CONFIRM" });
    updateCurrentSession((sess) => ({
      ...sess,
      detections: sess.detections.map((d, i) => (i === 0 ? { ...d, status: "confirmed" } : d)),
    }));
    setPipelineState("PLAYING");
    setCurrentDetection(null);
    llmInsightRef.current = ""; setLlmInsight("");
  }, [updateCurrentSession]);

  // Phase D — flag this detection as a persistent false positive. Server saves
  // (label + bbox) to SQLite so future sessions auto-skip the same region.
  const reportFalsePositive = useCallback(() => {
    if (!wsRef.current) return;
    wsRef.current.send({ action: "ACTION_REPORT_FALSE_POSITIVE" });
    updateCurrentSession((sess) => ({
      ...sess,
      detections: sess.detections.map((d, i) => (i === 0 ? { ...d, status: "ignored" } : d)),
    }));
    setPipelineState("PLAYING");
    setCurrentDetection(null);
    llmInsightRef.current = ""; setLlmInsight("");
  }, [updateCurrentSession]);

  // Phase D — request a re-detect on the paused frame at a lower YOLO conf.
  // Result arrives as a fresh DETECTION_FOUND (or RECHECK_EMPTY) via WS,
  // handled by the standard server-event switch.
  const recheck = useCallback((conf: number = 0.4) => {
    if (!wsRef.current) return;
    wsRef.current.send({ action: "ACTION_RECHECK", payload: { conf } });
  }, []);

  // Phase 02 — "Xác nhận luôn": register track id with worker so the same
  // lesion silently auto-captures from then on (no more pauses). Resume
  // pipeline + clear current detection bar (legacy ACTION_CONFIRM semantics).
  const addConfirmedTrack = useCallback((trackId: number) => {
    if (!wsRef.current) return;
    if (!Number.isInteger(trackId) || trackId < 0) return;
    wsRef.current.send({ action: "ACTION_CONFIRM_TRACK", payload: { track_id: trackId } });
    updateCurrentSession((sess) => ({
      ...sess,
      confirmedTrackIds: [...(sess.confirmedTrackIds ?? []), trackId],
    }));
    setPipelineState("PLAYING");
    setCurrentDetection(null);
    llmInsightRef.current = "";
    setLlmInsight("");
  }, [updateCurrentSession]);

  // Phase 02 — "Bỏ qua": symmetric session-mute. Worker drops further frames
  // for this track silently.
  const addMutedTrack = useCallback((trackId: number) => {
    if (!wsRef.current) return;
    if (!Number.isInteger(trackId) || trackId < 0) return;
    wsRef.current.send({ action: "ACTION_MUTE_TRACK", payload: { track_id: trackId } });
    updateCurrentSession((sess) => ({
      ...sess,
      mutedTrackIds: [...(sess.mutedTrackIds ?? []), trackId],
    }));
    setPipelineState("PLAYING");
    setCurrentDetection(null);
    llmInsightRef.current = "";
    setLlmInsight("");
  }, [updateCurrentSession]);

  const openRecheckModal = useCallback(() => setIsRecheckModalOpen(true), []);
  const closeRecheckModal = useCallback(() => setIsRecheckModalOpen(false), []);

  // Phase 02 — declutter helper for the captures grid.
  const removeCapture = useCallback((timestamp: number) => {
    updateCurrentSession((sess) => ({
      ...sess,
      captures: (sess.captures ?? []).filter((c) => c.timestamp !== timestamp),
    }));
  }, [updateCurrentSession]);

  // Phase B — chatbot send. Two paths:
  //   - Live WS path (during/just-after session): action ACTION_SESSION_QA;
  //     reply streams in via SESSION_QA_CHUNK case.
  //   - HTTP path (from /report page where WS has long closed): POST to
  //     /session/{videoId}/qa, wait for the full reply, append both turns
  //     locally. Server still persists the conversation to qa_messages so
  //     the next page open sees the same history.
  const sendSessionQA = useCallback((text: string, sessionId?: string) => {
    const t = text.trim();
    if (!t) return;

    // Resolve target session — explicit param wins, else currentSessionId.
    // /report passes the session id explicitly since user may be browsing
    // an older session whose id no longer matches currentSessionId.
    const targetId = sessionId ?? currentSessionId;
    if (!targetId) return;

    // Helper: append a message to the target session (not necessarily current).
    const appendToTarget = (msg: QaMessage, streaming = true) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetId
            ? { ...s, qaStreaming: streaming, qaMessages: [...(s.qaMessages ?? []), msg] }
            : s,
        ),
      );
    };

    // Optimistic local append.
    appendToTarget({ role: "user", content: t, ts: Date.now() }, true);

    // Prefer live WS for the currently-active session (streams tokens).
    if (wsRef.current && targetId === currentSessionId) {
      wsRef.current.send({ action: "ACTION_SESSION_QA", payload: { text: t } });
      return;
    }

    // HTTP fallback — used at /report (no WS) or when chatting about a
    // session that isn't currently active.
    const sess = sessions.find((s) => s.id === targetId);
    const vid = sess?.videoId;
    if (!vid) {
      appendToTarget({ role: "assistant", content: "Không thể kết nối phiên — thiếu video id.", ts: Date.now() }, false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/session/${vid}/qa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: t }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { reply: string };
        appendToTarget({ role: "assistant", content: data.reply, ts: Date.now() }, false);
      } catch (err) {
        appendToTarget({ role: "assistant", content: `Lỗi gọi AI: ${String(err)}`, ts: Date.now() }, false);
      }
    })();
  }, [sessions, currentSessionId]);

  const setIsPlaying = useCallback((v: boolean) => {
    if (!v) {
      clearMockTimers();
      setPipelineState("IDLE");
      wsRef.current?.disconnect();
    }
  }, [clearMockTimers]);

  const addDetection = useCallback((d: Detection) => {
    updateCurrentSession((sess) => ({ ...sess, detections: [d, ...sess.detections] }));
  }, [updateCurrentSession]);

  const removeDetection = useCallback((timestamp: number) => {
    updateCurrentSession((sess) => ({
      ...sess,
      detections: sess.detections.filter((d) => d.timestamp !== timestamp),
    }));
  }, [updateCurrentSession]);

  const resetPipeline = useCallback(() => {
    clearMockTimers();
    wsRef.current?.disconnect();
    wsRef.current = null;
    explainInFlightRef.current = false;
    setPipelineState("IDLE");
    setIsConnected(false);
    setCurrentDetection(null);
    setIsListeningVoice(false);
    llmInsightRef.current = ""; setLlmInsight("");
    // Sessions persist in history; we just unbind the "current" pointer.
    setCurrentSessionId(null);
  }, [clearMockTimers]);

  const resetAnalysis = useCallback(() => {
    resetPipeline();
    setVideoId(null);
  }, [resetPipeline]);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setCurrentSessionId((cur) => (cur === sessionId ? null : cur));
  }, []);

  const clearSessions = useCallback(() => {
    setSessions([]);
    setCurrentSessionId(null);
  }, []);

  useEffect(() => {
    return () => {
      clearMockTimers();
      wsRef.current?.disconnect();
    };
  }, [clearMockTimers]);

  const value = useMemo<AnalysisContextType>(
    () => ({
      isConnected,
      pipelineState,
      videoId,
      sessions,
      currentSessionId,
      isPlaying,
      currentDetection,
      detections,
      llmInsightRef,
      uploadOnly,
      uploadAndConnect,
      connectLive,
      prepareFromLibrary,
      selectFromLibrary,
      startMockAnalysis,
      resetPipeline,
      ignoreDetection,
      explainMore,
      followUpChat,
      confirmDetection,
      resumePlayback,
      quickConfirm,
      reportFalsePositive,
      recheck,
      addConfirmedTrack,
      addMutedTrack,
      recheckResult,
      isRecheckModalOpen,
      openRecheckModal,
      closeRecheckModal,
      removeCapture,
      sendSessionQA,
      lastError,
      dismissError: () => setLastError(null),
      setIsPlaying,
      addDetection,
      removeDetection,
      resetAnalysis,
      removeSession,
      clearSessions,
    }),
    [
      isConnected, pipelineState, videoId, sessions, currentSessionId, isPlaying,
      currentDetection, detections, llmInsightRef,
      uploadOnly, uploadAndConnect, connectLive, prepareFromLibrary, selectFromLibrary,
      startMockAnalysis, resetPipeline, ignoreDetection,
      explainMore, followUpChat, confirmDetection, resumePlayback,
      quickConfirm, reportFalsePositive, recheck,
      addConfirmedTrack, addMutedTrack,
      recheckResult, isRecheckModalOpen, openRecheckModal, closeRecheckModal,
      removeCapture,
      sendSessionQA, lastError, setIsPlaying,
      addDetection, removeDetection, resetAnalysis, removeSession, clearSessions,
    ],
  );

  // Separate value for the streaming context — only changes when the LLM text
  // or the listening flag changes, isolating those frequent updates.
  const llmValue = useMemo<LlmStreamContextType>(
    () => ({ llmInsight, isListeningVoice }),
    [llmInsight, isListeningVoice],
  );

  return (
    <AnalysisContext.Provider value={value}>
      <LlmStreamContext.Provider value={llmValue}>{children}</LlmStreamContext.Provider>
    </AnalysisContext.Provider>
  );
}

export function useAnalysis(): AnalysisContextType {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider");
  return ctx;
}

/** Subscribe ONLY to the live LLM stream (llmInsight + isListeningVoice).
 *  Use this in the leaf components that render the streaming text so token
 *  updates don't re-render the whole workspace. */
export function useLlmStream(): LlmStreamContextType {
  const ctx = useContext(LlmStreamContext);
  if (!ctx) throw new Error("useLlmStream must be used within AnalysisProvider");
  return ctx;
}
