from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.models.conversation import Conversation
from app.models.audit_log import AuditAction
from app.schemas.conversation import ConversationCreate, ConversationRead, ChatRequest, ChatResponse
from app.services.chat import ChatService
from app.services.audit_service import record_audit

router = APIRouter(prefix="/conversations")


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    *,
    request: Request,
    db: AsyncSession = Depends(get_db),
    conversation_in: ConversationCreate,
) -> Any:
    conversation = Conversation(**conversation_in.model_dump())
    db.add(conversation)
    await db.flush()

    # Audit: conversation.started
    if conversation.patient_id:
        await record_audit(
            db,
            patient_id=conversation.patient_id,
            actor=None,
            action=AuditAction.conversation_started,
            resource_type="conversation",
            resource_id=conversation.id,
            detail={"tree_id": conversation.tree_id, "mode": conversation.mode},
            ip_address=request.client.host if request.client else None,
        )

    await db.commit()
    await db.refresh(conversation)
    return conversation


@router.get("/{id}", response_model=ConversationRead)
async def get_conversation(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    query = (
        select(Conversation)
        .where(Conversation.id == id)
        .options(
            selectinload(Conversation.turns),
            selectinload(Conversation.patient_variables),
        )
    )
    result = await db.execute(query)
    conversation = result.scalars().first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.post("/{id}/chat", response_model=ChatResponse)
async def chat(
    id: str,
    chat_request: ChatRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    query = (
        select(Conversation)
        .where(Conversation.id == id)
        .options(
            selectinload(Conversation.turns),
            selectinload(Conversation.patient_variables),
        )
    )
    result = await db.execute(query)
    conversation = result.scalars().first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    chat_service = ChatService(db)
    
    # The backend now handles extraction tools and routing natively.
    
    # Process turn
    result_dict = await chat_service.process_message(
        conversation=conversation,
        patient_message=chat_request.message,
    )

    # Audit: conversation.routed (when a routing outcome has been determined)
    if conversation.patient_id and conversation.outcome_specialist_id and conversation.status.value == "routed":
        await record_audit(
            db,
            patient_id=conversation.patient_id,
            actor=None,
            action=AuditAction.conversation_routed,
            resource_type="conversation",
            resource_id=conversation.id,
            detail={
                "specialist_id": conversation.outcome_specialist_id,
                "urgency": conversation.outcome_urgency.value if conversation.outcome_urgency else None,
            },
            ip_address=request.client.host if request.client else None,
        )
    
    await db.commit()
    
    return ChatResponse(**result_dict)
