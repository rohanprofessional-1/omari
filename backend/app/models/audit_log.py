import uuid
import enum
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Enum, ForeignKey, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, utcnow


class AuditAction(str, enum.Enum):
    """Every auditable event type in the system."""
    patient_created = "patient.created"
    patient_updated = "patient.updated"
    patient_viewed = "patient.viewed"
    patient_deleted = "patient.deleted"
    referral_created = "referral.created"
    referral_status_changed = "referral.status_changed"
    conversation_started = "conversation.started"
    conversation_routed = "conversation.routed"
    conversation_escalated = "conversation.escalated"


class AuditLog(Base):
    """Append-only audit trail for patient-scoped events.

    Rows are NEVER updated or soft-deleted — this table is an immutable ledger.
    The denormalized ``actor_label`` ensures audit rows remain human-readable
    even if the acting user is later removed from the system.
    """
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    patient_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("patients.id"), nullable=False
    )
    actor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_label: Mapped[str] = mapped_column(
        String(255), nullable=False, default="system"
    )
    action: Mapped[AuditAction] = mapped_column(
        Enum(AuditAction, name="audit_action_enum"), nullable=False
    )
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    # Relationships (read-only lookups)
    patient: Mapped["Patient"] = relationship()
    actor: Mapped["User | None"] = relationship()

    __table_args__ = (
        Index("ix_audit_logs_patient_id", "patient_id"),
        Index("ix_audit_logs_timestamp", "timestamp"),
        Index("ix_audit_logs_patient_action", "patient_id", "action"),
    )
