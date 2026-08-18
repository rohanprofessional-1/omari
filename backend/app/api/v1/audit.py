"""Admin-wide audit log query endpoint.

Returns paginated audit events across all patients, with filtering and search.
"""
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User, UserRole
from app.models.audit_log import AuditLog
from app.models.patient import Patient
from app.schemas.audit_log import AuditLogRead, AuditLogListResponse

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    patient_id: Optional[str] = None,
    patient_name: Optional[str] = Query(None, description="Partial match on patient name"),
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Any:
    """Return paginated audit events across all patients.

    Restricted to admin users only.
    """
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    # Base query with patient join for name display
    query = (
        select(AuditLog, Patient)
        .join(Patient, AuditLog.patient_id == Patient.id)
    )
    count_query = (
        select(func.count())
        .select_from(AuditLog)
        .join(Patient, AuditLog.patient_id == Patient.id)
    )

    # Filters
    if patient_id:
        query = query.where(AuditLog.patient_id == patient_id)
        count_query = count_query.where(AuditLog.patient_id == patient_id)

    if patient_name:
        name_filter = or_(
            Patient.first_name.ilike(f"%{patient_name}%"),
            Patient.last_name.ilike(f"%{patient_name}%"),
        )
        query = query.where(name_filter)
        count_query = count_query.where(name_filter)

    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)

    if actor_id:
        query = query.where(AuditLog.actor_id == actor_id)
        count_query = count_query.where(AuditLog.actor_id == actor_id)

    # Count
    total = (await db.execute(count_query)).scalar() or 0

    # Page
    query = query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    items = [
        AuditLogRead(
            id=entry.id,
            patient_id=entry.patient_id,
            patient_name=f"{patient.first_name} {patient.last_name}",
            patient_mrn=patient.mrn,
            actor_id=entry.actor_id,
            actor_label=entry.actor_label,
            action=entry.action.value if hasattr(entry.action, "value") else entry.action,
            resource_type=entry.resource_type,
            resource_id=entry.resource_id,
            detail=entry.detail,
            ip_address=entry.ip_address,
            timestamp=entry.timestamp,
        )
        for entry, patient in rows
    ]

    return AuditLogListResponse(items=items, total=total, offset=offset, limit=limit)
