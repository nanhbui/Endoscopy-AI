/**
 * use-live-voice-capture.ts — Hands-free mic capture for the live session.
 *
 * The mic is just an audio input device (wired / USB / Bluetooth — all appear as
 * `audioinput`). While `enabled`, we open the chosen device, run a lightweight
 * RMS-based VAD to segment speech into utterances, and POST each utterance to
 * `/voice/command` on the backend (faster-whisper → Vietnamese transcript +
 * intent). Transcription runs server-side; nothing is sent to any cloud STT.
 *
 * Per-utterance MediaRecorder (start on speech, stop on ~0.8s silence) → each blob
 * is an independent, decodable WebM. Latency is non-critical: the doctor speaks a
 * short command, we transcribe once it lands.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/ws-client";

export interface VoiceResult {
  transcript: string;
  intent: "BO_QUA" | "GIAI_THICH" | "XAC_NHAN" | "KIEM_TRA_LAI" | "UNKNOWN";
  confidence: number;
}

interface Options {
  enabled: boolean;
  deviceId: string;          // chosen audioinput device ("" = system default)
  sessionId: string;         // live session id, for server-side transcript log
  onResult: (r: VoiceResult) => void;
}

// VAD tuning — RMS thresholds on the [0..1] level. Tunable after field testing.
const SPEECH_RMS = 0.025;    // above → speech started
const SILENCE_MS = 800;      // this much silence after speech → utterance ended
const MIN_UTTERANCE_MS = 350; // shorter blips are ignored (coughs, clicks)
const MAX_UTTERANCE_MS = 8000; // hard flush so a long monologue still gets sent

export function useLiveVoiceCapture({ enabled, deviceId, sessionId, onResult }: Options) {
  const [audioLevel, setAudioLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speakingRef = useRef(false);
  const speechStartRef = useRef(0);
  const silenceStartRef = useRef(0);
  // Keep the latest callback without re-subscribing the capture loop.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });

  const sendUtterance = useCallback((blob: Blob) => {
    if (blob.size < 1200) return; // near-empty → skip
    const fd = new FormData();
    fd.append("audio", blob, "utt.webm");
    fd.append("session_id", sessionId);
    fetch(`${API_BASE}/voice/command`, { method: "POST", body: fd })
      .then(r => (r.ok ? r.json() : null))
      .then((d: VoiceResult | null) => {
        if (d && d.transcript) onResultRef.current(d);
      })
      .catch(() => { /* one dropped utterance is non-fatal */ });
  }, [sessionId]);

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
        const dur = Date.now() - speechStartRef.current;
        if (dur >= MIN_UTTERANCE_MS) sendUtterance(blob);
      };
      rec.start();
      recorderRef.current = rec;
    } catch {
      recorderRef.current = null; // capture is best-effort
    }
  }, [sendUtterance]);

  // Start / stop the whole capture pipeline when `enabled` or device changes.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setListening(true);
        setError(null);

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
            // Hard flush very long utterances so they still get transcribed.
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
        if (!cancelled) setError("Không truy cập được mic. Hãy cấp quyền micro và chọn đúng thiết bị.");
      });

    return () => {
      cancelled = true;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      stopRecorder();
      speakingRef.current = false;
      silenceStartRef.current = 0;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setListening(false);
      setAudioLevel(0);
    };
  }, [enabled, deviceId, startRecorder, stopRecorder]);

  return { listening, audioLevel, error };
}
