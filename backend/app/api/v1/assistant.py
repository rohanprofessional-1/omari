"""Blume — Builder assistant API (/api/v1/assistant).

One STATELESS endpoint: the clinician's message + their current tree in,
the model's reply + proposed operations out. Deliberately no database
dependency and no persistence — the assistant cannot change anything by
itself. The Builder Zod-validates the operations, applies them to a copy,
shows the clinician the exact diff, and only their confirm touches the
canvas (and only a manual save touches the library).
"""
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.assistant import TreeChatRequest, TreeChatResponse
from app.services.anthropic import anthropic_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant")


@router.post("/tree-chat", response_model=TreeChatResponse)
async def tree_chat(body: TreeChatRequest) -> Any:
    """Builder assistant turn: translate stated edits into proposed tree
    operations, clarify underspecified ones, decline clinical-judgment
    requests, and answer questions about the tree as it stands."""
    if not anthropic_service.is_available:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured on the backend.")
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="No message provided.")
    try:
        out = await anthropic_service.tree_chat(
            tree=body.tree,
            message=body.message,
            history=[t.model_dump() for t in body.history],
            warnings=body.warnings,
            selected_node_ids=body.selectedNodeIds,
        )
    except Exception as e:
        logger.exception("tree chat failed")
        raise HTTPException(status_code=502, detail=f"Assistant call failed: {e}")
    return TreeChatResponse(
        mode=out["mode"],
        message=out["message"],
        operations=out["operations"],
        focusNodeIds=out["focusNodeIds"],
    )


@router.post("/tree-chat/stream")
async def tree_chat_stream(body: TreeChatRequest) -> Any:
    """Streaming variant of tree-chat (SSE). Emits `delta` events carrying the
    reply text as it generates, then one `done` event with the SAME payload
    shape as the non-streaming endpoint — proposals only, nothing applied."""
    if not anthropic_service.is_available:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured on the backend.")
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="No message provided.")

    async def gen():
        try:
            async for evt in anthropic_service.tree_chat_stream(
                tree=body.tree,
                message=body.message,
                history=[t.model_dump() for t in body.history],
                warnings=body.warnings,
                selected_node_ids=body.selectedNodeIds,
            ):
                yield f"data: {json.dumps(evt)}\n\n"
        except Exception as e:  # surface as an in-stream event; the client falls back
            logger.exception("tree chat stream failed")
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
