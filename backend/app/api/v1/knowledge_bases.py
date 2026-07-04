from __future__ import annotations

import json
from typing import Any, List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.models.branch import Branch
from app.models.clinic import Clinic
from app.models.node import Node
from app.models.tree import Tree
from app.schemas.knowledge_base import KnowledgeBaseFileSummary, KnowledgeBasePreviewResponse
from app.services.knowledge_base import _collect_tree_context, knowledge_base_service

router = APIRouter(prefix="/clinics")


@router.post(
    "/{clinic_id}/knowledge-base/preview",
    response_model=KnowledgeBasePreviewResponse,
    status_code=status.HTTP_200_OK,
)
async def preview_knowledge_base(
    clinic_id: str,
    tree_id: str = Form(...),
    files: List[UploadFile] = File(...),
    persist: bool = Form(False),
    db: AsyncSession = Depends(get_db),
) -> Any:
    clinic = await db.get(Clinic, clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")

    tree_query = (
        select(Tree)
        .where(Tree.id == tree_id)
        .options(
            selectinload(Tree.nodes).selectinload(Node.branches).selectinload(Branch.condition),
            selectinload(Tree.nodes).selectinload(Node.workup_items),
        )
    )
    tree_result = await db.execute(tree_query)
    tree = tree_result.scalars().first()
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")

    if tree.clinic_id and tree.clinic_id != clinic_id:
        raise HTTPException(status_code=404, detail="Tree does not belong to this clinic")

    context = _collect_tree_context(tree)
    file_summaries: list[KnowledgeBaseFileSummary] = []

    for upload in files:
        data = await upload.read()
        if not data:
            continue
        summary = await knowledge_base_service.analyze_document(
            filename=upload.filename or "untitled",
            content_type=upload.content_type,
            data=data,
            context=context,
        )
        file_summaries.append(KnowledgeBaseFileSummary(**summary))

    combined_topics: list[str] = []
    for item in file_summaries:
        combined_topics.extend(item.relevant_topics)
    combined_topics = sorted({topic for topic in combined_topics if topic.strip()}, key=str.lower)

    overview_parts = [f"{len(file_summaries)} file(s) ingested for {tree.name}."]
    if combined_topics:
        overview_parts.append("Shared topics: " + ", ".join(combined_topics[:16]) + ".")
    if context.specialist_lines:
        overview_parts.append("Routing targets: " + "; ".join(context.specialist_lines[:4]) + ".")

    response = KnowledgeBasePreviewResponse(
        clinic_id=clinic.id,
        clinic_name=clinic.name,
        tree_id=tree.id,
        tree_name=tree.name,
        overview=" ".join(overview_parts),
        focus_terms=context.focus_terms,
        files=file_summaries,
        persisted=False,
        updated_at=clinic.updated_at,
    )

    if persist:
        clinic.knowledge_base = json.dumps(response.model_dump(mode="json"), indent=2)
        await db.flush()
        response.persisted = True
        response.updated_at = clinic.updated_at

    return response
