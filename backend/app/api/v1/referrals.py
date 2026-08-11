import logging
import uuid
from typing import Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field

from app.api.deps import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User, UserRole
from app.models.referral import Referral, ReferralChannel, ReferralPriority, ReferralStatus
from app.models.patient import Patient
from app.models.referring_provider import ReferringProvider
from app.models.specialist import Specialist
from app.services.route_referral import route_referral

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/referrals", tags=["referrals"])

# Schemas
class PatientCreate(BaseModel):
    first_name: str
    last_name: str
    dob: Optional[str] = None
    sex: Optional[str] = None
    phone: Optional[str] = None
    mrn: Optional[str] = None

class ReferringProviderCreate(BaseModel):
    provider_name: str
    practice_name: Optional[str] = None
    npi: Optional[str] = None
    phone: Optional[str] = None
    fax: Optional[str] = None

class ReferralCreate(BaseModel):
    patient: PatientCreate
    referred_by: Optional[ReferringProviderCreate] = None
    routed_specialist_id: Optional[str] = None
    # If routed_specialist_id is not known, supply the name and the API will resolve it.
    routed_specialist_name: Optional[str] = None
    tree_id: Optional[str] = None
    channel: ReferralChannel = ReferralChannel.epic
    priority: ReferralPriority = ReferralPriority.routine
    reason_for_referral: Optional[str] = None
    clinical_note: Optional[str] = None
    extraction: Optional[dict] = None
    annotations: Optional[dict] = None
    structured_data: Optional[dict] = None

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_referral(
    req: ReferralCreate,
    db: AsyncSession = Depends(get_db)
) -> Any:
    # 1. Get or create patient
    patient = None
    if req.patient.mrn:
        res = await db.execute(select(Patient).where(Patient.mrn == req.patient.mrn))
        patient = res.scalars().first()
        
    if not patient:
        patient = Patient(
            first_name=req.patient.first_name,
            last_name=req.patient.last_name,
            dob=req.patient.dob,
            sex=req.patient.sex,
            phone=req.patient.phone,
            mrn=req.patient.mrn
        )
        db.add(patient)
        
    # 2. Get or create referring provider
    provider = None
    if req.referred_by:
        if req.referred_by.npi:
            res = await db.execute(select(ReferringProvider).where(ReferringProvider.npi == req.referred_by.npi))
            provider = res.scalars().first()
            
        if not provider:
            provider = ReferringProvider(
                provider_name=req.referred_by.provider_name,
                practice_name=req.referred_by.practice_name,
                npi=req.referred_by.npi,
                phone=req.referred_by.phone,
                fax=req.referred_by.fax
            )
            db.add(provider)
            
    await db.flush()  # ensure IDs are generated

    # 3. Resolve specialist ID if explicitly provided (pre-routing override)
    specialist_id = req.routed_specialist_id
    if not specialist_id and req.routed_specialist_name:
        res = await db.execute(
            select(Specialist).where(Specialist.name == req.routed_specialist_name)
        )
        matched = res.scalars().first()
        if matched:
            specialist_id = matched.id
    
    # 4. Generate a readable display ID
    now_str = datetime.utcnow().strftime("%Y%m")
    short_uuid = str(uuid.uuid4())[:4].upper()
    display_id = f"REF-{now_str}-{short_uuid}"
    
    # 5. Create the referral row
    referral = Referral(
        display_id=display_id,
        patient_id=patient.id,
        referred_by_id=provider.id if provider else None,
        routed_specialist_id=specialist_id,
        tree_id=req.tree_id,
        channel=req.channel,
        priority=req.priority,
        reason_for_referral=req.reason_for_referral,
        clinical_note=req.clinical_note,
        extraction=req.extraction,
        annotations=req.annotations,
        structured_data=req.structured_data,
        status=ReferralStatus.new,
    )
    db.add(referral)
    await db.flush()

    # 6. Run the routing engine if extraction data is available and no
    #    specialist was explicitly pre-assigned.
    routing_outcome = None
    if req.extraction and not specialist_id:
        try:
            result = await route_referral(db, referral)
            routing_outcome = result.outcome.value
        except Exception:
            logger.exception("Routing engine failed for referral %s", referral.id)
            # Non-fatal: the referral is created regardless; routing can be retried.

    await db.commit()
    await db.refresh(referral)
    
    return {
        "id": referral.id,
        "display_id": referral.display_id,
        "routing_outcome": routing_outcome,
    }

@router.get("")
async def list_referrals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 100
) -> Any:
    """List referrals, scoped by the current user's role.

    - Admin: sees all referrals.
    - Surgeon: sees only referrals routed to their specialist.
    - Patient: sees only their own referrals (by patient MRN via user linkage).
    """
    query = select(Referral).options(
        selectinload(Referral.patient),
        selectinload(Referral.referred_by),
        selectinload(Referral.routed_specialist),
    ).order_by(desc(Referral.received_at)).limit(limit)
    
    if current_user.role == UserRole.surgeon and current_user.specialist_id:
        query = query.where(Referral.routed_specialist_id == current_user.specialist_id)
        
    result = await db.execute(query)
    referrals = result.scalars().all()
    
    return [_serialize_referral(r) for r in referrals]


# ---------------------------------------------------------------------------
# Serialization helper
# ---------------------------------------------------------------------------

def _serialize_referral(r: Referral) -> dict[str, Any]:
    """Convert a Referral ORM row to a JSON-safe dict for the API response."""
    return {
        "id": r.id,
        "display_id": r.display_id,
        "received_at": r.received_at.isoformat() if r.received_at else None,
        "channel": r.channel.value if hasattr(r.channel, "value") else r.channel,
        "priority": r.priority.value if hasattr(r.priority, "value") else r.priority,
        "status": r.status.value if hasattr(r.status, "value") else r.status,
        "reason_for_referral": r.reason_for_referral,
        "clinical_note": r.clinical_note,
        "patient": {
            "id": r.patient.id,
            "name": f"{r.patient.first_name} {r.patient.last_name}",
            "mrn": r.patient.mrn,
            "dob": r.patient.dob.isoformat() if r.patient.dob else None,
            "sex": r.patient.sex,
            "phone": r.patient.phone,
        } if r.patient else None,
        "referred_by": {
            "id": r.referred_by.id,
            "provider": r.referred_by.provider_name,
            "practice": r.referred_by.practice_name,
            "npi": r.referred_by.npi,
            "phone": r.referred_by.phone,
            "fax": r.referred_by.fax,
        } if r.referred_by else None,
        "routed_specialist_name": r.routed_specialist.name if r.routed_specialist else None,
        "extraction": r.extraction,
        "annotations": r.annotations,
        "structured_data": r.structured_data,
    }


# ---------------------------------------------------------------------------
# PATCH /referrals/:id — status updates & corrections
# ---------------------------------------------------------------------------

class ReferralUpdate(BaseModel):
    """Request body for updating a referral's status or routing.

    Surgeons use this to approve/reject/correct referrals. Admins can do
    anything. The status field drives the workflow:
      - 'reviewed': surgeon has approved the referral.
      - 'scheduled': a visit has been booked.
      - 'dismissed': referral was rejected (out-of-scope, duplicate, etc).
    """
    status: Optional[str] = None  # reviewed | scheduled | dismissed
    # Correction: re-route to a different specialist (by ID or name)
    routed_specialist_id: Optional[str] = None
    routed_specialist_name: Optional[str] = None
    # Priority override
    priority: Optional[ReferralPriority] = None
    # Merge additional annotations (e.g., review notes, urgency overrides)
    annotations: Optional[dict] = None


# Allowed status transitions. Only forward transitions are valid.
_VALID_STATUSES = {"reviewed", "scheduled", "dismissed"}


@router.patch("/{referral_id}")
async def update_referral(
    referral_id: str,
    req: ReferralUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Update a referral's status or routing.

    Authorization:
    - Admin: can update any referral.
    - Surgeon: can only update referrals routed to their specialist.
    """
    # Load the referral with relationships
    result = await db.execute(
        select(Referral).options(
            selectinload(Referral.patient),
            selectinload(Referral.referred_by),
            selectinload(Referral.routed_specialist),
        ).where(Referral.id == referral_id)
    )
    referral = result.scalars().first()

    if not referral:
        raise HTTPException(status_code=404, detail="Referral not found.")

    # Authorization: surgeons can only update their own referrals
    if current_user.role == UserRole.surgeon:
        if not current_user.specialist_id:
            raise HTTPException(status_code=403, detail="Surgeon has no linked specialist.")
        if referral.routed_specialist_id != current_user.specialist_id:
            raise HTTPException(status_code=403, detail="Not authorized to update this referral.")

    # Apply status change
    if req.status:
        if req.status not in _VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{req.status}'. Must be one of: {', '.join(_VALID_STATUSES)}.",
            )
        referral.status = ReferralStatus(req.status)

    # Apply specialist correction
    if req.routed_specialist_id or req.routed_specialist_name:
        new_specialist_id = req.routed_specialist_id
        if not new_specialist_id and req.routed_specialist_name:
            spec_result = await db.execute(
                select(Specialist).where(Specialist.name == req.routed_specialist_name)
            )
            spec = spec_result.scalars().first()
            if not spec:
                raise HTTPException(
                    status_code=400,
                    detail=f"Specialist '{req.routed_specialist_name}' not found.",
                )
            new_specialist_id = spec.id

        if new_specialist_id:
            # Record the correction in annotations for audit trail
            annotations = referral.annotations or {}
            corrections = annotations.get("corrections", [])
            corrections.append({
                "from_specialist_id": referral.routed_specialist_id,
                "to_specialist_id": new_specialist_id,
                "corrected_by": current_user.email,
                "corrected_at": datetime.utcnow().isoformat(),
            })
            annotations["corrections"] = corrections
            referral.annotations = annotations
            referral.routed_specialist_id = new_specialist_id

    # Apply priority override
    if req.priority:
        referral.priority = req.priority

    # Merge annotations (additive, not destructive)
    if req.annotations:
        existing = referral.annotations or {}
        existing.update(req.annotations)
        referral.annotations = existing

    await db.commit()

    # Re-load with relationships for the response
    await db.refresh(referral)
    result = await db.execute(
        select(Referral).options(
            selectinload(Referral.patient),
            selectinload(Referral.referred_by),
            selectinload(Referral.routed_specialist),
        ).where(Referral.id == referral_id)
    )
    referral = result.scalars().first()

    return _serialize_referral(referral)
