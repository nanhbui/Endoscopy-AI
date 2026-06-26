'use client';

/**
 * browser-capture-live.tsx — Trực tuyến (live) via the browser.
 *
 * The browser captures the HDMI-capture device (it appears as a normal webcam)
 * and mirrors it locally — the doctor sees the other machine's screen live. The
 * mirror runs continuously and is NEVER paused. Detection runs after "Bắt đầu
 * AI": frames are JPEG-streamed to /ws/live-detect, the backend runs YOLO and
 * returns boxes overlaid on the live <video>.
 *
 * On each detection we snapshot the frame into the right-hand panel and, in
 * parallel, ask the VLM (/live/explain) to describe it. "Tạo báo cáo" folds the
 * collected captures (+ their LLM reports) into a `live` session and opens the
 * normal /report page — same surface as the uploaded-video flow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { Radio, Cpu, Square, Video as VideoIcon, X, Info, Maximize2, FileText, StopCircle, CheckCircle2, Mic, MicOff } from 'lucide-react';
import { WS_BASE, API_BASE, uploadRecording, type LesionReport } from '@/lib/ws-client';
import { b64ToJpegBlob } from '@/lib/lesion-report-edits';
import { startRecordingUpload, setRecordingUploadProgress, finishRecordingUpload, useRecordingUpload } from '@/lib/recording-upload-store';
import { labelToColor as colorFor } from '@/lib/lesion-colors';
import { useAnalysis, lesionReportToMarkdown, type Detection } from '@/context/AnalysisContext';
import { LiveCapturesPanel, type LiveCapture } from '@/components/live-captures-panel';
import { useLiveVoiceCapture, type VoiceResult } from '@/hooks/use-live-voice-capture';
import {
  PatientContextForm,
  emptyPatientContext,
  hasPatientContext,
  patientContextToBody,
  type PatientContextData,
} from '@/components/patient-context-form';

interface LiveBox { label: string; confidence: number; bbox: [number, number, number, number]; }

const FRAME_W = 1920;
const FRAME_H = 1080;
const SEND_INTERVAL_MS = 200;       // grab cadence (~5 fps to backend)
const GRAB_WIDTH = 960;             // downscale frames sent to the detector
const CAP_WIDTH = 960;              // snapshot width stored for the panel + report
const MAX_CAPTURES = 50;            // cap memory/localStorage footprint
// Backpressure: the local VLM serves explanations serially, so firing one fetch
// per detection during a busy sweep floods it and the tail request times out.
// Run at most EXPLAIN_CONCURRENCY at a time; the rest wait in a FIFO queue.
const EXPLAIN_CONCURRENCY = 1;
const EXPLAIN_CLIENT_TIMEOUT_MS = 185_000; // just above the server's 180s hard cap

// Capture resolutions offered to the doctor. "auto" lets the dongle decide.
const RES_OPTIONS = [
  { value: 'auto', label: 'Tự động' },
  { value: '1920x1080', label: '1920×1080 (16:9)' },
  { value: '1280x720', label: '1280×720 (16:9)' },
  { value: '1024x768', label: '1024×768 (4:3)' },
  { value: '800x600', label: '800×600 (4:3)' },
];

// How the mirror fills its frame. "contain" keeps aspect (letterbox), "fill"
// stretches to the frame (fixes a squished signal), "cover" crops to fill.
type FitMode = 'contain' | 'cover' | 'fill';
const FIT_OPTIONS: { value: FitMode; label: string }[] = [
  { value: 'contain', label: 'Vừa khung' },
  { value: 'fill', label: 'Lấp đầy' },
  { value: 'cover', label: 'Cắt vừa' },
];

interface BrowserCaptureLiveProps {
  /** Opens the source modal on the "Bản ghi trực tiếp" tab — wired to the
   *  "Xem bản ghi" link shown after a recording is saved. */
  onViewRecordings?: () => void;
}

export function BrowserCaptureLive({ onViewRecordings }: BrowserCaptureLiveProps) {
  const { saveLiveSession } = useAnalysis();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);     // detector send-loop canvas
  const capCanvasRef = useRef<HTMLCanvasElement>(null);  // panel snapshot canvas
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendingRef = useRef(false);
  const capIdRef = useRef(0);
  // FIFO queue + in-flight counter for serialized lesion explanations.
  const explainQueueRef = useRef<Array<{ id: number; b64: string; box: LiveBox }>>([]);
  const explainActiveRef = useRef(0);
  // Full-session recording (Trực tiếp): MediaRecorder taps the raw mirror stream
  // — clean video, no AI overlay — and the whole .webm is uploaded to the library
  // on "Dừng phiên". Recording is auto-started with the AI session.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartMsRef = useRef(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [previewing, setPreviewing] = useState(false);
  // Display tuning: requested capture resolution, how the mirror fills the
  // frame, and a manual zoom to compensate a squished/off-center signal.
  const [resolution, setResolution] = useState('auto');
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [zoom, setZoom] = useState(100);          // percent, 50–150
  const [actualRes, setActualRes] = useState(''); // e.g. "1920×1080" from the track
  const [showHint, setShowHint] = useState(true);
  const [aiOn, setAiOn] = useState(false);
  // True after "Dừng phiên": switches the bottom controls into the finalize
  // panel (loading → "Tạo báo cáo"). Reset when the source is started again.
  const [stopped, setStopped] = useState(false);
  const [boxes, setBoxes] = useState<LiveBox[]>([]);
  const [captures, setCaptures] = useState<LiveCapture[]>([]);
  const [err, setErr] = useState('');
  const [patientCtx, setPatientCtx] = useState<PatientContextData>(emptyPatientContext);
  // Recording UI state: live elapsed seconds. Upload progress (name + %) lives in
  // the shared store so the recordings list can show it too.
  const [recording, setRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [recNotice, setRecNotice] = useState(false);   // transient "recording started" banner
  const [savedNotice, setSavedNotice] = useState(false); // persistent "saved → view" CTA
  const upload = useRecordingUpload();
  // Hands-free mic (audio input device) — independent of the video mirror.
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [voiceLog, setVoiceLog] = useState<Array<{ text: string; ts: number }>>([]);
  // Stable id for this live voice session so the server can key the transcript
  // log (consumed by the end-of-session summary). Set on first mic-on.
  const liveVoiceSessionIdRef = useRef('');

  // Raise the persistent "saved → Xem bản ghi" banner once the upload finishes.
  useEffect(() => { if (upload.status === 'done') setSavedNotice(true); }, [upload.status]);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'videoinput'));
      // Mic devices too — wired / USB / Bluetooth all surface as 'audioinput'.
      // Labels are only populated after mic permission is granted.
      setAudioDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch {
      setErr('Trình duyệt không liệt kê được thiết bị video.');
    }
  }, []);

  const startPreview = useCallback(async (id?: string, res?: string) => {
    setErr('');
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const useRes = res ?? resolution;
      const [w, h] = useRes !== 'auto' ? useRes.split('x').map(Number) : [];
      const sizeConstraint = w && h ? { width: { ideal: w }, height: { ideal: h } } : {};
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, ...sizeConstraint } : (w ? sizeConstraint : true),
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPreviewing(true);
      setStopped(false);
      await refreshDevices();
      const settings = stream.getVideoTracks()[0]?.getSettings?.();
      if (settings?.deviceId) setDeviceId(settings.deviceId);
      if (settings?.width && settings?.height) setActualRes(`${settings.width}×${settings.height}`);
    } catch {
      setErr('Không truy cập được thiết bị. Hãy cấp quyền camera cho trang và cắm cục capture.');
      setPreviewing(false);
    }
  }, [refreshDevices, resolution]);

  // Ask the VLM to describe one captured frame; fill the panel item when it returns.
  // Aborts at EXPLAIN_CLIENT_TIMEOUT_MS so a stuck request never hangs the queue.
  const runExplain = useCallback(async (id: number, b64: string, box: LiveBox) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EXPLAIN_CLIENT_TIMEOUT_MS);
    try {
      const qs = new URLSearchParams({ label: box.label, conf: String(box.confidence) });
      const r = await fetch(`${API_BASE}/live/explain?${qs.toString()}`, { method: 'POST', body: b64ToJpegBlob(b64), signal: ctrl.signal });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
      const data = await r.json();
      setCaptures((prev) => prev.map((c) => c.id === id ? { ...c, report: data.report ?? null, explaining: false } : c));
    } catch (e) {
      const msg = ctrl.signal.aborted
        ? 'Hết thời gian chờ AI — nhấn để thử lại.'
        : (e instanceof Error ? e.message : 'Giải thích thất bại');
      setCaptures((prev) => prev.map((c) => c.id === id ? { ...c, explaining: false, error: msg } : c));
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Drain the queue, keeping at most EXPLAIN_CONCURRENCY explains in flight so we
  // never flood the serial VLM. Re-pumps as each one settles.
  const pumpExplainQueue = useCallback(() => {
    while (explainActiveRef.current < EXPLAIN_CONCURRENCY && explainQueueRef.current.length > 0) {
      const job = explainQueueRef.current.shift()!;
      explainActiveRef.current += 1;
      void runExplain(job.id, job.b64, job.box).finally(() => {
        explainActiveRef.current -= 1;
        pumpExplainQueue();
      });
    }
  }, [runExplain]);

  // Enqueue instead of firing immediately — backpressure for the serial VLM.
  const explainCapture = useCallback((id: number, b64: string, box: LiveBox) => {
    explainQueueRef.current.push({ id, b64, box });
    pumpExplainQueue();
  }, [pumpExplainQueue]);

  // Snapshot the current frame, draw the detection boxes onto it (same overlay
  // the doctor sees live), push it to the panel, then kick off the VLM. `box` is
  // the strongest box (drives label/conf + explain); `all` are drawn for context.
  const captureFrame = useCallback((box: LiveBox, all: LiveBox[]) => {
    const v = videoRef.current, cap = capCanvasRef.current;
    if (!v || !cap || !v.videoWidth) return;
    const cw = CAP_WIDTH;
    const ch = Math.round((cw * v.videoHeight) / v.videoWidth) || Math.round(cw * 9 / 16);
    cap.width = cw; cap.height = ch;
    const ctx = cap.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, cw, ch);
    // Draw boxes — bbox coords are normalized to 1920×1080, same as the live overlay.
    const sx = cw / FRAME_W, sy = ch / FRAME_H;
    const lw = Math.max(2, Math.round(cw / 320));
    const fontPx = Math.max(11, Math.round(cw / 60));
    const labelH = fontPx + 6;
    ctx.textBaseline = 'middle';
    for (const b of all) {
      const [x1, y1, x2, y2] = b.bbox;
      const rx = x1 * sx, ry = y1 * sy, rw = (x2 - x1) * sx, rh = (y2 - y1) * sy;
      const col = colorFor(b.label);
      ctx.lineWidth = lw;
      ctx.strokeStyle = col;
      ctx.strokeRect(rx, ry, rw, rh);
      const text = `${b.label} ${(b.confidence * 100).toFixed(0)}%`;
      ctx.font = `700 ${fontPx}px sans-serif`;
      const tw = ctx.measureText(text).width + 8;
      const ly = Math.max(0, ry - labelH);
      ctx.fillStyle = col;
      ctx.fillRect(rx, ly, tw, labelH);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, rx + 4, ly + labelH / 2);
    }
    const b64 = cap.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '';
    if (!b64) return;
    const id = ++capIdRef.current;
    setCaptures((prev) => [
      { id, frameB64: b64, label: box.label, confidence: box.confidence, bboxNorm: box.bbox, ts: Date.now(), report: null, explaining: true },
      ...prev,
    ].slice(0, MAX_CAPTURES));
    explainCapture(id, b64, box);
  }, [explainCapture]);

  // Snapshot only NEW detections. The backend (LiveDetector) already de-dupes a
  // lingering lesion across frames (spatial-temporal + diffuse cooldown) and
  // sends them in `captures`, so a lesion that stays in view is recorded once —
  // not 5×/s. `overlay` is drawn on the snapshot for context. We snapshot the
  // strongest new detection per message (distinct simultaneous lesions are rare
  // in a single scope view).
  const maybeCapture = useCallback((captures: LiveBox[], overlay: LiveBox[]) => {
    if (captures.length === 0) return;
    const top = captures.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    captureFrame(top, overlay.length ? overlay : captures);
  }, [captureFrame]);

  // Start recording the RAW mirror stream (no AI overlay) — full session, one
  // .webm file. No-op if already recording or the stream isn't ready, so AI
  // off→on toggles never fragment the recording. Best-effort: a browser that
  // can't record just skips it; detection is unaffected.
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (recorderRef.current || !stream || typeof MediaRecorder === 'undefined') return;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m)) || '';
    try {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recordedChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data); };
      rec.start(1000);   // 1s timeslice → periodic chunks, survives long sessions
      recorderRef.current = rec;
      recordStartMsRef.current = Date.now();
      setRecording(true);
      setRecordElapsed(0);
      // One-shot "recording started" notice so the doctor knows the session is
      // being recorded; auto-dismisses (the persistent REC badge remains).
      setRecNotice(true);
      setSavedNotice(false);   // clear any prior session's "saved" banner

      if (recNoticeTimerRef.current) clearTimeout(recNoticeTimerRef.current);
      recNoticeTimerRef.current = setTimeout(() => setRecNotice(false), 5000);
      recordTimerRef.current = setInterval(
        () => setRecordElapsed(Math.floor((Date.now() - recordStartMsRef.current) / 1000)), 1000);
    } catch {
      recorderRef.current = null;  // recording is optional — never block the session
    }
  }, []);

  // Stop recording and upload the .webm to the library (tagged live_recording).
  // Returns a promise that resolves once upload settles so callers can await it.
  const stopAndUploadRecording = useCallback(async (): Promise<void> => {
    const rec = recorderRef.current;
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setRecording(false);
    if (!rec) return;
    recorderRef.current = null;
    const durationMs = recordStartMsRef.current ? Date.now() - recordStartMsRef.current : 0;
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(recordedChunksRef.current, { type: 'video/webm' }));
      try { rec.stop(); } catch { resolve(new Blob(recordedChunksRef.current, { type: 'video/webm' })); }
    });
    recordedChunksRef.current = [];
    if (blob.size === 0) return;
    const name = `Trực tiếp ${new Date().toLocaleString('vi-VN')}.webm`;
    // Drive the shared store so the name + % shows on both the live view banner
    // and the recordings list.
    startRecordingUpload(name);
    try {
      await uploadRecording(blob, name, { durationMs, onProgress: setRecordingUploadProgress });
      finishRecordingUpload(true);
    } catch {
      finishRecordingUpload(false);
    }
  }, []);

  const stopAi = useCallback(() => {
    setAiOn(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    wsRef.current?.close();
    wsRef.current = null;
    sendingRef.current = false;
    setBoxes([]);
  }, []);

  const startAi = useCallback(() => {
    if (!previewing) return;
    const ws = new WebSocket(`${WS_BASE}/ws/live-detect/browser`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      let nb: LiveBox[] = [];
      let caps: LiveBox[] = [];
      try {
        const msg = JSON.parse(ev.data);
        nb = msg.boxes ?? [];
        caps = msg.captures ?? [];
      } catch { /* ignore */ }
      setBoxes(nb);
      sendingRef.current = false;
      maybeCapture(caps, nb);
    };
    ws.onclose = () => { sendingRef.current = false; };
    ws.onerror = () => { setErr('Mất kết nối tới máy chủ AI.'); };
    ws.onopen = () => {
      setAiOn(true);
      startRecording();   // auto-record the full session (raw mirror, no overlay)
      timerRef.current = setInterval(() => {
        const v = videoRef.current, c = canvasRef.current, sock = wsRef.current;
        if (!v || !c || !sock || sock.readyState !== WebSocket.OPEN) return;
        if (sendingRef.current) return;        // backpressure: one frame in flight
        if (!v.videoWidth) return;
        const cw = GRAB_WIDTH;
        const ch = Math.round((cw * v.videoHeight) / v.videoWidth) || Math.round(cw * 9 / 16);
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, cw, ch);
        c.toBlob((blob) => {
          if (!blob || sock.readyState !== WebSocket.OPEN) return;
          sendingRef.current = true;
          blob.arrayBuffer().then((buf) => sock.send(buf)).catch(() => { sendingRef.current = false; });
        }, 'image/jpeg', 0.6);
      }, SEND_INTERVAL_MS);
    };
  }, [previewing, maybeCapture, startRecording]);

  // "Dừng phiên" — stop the detector AND the mirror; captures stay so the doctor
  // can still review and "Tạo báo cáo". The full-session recording is flushed and
  // uploaded BEFORE the stream tracks are stopped so the final chunk is captured.
  const stopSession = useCallback(() => {
    stopAi();
    setMicOn(false);   // hands-free mic off when the session ends
    void stopAndUploadRecording();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPreviewing(false);
    setStopped(true);
  }, [stopAi, stopAndUploadRecording]);

  const removeCapture = useCallback((id: number) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // "Báo sai phân tích" applied to a live capture — update its report in place.
  // It's persisted (kept/edited/cleared) when the doctor hits "Tạo báo cáo đầy đủ".
  const applyAnalysis = useCallback((id: number, next: LesionReport) => {
    setCaptures((prev) => prev.map((c) => c.id === id ? { ...c, report: next } : c));
  }, []);

  // "Tạo báo cáo" — fold captures into a live session and open /report.
  // Block report creation until every capture's VLM call has settled — otherwise
  // detections land in the report with an empty "Phân tích AI".
  const pendingExplain = captures.filter((c) => c.explaining).length;
  const canReport = captures.length > 0 && pendingExplain === 0;

  const createReport = useCallback(async () => {
    if (captures.length === 0 || captures.some((c) => c.explaining)) return;
    stopSession();   // end the live mirror/detector — the report popup takes over
    const base = Math.min(...captures.map((c) => c.ts));
    const dets: Detection[] = captures.map((c) => {
      // Carry the YOLO box (1920×1080 px) as percent of frame — same shape the
      // upload path uses — so the session-report modal can persist it as a
      // false-positive ("Báo sai") that future runs match by IoU.
      const [bx1, by1, bx2, by2] = c.bboxNorm;
      return {
      label: c.label,
      confidence: c.confidence,
      bbox: {
        x: (bx1 / FRAME_W) * 100,
        y: (by1 / FRAME_H) * 100,
        width: ((bx2 - bx1) / FRAME_W) * 100,
        height: ((by2 - by1) / FRAME_H) * 100,
      },
      timestamp: Math.max(0, Math.round((c.ts - base) / 1000)),
      frame_b64: c.frameB64,
      lesionReport: c.report ?? undefined,
      llmInsight: c.report ? lesionReportToMarkdown(c.report) : undefined,
      status: 'analyzed',
      };
    });
    const name = `Trực tiếp ${new Date().toLocaleString('vi-VN')}`;
    // saveLiveSession flips pipelineState → EOS_SUMMARY; the workspace page then
    // renders its SessionReportModal (the stop→report popup). We intentionally do
    // NOT navigate to /report here — the doctor reviews the popup first, then the
    // modal's "Xem báo cáo đầy đủ" button routes to /report.
    const sessionId = saveLiveSession(name, dets);

    // Re-key the live voice transcript to this report session so the end-of-session
    // summary picks up the doctor's spoken narration. Non-fatal.
    if (liveVoiceSessionIdRef.current) {
      void fetch(`${API_BASE}/live/sessions/${sessionId}/voice-transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_session_id: liveVoiceSessionIdRef.current }),
      }).catch(() => { /* non-fatal — summary just omits the narration */ });
    }

    // Phase 1 — persist patient context (PHI) FIRST so the summary (which reads it)
    // sees it. Non-fatal: on failure the summary just degrades to no patient context.
    if (hasPatientContext(patientCtx)) {
      await fetch(`${API_BASE}/sessions/${sessionId}/patient-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patientContextToBody(patientCtx)),
      }).catch(() => { /* non-fatal — summary degrades to no patient context */ });
    }

    // NOTE: AI summary is NOT kicked off here. It's deferred to "Tạo báo cáo đầy
    // đủ" in the session-report modal so detections the doctor flags as "Báo sai"
    // can be excluded from the synthesis (only the kept findings are summarized).
  }, [captures, patientCtx, saveLiveSession, stopSession]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (recNoticeTimerRef.current) clearTimeout(recNoticeTimerRef.current);
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // ── Hands-free voice (live = narration only) ─────────────────────────────────
  // Each transcribed utterance is logged (shown below + persisted server-side for
  // the end-of-session summary). The live flow has no real-time voice commands —
  // false-positive review happens post-session in the report modal, and command
  // intents (bỏ qua / giải thích / xác nhận) belong to the upload-video flow.
  const handleVoiceResult = useCallback((r: VoiceResult) => {
    if (!r.transcript) return;
    setVoiceLog((prev) => [...prev, { text: r.transcript, ts: Date.now() }]);
  }, []);

  const { audioLevel: micLevel, error: micError } = useLiveVoiceCapture({
    enabled: micOn,
    deviceId: audioDeviceId,
    sessionId: liveVoiceSessionIdRef.current,
    onResult: handleVoiceResult,
  });

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      const next = !on;
      // First activation: mint a session id + ask for mic permission so the
      // device dropdown can show real labels (re-enumerated on devicechange).
      if (next && !liveVoiceSessionIdRef.current) {
        liveVoiceSessionIdRef.current =
          (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `live-${Date.now()}`;
      }
      if (next) void refreshDevices();
      return next;
    });
  }, [refreshDevices]);

  // Bluetooth headsets drop/reconnect and change deviceId — re-enumerate so the
  // mic dropdown stays accurate and the chosen device isn't lost.
  useEffect(() => {
    const h = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', h);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', h);
  }, [refreshDevices]);

  const videoStyle = useMemo(() => ({
    position: 'absolute' as const, inset: 0, width: '100%', height: '100%',
    objectFit: fitMode, background: '#0D1117',
    transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
  }), [fitMode, zoom]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* "Recording started" notice — shown when AI starts (= recording starts),
          auto-dismisses after a few seconds. The REC badge on the video persists. */}
      {recNotice && (
        <Box sx={{ px: 2, py: 1.25, borderRadius: '12px', backgroundColor: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.3)', display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: '#DC2626', flexShrink: 0, animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }} />
          <Typography sx={{ fontSize: '0.85rem', color: '#B91C1C', fontWeight: 600, flex: 1 }}>
            Đã bắt đầu ghi hình phiên trực tiếp — video sẽ được lưu vào “Bản ghi trực tiếp” khi bạn bấm “Dừng phiên”.
          </Typography>
        </Box>
      )}

      {/* Patient context — filled before starting; saved on "Tạo báo cáo" */}
      {!aiOn && (
        <PatientContextForm data={patientCtx} onChange={setPatientCtx} />
      )}

      {/* Duplicate-mode notice — an Extend (mở rộng) signal arrives squished/cropped */}
      {showHint && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.5, py: 1, borderRadius: '10px', border: '1px solid #FCD34D', backgroundColor: '#FFFBEB' }}>
          <Info size={16} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
          <Typography sx={{ fontSize: '0.75rem', color: '#92400E', flex: 1, lineHeight: 1.5 }}>
            Trên máy nguồn, đặt chế độ màn hình là <b>Duplicate (Nhân đôi)</b>, không dùng <b>Extend (Mở rộng)</b> —
            nếu để Extend, hình truyền sang sẽ bị méo/bẹp hoặc cắt mất. Có thể chỉnh thêm độ phân giải và tỉ lệ bên dưới.
          </Typography>
          <Box component="button" onClick={() => setShowHint(false)}
            sx={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#B45309', display: 'inline-flex', p: 0 }}>
            <X size={15} />
          </Box>
        </Box>
      )}

      {/* Video (left) + captures panel (right) */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1.5, alignItems: 'stretch' }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {/* Video surface + overlay */}
          <Box sx={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '16px', backgroundColor: '#0D1117', position: 'relative', overflow: 'hidden', border: '1px solid #1c2530', boxShadow: '0 6px 24px rgba(13,27,42,0.10)' }}>
            <video ref={videoRef} muted playsInline style={videoStyle} />
            {!previewing && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                <VideoIcon size={36} color="rgba(0,132,143,0.5)" />
                <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)' }}>
                  Chưa bật nguồn — bấm “Bật nguồn” và chọn cục capture HDMI
                </Typography>
              </Box>
            )}

            {/* Detection overlay (boxes normalized to 1920×1080) */}
            {aiOn && boxes.map((b, i) => {
              const [x1, y1, x2, y2] = b.bbox;
              const c = colorFor(b.label);
              return (
                <Box key={i} sx={{
                  position: 'absolute',
                  left: `${(x1 / FRAME_W) * 100}%`, top: `${(y1 / FRAME_H) * 100}%`,
                  width: `${((x2 - x1) / FRAME_W) * 100}%`, height: `${((y2 - y1) / FRAME_H) * 100}%`,
                  border: `2px solid ${c}`, borderRadius: '4px', pointerEvents: 'none',
                }}>
                  <Box sx={{ position: 'absolute', top: -19, left: -1, backgroundColor: c, color: '#fff', px: 0.6, fontSize: '0.6rem', fontWeight: 700, borderRadius: '4px 4px 0 0', whiteSpace: 'nowrap' }}>
                    {b.label} {(b.confidence * 100).toFixed(0)}%
                  </Box>
                </Box>
              );
            })}

            {/* status badge */}
            <Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 2, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.4, borderRadius: '6px', backgroundColor: aiOn ? 'rgba(220,38,38,0.85)' : previewing ? 'rgba(2,119,189,0.85)' : 'rgba(100,100,100,0.6)', backdropFilter: 'blur(6px)' }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#fff', animation: aiOn ? 'pulse 1.5s infinite' : 'none', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } } }} />
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>
                {aiOn ? 'AI ĐANG CHẠY' : previewing ? 'MIRROR' : 'OFFLINE'}
              </Typography>
              {previewing && actualRes && (
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', ml: 0.5 }}>
                  · {actualRes}
                </Typography>
              )}
            </Box>

            {/* detection count (AI on) */}
            {aiOn && (
              <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.1, py: 0.4, borderRadius: '6px', backgroundColor: 'rgba(0,96,100,0.95)', color: '#fff' }}>
                <Cpu size={11} />
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 800 }}>{boxes.length} vùng</Typography>
              </Box>
            )}

            {/* REC indicator + elapsed timer (full-session recording) */}
            {recording && (
              <Box sx={{ position: 'absolute', bottom: 12, right: 12, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 0.6, px: 1.1, py: 0.4, borderRadius: '6px', backgroundColor: 'rgba(220,38,38,0.9)', color: '#fff', backdropFilter: 'blur(6px)' }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#fff', animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }} />
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', fontVariantNumeric: 'tabular-nums' }}>
                  REC {String(Math.floor(recordElapsed / 60)).padStart(2, '0')}:{String(recordElapsed % 60).padStart(2, '0')}
                </Typography>
              </Box>
            )}
          </Box>

          {err && (
            <Typography sx={{ fontSize: '0.78rem', color: '#DC2626' }}>{err}</Typography>
          )}

          {/* Recording upload progress — name + % (shared with the recordings list).
              The 'done' case is handled by the persistent "saved → Xem bản ghi" CTA below. */}
          {upload.active && upload.status !== 'done' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, flex: 1, color: upload.status === 'error' ? '#DC2626' : '#00838F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {upload.status === 'uploading' && `Đang lưu bản ghi: ${upload.name}`}
                  {upload.status === 'error' && 'Lưu bản ghi thất bại — phiên vẫn được xử lý bình thường.'}
                </Typography>
                {upload.status === 'uploading' && (
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#00838F', flexShrink: 0 }}>{upload.pct}%</Typography>
                )}
              </Box>
              {upload.status === 'uploading' && (
                <LinearProgress variant="determinate" value={upload.pct}
                  sx={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(0,131,143,0.12)', '& .MuiLinearProgress-bar': { backgroundColor: '#00838F' } }} />
              )}
            </Box>
          )}

          {/* Persistent "recording saved" CTA — links straight to the recordings tab. */}
          {savedNotice && (
            <Box sx={{ px: 2, py: 1.25, borderRadius: '12px', backgroundColor: 'rgba(0,131,143,0.06)', border: '1px solid #A7D8DC', display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CheckCircle2 size={18} color="#00838F" style={{ flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.85rem', color: '#0D1B2A', fontWeight: 600, flex: 1 }}>
                Đã lưu bản ghi phiên trực tiếp vào thư viện.
              </Typography>
              {onViewRecordings && (
                <Box component="button" onClick={() => { setSavedNotice(false); onViewRecordings(); }}
                  sx={{ ...btnSx('#00838F'), py: 0.6, px: 1.5, fontSize: '0.8rem', flexShrink: 0 }}>
                  <FileText size={15} /> Xem bản ghi
                </Box>
              )}
              <Box component="button" onClick={() => setSavedNotice(false)}
                sx={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'text.secondary', display: 'inline-flex', p: 0.25, flexShrink: 0 }}>
                <X size={16} />
              </Box>
            </Box>
          )}

          {/* Controls */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            {!previewing ? (
              <Box component="button" onClick={() => startPreview()} sx={btnSx('#006064')}>
                <Radio size={16} /> Bật nguồn (chọn cục capture)
              </Box>
            ) : (
              <>
                {/* Device picker — no typing. Locked while AI runs: switching the
                    source reacquires the stream and would truncate the recording. */}
                <Box component="select"
                  value={deviceId}
                  disabled={aiOn}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => startPreview(e.target.value)}
                  sx={{ flex: '1 1 200px', minWidth: 180, px: 1.5, py: 1, borderRadius: '10px', border: '1px solid #CBD5D3', fontSize: '0.85rem', backgroundColor: aiOn ? '#F1F5F4' : '#fff', color: 'text.primary', cursor: aiOn ? 'not-allowed' : 'pointer' }}
                >
                  {devices.map((d, i) => (
                    <option key={`${d.deviceId}-${i}`} value={d.deviceId}>
                      {d.label || `Thiết bị ${i + 1}`}
                    </option>
                  ))}
                </Box>
                {!aiOn ? (
                  <Box component="button" onClick={startAi} sx={btnSx('#DC2626')}>
                    <Cpu size={16} /> Bắt đầu AI
                  </Box>
                ) : (
                  <Box component="button" onClick={stopAi} sx={btnSx('#6E7C7B')}>
                    <Square size={15} /> Dừng AI
                  </Box>
                )}
                <Box component="button" onClick={stopSession} sx={btnSx('#B45309')}>
                  <StopCircle size={16} /> Dừng phiên
                </Box>
              </>
            )}
          </Box>

          {/* Hands-free mic — pick an audio input (wired / USB / Bluetooth) and
              toggle it on/off for this session. While on, speech is transcribed
              server-side (Vietnamese) and shown below. */}
          {previewing && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 1.5, py: 1, borderRadius: '10px', border: '1px solid #E2EAE8', backgroundColor: '#F8FAFB' }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                  <Mic size={14} color="#006064" />
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#445', whiteSpace: 'nowrap' }}>Micro</Typography>
                </Box>
                <Box component="select"
                  value={audioDeviceId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAudioDeviceId(e.target.value)}
                  sx={{ flex: '1 1 200px', minWidth: 180, px: 1.25, py: 0.7, borderRadius: '8px', border: '1px solid #CBD5D3', fontSize: '0.8rem', backgroundColor: '#fff', cursor: 'pointer' }}
                >
                  <option value="">Mic mặc định của hệ thống</option>
                  {audioDevices.map((d, i) => (
                    <option key={`${d.deviceId}-${i}`} value={d.deviceId}>
                      {d.label || `Mic ${i + 1}`}
                    </option>
                  ))}
                </Box>
                <Box component="button" onClick={toggleMic}
                  sx={{ ...btnSx(micOn ? '#DC2626' : '#00838F'), py: 0.7, px: 1.5, fontSize: '0.8rem' }}>
                  {micOn ? <><MicOff size={15} /> Tắt mic</> : <><Mic size={15} /> Bật mic</>}
                </Box>
                {/* Live input-level bar (shows the mic is actually picking up sound) */}
                {micOn && (
                  <Box sx={{ flex: '1 1 80px', minWidth: 70, height: 6, borderRadius: 3, backgroundColor: 'rgba(0,131,143,0.12)', overflow: 'hidden' }}>
                    <Box sx={{ width: `${Math.round(micLevel * 100)}%`, height: '100%', backgroundColor: '#00838F', transition: 'width 0.08s linear' }} />
                  </Box>
                )}
              </Box>
              {micError && (
                <Typography sx={{ fontSize: '0.74rem', color: '#DC2626' }}>{micError}</Typography>
              )}
              {voiceLog.length > 0 && (
                <Box sx={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.4, mt: 0.25 }}>
                  {voiceLog.map((v, i) => (
                    <Typography key={i} sx={{ fontSize: '0.78rem', color: '#0D1B2A' }}>
                      <span style={{ color: '#6E7C7B', fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(v.ts).toLocaleTimeString('vi-VN')}
                      </span>{' '}
                      {v.text}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* Finalize panel — appears after "Dừng phiên". While the VLM is still
              explaining captured lesions it shows a calm loading state with
              progress; once every explanation settles it swaps to the primary
              "Tạo báo cáo" action. Replaces the old disabled-button-with-counter,
              which looked broken (blurred + counting down). */}
          {stopped && captures.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.75, borderRadius: '12px', border: `1px solid ${canReport ? '#A7D8DC' : '#E2EAE8'}`, backgroundColor: canReport ? 'rgba(0,131,143,0.05)' : '#F8FAFB' }}>
              {canReport ? (
                <>
                  <CheckCircle2 size={26} color="#00838F" style={{ flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: '#0D1B2A' }}>
                      Đã phân tích xong {captures.length} tổn thương
                    </Typography>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                      AI đã hoàn tất giải thích — bạn có thể tạo báo cáo ngay.
                    </Typography>
                  </Box>
                  <Box component="button" onClick={createReport} sx={{ ...btnSx('#00838F'), flexShrink: 0 }}>
                    <FileText size={16} /> Tạo báo cáo
                  </Box>
                </>
              ) : (
                <>
                  <CircularProgress size={26} sx={{ color: '#00838F', flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: '#0D1B2A' }}>
                      Đang phân tích tổn thương bằng AI…
                    </Typography>
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 0.75 }}>
                      Đã xong {captures.length - pendingExplain}/{captures.length} — vui lòng đợi trước khi tạo báo cáo.
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={((captures.length - pendingExplain) / captures.length) * 100}
                      sx={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(0,131,143,0.12)', '& .MuiLinearProgress-bar': { backgroundColor: '#00838F' } }}
                    />
                  </Box>
                </>
              )}
            </Box>
          )}

          {/* Display tuning — resolution, fit mode, zoom (fixes a squished signal) */}
          {previewing && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderRadius: '10px', border: '1px solid #E2EAE8', backgroundColor: '#F8FAFB' }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                <Maximize2 size={14} color="#006064" />
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#445' }}>Độ phân giải</Typography>
                <Box component="select"
                  value={resolution}
                  disabled={aiOn}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setResolution(e.target.value); startPreview(deviceId, e.target.value); }}
                  sx={{ px: 1, py: 0.6, borderRadius: '8px', border: '1px solid #CBD5D3', fontSize: '0.78rem', backgroundColor: aiOn ? '#F1F5F4' : '#fff', cursor: aiOn ? 'not-allowed' : 'pointer' }}
                >
                  {RES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Box>
              </Box>

              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#445' }}>Hiển thị</Typography>
                <Box sx={{ display: 'inline-flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #CBD5D3' }}>
                  {FIT_OPTIONS.map((o) => (
                    <Box key={o.value} component="button" onClick={() => setFitMode(o.value)}
                      sx={{ px: 1.1, py: 0.6, border: 'none', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600,
                        backgroundColor: fitMode === o.value ? '#006064' : '#fff',
                        color: fitMode === o.value ? '#fff' : '#445' }}>
                      {o.label}
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, flex: '1 1 180px', minWidth: 160 }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#445', whiteSpace: 'nowrap' }}>Tỉ lệ {zoom}%</Typography>
                <Box component="input" type="range" min={50} max={150} step={1}
                  value={zoom}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setZoom(Number(e.target.value))}
                  sx={{ flex: 1, accentColor: '#006064', cursor: 'pointer' }}
                />
                {zoom !== 100 && (
                  <Box component="button" onClick={() => setZoom(100)}
                    sx={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#006064', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', p: 0 }}>
                    Đặt lại
                  </Box>
                )}
              </Box>
            </Box>
          )}

          <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
            Cục capture HDMI cắm vào máy này; trình duyệt nhận như một “camera”. Màn hình máy kia hiển thị
            liên tục (mirror). Bấm <b>Bắt đầu AI</b> để chạy phát hiện — mỗi tổn thương sẽ được tự chụp lại
            sang panel bên phải kèm giải thích của AI. Xong bấm <b>Tạo báo cáo</b>.
          </Typography>
        </Box>

        {/* Right panel — auto-captured detections + their LLM explanations */}
        {(previewing || captures.length > 0) && (
          <LiveCapturesPanel captures={captures} onRemove={removeCapture} onApplyAnalysis={applyAnalysis} />
        )}
      </Box>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <canvas ref={capCanvasRef} style={{ display: 'none' }} />
    </Box>
  );
}

function btnSx(color: string) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 0.75,
    px: 2, py: 1, borderRadius: '10px', border: 'none', cursor: 'pointer',
    backgroundColor: color, color: '#fff', fontSize: '0.85rem', fontWeight: 700,
    '&:hover': { filter: 'brightness(1.08)' },
  } as const;
}