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
  EndoscopyWsClient,
  uploadVideo,
  connectLiveStream,
  selectLibraryVideo,
  type DetectionData,
  type ServerEvent,
  type LesionReport,
} from "@/lib/ws-client";

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

/** A single analysis session — one video / live stream run. */
export interface Session {
  id: string;
  name: string;
  source: SessionSource;
  startedAt: number;
  detections: Detection[];
  videoId?: string;
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
  isListeningVoice: boolean;
  llmInsight: string;
  detections: Detection[];

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

// ── helpers ───────────────────────────────────────────────────────────────────

const FRAME_W = 1920;
const FRAME_H = 1080;

const STORAGE_KEY = "gastroeye:sessions:v1";
const MAX_SESSIONS = 10;

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
  let payload = sessions.slice(0, MAX_SESSIONS);
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

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const wsRef = useRef<EndoscopyWsClient | null>(null);
  const llmInsightRef = useRef("");
  // Prevents duplicate ACTION_EXPLAIN before server STATE_CHANGE PROCESSING_LLM arrives
  const explainInFlightRef = useRef(false);

  const detectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmTypingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  // Persist sessions on every change.
  useEffect(() => {
    saveSessions(sessions);
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
      case "VIDEO_FINISHED": {
        setPipelineState("EOS_SUMMARY");
        setIsConnected(false);
        wsRef.current?.disconnect();
        wsRef.current = null;
        break;
      }
      case "ERROR":
        if (evt.data.message?.includes("Session not found")) {
          console.warn("[WS] session expired (likely backend restart) — resetting state");
          wsRef.current?.disconnect();
          wsRef.current = null;
          setIsConnected(false);
          setPipelineState("IDLE");
          setVideoId(null);
        } else {
          console.error("[WS] server error:", evt.data.message);
        }
        break;
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
      isListeningVoice,
      llmInsight,
      detections,
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
      setIsPlaying,
      addDetection,
      removeDetection,
      resetAnalysis,
      removeSession,
      clearSessions,
    }),
    [
      isConnected, pipelineState, videoId, sessions, currentSessionId, isPlaying,
      currentDetection, isListeningVoice, llmInsight, detections,
      uploadOnly, uploadAndConnect, connectLive, prepareFromLibrary, selectFromLibrary,
      startMockAnalysis, resetPipeline, ignoreDetection,
      explainMore, followUpChat, confirmDetection, resumePlayback, setIsPlaying,
      addDetection, removeDetection, resetAnalysis, removeSession, clearSessions,
    ],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextType {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider");
  return ctx;
}
