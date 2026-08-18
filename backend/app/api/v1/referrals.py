import uuid
from typing import Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel, Field

from app.api.deps import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User, UserRole
from app.models.referral import Referral, ReferralChannel, ReferralPriority, ReferralStatus
from app.models.patient import Patient
from app.models.referring_provider import ReferringProvider
from app.models.audit_log import AuditAction
from app.services.audit_service import record_audit

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
    current_user: User = Depends(get_current_user),
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
            
    await db.flush() # ensure IDs are generated

    # Resolve specialist ID: prefer explicit ID, fall back to name lookup.
    specialist_id = req.routed_specialist_id
    if not specialist_id and req.routed_specialist_name:
        from app.models.specialist import Specialist
        res = await db.execute(
            select(Specialist).where(Specialist.name == req.routed_specialist_name)
        )
        matched = res.scalars().first()
        if matched:
            specialist_id = matched.id
    
    # Generate a readable display ID
    now_str = datetime.utcnow().strftime("%Y%m")
    short_uuid = str(uuid.uuid4())[:4].upper()
    display_id = f"REF-{now_str}-{short_uuid}"
    
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
        status=ReferralStatus.new
    )
    db.add(referral)
    await db.flush()

    # Audit: referral.created
    await record_audit(
        db,
        patient_id=patient.id,
        actor=None,
        action=AuditAction.referral_created,
        resource_type="referral",
        resource_id=referral.id,
        detail={
            "display_id": referral.display_id,
            "channel": req.channel.value,
            "priority": req.priority.value,
        },
    )

    # Automatically evaluate the tree if data is provided and it's from Epic
    if req.channel == ReferralChannel.epic:
        from app.models.tree import Tree
        from app.models.node import Node
        from app.models.branch import Branch
        from app.schemas.tree import TreeReadFull
        from app.services.tree_engine import run_engine
        from sqlalchemy.orm import selectinload

        tree_id_to_use = req.tree_id
        if not tree_id_to_use:
            # Fall back to any available tree if one is not specified
            tree_res = await db.execute(select(Tree).limit(1))
            fallback_tree = tree_res.scalars().first()
            if fallback_tree:
                tree_id_to_use = fallback_tree.id

        if tree_id_to_use:
            tree_query = select(Tree).where(Tree.id == tree_id_to_use).options(
                selectinload(Tree.nodes).selectinload(Node.branches).selectinload(Branch.condition),
                selectinload(Tree.nodes).selectinload(Node.workup_items),
            )
            tree_obj = (await db.execute(tree_query)).scalars().first()

            if tree_obj:
                tree_schema = TreeReadFull.model_validate(tree_obj)
                extracted = req.extraction or {}
                engine_result = run_engine(tree_schema, extracted)

                if engine_result.outcome == "routed":
                    # Fully routed; just update the referral
                    from app.models.specialist import Specialist
                    spec = engine_result.specialist
                    specialist_record = (await db.execute(
                        select(Specialist).where(Specialist.name == spec.specialist_name)
                    )).scalars().first()
                    
                    if specialist_record:
                        referral.routed_specialist_id = specialist_record.id
                
                elif engine_result.outcome == "incomplete":
                    # Information is missing; create a Conversation
                    from app.models.conversation import Conversation, ConversationStatus, PatientVariable, VariableVia
                    
                    conversation = Conversation(
                        patient_id=patient.id,
                        referral_id=referral.id,
                        tree_id=tree_obj.id,
                        status=ConversationStatus.in_progress
                    )
                    db.add(conversation)
                    await db.flush()

                    # Seed the known variables
                    from datetime import datetime, timezone
                    for k, v in extracted.items():
                        pv = PatientVariable(
                            conversation_id=conversation.id,
                            variable_key=k,
                            via=VariableVia.extraction,
                            filled_at=datetime.now(timezone.utc)
                        )
                        if isinstance(v, bool):
                            pv.value_boolean = v
                        elif isinstance(v, (int, float)):
                            pv.value_number = v
                        elif isinstance(v, str):
                            pv.value_string = v
                        else:
                            pv.value_json = v
                        db.add(pv)

                    await record_audit(
                        db,
                        patient_id=patient.id,
                        actor=None,
                        action=AuditAction.conversation_started,
                        resource_type="conversation",
                        resource_id=conversation.id,
                        detail={"tree_id": tree_obj.id, "reason": "epic_incomplete_intake"},
                    )

    await db.commit()
    await db.refresh(referral)
    
    return {"id": referral.id, "display_id": referral.display_id}

@router.get("")
async def list_referrals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 100
) -> Any:
    # If the user is a surgeon, filter referrals to their specialist_id
    query = select(Referral).order_by(desc(Referral.received_at)).limit(limit)
    
    if current_user.role == UserRole.surgeon and current_user.specialist_id:
        query = query.where(Referral.routed_specialist_id == current_user.specialist_id)
        
    result = await db.execute(query)
    referrals = result.scalars().all()
    
    # Eager load relationships for the response manually since we don't have Pydantic models for everything
    # Better yet, load them in the query
    
    # Re-query with eager loads
    from sqlalchemy.orm import selectinload
    query = select(Referral).options(
        selectinload(Referral.patient),
        selectinload(Referral.referred_by),
        selectinload(Referral.routed_specialist)
    ).order_by(desc(Referral.received_at)).limit(limit)
    
    if current_user.role == UserRole.surgeon and current_user.specialist_id:
        query = query.where(Referral.routed_specialist_id == current_user.specialist_id)
        
    result = await db.execute(query)
    referrals = result.scalars().all()
    
    res_list = []
    for r in referrals:
        res_list.append({
            "id": r.id,
            "display_id": r.display_id,
            "received_at": r.received_at.isoformat() if r.received_at else None,
            "channel": r.channel.value if hasattr(r.channel, 'value') else r.channel,
            "priority": r.priority.value if hasattr(r.priority, 'value') else r.priority,
            "status": r.status.value if hasattr(r.status, 'value') else r.status,
            "reason_for_referral": r.reason_for_referral,
            "clinical_note": r.clinical_note,
            "patient": {
                "id": r.patient.id,
                "name": f"{r.patient.first_name} {r.patient.last_name}",
                "mrn": r.patient.mrn,
                "dob": r.patient.dob.isoformat() if r.patient.dob else None,
                "sex": r.patient.sex,
                "phone": r.patient.phone
            } if r.patient else None,
            "referred_by": {
                "id": r.referred_by.id,
                "provider": r.referred_by.provider_name,
                "practice": r.referred_by.practice_name,
                "npi": r.referred_by.npi,
                "phone": r.referred_by.phone,
                "fax": r.referred_by.fax
            } if r.referred_by else None,
            "routed_specialist_name": r.routed_specialist.name if r.routed_specialist else None,
            "extraction": r.extraction,
            "annotations": r.annotations,
            "structured_data": r.structured_data
        })
        
    return res_list
