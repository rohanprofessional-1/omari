from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.models.conversation import Conversation
from app.schemas.conversation import ConversationCreate, ConversationRead, ChatRequest, ChatResponse
from app.services.chat import ChatService

router = APIRouter(prefix="/conversations")


@router.post("", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    *,
    db: AsyncSession = Depends(get_db),
    conversation_in: ConversationCreate,
) -> Any:
    conversation = Conversation(**conversation_in.model_dump())
    db.add(conversation)
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
    
    await db.commit()
    
    return ChatResponse(**result_dict)
