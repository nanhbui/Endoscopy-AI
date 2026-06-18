"""voice_api.py — FastAPI router for voice command processing.

POST /voice/classify
  Receives transcript text (from browser Web Speech API),
  uses LLM to understand natural-language intent, returns action.

POST /voice/command  (legacy — audio → Whisper → classify)
  Kept for compatibility; requires ffmpeg on server.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from logger import logger  # noqa: E402
from src.voice.intent_classifier import IntentClassifier

router = APIRouter()
_classifier = IntentClassifier()

# ── LLM intent classification ─────────────────────────────────────────────────

_SYSTEM_PROMPT = """Bạn là trợ lý phân loại lệnh giọng nói trong phòng nội soi.
Bác sĩ vừa nói một câu trong lúc đang xem kết quả AI phát hiện tổn thương.
Phân loại ý định của bác sĩ vào đúng 1 trong 5 nhãn sau:

BO_QUA       — bác sĩ cho rằng AI nhận sai (false positive), muốn bỏ qua và tiếp tục video
               Ví dụ: "cái này chỉ là bọt thôi", "không phải tổn thương đâu", "bỏ qua đi", "ánh sáng phản chiếu thôi"

GIAI_THICH   — bác sĩ muốn AI giải thích chi tiết hơn về tổn thương vừa phát hiện
               Ví dụ: "cho tôi biết thêm", "giải thích xem sao", "tại sao lại phát hiện chỗ này", "phân tích thêm đi"

KIEM_TRA_LAI — bác sĩ muốn AI phân tích / chạy lại frame hiện tại (hạ ngưỡng, kiểm tra kỹ hơn)
               Ví dụ: "kiểm tra lại đi", "quét lại chỗ này", "phân tích lại frame", "xem kỹ lại"

XAC_NHAN     — bác sĩ xác nhận phát hiện là đúng, ghi nhận lại
               Ví dụ: "đúng rồi", "ghi lại đi", "xác nhận", "chuẩn", "lưu lại"

UNKNOWN      — không rõ ý định, hoặc không liên quan đến lệnh điều khiển

Trả lời CHỈ bằng một từ: BO_QUA, GIAI_THICH, KIEM_TRA_LAI, XAC_NHAN, hoặc UNKNOWN"""


async def _classify_with_llm(transcript: str) -> tuple[str, float]:
    """Use OpenAI to classify natural-language doctor command."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # Fallback to keyword matching if LLM not configured
        intent, conf = _classifier.classify(transcript)
        return intent.name, conf

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": transcript},
            ],
            max_tokens=10,
            temperature=0,
        )
        label = resp.choices[0].message.content.strip().upper()
        if label not in ("BO_QUA", "GIAI_THICH", "KIEM_TRA_LAI", "XAC_NHAN", "UNKNOWN"):
            label = "UNKNOWN"
        return label, 0.95
    except Exception as exc:
        logger.warning("LLM classify failed, falling back to keywords: {}", exc)
        intent, conf = _classifier.classify(transcript)
        return intent.name, conf


# ── Endpoints ─────────────────────────────────────────────────────────────────

class ClassifyRequest(BaseModel):
    transcript: str


@router.post("/voice/classify", response_class=JSONResponse)
async def voice_classify(body: ClassifyRequest):
    """Classify a transcript string (from Web Speech API) using LLM.

    Returns: { "intent": "BO_QUA"|..., "confidence": float }
    """
    text = body.transcript.strip()
    if not text:
        return JSONResponse(content={"intent": "UNKNOWN", "confidence": 0.0})

    intent, confidence = await _classify_with_llm(text)
    logger.info("Voice classify: '{}' → {} ({:.2f})", text[:60], intent, confidence)
    return JSONResponse(content={"intent": intent, "confidence": round(confidence, 2)})


@router.post("/voice/command", response_class=JSONResponse)
async def voice_command(audio: UploadFile = File(...)):
    """Legacy: transcribe audio with Whisper then classify. Requires ffmpeg."""
    try:
        from src.voice.whisper_transcriber import WhisperTranscriber
        transcriber = WhisperTranscriber(model_size="base")
        audio_bytes = await audio.read()
        loop = asyncio.get_running_loop()
        transcript = await loop.run_in_executor(None, transcriber.transcribe, audio_bytes)
        intent, confidence = await _classify_with_llm(transcript)
        logger.info("Voice command: '{}' → {} ({:.2f})", transcript, intent, confidence)
        return JSONResponse(content={
            "transcript": transcript,
            "intent": intent,
            "confidence": round(confidence, 2),
        })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Voice processing failed: {exc}")
