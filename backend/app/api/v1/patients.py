from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.api.v1.auth import get_current_user
from app.models.patient import Patient
from app.models.user import User
from app.models.audit_log import AuditAction, AuditLog
from app.schemas.patient import PatientCreate, PatientUpdate, PatientRead
from app.schemas.audit_log import AuditLogRead, AuditLogListResponse
from app.services.audit_service import record_audit, compute_patient_diff

router = APIRouter(prefix="/patients")


def _client_ip(request: Request) -> str | None:
    """Extract the client IP from the request."""
    if request.client:
        return request.client.host
    return None


@router.get("", response_model=List[PatientRead])
async def list_patients(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    clinic_id: str | None = None,
) -> Any:
    query = select(Patient)
    if clinic_id:
        query = query.where(Patient.clinic_id == clinic_id)
        
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def create_patient(
    *,
    request: Request,
    db: AsyncSession = Depends(get_db),
    patient_in: PatientCreate,
    current_user: User = Depends(get_current_user),
) -> Any:
    patient = Patient(**patient_in.model_dump())
    db.add(patient)
    await db.flush()

    await record_audit(
        db,
        patient_id=patient.id,
        actor=current_user,
        action=AuditAction.patient_created,
        resource_type="patient",
        resource_id=patient.id,
        detail={"created": patient_in.model_dump(mode="json")},
        ip_address=_client_ip(request),
    )

    await db.commit()
    await db.refresh(patient)
    return patient


@router.get("/{id}", response_model=PatientRead)
async def get_patient(
    id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    # Later we might want to return conversations too, but schema currently does not have it.
    patient = await db.get(Patient, id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if current_user.role == UserRole.surgeon and current_user.specialist_id:
        from app.models.referral import Referral
        res = await db.execute(select(Referral).where(
            Referral.patient_id == patient.id,
            Referral.routed_specialist_id == current_user.specialist_id
        ))
        if not res.scalars().first():
            raise HTTPException(status_code=403, detail="Not authorized to view this patient")

    await record_audit(
        db,
        patient_id=patient.id,
        actor=current_user,
        action=AuditAction.patient_viewed,
        resource_type="patient",
        resource_id=patient.id,
        ip_address=_client_ip(request),
    )

    return patient


@router.patch("/{id}", response_model=PatientRead)
async def update_patient(
    id: str,
    request: Request,
    patient_in: PatientUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    patient = await db.get(Patient, id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if current_user.role == UserRole.surgeon and current_user.specialist_id:
        from app.models.referral import Referral
        res = await db.execute(select(Referral).where(
            Referral.patient_id == patient.id,
            Referral.routed_specialist_id == current_user.specialist_id
        ))
        if not res.scalars().first():
            raise HTTPException(status_code=403, detail="Not authorized to update this patient")

    # Capture the old values for the diff
    old_values = {
        "first_name": patient.first_name,
        "last_name": patient.last_name,
        "clinic_id": patient.clinic_id,
        "dob": patient.dob,
        "email": patient.email,
        "phone": patient.phone,
        "mrn": patient.mrn,
        "referring_provider": patient.referring_provider,
        "referral_date": patient.referral_date,
        "referral_note": patient.referral_note,
    }

    # Apply updates (only non-None fields from the PATCH body)
    update_data = patient_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(patient, field, value)

    # Compute field-level diff
    diff = compute_patient_diff(old_values, update_data)

    if diff:
        await record_audit(
            db,
            patient_id=patient.id,
            actor=current_user,
            action=AuditAction.patient_updated,
            resource_type="patient",
            resource_id=patient.id,
            detail=diff,
            ip_address=_client_ip(request),
        )

    await db.commit()
    await db.refresh(patient)
    return patient


@router.get("/{id}/audit-log", response_model=AuditLogListResponse)
async def get_patient_audit_log(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    action: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Any:
    """Return the paginated audit trail for a specific patient."""
    # Verify patient exists
    patient = await db.get(Patient, id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if current_user.role == UserRole.surgeon and current_user.specialist_id:
        from app.models.referral import Referral
        res = await db.execute(select(Referral).where(
            Referral.patient_id == patient.id,
            Referral.routed_specialist_id == current_user.specialist_id
        ))
        if not res.scalars().first():
            raise HTTPException(status_code=403, detail="Not authorized to view this patient's audit log")

    # Build query
    query = select(AuditLog).where(AuditLog.patient_id == id)
    count_query = select(func.count()).select_from(AuditLog).where(AuditLog.patient_id == id)

    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)

    # Get total
    total = (await db.execute(count_query)).scalar() or 0

    # Get page
    query = query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    entries = result.scalars().all()

    items = [
        AuditLogRead(
            id=e.id,
            patient_id=e.patient_id,
            patient_name=f"{patient.first_name} {patient.last_name}",
            patient_mrn=patient.mrn,
            actor_id=e.actor_id,
            actor_label=e.actor_label,
            action=e.action.value if hasattr(e.action, "value") else e.action,
            resource_type=e.resource_type,
            resource_id=e.resource_id,
            detail=e.detail,
            ip_address=e.ip_address,
            timestamp=e.timestamp,
        )
        for e in entries
    ]

    return AuditLogListResponse(items=items, total=total, offset=offset, limit=limit)
