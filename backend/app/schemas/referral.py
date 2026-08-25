"""Referral API schemas — Pydantic models for request/response validation."""
from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


# ── Nested payload shapes ────────────────────────────────────────────────────

class PatientInfo(BaseModel):
    name: str
    mrn: str
    dob: str
    sex: str
    phone: str | None = None

class ReferringProvider(BaseModel):
    provider: str
    npi: str | None = None
    practice: str | None = None
    phone: str | None = None
    fax: str | None = None

class Diagnosis(BaseModel):
    icd10: str
    description: str

class Attachment(BaseModel):
    title: str
    type: str
    date: str
    pages: int | None = None

class StructuredData(BaseModel):
    vitals: dict[str, str] | None = None
    meds: list[str] | None = None
    problems: list[str] | None = None

class ExtractionVariable(BaseModel):
    value: str | int | float | bool
    confidence: float

class ReferralExtraction(BaseModel):
    variables: dict[str, ExtractionVariable]
    sources: dict[str, str]

class WorkupStateEntry(BaseModel):
    status: str
    responsible: str
    dueDaysBeforeVisit: int

class ScopeAnnotation(BaseModel):
    kind: str
    suggestedRedirect: str
    reason: str

class FlagsAnnotation(BaseModel):
    ambiguousBetween: list[str] | None = None
    statedReasonMismatch: bool | None = None

class ReferralAnnotations(BaseModel):
    scope: ScopeAnnotation | None = None
    flags: FlagsAnnotation | None = None
    workupState: dict[str, WorkupStateEntry] | None = None
    visitDate: str | None = None


# ── Payload: the full inbound referral ───────────────────────────────────────

class ReferralPayload(BaseModel):
    """The shape of an inbound referral, matching the frontend's EpicReferralPayload."""
    referralId: str
    receivedAt: str
    channel: str
    patient: PatientInfo
    referredBy: ReferringProvider
    referredToDepartment: str | None = None
    priority: str = "routine"
    reasonForReferral: str
    clinicalNote: str | None = None
    diagnoses: list[Diagnosis] = []
    attachments: list[Attachment] = []
    structured: StructuredData | None = None


# ── Create / Update ─────────────────────────────────────────────────────────

class ReferralCreate(BaseModel):
    """Create a new referral with its payload, extraction, and optional annotations."""
    payload: ReferralPayload
    extraction: ReferralExtraction
    annotations: ReferralAnnotations | None = None
    clinic_id: str | None = None


class ReferralUpdate(BaseModel):
    """Partial update to a referral (mainly for extraction re-runs or annotation changes)."""
    extraction: ReferralExtraction | None = None
    annotations: ReferralAnnotations | None = None


# ── Read ─────────────────────────────────────────────────────────────────────

class ReferralRead(BaseModel):
    """Full referral as returned by the API, matching the frontend's ReferralFixture shape."""
    id: str
    payload: ReferralPayload
    extraction: ReferralExtraction
    annotations: ReferralAnnotations | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Review ───────────────────────────────────────────────────────────────────

class CorrectionData(BaseModel):
    field: str
    fromValue: str = Field(alias="from")
    to: str
    reason: str

    model_config = {"populate_by_name": True}

class ReviewCreate(BaseModel):
    status: str
    actor: str
    role: str
    correction: CorrectionData | None = None
    note: str | None = None

class ReviewRead(BaseModel):
    id: str
    referral_id: str
    status: str
    reviewer: str | None = None
    reviewed_at: datetime | None = None
    surgeon_seen: bool = False
    correction: dict | None = None
    workup_overrides: dict | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Audit ────────────────────────────────────────────────────────────────────

class AuditEventRead(BaseModel):
    id: str
    referral_id: str
    at: datetime
    actor: str
    role: str
    action: str
    correction: dict | None = None
    note: str | None = None

    model_config = {"from_attributes": True}


# ── Workup status update ────────────────────────────────────────────────────

class WorkupStatusUpdate(BaseModel):
    item_name: str
    status: str
    actor: str
    role: str
