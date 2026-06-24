from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_db
from app.models.specialist import Specialist
from app.schemas.specialist import SpecialistCreate, SpecialistUpdate, SpecialistRead

router = APIRouter(prefix="/specialists")


@router.get("", response_model=List[SpecialistRead])
async def list_specialists(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    clinic_id: str | None = None,
) -> Any:
    query = select(Specialist)
    if clinic_id:
        query = query.where(Specialist.clinic_id == clinic_id)
        
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=SpecialistRead, status_code=status.HTTP_201_CREATED)
async def create_specialist(
    *,
    db: AsyncSession = Depends(get_db),
    specialist_in: SpecialistCreate,
) -> Any:
    specialist = Specialist(**specialist_in.model_dump())
    db.add(specialist)
    await db.commit()
    await db.refresh(specialist)
    return specialist


@router.get("/{id}", response_model=SpecialistRead)
async def get_specialist(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    specialist = await db.get(Specialist, id)
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist not found")
    return specialist


@router.patch("/{id}", response_model=SpecialistRead)
async def update_specialist(
    id: str,
    specialist_in: SpecialistUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    specialist = await db.get(Specialist, id)
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist not found")
    
    update_data = specialist_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(specialist, field, value)
        
    await db.commit()
    await db.refresh(specialist)
    return specialist
