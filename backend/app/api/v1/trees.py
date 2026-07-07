from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.models.tree import Tree
from app.schemas.tree import TreeCreate, TreeUpdate, TreeRead, TreeReadFull

router = APIRouter(prefix="/trees")


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


from app.services.tree_import import import_tree_from_json
from app.models.clinic import Clinic

@router.post("/import", response_model=TreeReadFull, status_code=status.HTTP_201_CREATED)
async def import_tree(
    *,
    db: AsyncSession = Depends(get_db),
    payload: dict,
) -> Any:
    """
    Imports a full nested tree structure from JSON, upserting the Tree and completely
    replacing its nested children.
    """
    # Just get the first clinic for now (as demo environment)
    clinic = (await db.execute(select(Clinic).limit(1))).scalars().first()
    if not clinic:
        raise HTTPException(status_code=400, detail="No clinic found in database.")
        
    tree = await import_tree_from_json(db, clinic.id, payload)
    
    # Reload tree with full nested relationships to return TreeReadFull
    query = (
        select(Tree)
        .where(Tree.id == tree.id)
        .options(
            selectinload(Tree.nodes).selectinload(getattr(Tree.nodes.property.mapper.class_, "branches")).selectinload(getattr(Tree.nodes.property.mapper.class_, "branches").property.mapper.class_.condition),
            selectinload(Tree.nodes).selectinload(getattr(Tree.nodes.property.mapper.class_, "workup_items")),
        )
    )
    result = await db.execute(query)
    full_tree = result.scalars().first()
    return full_tree

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
    return tree

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
