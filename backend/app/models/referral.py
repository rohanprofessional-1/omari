import uuid
import enum
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Enum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, utcnow

class ReferralChannel(str, enum.Enum):
    epic = "epic"
    fax = "fax"
    phone = "phone"
    other = "other"

class ReferralPriority(str, enum.Enum):
    routine = "routine"
    urgent = "urgent"

class ReferralStatus(str, enum.Enum):
    new = "new"
    needs_review = "needs_review"
    reviewed = "reviewed"
    scheduled = "scheduled"
    dismissed = "dismissed"

class Referral(Base, TimestampMixin):
    __tablename__ = "referrals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    display_id: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    patient_id: Mapped[str] = mapped_column(String(36), ForeignKey("patients.id"), nullable=False)
    referred_by_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("referring_providers.id"), nullable=True)
    routed_specialist_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("specialists.id"), nullable=True)
    tree_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("trees.id"), nullable=True)
    
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    channel: Mapped[ReferralChannel] = mapped_column(Enum(ReferralChannel, name="referral_channel_enum"), nullable=False)
    priority: Mapped[ReferralPriority] = mapped_column(Enum(ReferralPriority, name="referral_priority_enum"), nullable=False, default=ReferralPriority.routine)
    status: Mapped[ReferralStatus] = mapped_column(Enum(ReferralStatus, name="referral_status_enum"), nullable=False, default=ReferralStatus.new)
    
    reason_for_referral: Mapped[str | None] = mapped_column(Text, nullable=True)
    clinical_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    # Store dynamic extraction (LLM variables) and annotations (workup/visit date)
    extraction: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    annotations: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    structured_data: Mapped[dict | None] = mapped_column(JSON, nullable=True) # vitals, meds, problems, diagnoses
    
    # Relationships
    patient: Mapped["Patient"] = relationship()
    referred_by: Mapped["ReferringProvider | None"] = relationship()
    routed_specialist: Mapped["Specialist | None"] = relationship()
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="referral", cascade="all, delete-orphan", lazy="selectin")
