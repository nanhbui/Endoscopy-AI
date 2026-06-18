"""IntentClassifier — Phân loại câu nói của bác sĩ thành intent cụ thể.

Hỗ trợ 4 intent chính:
  FALSE_POSITIVE → bác sĩ báo detect sai (trigger Idea 1 - frame skipping)
  EXPLAIN        → bác sĩ muốn LLM giải thích thêm (trigger Idea 2)
  CHECK_AGAIN    → bác sĩ muốn phân tích lại frame hiện tại
  CONFIRM        → bác sĩ xác nhận detect đúng

Thuật toán: keyword matching có trọng số.
  - Keyword dài hơn (nhiều từ hơn) → confidence cao hơn
  - Không dùng LLM để giữ latency thấp (<5ms)
"""

import re
import os
import json
from enum import Enum
from typing import Tuple, List

# Optional LLM import – used only for EXPLAIN intent
try:
    from langchain_openai import ChatOpenAI
except Exception:  # pragma: no cover
    ChatOpenAI = None


class VoiceIntent(Enum):
    BO_QUA       = "bo_qua"         # Detect sai → bỏ qua frame (Idea 1)
    GIAI_THICH   = "giai_thich"     # Giải thích thêm (Idea 2)
    KIEM_TRA_LAI = "kiem_tra_lai"   # Phân tích lại frame
    XAC_NHAN     = "xac_nhan"       # Xác nhận detect đúng
    UNKNOWN      = "unknown"        # Không nhận ra


# Nhãn hiển thị / log
INTENT_LABELS = {
    VoiceIntent.BO_QUA:       "Bỏ qua (false positive)",
    VoiceIntent.GIAI_THICH:   "Giải thích thêm",
    VoiceIntent.KIEM_TRA_LAI: "Kiểm tra lại",
    VoiceIntent.XAC_NHAN:     "Xác nhận đúng",
    VoiceIntent.UNKNOWN:      "Không rõ",
}

# Path for persisting skipped frames (false‑positive frames)
_SKIPPED_FRAMES_PATH = os.path.join(os.path.dirname(__file__), "skipped_frames.json")


def _load_skipped_frames() -> List[str]:
    """Load persisted skipped frames from JSON file.
    Returns an empty list if the file does not exist or is malformed.
    """
    if not os.path.exists(_SKIPPED_FRAMES_PATH):
        return []
    try:
        with open(_SKIPPED_FRAMES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_skipped_frames(frames: List[str]) -> None:
    """Persist the list of skipped frames to JSON.
    Overwrites the existing file atomically.
    """
    try:
        with open(_SKIPPED_FRAMES_PATH, "w", encoding="utf-8") as f:
            json.dump(frames, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[WARN] Could not save skipped frames: {e}")


def _add_skipped_frame(frame_text: str) -> None:
    """Add a frame to the skip list if not already present.
    This ensures the same false‑positive frame is ignored in future runs.
    """
    frames = _load_skipped_frames()
    normalized = frame_text.strip().lower()
    if normalized not in frames:
        frames.append(normalized)
        _save_skipped_frames(frames)


def _is_skipped(frame_text: str) -> bool:
    """Check whether the given frame text has been marked as skipped.
    """
    frames = _load_skipped_frames()
    return frame_text.strip().lower() in frames


def _explain_with_llm(text: str) -> str:
    """Call an LLM (OpenAI via LangChain) to generate an explanation.
    Returns a short explanatory string. If the LLM is unavailable, falls back
    to a generic placeholder.
    """
    if ChatOpenAI is None:
        return "(Giải thích không khả dụng – chưa cấu hình LLM)"
    try:
        llm = ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), temperature=0.2)
        prompt = (
            "Bạn là một trợ lý y khoa. Đọc câu sau và cung cấp một giải thích ngắn gọn, "
            "đầy đủ về nội dung mà bác sĩ đang hỏi. Không cần đưa ra lời khuyên y tế, "
            "chỉ giải thích khái niệm."
        )
        response = llm.invoke([{"role": "user", "content": f"{prompt}\n\n{ text }"}])
        return response.content.strip()
    except Exception as e:
        print(f"[WARN] LLM explanation failed: {e}")
        return "(Giải thích không khả dụng – lỗi khi gọi LLM)"


class IntentClassifier:
    """Phân loại text tiếng Việt thành VoiceIntent dùng keyword matching.

    Trả về (intent, confidence) trong đó confidence ∈ [0.0, 1.0].
    Confidence được tính dựa trên độ dài keyword khớp:
      - keyword 1 từ → 0.5
      - keyword 2 từ → 0.7
      - keyword 3+ từ → 0.9
    """

    # Bảng keyword cho từng intent.
    # Liệt kê từ cụ thể → chung để ưu tiên match dài trước.
    _PATTERNS: dict = {
        VoiceIntent.BO_QUA: [
            "bắt sai rồi",
            "nhận sai rồi",
            "không phải tổn thương",
            "bọt trắng",
            "ánh sáng phản chiếu",
            "dịch nhầy",
            "false positive",
            "bỏ qua",
            "loại bỏ",
            "không phải",
            "không đúng",
            "bắt sai",
            "nhận sai",
            "nhầm",
            "sai",
            "bọt",
            "loáng",
        ],
        VoiceIntent.GIAI_THICH: [
            "giải thích thêm",
            "nói thêm về",
            "chi tiết hơn",
            "phân tích thêm",
            "thêm thông tin",
            "tại sao lại",
            "vì sao lại",
            "giải thích",
            "thích thêm",
            "phân tích",
            "nói thêm",
            "chi tiết",
            "thêm nào",
            "tại sao",
            "vì sao",
        ],
        VoiceIntent.KIEM_TRA_LAI: [
            "kiểm tra lại",
            "phân tích lại",
            "đánh giá lại",
            "xem lại đi",
            "nhìn lại xem",
            "check lại",
            "xem lại",
            "nhìn lại",
            "kiểm tra",
            "lại",
        ],
        VoiceIntent.XAC_NHAN: [
            "xác nhận đúng",
            "đúng rồi",
            "chính xác",
            "lưu lại",
            "ghi nhận",
            "xác nhận",
            "đúng",
            "chuẩn",
            "ok",
            "được",
        ],
    }

    def classify(self, text: str) -> Tuple[VoiceIntent, float]:
        """Phân loại text thành (VoiceIntent, confidence).

        Nếu text đã được đánh dấu là bỏ qua (BO_QUA) trước đó, trả về BO_QUA ngay lập tức.
        """
        if _is_skipped(text):
            # Frame đã được bỏ qua trước đây
            return VoiceIntent.BO_QUA, 1.0

        normalized = self._normalize(text)

        best_intent = VoiceIntent.UNKNOWN
        best_confidence = 0.0

        for intent, keywords in self._PATTERNS.items():
            for keyword in keywords:
                if self._matches(keyword, normalized):
                    confidence = self._keyword_confidence(keyword)
                    if confidence > best_confidence:
                        best_confidence = confidence
                        best_intent = intent
        return best_intent, best_confidence

    @staticmethod
    def _matches(keyword: str, normalized: str) -> bool:
        """Khớp keyword theo ranh giới TỪ, không phải substring thô.

        `normalized` đã được tách bằng khoảng trắng đơn và bỏ dấu câu, nên ta
        chỉ chấp nhận khi keyword nằm trọn vẹn giữa các ranh giới khoảng trắng.
        Tránh các match sai kiểu "lại" lọt vào "tải", "sai" lọt vào "sai số"
        ở giữa một token dài hơn.
        """
        return re.search(rf"(?<!\S){re.escape(keyword)}(?!\S)", normalized) is not None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize(text: str) -> str:
        """Lowercase, bỏ dấu câu để tăng tỷ lệ match."""
        text = text.lower().strip()
        text = re.sub(r"[^\w\s]", "", text)   # bỏ dấu câu
        text = re.sub(r"\s+", " ", text)       # chuẩn hóa khoảng trắng
        return text

    @staticmethod
    def _keyword_confidence(keyword: str) -> float:
        """Tính confidence theo số từ trong keyword.
        1 từ  → 0.5
        2 từ  → 0.7
        3+ từ → 0.9
        """
        word_count = len(keyword.split())
        if word_count == 1:
            return 0.5
        elif word_count == 2:
            return 0.7
        else:
            return 0.9

    # ------------------------------------------------------------------
    # Public helper methods for downstream processing
    # ------------------------------------------------------------------

    def handle_intent(self, intent: VoiceIntent, text: str) -> str:
        """Xử lý intent đặc biệt.
        * GIAI_THICH → gọi LLM để giải thích và trả về chuỗi giải thích.
        * BO_QUA      → lưu frame để bỏ qua trong các lần chạy tiếp theo.
        Các intent khác trả về chuỗi rỗng.
        """
        if intent == VoiceIntent.GIAI_THICH:
            return _explain_with_llm(text)
        if intent == VoiceIntent.BO_QUA:
            _add_skipped_frame(text)
            return "(frame đã được bỏ qua và sẽ không tái phát hiện)"
        return ""
