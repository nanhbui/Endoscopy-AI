/**
 * use-voice-control.ts — Real-time voice command hook using Web Speech API.
 *
 * Uses browser SpeechRecognition for instant word-by-word transcript,
 * with keyword matching for intent classification (no backend needed).
 *
 * Audio level meter via Web Audio API AnalyserNode (for the level bar UI).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/ws-client";

export type VoiceIntent = "BO_QUA" | "GIAI_THICH" | "XAC_NHAN" | "UNKNOWN";

// Feature flag — voice commands (faster-whisper / Web Speech + keyword intent)
// are HIDDEN by default while accuracy is being reworked. Set
// NEXT_PUBLIC_VOICE_ENABLED=true to re-enable the mic UI and auto-activation.
const VOICE_ENABLED = process.env.NEXT_PUBLIC_VOICE_ENABLED === "true";

interface UseVoiceControlOptions {
  onIntent: (intent: VoiceIntent, transcript: string) => void;
}

// Quick keyword pass — fires instantly for obvious short commands
// Includes common Web Speech API misrecognitions of Vietnamese
const QUICK_KEYWORDS: [VoiceIntent, string[]][] = [
  ["BO_QUA", [
    "bỏ qua", "bo qua", "loại bỏ", "loai bo",
    "không phải", "khong phai", "bắt sai", "nhận sai", "nhầm rồi", "sai rồi",
    "false positive", "skip", "next",
  ]],
  ["GIAI_THICH", [
    "giải thích", "giai thich", "phân tích", "phan tich",
    "nói thêm", "chi tiết hơn", "tại sao", "vì sao", "explain", "more detail",
  ]],
  ["XAC_NHAN", [
    "xác nhận", "xac nhan", "đúng rồi", "ghi lại", "lưu lại",
    "chính xác", "chuẩn rồi", "confirm", "yes",
  ]],
];

function quickMatch(text: string): VoiceIntent | null {
  const lower = text.toLowerCase();
  for (const [intent, kws] of QUICK_KEYWORDS) {
    if (kws.some(kw => lower.includes(kw))) return intent;
  }
  return null;
}

/** Classify intent: keyword-first (<1ms), LLM fallback for ambiguous sentences. */
async function classifyIntent(transcript: string): Promise<VoiceIntent> {
  const quick = quickMatch(transcript);
  if (quick) return quick; // instant — no network call

  // Ambiguous utterance → LLM understands full context
  try {
    const res = await fetch(`${API_BASE}/voice/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) return "UNKNOWN";
    const data = await res.json() as { intent: VoiceIntent };
    return data.intent ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

// Minimal type shims for SpeechRecognition (not fully typed in all lib.dom versions)
interface ISpeechRecognitionEvent {
  resultIndex: number;
  results: { isFinal: boolean; 0: { transcript: string } }[];
}
interface ISpeechRecognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: ISpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function useVoiceControl({ onIntent }: UseVoiceControlOptions) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState(""); // current interim text
  const [supported, setSupported] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onIntentRef = useRef(onIntent);
  // Keep the latest callback without re-subscribing recognition. Updating the
  // ref in an effect (not during render) satisfies react-hooks/refs.
  useEffect(() => { onIntentRef.current = onIntent; });
  // Track how many chars of the current interim we've already acted on.
  // Resets to 0 when Chrome finalises the result (new utterance slot).
  const lastFiredEndRef = useRef<number>(0);

  useEffect(() => {
    console.log("[VoiceControl] mount — checking SpeechRecognition support");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log("[VoiceControl] window.SpeechRecognition:", !!(window as any).SpeechRecognition);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log("[VoiceControl] window.webkitSpeechRecognition:", !!(window as any).webkitSpeechRecognition);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection needs window, only available after mount (SSR-safe)
    setSupported(
      VOICE_ENABLED &&
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window),
    );
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setIsListening(false);
    setAudioLevel(0);
    setTranscript("");
  }, []);

  const startListening = useCallback(() => {
    console.log("[VoiceControl] startListening called", { supported, isListening, hasRef: !!recognitionRef.current });
    // If recognition object already exists, it's already running — don't double-start
    if (!supported || recognitionRef.current) return;

    // ── Speech recognition (synchronous — must stay within user gesture) ──────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SRClass = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    console.log("[VoiceControl] SRClass:", SRClass);
    if (!SRClass) return;

    const recognition: ISpeechRecognition = new SRClass();
    recognition.lang = "vi-VN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }

      // ── Interim: match only on the *new* words since last fire ─────────────
      if (interim) {
        setTranscript(interim);
        const delta = interim.slice(lastFiredEndRef.current).trim();
        if (delta) {
          const quickIntent = quickMatch(delta);
          if (quickIntent) {
            lastFiredEndRef.current = 0;
            console.log("[VoiceControl] interim match:", quickIntent, delta);
            onIntentRef.current(quickIntent, delta);
            // Restart to flush accumulated buffer — next command starts clean
            recognitionRef.current?.stop();
          }
        }
      }

      // ── Final: always log transcript; classify intent only if no interim fired ──
      if (finalText.trim()) {
        setTranscript(finalText);
        const alreadyFired = lastFiredEndRef.current > 0;
        lastFiredEndRef.current = 0;
        if (alreadyFired) {
          // Interim already fired an intent — still log the full final text
          onIntentRef.current("UNKNOWN", finalText.trim());
        } else {
          classifyIntent(finalText.trim()).then(intent => {
            onIntentRef.current(intent, finalText.trim());
          });
        }
      }
    };

    recognition.onerror = (event) => {
      // no-speech / aborted are normal Chrome timeouts — not real errors
      if (event.error === "no-speech" || event.error === "aborted") {
        console.log("[VoiceControl] non-fatal:", event.error);
        return;
      }
      console.error("[VoiceControl] error:", event.error);
      setMicError(event.error);
    };

    // Auto-restart after silence — Chrome stops the session automatically
    recognition.onend = () => {
      if (recognitionRef.current) {
        // Small delay prevents tight restart loop when no-speech fires repeatedly
        setTimeout(() => {
          if (!recognitionRef.current) return;
          try { recognitionRef.current.start(); } catch (e) {
            if (!(e instanceof DOMException && e.name === "InvalidStateError")) {
              console.warn("[VoiceControl] restart failed:", e);
            }
          }
        }, 300);
      }
    };

    try {
      recognition.start();
      console.log("[VoiceControl] recognition.start() OK");
      setIsListening(true);
      setMicError(null);
    } catch (err) {
      console.error("[VoiceControl] start failed:", err);
      setMicError(String(err));
      return;
    }

    // ── Audio level meter (async — getUserMedia after recognition is already running) ──
    navigator.mediaDevices?.getUserMedia({ audio: true, video: false })
      .then(stream => {
        streamRef.current = stream;
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
          setAudioLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => { /* level meter optional */ });
  }, [supported, isListening]);

  useEffect(() => () => stopListening(), [stopListening]);

  return { isListening, transcript, audioLevel, supported, micError, startListening, stopListening };
}
