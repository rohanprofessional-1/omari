"""Referral API — CRUD, review decisions, audit trail, workup status.

Replaces the frontend's MockEpicSource. The frontend adapter will call these
endpoints instead of reading from hardcoded fixture files.
"""
from __future__ import annotations
from typing import Any
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_db
from app.models.referral import Referral, ReferralReview, ReferralAuditEvent
from app.schemas.referral import (
    ReferralCreate,
    ReferralRead,
    ReferralUpdate,
    ReviewCreate,
    ReviewRead,
    AuditEventRead,
    WorkupStatusUpdate,
)

router = APIRouter(prefix="/referrals")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _referral_to_read(r: Referral) -> ReferralRead:
    """Map a Referral ORM row to the frontend-compatible ReferralRead shape."""
    payload = {
        "referralId": r.referral_id,
        "receivedAt": r.received_at.isoformat() if r.received_at else "",
        "channel": r.channel,
        "patient": {
            "name": r.patient_name,
            "mrn": r.patient_mrn,
            "dob": r.patient_dob,
            "sex": r.patient_sex,
            "phone": r.patient_phone or "",
        },
        "referredBy": {
            "provider": r.referred_by_provider,
            "npi": r.referred_by_npi or "",
            "practice": r.referred_by_practice or "",
            "phone": r.referred_by_phone or "",
            "fax": r.referred_by_fax,
        },
        "referredToDepartment": r.referred_to_department or "",
        "priority": r.priority,
        "reasonForReferral": r.reason_for_referral,
        "clinicalNote": r.clinical_note or "",
        "diagnoses": r.diagnoses or [],
        "attachments": r.attachments or [],
        "structured": r.structured or {},
    }
    extraction = {
        "variables": r.extraction_variables or {},
        "sources": r.extraction_sources or {},
    }
    return ReferralRead(
        id=r.id,
        payload=payload,
        extraction=extraction,
        annotations=r.annotations,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _create_referral_from_schema(data: ReferralCreate) -> Referral:
    """Map a ReferralCreate schema to a Referral ORM instance."""
    p = data.payload
    return Referral(
        clinic_id=data.clinic_id,
        referral_id=p.referralId,
        received_at=datetime.fromisoformat(p.receivedAt),
        channel=p.channel,
        priority=p.priority,
        patient_name=p.patient.name,
        patient_mrn=p.patient.mrn,
        patient_dob=p.patient.dob,
        patient_sex=p.patient.sex,
        patient_phone=p.patient.phone,
        referred_by_provider=p.referredBy.provider,
        referred_by_npi=p.referredBy.npi,
        referred_by_practice=p.referredBy.practice,
        referred_by_phone=p.referredBy.phone,
        referred_by_fax=p.referredBy.fax,
        referred_to_department=p.referredToDepartment,
        reason_for_referral=p.reasonForReferral,
        clinical_note=p.clinicalNote,
        diagnoses=[d.model_dump() for d in p.diagnoses],
        attachments=[a.model_dump() for a in p.attachments],
        structured=p.structured.model_dump() if p.structured else None,
        extraction_variables={
            k: v.model_dump() for k, v in data.extraction.variables.items()
        },
        extraction_sources=data.extraction.sources,
        annotations=data.annotations.model_dump(exclude_none=True) if data.annotations else None,
    )


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ReferralRead])
async def list_referrals(
    db: AsyncSession = Depends(get_db),
    clinic_id: str | None = None,
    specialist_name: str | None = None,
    mrn: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """List referrals, with optional scope filtering (clinic, specialist, MRN)."""
    query = select(Referral)
    if clinic_id:
        query = query.where(Referral.clinic_id == clinic_id)
    if mrn:
        query = query.where(Referral.patient_mrn == mrn)
    query = query.order_by(Referral.received_at.desc())
    result = await db.execute(query.offset(skip).limit(limit))
    rows = result.scalars().all()
    return [_referral_to_read(r) for r in rows]


@router.post("", response_model=ReferralRead, status_code=status.HTTP_201_CREATED)
async def create_referral(
    *,
    db: AsyncSession = Depends(get_db),
    data: ReferralCreate,
) -> Any:
    """Create a new referral with payload, extraction, and optional annotations."""
    referral = _create_referral_from_schema(data)
    db.add(referral)
    await db.flush()
    await db.refresh(referral)
    return _referral_to_read(referral)


@router.post("/bulk", response_model=list[ReferralRead], status_code=status.HTTP_201_CREATED)
async def create_referrals_bulk(
    *,
    db: AsyncSession = Depends(get_db),
    data: list[ReferralCreate],
) -> Any:
    """Bulk-create referrals (used by the seed script)."""
    referrals = [_create_referral_from_schema(d) for d in data]
    db.add_all(referrals)
    await db.flush()
    for r in referrals:
        await db.refresh(r)
    return [_referral_to_read(r) for r in referrals]


@router.get("/{referral_id}", response_model=ReferralRead)
async def get_referral(
    referral_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Get a single referral by its external referral_id (e.g. REF-2026-0142)."""
    result = await db.execute(
        select(Referral).where(Referral.referral_id == referral_id)
    )
    referral = result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    return _referral_to_read(referral)


@router.patch("/{referral_id}", response_model=ReferralRead)
async def update_referral(
    referral_id: str,
    data: ReferralUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Update extraction or annotations on an existing referral."""
    result = await db.execute(
        select(Referral).where(Referral.referral_id == referral_id)
    )
    referral = result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    if data.extraction is not None:
        referral.extraction_variables = {
            k: v.model_dump() for k, v in data.extraction.variables.items()
        }
        referral.extraction_sources = data.extraction.sources
    if data.annotations is not None:
        referral.annotations = data.annotations.model_dump(exclude_none=True)
    await db.flush()
    await db.refresh(referral)
    return _referral_to_read(referral)


@router.delete("/{referral_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_referral(
    referral_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a referral and all its reviews/audit events."""
    result = await db.execute(
        select(Referral).where(Referral.referral_id == referral_id)
    )
    referral = result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    await db.delete(referral)


# ── Reviews ──────────────────────────────────────────────────────────────────

@router.post("/{referral_id}/review", response_model=ReviewRead, status_code=status.HTTP_201_CREATED)
async def create_review(
    referral_id: str,
    data: ReviewCreate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Record a review decision and its audit event atomically."""
    result = await db.execute(
        select(Referral).where(Referral.referral_id == referral_id)
    )
    referral = result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")

    now = datetime.now(timezone.utc)

    # Upsert review (one active review per referral)
    existing = await db.execute(
        select(ReferralReview).where(ReferralReview.referral_id == referral.id)
    )
    review = existing.scalar_one_or_none()
    correction_data = None
    if data.correction:
        correction_data = {
            "field": data.correction.field,
            "from": data.correction.fromValue,
            "to": data.correction.to,
            "reason": data.correction.reason,
        }

    if review:
        review.status = data.status
        review.reviewer = data.actor
        review.reviewed_at = now
        review.correction = correction_data
    else:
        review = ReferralReview(
            referral_id=referral.id,
            status=data.status,
            reviewer=data.actor,
            reviewed_at=now,
            correction=correction_data,
        )
        db.add(review)

    # Audit event
    audit = ReferralAuditEvent(
        referral_id=referral.id,
        at=now,
        actor=data.actor,
        role=data.role,
        action=data.status,
        correction=correction_data,
        note=data.note,
    )
    db.add(audit)

    await db.flush()
    await db.refresh(review)
    return review


@router.get("/reviews/all", response_model=list[ReviewRead])
async def list_all_reviews(
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Get all reviews across all referrals."""
    query = select(ReferralReview)
    result = await db.execute(query)
    return result.scalars().all()

@router.get("/{referral_id}/reviews", response_model=list[ReviewRead])
async def list_reviews(
    referral_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Get all reviews for a referral."""
    ref_result = await db.execute(
        select(Referral).where(Referral.referral_id == referral_id)
    )
    referral = ref_result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    result = await db.execute(
        select(ReferralReview).where(ReferralReview.referral_id == referral.id)
    )
    return result.scalars().all()


# ── Audit trail ──────────────────────────────────────────────────────────────

@router.get("/{referral_id}/audit", response_model=list[AuditEventRead])
async def list_audit_events(
    referral_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Get the full audit trail for a referral."""
    ref_result = await db.execute(
        select(Referral).where(Referral.referral_id == referral_id)
    )
    referral = ref_result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")
    result = await db.execute(
        select(ReferralAuditEvent)
        .where(ReferralAuditEvent.referral_id == referral.id)
        .order_by(ReferralAuditEvent.at)
    )
    return result.scalars().all()


@router.get("/audit/all", response_model=list[AuditEventRead])
async def list_all_audit_events(
    db: AsyncSession = Depends(get_db),
    limit: int = 500,
) -> Any:
    """Get all audit events across all referrals (for the dashboard)."""
    result = await db.execute(
        select(ReferralAuditEvent)
        .order_by(ReferralAuditEvent.at.desc())
        .limit(limit)
    )
    return result.scalars().all()


# ── Workup status ────────────────────────────────────────────────────────────

@router.post("/{referral_id}/workup-status", response_model=ReviewRead)
async def update_workup_status(
    referral_id: str,
    data: WorkupStatusUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Update a workup item's status and record the change in the audit trail."""
    ref_result = await db.execute(
        select(Referral).where(Referral.referral_id == referral_id)
    )
    referral = ref_result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found")

    now = datetime.now(timezone.utc)

    # Upsert review with workup override
    existing = await db.execute(
        select(ReferralReview).where(ReferralReview.referral_id == referral.id)
    )
    review = existing.scalar_one_or_none()
    if not review:
        review = ReferralReview(
            referral_id=referral.id,
            status="pending",
            workup_overrides={data.item_name: data.status},
        )
        db.add(review)
    else:
        overrides = dict(review.workup_overrides or {})
        overrides[data.item_name] = data.status
        review.workup_overrides = overrides

    # Audit event
    audit = ReferralAuditEvent(
        referral_id=referral.id,
        at=now,
        actor=data.actor,
        role=data.role,
        action="workup_status_changed",
        note=f"{data.item_name} → {data.status}",
    )
    db.add(audit)

    await db.flush()
    await db.refresh(review)
    return review
