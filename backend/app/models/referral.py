import uuid
from sqlalchemy import String, Text, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Referral(Base, TimestampMixin):
    """
    Stores Epic-specific metadata for a C-CDA referral ingestion.

    Each Referral links 1:1 to a Conversation (mode='referral') and tracks
    the raw C-CDA content, parsed sections, LLM extraction results, and
    FHIR resource identifiers for auditability.
    """
    __tablename__ = "referrals"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    patient_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("patients.id"), nullable=True
    )

    # Epic FHIR identifiers
    epic_patient_fhir_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    document_reference_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    document_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Raw and processed document content
    ccda_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    sections_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    extraction_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    extraction_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Processing status: pending | extracted | routed | failed
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)

    # Relationships
    conversation: Mapped["Conversation"] = relationship()
    patient: Mapped["Patient | None"] = relationship()
