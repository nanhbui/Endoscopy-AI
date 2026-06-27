/**
 * use-voice-control.ts — Voice commands for the upload-video flow.
 *
 * Imperative mic control (startListening / stopListening) used by the workspace:
 * the pipeline pauses on a detection, the mic turns on, the doctor speaks a short
 * command, and the intent drives an action (ignore / explain / confirm / recheck).
 *
 * Engine: server-side faster-whisper via POST /voice/command (Vietnamese,
 * transcribe + intent in one call). Audio is VAD-segmented locally (RMS) and each
 * utterance is sent as one WebM clip — nothing goes to any cloud STT. Replaces the
 * earlier browser Web Speech implementation (Chromium-only, sent audio to Google).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/ws-client";

export type VoiceIntent = "BO_QUA" | "GIAI_THICH" | "XAC_NHAN" | "KIEM_TRA_LAI" | "UNKNOWN";

// Feature flag — voice commands are HIDDEN by default until explicitly enabled.
const VOICE_ENABLED = process.env.NEXT_PUBLIC_VOICE_ENABLED === "true";

interface UseVoiceControlOptions {
  onIntent: (intent: VoiceIntent, transcript: string) => void;
}

// VAD tuning — RMS thresholds on the [0..1] level (mirrors use-live-voice-capture).
const SPEECH_RMS = 0.025;       // above → speech started
const SILENCE_MS = 800;         // silence after speech → utterance ended
const MIN_UTTERANCE_MS = 350;   // shorter blips ignored (coughs, clicks)
const MAX_UTTERANCE_MS = 8000;  // hard flush so a long utterance still gets sent

export function useVoiceControl({ onIntent }: UseVoiceControlOptions) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speakingRef = useRef(false);
  const speechStartRef = useRef(0);
  const silenceStartRef = useRef(0);
  const onIntentRef = useRef(onIntent);
  useEffect(() => { onIntentRef.current = onIntent; });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection needs window, only available after mount (SSR-safe)
    setSupported(
      VOICE_ENABLED &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  const sendUtterance = useCallback((blob: Blob) => {
    if (blob.size < 1200) return; // near-empty → skip
    const fd = new FormData();
    fd.append("audio", blob, "utt.webm");
    fd.append("session_id", "");   // upload commands aren't persisted as narration
    fetch(`${API_BASE}/voice/command`, { method: "POST", body: fd })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { transcript: string; intent: VoiceIntent } | null) => {
        if (d && d.transcript) {
          setTranscript(d.transcript);
          onIntentRef.current(d.intent ?? "UNKNOWN", d.transcript);
        }
      })
      .catch(() => { /* one dropped utterance is non-fatal */ });
  }, []);

  const stopRecorder = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec || rec.state === "inactive") return;
    try { rec.stop(); } catch { /* already stopped */ }
  }, []);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recorderRef.current || typeof MediaRecorder === "undefined") return;
    const mime = ["audio/webm;codecs=opus", "audio/webm"]
      .find(m => MediaRecorder.isTypeSupported(m)) || "";
    try {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        if (Date.now() - speechStartRef.current >= MIN_UTTERANCE_MS) sendUtterance(blob);
      };
      rec.start();
      recorderRef.current = rec;
    } catch {
      recorderRef.current = null; // capture is best-effort
    }
  }, [sendUtterance]);

  const stopListening = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    stopRecorder();
    speakingRef.current = false;
    silenceStartRef.current = 0;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setIsListening(false);
    setAudioLevel(0);
    setTranscript("");
  }, [stopRecorder]);

  const startListening = useCallback(() => {
    if (!supported || streamRef.current) return; // already running / unsupported
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        streamRef.current = stream;
        setIsListening(true);
        setMicError(null);

        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        const buf = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          setAudioLevel(Math.min(1, rms * 6));
          const now = Date.now();

          if (rms >= SPEECH_RMS) {
            if (!speakingRef.current) {
              speakingRef.current = true;
              speechStartRef.current = now;
              startRecorder();
            }
            silenceStartRef.current = 0;
            if (now - speechStartRef.current > MAX_UTTERANCE_MS) {
              speakingRef.current = false;
              stopRecorder();
            }
          } else if (speakingRef.current) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            else if (now - silenceStartRef.current > SILENCE_MS) {
              speakingRef.current = false;
              silenceStartRef.current = 0;
              stopRecorder();
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        setMicError("Không truy cập được mic — hãy cấp quyền micro cho trang.");
        setIsListening(false);
      });
  }, [supported, startRecorder, stopRecorder]);

  useEffect(() => () => stopListening(), [stopListening]);

  return { isListening, transcript, audioLevel, supported, micError, startListening, stopListening };
}
