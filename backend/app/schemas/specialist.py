from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class SpecialistCreate(BaseModel):
    name: str = Field(..., max_length=255)
    clinic_id: Optional[str] = None
    specialty: Optional[str] = None
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    department: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: bool = True


class SpecialistUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    clinic_id: Optional[str] = None
    specialty: Optional[str] = None
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    department: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SpecialistRead(BaseModel):
    id: str
    name: str
    clinic_id: Optional[str] = None
    specialty: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
