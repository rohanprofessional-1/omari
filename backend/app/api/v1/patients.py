from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.models.patient import Patient
from app.schemas.patient import PatientCreate, PatientUpdate, PatientRead

router = APIRouter(prefix="/patients")


@router.get("", response_model=List[PatientRead])
async def list_patients(
    db: AsyncSession = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    clinic_id: str | None = None,
) -> Any:
    query = select(Patient)
    if clinic_id:
        query = query.where(Patient.clinic_id == clinic_id)
        
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def create_patient(
    *,
    db: AsyncSession = Depends(get_db),
    patient_in: PatientCreate,
) -> Any:
    patient = Patient(**patient_in.model_dump())
    db.add(patient)
    await db.commit()
    await db.refresh(patient)
    return patient


@router.get("/{id}", response_model=PatientRead)
async def get_patient(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    # Later we might want to return conversations too, but schema currently does not have it.
    patient = await db.get(Patient, id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient
