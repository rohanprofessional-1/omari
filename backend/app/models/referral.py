"""Referral model — the core of the referral review pipeline.

A Referral captures the inbound referral payload (from Epic/fax/phone),
the AI extraction results, and optional annotations (workup state, scope flags).
All data that was previously hardcoded in frontend fixtures now lives here.
"""
import uuid
from datetime import datetime
from sqlalchemy import (
    String, Text, DateTime, Boolean, Float, Enum as SAEnum,
    ForeignKey, JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, utcnow


class Referral(Base, TimestampMixin):
    """An inbound referral and its AI-extracted triage data."""
    __tablename__ = "referrals"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    clinic_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("clinics.id"), nullable=True
    )

    # ── Payload: the raw referral as received ────────────────────────────────
    referral_id: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False,
        comment="External referral identifier (e.g. REF-2026-0142)"
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    channel: Mapped[str] = mapped_column(
        String(20), nullable=False, comment="epic | fax | phone"
    )
    priority: Mapped[str] = mapped_column(
        String(20), nullable=False, default="routine",
        comment="routine | urgent"
    )

    # Patient info
    patient_name: Mapped[str] = mapped_column(String(255), nullable=False)
    patient_mrn: Mapped[str] = mapped_column(String(100), nullable=False)
    patient_dob: Mapped[str] = mapped_column(String(20), nullable=False)
    patient_sex: Mapped[str] = mapped_column(String(5), nullable=False)
    patient_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Referring provider
    referred_by_provider: Mapped[str] = mapped_column(String(255), nullable=False)
    referred_by_npi: Mapped[str | None] = mapped_column(String(20), nullable=True)
    referred_by_practice: Mapped[str | None] = mapped_column(String(255), nullable=True)
    referred_by_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    referred_by_fax: Mapped[str | None] = mapped_column(String(50), nullable=True)

    referred_to_department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason_for_referral: Mapped[str] = mapped_column(Text, nullable=False)
    clinical_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Complex nested data stored as JSON
    diagnoses: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, comment="[{icd10, description}]"
    )
    attachments: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, comment="[{title, type, date, pages?}]"
    )
    structured: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, comment="{vitals?, meds?, problems?}"
    )

    # ── Extraction: AI-extracted variables from the referral ─────────────────
    extraction_variables: Mapped[dict | None] = mapped_column(
        JSON, nullable=True,
        comment="{variableKey: {value, confidence}}"
    )
    extraction_sources: Mapped[dict | None] = mapped_column(
        JSON, nullable=True,
        comment="{variableKey: source}"
    )

    # ── Annotations: optional metadata for workup, scope, flags ─────────────
    annotations: Mapped[dict | None] = mapped_column(
        JSON, nullable=True,
        comment="scope, flags, workupState, visitDate"
    )

    # Relationships
    clinic = relationship("Clinic", backref="referrals")
    reviews: Mapped[list["ReferralReview"]] = relationship(
        back_populates="referral", cascade="all, delete-orphan", lazy="selectin"
    )
    audit_events: Mapped[list["ReferralAuditEvent"]] = relationship(
        back_populates="referral", cascade="all, delete-orphan", lazy="selectin"
    )


class ReferralReview(Base, TimestampMixin):
    """A review decision on a referral (approve, reject, correct, escalate)."""
    __tablename__ = "referral_reviews"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    referral_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("referrals.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False,
        comment="pending | approved | corrected | rejected | escalated | info_requested"
    )
    reviewer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    surgeon_seen: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Correction details (JSON for flexibility)
    correction: Mapped[dict | None] = mapped_column(
        JSON, nullable=True,
        comment="{field, from, to, reason}"
    )

    # Workup status overrides
    workup_overrides: Mapped[dict | None] = mapped_column(
        JSON, nullable=True,
        comment="{itemName: status}"
    )

    # Relationships
    referral: Mapped["Referral"] = relationship(back_populates="reviews")


class ReferralAuditEvent(Base):
    """Immutable audit trail entry for referral actions."""
    __tablename__ = "referral_audit_events"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    referral_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("referrals.id", ondelete="CASCADE"), nullable=False
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        String(30), nullable=False, comment="admin | surgeon | patient"
    )
    action: Mapped[str] = mapped_column(
        String(30), nullable=False,
        comment="pending | approved | corrected | rejected | escalated | info_requested | viewed | workup_status_changed | commented"
    )
    correction: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    referral: Mapped["Referral"] = relationship(back_populates="audit_events")
