from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_db
from app.models.clinic import Clinic
from app.schemas.clinic import ClinicCreate, ClinicUpdate, ClinicRead

router = APIRouter(prefix="/clinics")


@router.get("", response_model=List[ClinicRead])
async def list_clinics(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    result = await db.execute(select(Clinic).offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=ClinicRead, status_code=status.HTTP_201_CREATED)
async def create_clinic(
    *,
    db: AsyncSession = Depends(get_db),
    clinic_in: ClinicCreate,
) -> Any:
    clinic = Clinic(**clinic_in.model_dump())
    db.add(clinic)
    await db.commit()
    await db.refresh(clinic)
    return clinic


@router.get("/{id}", response_model=ClinicRead)
async def get_clinic(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    clinic = await db.get(Clinic, id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    return clinic


@router.patch("/{id}", response_model=ClinicRead)
async def update_clinic(
    id: str,
    clinic_in: ClinicUpdate,
    db: AsyncSession = Depends(get_db),
) -> Any:
    clinic = await db.get(Clinic, id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    
    update_data = clinic_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(clinic, field, value)
        
    await db.commit()
    await db.refresh(clinic)
    return clinic
