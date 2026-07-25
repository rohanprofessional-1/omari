"""Tree delta endpoints — the clinic customization layer.

Deltas persist separately from the compiled tree rows (see models/delta.py).
Compilation happens in the frontend (lib/deltas/compile.ts); the server
stores deltas, and `/reconcile` transactionally saves a compiled tree
together with the compile's per-delta verdicts.
"""
from typing import Any, List, Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.branch import Branch
from app.models.condition import Condition
from app.models.delta import TreeDelta
from app.models.node import Node
from app.models.tree import Tree
from app.models.workup_item import WorkupItem
from app.schemas.delta import (
    DeltaCreate,
    DeltaRead,
    DeltaUpdate,
    ReconcileRequest,
)
from app.api.v1.trees import _insert_tree_nodes

router = APIRouter(prefix="/trees/{tree_id}/deltas")
reconcile_router = APIRouter(prefix="/trees/{tree_id}")


async def _require_tree(db: AsyncSession, tree_id: str) -> Tree:
    tree = await db.get(Tree, tree_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")
    return tree


def _to_read(d: TreeDelta) -> DeltaRead:
    return DeltaRead(
        id=d.id,
        tree_id=d.tree_id,
        seq=d.seq,
        op=d.op,
        payload=d.payload_json,
        expected=d.expected_json,
        provenance=d.provenance_json or {},
        specialist_id=d.specialist_id,
        status=d.status,
        stale_reason=d.stale_reason,
        base_hash=d.base_hash,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


@router.get("", response_model=List[DeltaRead])
async def list_deltas(
    tree_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    await _require_tree(db, tree_id)
    result = await db.execute(
        select(TreeDelta).where(TreeDelta.tree_id == tree_id).order_by(TreeDelta.seq)
    )
    return [_to_read(d) for d in result.scalars().all()]


@router.post("", response_model=List[DeltaRead], status_code=status.HTTP_201_CREATED)
async def create_deltas(
    tree_id: str,
    body: Union[DeltaCreate, List[DeltaCreate]],
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Create one delta or a bulk batch (a session stage saves in one call)."""
    await _require_tree(db, tree_id)
    items = body if isinstance(body, list) else [body]
    if not items:
        raise HTTPException(status_code=422, detail="Empty delta batch")

    next_seq = (
        await db.execute(
            select(func.coalesce(func.max(TreeDelta.seq), -1)).where(TreeDelta.tree_id == tree_id)
        )
    ).scalar_one() + 1

    created: list[TreeDelta] = []
    for item in items:
        if item.payload.get("op") != item.op:
            raise HTTPException(
                status_code=422,
                detail=f"payload.op '{item.payload.get('op')}' does not match op '{item.op}'",
            )
        seq = item.seq if item.seq is not None else next_seq
        next_seq = max(next_seq, seq) + 1
        d = TreeDelta(
            tree_id=tree_id,
            seq=seq,
            op=item.op,
            payload_json=item.payload,
            expected_json=item.expected,
            provenance_json=item.provenance,
            specialist_id=item.specialist_id,
            base_hash=item.base_hash,
            status="active",
        )
        db.add(d)
        created.append(d)

    await db.commit()
    for d in created:
        await db.refresh(d)
    return [_to_read(d) for d in created]


@router.patch("/{delta_id}", response_model=DeltaRead)
async def update_delta(
    tree_id: str,
    delta_id: str,
    body: DeltaUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    d = await db.get(TreeDelta, delta_id)
    if not d or d.tree_id != tree_id:
        raise HTTPException(status_code=404, detail="Delta not found")
    if body.payload is not None:
        if body.payload.get("op") != d.op:
            raise HTTPException(status_code=422, detail="payload.op may not change; create a new delta")
        d.payload_json = body.payload
    if body.seq is not None:
        d.seq = body.seq
    if body.expected is not None:
        d.expected_json = body.expected
    if body.provenance is not None:
        d.provenance_json = body.provenance
    if body.specialist_id is not None:
        d.specialist_id = body.specialist_id
    if body.status is not None:
        d.status = body.status
    if body.stale_reason is not None:
        d.stale_reason = body.stale_reason
    await db.commit()
    await db.refresh(d)
    return _to_read(d)


@router.delete("/{delta_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_delta(
    tree_id: str,
    delta_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Hard delete — per-delta undo in the review rail."""
    d = await db.get(TreeDelta, delta_id)
    if not d or d.tree_id != tree_id:
        raise HTTPException(status_code=404, detail="Delta not found")
    await db.delete(d)
    await db.commit()


@reconcile_router.post("/rebase")
async def rebase_tree(
    tree_id: str,
    file: Optional[UploadFile] = File(None),
    document_text: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Regenerate the tree's BASE from an updated CPG document.

    Replaces base_tree_json / base_meta_json with a fresh scaffold (no
    grafting under a master root — this is the same guideline, revised).
    Deltas are NOT touched here: the frontend compiler replays them against
    the new base on the next Reconcile open, and deltas whose anchors no
    longer resolve surface as stale for re-review — never silently dropped.
    """
    from app.services.anthropic import anthropic_service
    from app.services.cpg_service import generate_scaffold_from_cpg

    tree = await _require_tree(db, tree_id)
    if tree.base_tree_json is None:
        raise HTTPException(status_code=422, detail="Tree has no CPG base to rebase — it predates the delta layer.")

    if not anthropic_service.is_available:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured — required for CPG extraction.")

    file_data: bytes | None = None
    filename: str | None = None
    content_type: str | None = None
    if file:
        file_data = await file.read()
        filename = file.filename
        content_type = file.content_type
    elif not document_text or not document_text.strip():
        raise HTTPException(status_code=422, detail="Provide either a file upload or document_text.")

    subspecialty = (
        tree.subspecialty
        or (tree.base_meta_json or {}).get("subspecialty")
        or tree.name
    )

    try:
        result = await generate_scaffold_from_cpg(
            subspecialty=subspecialty,
            document_text=document_text,
            file_data=file_data,
            filename=filename,
            content_type=content_type,
            existing_tree=None,  # fresh base — no master-root graft
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    tree.base_tree_json = result.tree
    tree.base_meta_json = result.base_meta
    await db.commit()
    return result


@reconcile_router.get("/base")
async def get_tree_base(
    tree_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """The raw CPG scaffold this tree compiles from, plus anchoring metadata."""
    tree = await _require_tree(db, tree_id)
    return {"baseTree": tree.base_tree_json, "baseMeta": tree.base_meta_json}


@reconcile_router.post("/reconcile", response_model=List[DeltaRead])
async def reconcile_tree(
    tree_id: str,
    body: ReconcileRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Save a compiled tree + per-delta compile verdicts in one transaction.

    Replaces the draft rows with the compiled output (same mapping as
    PUT /trees/{id}/full), bumps the version, and records each delta's
    status. Published tree_versions snapshots are untouched.
    """
    tree = await _require_tree(db, tree_id)

    known_ids = {
        d_id
        for (d_id,) in (
            await db.execute(select(TreeDelta.id).where(TreeDelta.tree_id == tree_id))
        ).all()
    }
    unknown = [r.delta_id for r in body.delta_results if r.delta_id not in known_ids]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown delta ids: {unknown}")

    # Replace draft rows, children first (mirrors update_tree_full).
    branch_ids = select(Branch.id).where(Branch.tree_id == tree_id)
    await db.execute(delete(Condition).where(Condition.branch_id.in_(branch_ids)))
    await db.execute(delete(WorkupItem).where(WorkupItem.tree_id == tree_id))
    await db.execute(delete(Branch).where(Branch.tree_id == tree_id))
    await db.execute(delete(Node).where(Node.tree_id == tree_id))

    if body.tree.name is not None:
        tree.name = body.tree.name
    if body.tree.description is not None:
        tree.description = body.tree.description
    tree.root_node_id = body.tree.rootNodeId
    tree.version = (tree.version or 1) + 1

    await _insert_tree_nodes(db, tree_id, body.tree.nodes)

    for r in body.delta_results:
        d = await db.get(TreeDelta, r.delta_id)
        d.status = r.status
        d.stale_reason = r.stale_reason

    await db.commit()

    result = await db.execute(
        select(TreeDelta).where(TreeDelta.tree_id == tree_id).order_by(TreeDelta.seq)
    )
    return [_to_read(d) for d in result.scalars().all()]
