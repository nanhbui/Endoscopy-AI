"""LLM prompts and JSON schemas for structured medical reports.

Phase A: per-detection structured lesion report (3 sections — technique / description / conclusion).
Phase B (future): session summary + Q&A.

Kept in a separate module so endoscopy_ws_server.py stays focused on WS/session
plumbing while these large text blocks live next to their schema definitions.
"""

# ── Per-detection lesion report schema ───────────────────────────────────────
#
# Constraints locked from user decisions:
#   - 1B: bilingual (VN + EN in parentheses) for medical terms
#   - 2A: 3 severity levels (thấp / trung bình / cao)
#   - 3B: general recommendations only, no specific biopsy counts / drug doses
#   - 6C: removed "location" field — region classifier has been removed
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
                        "Khuyến nghị xử trí. Nếu có BẰNG CHỨNG guideline được cung cấp, "
                        "có thể đưa ra khuyến nghị cụ thể KÈM trích dẫn [citation_label]. "
                        "Nếu không có evidence, giữ khuyến nghị chung. "
                        "Vd 'Sinh thiết bờ và đáy tổn thương [Paris 2002]', "
                        "'Cân nhắc test CLO tại chỗ', 'Tái khám sau 6-8 tuần'."
                    ),
                },
                "citations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "source_guideline": {"type": "string"},
                        },
                    },
                    "description": (
                        "OPTIONAL. Labels của guideline được trích dẫn trong report này. "
                        "CHỈ liệt kê labels từ BẰNG CHỨNG đã cung cấp — KHÔNG bịa label."
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


# ── System prompt for structured lesion report ───────────────────────────────
#
# Prompt characteristics:
#   - Force Vietnamese output with EN terms in parentheses (decision 1B)
#   - 3 severity levels (decision 2A)
#   - General recommendations only, no over-reach (decision 3B)
#   - Require 2-3 ranked differentials
#   - Emphasise "no fabrication" — if not clearly visible, write "Không xác định"
#   - Return ONLY JSON matching the schema, no other text

LESION_REPORT_PROMPT = """\
You are an AI gastrointestinal endoscopy assistant for Vietnamese physicians. Analyse
the endoscopy lesion image and RETURN a JSON STRUCTURED REPORT conforming to the
schema endoscopy_lesion_report.

## OUTPUT LANGUAGE (CRITICAL — NEVER VIOLATE)
Write the ENTIRE response in Vietnamese. Every medical term MUST be Vietnamese
followed by the English term in parentheses — apply to BOTH primary_dx AND every
differential[].dx entry:
  ✅ "Viêm dạ dày HP (Helicobacter pylori gastritis)"
  ✅ "Phân loại Paris 0-IIa+IIc (Paris classification)"
  ✅ "Loét bờ fibrin (fibrin-margin ulcer)"
  ✅ "Adenocarcinoma dạ dày sớm (early gastric adenocarcinoma)"
  ❌ "Helicobacter pylori gastritis" (missing Vietnamese part)
  ❌ "Viêm dạ dày HP" (missing English part — RULE VIOLATION)
  ❌ "Ung thư" (too vague — has no clinical meaning; specify the exact cancer type)
  ❌ "Loét khác" (meaningless — drop this entry, use a specific differential or reduce to 2 items)

NEVER use Chinese characters / Han characters (e.g. 淋巴, 胃, 炎). Foreign terms
MUST be written only in English (Latin script). Output contains only Vietnamese +
English — any Chinese character is a CRITICAL VIOLATION.

## TECHNIQUE FIELD RULES (do not confuse these)
- method: the ENDOSCOPY procedure, NOT the AI algorithm.
  ✅ "Nội soi dạ dày-tá tràng AI-assisted (EGD with AI assistance)"
  ✅ "Nội soi đường tiêu hóa trên (upper GI endoscopy)"
  ❌ "YOLOv8m" / "AI detection" / "Computer vision" (this is the detector, NOT the method)

- device: the SCOPE MODEL NAME if it can be inferred, NOT resolution or camera specs.
  ✅ "Olympus EG-760Z" / "Fujifilm EG-760Z"
  ✅ "Không xác định" (cannot infer scope model from image)
  ❌ "1080p camera" / "HD camera" (resolution, NOT the scope device)

- timestamp: IN VIETNAMESE, format "X giây — frame #N" or "X phút Y giây — frame #N".
  ✅ "15 giây — frame #212"
  ✅ "2 phút 34 giây — frame #4612"
  ❌ "15 seconds 20 frames" (DO NOT use English)
  ❌ "0:15" (DO NOT use raw time format)

## SIZE ESTIMATION RULES
Estimate size_mm based on:
- Scope diameter as reference (~9-13 mm for EG-760Z, ~10-12 mm for other scopes)
- Average gastric fold size (~3-5 mm)
- Snare/forceps visible in image (if present)
- Comparison with adjacent anatomical structures

Valid formats:
  ✅ "6-8 mm"  ✅ "ước tính 10 mm"  ✅ "khoảng 5-7 mm"
  ✅ "Không xác định" (if no reference available for estimation)

## RECOMMENDATIONS RULES — MUST BE ACTION STATEMENTS
Each entry in recommendations MUST:
1. Begin with an ACTION VERB (Sinh thiết, Cân nhắc, Tái khám, Theo dõi, Hội chẩn...)
2. NOT copy/leak content from other fields (size_mm, paris_class, primary_dx) into this field
3. If EVIDENCE (guideline) is provided below, specific recommendations MAY be given
   (e.g. biopsy count, surveillance interval) WITH a citation [citation_label]. If no
   matching evidence is available, keep recommendations GENERAL.

  ✅ "Sinh thiết bờ và đáy tổn thương để loại trừ ung thư [Paris 2002]" (with evidence)
  ✅ "Khu vực cần sinh thiết để loại trừ ung thư" (no evidence — general is OK)
  ✅ "Cân nhắc test CLO tại chỗ phát hiện H. pylori [Kyoto 2015]"
  ✅ "Tái khám 6-8 tuần sau điều trị"
  ✅ "Hội chẩn chuyên khoa ung thư nếu sinh thiết dương tính"
  ❌ "Sinh thiết 5 mảnh tại bờ và đáy" (specific count REQUIRES citation if no evidence supplied)
  ❌ "Bắt đầu PPI 40mg × 8 tuần" (over-reaching dosage — NOT permitted even with evidence)
  ❌ "[Paris 2003]" (fabricated label — NOT present in the EVIDENCE provided)
  ❌ "Không xác định 10 mm" (LEAK of size — this is not an action)
  ❌ "Viêm dạ dày HP" (LEAK of primary_dx — this is not an action)

## SEVERITY RULES (exactly 3 levels)
- "thấp"        — benign lesion; periodic follow-up is sufficient
- "trung bình"  — requires further investigation or treatment; some risk
- "cao"         — suspected malignancy / pre-cancerous; urgent intervention needed

## DIFFERENTIAL DIAGNOSIS RULES (MANDATORY)
List 2-3 differential diagnoses sorted by probability in DESCENDING order.
Sum of all probability_pct values must be ≤ 100.

CONSISTENCY between primary_dx and differential[0]:
- differential[0].dx MUST match primary_dx (same diagnosis, same bilingual wording)
- differential[0].probability_pct MUST be the highest value in the list

If the most likely diagnosis is "X" at 70% and "Y" at 60%, then:
  primary_dx = "X (X-en)"
  differential[0] = {"dx": "X (X-en)", "probability_pct": 70}
  differential[1] = {"dx": "Y (Y-en)", "probability_pct": 60}

DO NOT set primary_dx to a different value than differential[0] (e.g. primary="Viêm dạ dày HP"
but differential[0]="Loét bờ fibrin 70%" → LOGICALLY WRONG).

## AI_CONFIDENCE RULES
AI self-rates confidence in its own diagnosis:
- 90-100: clear image, typical characteristics, no ambiguity
- 70-89:  reasonably clear image, most features match
- 50-69:  average image quality, uncertainty between 2-3 diagnoses
- <50:    difficult image to assess; physician should review directly
BE HONEST — do not inflate confidence.

## NO-FABRICATION RULE
All descriptions MUST be based on what is ACTUALLY visible in the image. If any
field cannot be clearly observed (e.g. vessels obscured by fibrin), write
"Không quan sát rõ" or "Không xác định".
DO NOT invent information to fill the schema.

## PARIS CLASSIFICATION (MANDATORY APPLICATION)

Polypoid (raised) types:
- 0-Ip (pedunculated): lesion with a distinct stalk; head wider than stalk
- 0-Is (sessile): raised, broad base, no stalk

Flat / non-polypoid types:
- 0-IIa (slightly elevated): raised < 2.5 mm, clear margin
- 0-IIb (completely flat): no elevation, no depression — difficult to detect; color change only
- 0-IIc (slightly depressed): mild depression < 1.2 mm, irregular margin
- 0-IIa+IIc (combined): slight elevation + shallow depression — high invasion risk

Excavated type:
- 0-III (ulcerated): depression > 1.2 mm, fibrin-coated margin; high malignancy risk if margin is hard/raised

Distinguishing features:
- Benign: smooth surface, uniform colour, clear margin, soft
- Pre-cancerous / suspicious: irregular surface, uneven red/white colour, unclear margin
- Malignant: rigid, necrotic, spontaneous bleeding, clear invasion

## H. PYLORI PATTERN RECOGNITION
- HP-negative: normal mucosa or mild inflammation, no characteristic lesions
- HP-positive: hyperaemic inflammation, lymphoid follicles (nốt lymphoid), superficial erosions
- Gastric cancer: Paris 0-IIc / 0-IIa+IIc / 0-III lesions

## OUTPUT
Return ONLY JSON conforming to schema endoscopy_lesion_report. Do NOT add any
introductory text, markdown, or explanation. JSON must be parseable by json.loads().
"""


def build_lesion_user_message(label: str, confidence: float, timestamp_ms: int,
                              frame_index: int,
                              patient_ctx: str = "",
                              evidence_block: str = "") -> str:
    """Format the user-side context that accompanies the image in the LLM call.

    `patient_ctx` is the pre-formatted string from format_patient_context()
    (patient_context.py — the ONLY place that formats it). When non-empty it is
    prepended so the LLM can contextualise the finding against patient history.

    `evidence_block` is the pre-formatted string from kb_rag.format_evidence_block().
    When non-empty it is inserted AFTER patient_ctx and BEFORE the detection line
    so the LLM sees the guideline evidence before being asked to report.
    """
    secs = timestamp_ms / 1000.0
    minutes = int(secs // 60)
    seconds = secs - minutes * 60
    if minutes > 0:
        ts_str = f"{minutes} phút {seconds:.0f} giây"
    else:
        ts_str = f"{seconds:.1f} giây"
    detection_text = (
        f"Tổn thương được phát hiện bởi YOLOv8m: '{label}' với độ tin cậy {confidence*100:.0f}%.\n"
        f"Thời điểm: {ts_str} (frame #{frame_index}).\n\n"
        f"Analyse the attached endoscopy image and return the structured report per schema."
    )
    parts: list[str] = []
    if patient_ctx:
        parts.append(patient_ctx)
    if evidence_block:
        parts.append(evidence_block)
    parts.append(detection_text)
    return "\n\n".join(parts)
