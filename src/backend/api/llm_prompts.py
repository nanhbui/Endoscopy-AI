"""LLM prompts and JSON schemas for structured medical reports.

Phase A: per-detection structured lesion report (3 sections — Kỹ thuật / Mô tả / Kết luận).
Phase B (future): session summary + Q&A.

Kept in a separate module so endoscopy_ws_server.py stays focused on WS/session
plumbing while these large text blocks live next to their schema definitions.
"""

# ── Per-detection lesion report schema ───────────────────────────────────────
#
# Constraints locked from user decisions:
#   - 1B: bilingual (VN + EN trong ngoặc) cho thuật ngữ y khoa
#   - 2A: 3 mức severity (thấp / trung bình / cao)
#   - 3B: khuyến nghị chung chung, không số mảnh sinh thiết cụ thể
#   - 6C: bỏ field "vị trí" — region classifier đã removed
#
# The schema follows OpenAI's JSON Schema spec (also accepted by Ollama via
# response_format). Required fields enforce that the LLM produces a complete
# report — partial outputs would break the frontend's structured rendering.

LESION_REPORT_SCHEMA = {
    "type": "object",
    "required": ["technique", "description", "conclusion"],
    "properties": {
        "technique": {
            "type": "object",
            "required": ["method", "device", "timestamp"],
            "properties": {
                "method": {
                    "type": "string",
                    "description": "Phương pháp (vd 'Nội soi dạ dày-tá tràng AI-assisted')",
                },
                "device": {
                    "type": "string",
                    "description": "Thiết bị scope nếu suy luận được, ngược lại 'Không xác định'",
                },
                "timestamp": {
                    "type": "string",
                    "description": "Thời điểm phát hiện (vd '2 phút 34 giây — frame 4612')",
                },
            },
        },
        "description": {
            "type": "object",
            "required": [
                "size_mm", "paris_class", "surface", "color",
                "margin", "vascular", "fluid",
            ],
            "properties": {
                "size_mm": {
                    "type": "string",
                    "description": (
                        "Ước tính kích thước theo mm (vd '6-8 mm', 'ước tính 10 mm') "
                        "hoặc 'Không xác định' nếu không thể đo"
                    ),
                },
                "paris_class": {
                    "type": "string",
                    "description": (
                        "Phân loại Paris (vd '0-Ip', '0-IIa', '0-IIa+IIc', '0-III'). "
                        "Bilingual: 'Phân loại 0-IIc (Paris 0-IIc, lõm nông)'"
                    ),
                },
                "surface": {
                    "type": "string",
                    "description": "Bề mặt (trơn / sần / lõm / có fibrin / hoại tử ...)",
                },
                "color": {
                    "type": "string",
                    "description": "Màu sắc (đỏ / xung huyết / nhạt / không đều ...)",
                },
                "margin": {
                    "type": "string",
                    "description": "Bờ tổn thương (rõ / không rõ / cứng / mềm / gồ lên ...)",
                },
                "vascular": {
                    "type": "string",
                    "description": "Mạch máu bề mặt (rõ / mờ / bị fibrin che / mất pattern ...)",
                },
                "fluid": {
                    "type": "string",
                    "description": "Dịch / máu (không thấy / chảy máu nhẹ / mủ ...)",
                },
            },
        },
        "conclusion": {
            "type": "object",
            "required": [
                "primary_dx", "severity", "differential",
                "recommendations", "ai_confidence",
            ],
            "properties": {
                "primary_dx": {
                    "type": "string",
                    "description": (
                        "Chẩn đoán nghi ngờ chính, BILINGUAL: VN (EN). "
                        "Vd 'Viêm dạ dày HP (Helicobacter pylori gastritis)'"
                    ),
                },
                "severity": {
                    "type": "string",
                    "enum": ["thấp", "trung bình", "cao"],
                    "description": "Mức độ nghiêm trọng — chỉ 3 giá trị enum",
                },
                "differential": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 3,
                    "items": {
                        "type": "object",
                        "required": ["dx", "probability_pct"],
                        "properties": {
                            "dx": {
                                "type": "string",
                                "description": "Chẩn đoán phân biệt, bilingual VN (EN)",
                            },
                            "probability_pct": {
                                "type": "integer",
                                "minimum": 0,
                                "maximum": 100,
                                "description": "Xác suất % (tổng các differential ≤ 100)",
                            },
                        },
                    },
                    "description": "2-3 chẩn đoán phân biệt sắp xếp giảm dần theo xác suất",
                },
                "recommendations": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Khuyến nghị xử trí — CHUNG CHUNG, không số mảnh cụ thể. "
                        "Vd 'Khu vực cần sinh thiết để loại trừ ung thư', "
                        "'Cân nhắc test CLO tại chỗ', 'Tái khám sau 6-8 tuần'. "
                        "KHÔNG ghi 'Sinh thiết 5 mảnh tại bờ' (over-reach lâm sàng)"
                    ),
                },
                "ai_confidence": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 100,
                    "description": "AI tự đánh giá độ tin cậy 0-100, phải honest",
                },
            },
        },
    },
}


# ── System prompt cho structured report ─────────────────────────────────────
#
# Đặc điểm prompt:
#   - Force tiếng Việt với thuật ngữ EN trong ngoặc (decision 1B)
#   - 3 mức severity (decision 2A)
#   - Khuyến nghị chung chung không over-reach (decision 3B)
#   - Bắt buộc 2-3 differential ranked
#   - Nhấn mạnh "không bịa" — nếu không thấy rõ thì ghi "Không xác định"
#   - Chỉ trả về JSON theo schema, không text khác

LESION_REPORT_PROMPT = """\
Bạn là trợ lý nội soi tiêu hóa AI cho bác sĩ Việt Nam. Phân tích ảnh tổn thương
endoscopy và TRẢ VỀ JSON STRUCTURED REPORT theo schema endoscopy_lesion_report.

## QUY TẮC NGÔN NGỮ (BẮT BUỘC — KHÔNG được bỏ qua)
Toàn bộ output là tiếng Việt. Mọi THUẬT NGỮ Y KHOA bắt buộc kèm phần
tiếng Anh trong ngoặc — áp dụng cho CẢ primary_dx VÀ MỌI mục differential[].dx:
  ✅ "Viêm dạ dày HP (Helicobacter pylori gastritis)"
  ✅ "Phân loại Paris 0-IIa+IIc (Paris classification)"
  ✅ "Loét bờ fibrin (fibrin-margin ulcer)"
  ✅ "Adenocarcinoma dạ dày sớm (early gastric adenocarcinoma)"
  ❌ "Helicobacter pylori gastritis" (thiếu phần VN)
  ❌ "Viêm dạ dày HP" (thiếu phần EN — VI PHẠM rule)
  ❌ "Ung thư" (quá chung — KHÔNG có nghĩa lâm sàng, phải nói rõ ung thư gì)
  ❌ "Loét khác" (vô nghĩa — bỏ entry này, ghi differential cụ thể hoặc giảm xuống 2 mục)

## QUY TẮC KỸ THUẬT (technique fields — đừng nhầm)
- method: phương pháp NỘI SOI, không phải thuật toán AI.
  ✅ "Nội soi dạ dày-tá tràng AI-assisted (EGD with AI assistance)"
  ✅ "Nội soi đường tiêu hóa trên (upper GI endoscopy)"
  ❌ "YOLOv8m" / "AI detection" / "Computer vision" (đây là detector, KHÔNG phải method)

- device: TÊN scope nếu suy ra được, không phải resolution / camera spec.
  ✅ "Olympus EG-760Z" / "Fujifilm EG-760Z"
  ✅ "Không xác định" (không suy luận được loại scope từ ảnh)
  ❌ "1080p camera" / "HD camera" (resolution, KHÔNG phải scope device)

- timestamp: TIẾNG VIỆT, format "X giây — frame #N" hoặc "X phút Y giây — frame #N".
  ✅ "15 giây — frame #212"
  ✅ "2 phút 34 giây — frame #4612"
  ❌ "15 seconds 20 frames" (KHÔNG dùng tiếng Anh)
  ❌ "0:15" (KHÔNG dùng raw time format)

## QUY TẮC ƯỚC LƯỢNG KÍCH THƯỚC
Ước lượng size_mm dựa trên:
- Đường kính scope tham chiếu (~9-13 mm cho EG-760Z, ~10-12 mm cho scope khác)
- Kích thước nếp gấp dạ dày trung bình (~3-5 mm)
- Snare/forceps trong ảnh (nếu có)
- So sánh với cấu trúc giải phẫu lân cận

Format hợp lệ:
  ✅ "6-8 mm"  ✅ "ước tính 10 mm"  ✅ "khoảng 5-7 mm"
  ✅ "Không xác định" (nếu không có reference để ước lượng)

## QUY TẮC KHUYẾN NGHỊ (recommendations) — BẮT BUỘC LÀ HÀNH ĐỘNG
Mỗi entry trong recommendations PHẢI:
1. Bắt đầu bằng ĐỘNG TỪ chỉ hành động (Sinh thiết, Cân nhắc, Tái khám, Theo dõi, Hội chẩn...)
2. KHÔNG copy/leak nội dung từ field khác (size_mm, paris_class, primary_dx) vào đây
3. KHÔNG over-reach quyền chỉ định lâm sàng (số mảnh sinh thiết cụ thể, liều thuốc cụ thể)

  ✅ "Khu vực cần sinh thiết để loại trừ ung thư"
  ✅ "Cân nhắc test CLO tại chỗ phát hiện H. pylori"
  ✅ "Tái khám 6-8 tuần sau điều trị"
  ✅ "Cân nhắc EUS nếu nghi ngờ xâm lấn sâu"
  ✅ "Hội chẩn chuyên khoa ung thư nếu sinh thiết dương tính"
  ❌ "Sinh thiết 5 mảnh tại bờ và đáy" (over-reach số mảnh)
  ❌ "Bắt đầu PPI 40mg × 8 tuần" (over-reach liều)
  ❌ "Không xác định 10 mm" (LEAK size — không phải hành động)
  ❌ "Phân loại Paris 0-IIa" (LEAK paris_class — không phải hành động)
  ❌ "Viêm dạ dày HP" (LEAK primary_dx — không phải hành động)

## QUY TẮC SEVERITY (chỉ 3 mức)
- "thấp"        — tổn thương lành tính, theo dõi định kỳ là đủ
- "trung bình"  — cần xét nghiệm thêm hoặc điều trị, có nguy cơ
- "cao"         — nghi ngờ ác tính / tiền ung thư, cần can thiệp khẩn

## QUY TẮC DIFFERENTIAL DIAGNOSIS (BẮT BUỘC)
Liệt kê 2-3 chẩn đoán phân biệt, sắp xếp xác suất GIẢM DẦN.
Tổng probability_pct của các differential ≤ 100.

NHẤT QUÁN giữa primary_dx và differential[0]:
- differential[0].dx PHẢI khớp với primary_dx (cùng chẩn đoán, cùng wording bilingual)
- differential[0].probability_pct PHẢI là giá trị cao nhất trong list

Nếu nghi nhất là "X" với 70% và "Y" 60%, thì:
  primary_dx = "X (X-en)"
  differential[0] = {"dx": "X (X-en)", "probability_pct": 70}
  differential[1] = {"dx": "Y (Y-en)", "probability_pct": 60}

KHÔNG được đặt primary_dx khác với differential[0] (vd primary="Viêm dạ dày HP"
nhưng differential[0]="Loét bờ fibrin 70%" → SAI logic).

## QUY TẮC AI_CONFIDENCE
AI tự chấm điểm độ tin cậy của chính chẩn đoán này:
- 90-100: ảnh rõ, đặc điểm điển hình, không nhầm lẫn được
- 70-89:  ảnh khá rõ, đa số đặc điểm phù hợp
- 50-69:  ảnh trung bình, có phân vân giữa 2-3 chẩn đoán
- <50:    ảnh khó đánh giá, nên BS xem trực tiếp
HONEST — không inflate confidence.

## QUY TẮC "KHÔNG BỊA"
Mọi mô tả PHẢI dựa trên những gì THỰC SỰ thấy trong ảnh. Nếu không quan sát rõ
field nào (vd mạch máu bị che bởi fibrin), ghi "Không quan sát rõ" hoặc "Không xác định".
KHÔNG bịa đặt thông tin để filling schema.

## PHÂN LOẠI PARIS (BẮT BUỘC ÁP DỤNG)

Dạng polypoid (nhô cao):
- 0-Ip (cuống): tổn thương có cuống rõ, đầu to hơn thân
- 0-Is (không cuống): nhô cao, đáy rộng, không cuống

Dạng phẳng / không polypoid:
- 0-IIa (nhô thấp): nhô < 2.5 mm, bờ rõ
- 0-IIb (phẳng hoàn toàn): không nhô, không lõm — khó nhận biết, thay đổi màu sắc
- 0-IIc (lõm nông): lõm nhẹ < 1.2 mm, bờ không đều
- 0-IIa+IIc (kết hợp): nhô thấp + lõm nông — nguy cơ xâm lấn cao

Dạng lõm sâu:
- 0-III (loét): lõm > 1.2 mm, có bờ fibrin, nguy cơ ác tính cao nếu bờ cứng/gồ

Đặc điểm phân biệt:
- Lành tính: bề mặt trơn, màu đều, bờ rõ, mềm
- Tiền ung thư / nghi ngờ: gồ ghề, đỏ/trắng không đều, bờ không rõ
- Ác tính: cứng, hoại tử, chảy máu tự phát, xâm lấn rõ

## DẤU HIỆU H. PYLORI
- HP-negative: niêm mạc bình thường hoặc viêm nhẹ, không tổn thương đặc trưng
- HP-positive: viêm xung huyết, nốt lymphoid (lymphoid follicles), vết trợt nông (erosions)
- Gastric cancer: tổn thương Paris 0-IIc / 0-IIa+IIc / 0-III

## OUTPUT
CHỈ trả về JSON theo schema endoscopy_lesion_report. Không thêm text giới thiệu,
không markdown, không giải thích. JSON phải parse được bằng json.loads().
"""


def build_lesion_user_message(label: str, confidence: float, timestamp_ms: int,
                              frame_index: int) -> str:
    """Format the user-side context that accompanies the image in the LLM call.

    Provides the AI's own detection metadata so the report can reference what was
    flagged and why we're asking. Keep this short — the image carries most signal.
    """
    secs = timestamp_ms / 1000.0
    minutes = int(secs // 60)
    seconds = secs - minutes * 60
    if minutes > 0:
        ts_str = f"{minutes} phút {seconds:.0f} giây"
    else:
        ts_str = f"{seconds:.1f} giây"
    return (
        f"Tổn thương được phát hiện bởi YOLOv8m: '{label}' với độ tin cậy {confidence*100:.0f}%.\n"
        f"Thời điểm: {ts_str} (frame #{frame_index}).\n\n"
        f"Phân tích ảnh nội soi đính kèm và trả về structured report theo schema."
    )
