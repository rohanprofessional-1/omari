from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_db
from app.models.node import Node
from app.models.branch import Branch
from app.models.condition import Condition
from app.models.workup_item import WorkupItem
from app.schemas.node import NodeCreate, NodeUpdate, NodeRead

# This router is included under prefix "/trees" in main.py, wait no, let's include it directly.
# Let's use prefix="/trees/{tree_id}/nodes"
router = APIRouter(prefix="/trees/{tree_id}/nodes")


@router.post("", response_model=NodeRead, status_code=status.HTTP_201_CREATED)
async def create_node(
    *,
    tree_id: str,
    db: AsyncSession = Depends(get_db),
    node_in: NodeCreate,
) -> Any:
    data = node_in.model_dump(exclude={"branches", "workup_items"})
    data["tree_id"] = tree_id
    
    node = Node(**data)
    db.add(node)
    
    for branch_in in node_in.branches:
        branch_data = branch_in.model_dump(exclude={"condition"})
        branch_data["tree_id"] = tree_id
        branch = Branch(**branch_data)
        if branch_in.condition:
            condition = Condition(**branch_in.condition.model_dump())
            branch.condition = condition
        node.branches.append(branch)
        
    for workup_in in node_in.workup_items:
        workup_data = workup_in.model_dump()
        workup_data["tree_id"] = tree_id
        workup = WorkupItem(**workup_data)
        node.workup_items.append(workup)
        
    await db.commit()
    
    # Reload with relationships
    from sqlalchemy.orm import selectinload
    query = select(Node).where(Node.id == node.id).options(
        selectinload(Node.branches).selectinload(Branch.condition),
        selectinload(Node.workup_items)
    )
    result = await db.execute(query)
    return result.scalars().first()


@router.patch("/{node_id}", response_model=NodeRead)
async def update_node(
    tree_id: str,
    node_id: str,
    node_in: NodeUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    node = await db.get(Node, {"id": node_id, "tree_id": tree_id})
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    update_data = node_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(node, field, value)
        
    await db.commit()
    await db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(
    tree_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    node = await db.get(Node, {"id": node_id, "tree_id": tree_id})
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    await db.delete(node)
    await db.commit()
