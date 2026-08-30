import json
from datetime import datetime, timezone
from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, update
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.models.tree import Tree, TreeVersion
from app.models.node import Node, NodeType, DataSource, Urgency
from app.models.branch import Branch
from app.models.condition import Condition, ConditionType
from app.models.workup_item import WorkupItem
from app.schemas.tree import (
    TreeCreate,
    TreeUpdate,
    TreeRead,
    TreeReadFull,
    TreeFullCreate,
    TreeFullUpdate,
    TreePublish,
    TreeVersionRead,
    WorkupSpecIn,
    WorkupItemIn,
)
from app.services.tree_serializer import serialize_tree

router = APIRouter(prefix="/trees")

async def _deactivate_other_trees(db: AsyncSession, active_tree_id: str, clinic_id: str | None) -> None:
    """Ensure only one tree is active per clinic (or globally if clinic_id is None)."""
    query = update(Tree).where(Tree.id != active_tree_id)
    if clinic_id:
        query = query.where(Tree.clinic_id == clinic_id)
    else:
        query = query.where(Tree.clinic_id.is_(None))
    await db.execute(query.values(is_active=False))

def _normalize_workup(workup) -> dict | None:
    """Legacy flat list or WorkupSpecIn → the canonical WorkupSpec dict."""
    if workup is None:
        return None
    if isinstance(workup, WorkupSpecIn):
        return workup.model_dump(exclude_none=True)
    # Legacy: List[WorkupItemIn] becomes the `always` list.
    return {
        "always": [w.model_dump() for w in workup],
        "conditional": [],
        "doNotOrderUnless": [],
    }


def _workup_always_items(spec: dict | None) -> list[dict]:
    return (spec or {}).get("always", [])


@router.get("", response_model=List[TreeRead])
async def list_trees(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    clinic_id: str | None = None,
    is_active: bool | None = None,
) -> Any:
    query = select(Tree)
    if clinic_id:
        query = query.where(Tree.clinic_id == clinic_id)
    if is_active is not None:
        query = query.where(Tree.is_active == is_active)
        
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=TreeRead, status_code=status.HTTP_201_CREATED)
async def create_tree(
    *,
    db: AsyncSession = Depends(get_db),
    tree_in: TreeCreate,
) -> Any:
    tree = Tree(**tree_in.model_dump())
    db.add(tree)
    await db.commit()
    await db.refresh(tree)
    
    if tree.is_active:
        await _deactivate_other_trees(db, tree.id, tree.clinic_id)
        await db.commit()
        await db.refresh(tree)
        
    return tree


@router.post("/full", response_model=TreeRead, status_code=status.HTTP_201_CREATED)
async def create_tree_full(
    *,
    db: AsyncSession = Depends(get_db),
    tree_in: TreeFullCreate,
) -> Any:
    """Persist a complete nested tree (nodes, branches, conditions, workup).

    Accepts the frontend tree shape (camelCase) so the Builder/Runner can save a
    whole tree in one call. Reuses the frontend node ids as Node.id (Node PK is
    composite (id, tree_id), so ids may repeat across trees).
    """
    tree = Tree(
        name=tree_in.name,
        description=tree_in.description,
        clinic_id=tree_in.clinic_id,
        authored_by=tree_in.authored_by,
        root_node_id=tree_in.rootNodeId,
        is_active=True,
        version=1,
        base_tree_json=tree_in.baseTree,
        base_meta_json=tree_in.baseMeta,
    )
    db.add(tree)
    await db.flush()  # assign tree.id

    await _insert_tree_nodes(db, tree.id, tree_in.nodes)

    await db.commit()
    await db.refresh(tree)

    if tree.is_active:
        await _deactivate_other_trees(db, tree.id, tree.clinic_id)
        await db.commit()
        await db.refresh(tree)

    return tree


async def _insert_tree_nodes(db: AsyncSession, tree_id: str, nodes) -> None:
    """Persist the nested node/branch/condition/workup rows for a tree.

    Shared by create-full and update-full so the relational mapping of the
    frontend tree shape lives in exactly one place."""
    for n in nodes:
        node = Node(id=n.id, tree_id=tree_id, node_type=NodeType(n.type))
        if n.type == "variable":
            node.variable_key = n.variableKey
            node.prompt = n.prompt
            node.data_source = DataSource(n.dataSource) if n.dataSource else None
        elif n.type == "specialist":
            node.specialist_name = n.specialistName
            node.specialty = n.specialty
            node.urgency = Urgency(n.urgency) if n.urgency else None
            node.reasoning_template = n.reasoningTemplate
            node.clinical_basis = n.clinicalBasis
            node.confirm_with_dr_li = n.confirmWithDrLi
            node.workup_spec = _normalize_workup(n.workup)
        elif n.type == "escalation":
            node.escalation_reason = n.reason
        db.add(node)
        await db.flush()

        for i, b in enumerate(n.branches or []):
            branch = Branch(
                node_id=node.id,
                tree_id=tree_id,
                label=b.label,
                patient_label=b.patientLabel,
                next_node_id=b.nextNodeId,
                branch_order=i,
            )
            db.add(branch)
            await db.flush()
            cond = _build_condition(b.condition, branch.id)
            if cond is not None:
                db.add(cond)

        # Legacy-compat rows: mirror the spec's `always` list into workup_items
        # so anything still reading the old table keeps working.
        for i, w in enumerate(_workup_always_items(node.workup_spec)):
            db.add(
                WorkupItem(
                    node_id=node.id,
                    tree_id=tree_id,
                    name=w.get("name", ""),
                    protocol=w.get("protocol", ""),
                    rationale=w.get("rationale", ""),
                    item_order=i,
                )
            )


@router.put("/{tree_id}/full", response_model=TreeRead)
async def update_tree_full(
    *,
    db: AsyncSession = Depends(get_db),
    tree_id: str,
    tree_in: TreeFullUpdate,
) -> Any:
    """Replace an existing tree's nodes IN PLACE (same row, version bumped).

    This makes the edit → save loop coherent: opening a library tree, editing
    it (manually or via Sprout), and saving updates THAT tree instead of
    spawning a near-duplicate row. Published snapshots in tree_versions are
    immutable and untouched — this only rewrites the editable draft."""
    tree = await db.get(Tree, tree_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")

    # Wipe the current draft rows, children first (conditions cascade from
    # branches at the DB level; deleted explicitly for clarity).
    branch_ids = select(Branch.id).where(Branch.tree_id == tree_id)
    await db.execute(delete(Condition).where(Condition.branch_id.in_(branch_ids)))
    await db.execute(delete(WorkupItem).where(WorkupItem.tree_id == tree_id))
    await db.execute(delete(Branch).where(Branch.tree_id == tree_id))
    await db.execute(delete(Node).where(Node.tree_id == tree_id))

    if tree_in.name is not None:
        tree.name = tree_in.name
    if tree_in.description is not None:
        tree.description = tree_in.description
    tree.root_node_id = tree_in.rootNodeId
    tree.version = (tree.version or 1) + 1

    await _insert_tree_nodes(db, tree_id, tree_in.nodes)

    await db.commit()
    await db.refresh(tree)
    return tree


def _build_condition(cond, branch_id: str) -> Condition | None:
    """Map a frontend condition ({op, value|min|max|values}) to a Condition row."""
    if cond is None:
        return None
    if cond.op == "equals":
        value = cond.value
        # Booleans must round-trip as lowercase 'true'/'false' (frontend coerces).
        if isinstance(value, bool):
            value_string = "true" if value else "false"
        else:
            value_string = str(value)
        return Condition(
            branch_id=branch_id,
            condition_type=ConditionType.equals,
            value_string=value_string,
        )
    if cond.op == "range":
        return Condition(
            branch_id=branch_id,
            condition_type=ConditionType.range,
            min_value=cond.min,
            max_value=cond.max,
        )
    if cond.op == "in":
        return Condition(
            branch_id=branch_id,
            condition_type=ConditionType.in_,
            values_list=json.dumps(cond.values or []),
        )
    return None


@router.get("/{id}", response_model=TreeReadFull)
async def get_tree(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    # Need to load nested relationships for TreeReadFull
    query = (
        select(Tree)
        .where(Tree.id == id)
        .options(
            selectinload(Tree.nodes).selectinload(getattr(Tree.nodes.property.mapper.class_, "branches")).selectinload(getattr(Tree.nodes.property.mapper.class_, "branches").property.mapper.class_.condition),
            selectinload(Tree.nodes).selectinload(getattr(Tree.nodes.property.mapper.class_, "workup_items")),
        )
    )
    result = await db.execute(query)
    tree = result.scalars().first()
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")
    return tree


@router.patch("/{id}", response_model=TreeRead)
async def update_tree(
    id: str,
    tree_in: TreeUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    tree = await db.get(Tree, id)
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")
    
    update_data = tree_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(tree, field, value)
        
    await db.commit()
    await db.refresh(tree)

    if update_data.get("is_active") is True:
        await _deactivate_other_trees(db, tree.id, tree.clinic_id)
        await db.commit()
        await db.refresh(tree)

    return tree


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tree(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    tree = await db.get(Tree, id)
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")

    tree.is_active = False
    await db.commit()


@router.post("/{id}/activate", response_model=TreeRead)
async def activate_tree(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    tree = await db.get(Tree, id)
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")

    tree.is_active = True
    await _deactivate_other_trees(db, tree.id, tree.clinic_id)
    await db.commit()
    await db.refresh(tree)
    
    return tree


# ---------------------------------------------------------------------------
# Versioning & sign-off — publish snapshots the mutable draft into an
# IMMUTABLE tree_versions row (frontend camelCase shape, engine-native).
# ---------------------------------------------------------------------------


async def _load_tree_full(id: str, db: AsyncSession) -> Tree:
    node_cls = Tree.nodes.property.mapper.class_
    query = (
        select(Tree)
        .where(Tree.id == id)
        .options(
            selectinload(Tree.nodes)
            .selectinload(node_cls.branches)
            .selectinload(node_cls.branches.property.mapper.class_.condition),
            selectinload(Tree.nodes).selectinload(node_cls.workup_items),
        )
    )
    result = await db.execute(query)
    tree = result.scalars().first()
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")
    return tree


@router.post("/{id}/publish", response_model=TreeVersionRead, status_code=status.HTTP_201_CREATED)
async def publish_tree(
    id: str,
    body: TreePublish,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Snapshot the current draft as an immutable, optionally signed version."""
    tree = await _load_tree_full(id, db)
    tree_json = serialize_tree(tree)

    if not tree_json.get("rootNodeId") or not tree_json.get("nodes"):
        raise HTTPException(status_code=422, detail="Tree has no root/nodes; cannot publish an empty draft.")

    next_no = (
        await db.execute(
            select(func.coalesce(func.max(TreeVersion.version_no), 0)).where(TreeVersion.tree_id == id)
        )
    ).scalar_one() + 1

    version = TreeVersion(
        tree_id=id,
        version_no=next_no,
        tree_json=tree_json,
        validation_summary_json=body.validation_summary,
        signed_by=body.signed_by,
        signed_at=datetime.now(timezone.utc) if body.signed_by else None,
    )
    db.add(version)
    await db.flush()

    tree.status = "published"
    tree.version = next_no
    tree.current_version_id = version.id

    await db.commit()
    await db.refresh(version)
    return version


@router.get("/{id}/versions", response_model=List[TreeVersionRead])
async def list_tree_versions(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    result = await db.execute(
        select(TreeVersion).where(TreeVersion.tree_id == id).order_by(TreeVersion.version_no.desc())
    )
    return result.scalars().all()
