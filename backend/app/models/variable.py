import enum
from sqlalchemy import String, Text, JSON, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin


class AnswerType(str, enum.Enum):
    single_choice = "single_choice"
    number = "number"
    boolean = "boolean"
    text = "text"


class Variable(Base, TimestampMixin):
    __tablename__ = "variables"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    clinical_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer_type: Mapped[AnswerType] = mapped_column(Enum(AnswerType, name="answer_type_enum"), nullable=False)
    options_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    extraction_hints: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Domain knowledge fields for improved extraction
    # e.g. ["weakness", "can't grip", "drop things"] for a "motor_deficit" option
    synonyms: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # e.g. [{"patient_says": "my grip is weak", "maps_to": "motor_deficit"}, ...]
    patient_examples: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # e.g. {"motor_deficit": {"definition": "Loss of motor function", "patient_terms": ["weakness", "can't grip"]}}
    clinical_mappings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
