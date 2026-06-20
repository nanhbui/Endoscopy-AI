"""Patient context dataclass and formatter — single source of formatting (DRY).

PHI note: do NOT log raw context values; caller is responsible for audit logging.
This module only formats; storage and retrieval are in db.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PatientContext:
    """Structured patient metadata attached to an endoscopy session.

    All fields are optional — the patient-context form is pre-session and
    a doctor may leave any field blank.
    """
    age: Optional[int] = None          # years, clamped to 0–120
    sex: Optional[str] = None          # "Nam" | "Nữ" | "Khác" or None
    indication: Optional[str] = None   # lý do nội soi
    history: Optional[str] = None      # tiền sử bệnh
    meds: Optional[str] = None         # thuốc đang dùng

    # ── Validation ────────────────────────────────────────────────────────
    def __post_init__(self) -> None:
        if self.age is not None:
            self.age = max(0, min(120, int(self.age)))
        # Normalise empty strings to None so formatters can test truthiness.
        for attr in ("sex", "indication", "history", "meds"):
            val = getattr(self, attr)
            if isinstance(val, str):
                stripped = val.strip()
                setattr(self, attr, stripped if stripped else None)

    # ── Dict helpers (used by db.py for JSON serialisation) ───────────────
    def to_dict(self) -> dict:
        return {
            "age": self.age,
            "sex": self.sex,
            "indication": self.indication,
            "history": self.history,
            "meds": self.meds,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PatientContext":
        """Construct from a plain dict (e.g. loaded from DB JSON column)."""
        return cls(
            age=d.get("age"),
            sex=d.get("sex"),
            indication=d.get("indication"),
            history=d.get("history"),
            meds=d.get("meds"),
        )


def format_patient_context(ctx: Optional[PatientContext]) -> str:
    """Return a compact bilingual block for insertion into LLM prompts.

    Omits any field that is None/empty.  Returns "" when ctx is None or
    all fields are empty — callers can test ``if formatted:`` to skip
    the insertion entirely.

    Example output:
        ## Bệnh nhân (Patient)
        - Tuổi (Age): 54 | Giới (Sex): Nam
        - Lý do nội soi (Indication): đau thượng vị
        - Tiền sử (History): viêm dạ dày mãn
        - Thuốc đang dùng (Current meds): omeprazole 20 mg
    """
    if ctx is None:
        return ""

    lines: list[str] = []

    # Age + sex on the same line when both are present.
    age_part = f"Tuổi (Age): {ctx.age}" if ctx.age is not None else ""
    sex_part = f"Giới (Sex): {ctx.sex}" if ctx.sex else ""
    if age_part or sex_part:
        lines.append("- " + " | ".join(p for p in [age_part, sex_part] if p))

    if ctx.indication:
        lines.append(f"- Lý do nội soi (Indication): {ctx.indication}")
    if ctx.history:
        lines.append(f"- Tiền sử (History): {ctx.history}")
    if ctx.meds:
        lines.append(f"- Thuốc đang dùng (Current meds): {ctx.meds}")

    if not lines:
        return ""

    return "## Bệnh nhân (Patient)\n" + "\n".join(lines)
