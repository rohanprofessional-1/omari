from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_db
from app.models.variable import Variable
from app.schemas.variable import VariableCreate, VariableUpdate, VariableRead

router = APIRouter(prefix="/variables")


@router.get("", response_model=List[VariableRead])
async def list_variables(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    result = await db.execute(select(Variable).offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=VariableRead, status_code=status.HTTP_201_CREATED)
async def create_variable(
    *,
    db: AsyncSession = Depends(get_db),
    variable_in: VariableCreate,
) -> Any:
    variable = await db.get(Variable, variable_in.key)
    if variable:
        raise HTTPException(status_code=400, detail="Variable key already exists")
    
    variable = Variable(**variable_in.model_dump())
    db.add(variable)
    await db.commit()
    await db.refresh(variable)
    return variable


@router.get("/{key}", response_model=VariableRead)
async def get_variable(
    key: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    variable = await db.get(Variable, key)
    if not variable:
        raise HTTPException(status_code=404, detail="Variable not found")
    return variable


@router.patch("/{key}", response_model=VariableRead)
async def update_variable(
    key: str,
    variable_in: VariableUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    variable = await db.get(Variable, key)
    if not variable:
        raise HTTPException(status_code=404, detail="Variable not found")
    
    update_data = variable_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(variable, field, value)
        
    await db.commit()
    await db.refresh(variable)
    return variable
