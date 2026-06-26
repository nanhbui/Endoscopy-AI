"""whisper_transcriber.py — Transcribe audio bytes → Vietnamese text via faster-whisper.

Accepts raw audio in any browser-native format (WebM/OPUS, WAV, MP4).
faster-whisper delegates decoding to ffmpeg, so no manual conversion is needed.
Loads the model once (process-wide singleton); subsequent calls reuse it.

Config via env (so deploy can tune without code changes):
  VOICE_WHISPER_MODEL    model size ("small" default, "base", "medium", …) OR a
                         local CTranslate2 model directory path (offline / pre-staged).
  VOICE_WHISPER_DEVICE   "cpu" (default), "cuda", or "auto" (cuda if available).
  VOICE_WHISPER_COMPUTE  ctranslate2 compute type (default int8 on cpu, float16 on cuda).
"""

from __future__ import annotations

import os
import tempfile
from typing import Optional


class WhisperTranscriber:
    """Singleton wrapper around faster-whisper for audio bytes → Vietnamese text.

    The model is selected entirely from env (see module docstring). Any positional
    model-size argument is accepted but ignored for backward compatibility — the
    deployed model is governed by VOICE_WHISPER_MODEL.
    """

    _instance: Optional["WhisperTranscriber"] = None

    def __new__(cls, *_args, **_kwargs) -> "WhisperTranscriber":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._loaded = False
        return cls._instance

    def _load(self) -> None:
        if self._loaded:
            return
        from faster_whisper import WhisperModel

        model = os.environ.get("VOICE_WHISPER_MODEL", "small")
        device = os.environ.get("VOICE_WHISPER_DEVICE", "cpu").lower()
        if device == "auto":
            try:
                import ctranslate2
                device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
            except Exception:
                device = "cpu"
        compute_type = os.environ.get(
            "VOICE_WHISPER_COMPUTE", "float16" if device == "cuda" else "int8"
        )
        print(f"[Whisper] Loading model '{model}' on {device} ({compute_type})")
        self._model = WhisperModel(model, device=device, compute_type=compute_type)
        self._loaded = True
        print("[Whisper] Model ready")

    def transcribe(self, audio_bytes: bytes) -> str:
        """Transcribe raw audio bytes to Vietnamese text.

        Args:
            audio_bytes: Raw audio in any format ffmpeg can read (WebM, WAV, MP4…).

        Returns:
            Transcribed text, or empty string if nothing was detected.
        """
        self._load()

        # Write to a temp file — faster-whisper/ffmpeg need a seekable source.
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name

        try:
            segments, _ = self._model.transcribe(
                tmp_path,
                language="vi",
                beam_size=1,                       # greedy → fast for short commands
                vad_filter=True,                   # Silero VAD: filter silence/noise
                condition_on_previous_text=False,  # avoid hallucination carry-over
                initial_prompt=(                   # bias toward clinical commands
                    "nhầm rồi bỏ qua sai không phải false positive "
                    "giải thích phân tích chi tiết tại sao "
                    "đúng rồi xác nhận chuẩn ok được"
                ),
            )
            return " ".join(seg.text for seg in segments).strip()
        finally:
            os.unlink(tmp_path)
