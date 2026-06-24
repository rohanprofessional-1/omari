from pydantic import BaseModel, Field
from datetime import datetime, date
from typing import Optional


class PatientCreate(BaseModel):
    first_name: str = Field(..., max_length=255)
    last_name: str = Field(..., max_length=255)
    clinic_id: Optional[str] = None
    dob: Optional[date] = None
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    mrn: Optional[str] = Field(None, max_length=100)
    referring_provider: Optional[str] = Field(None, max_length=255)
    referral_date: Optional[date] = None
    referral_note: Optional[str] = None


class PatientUpdate(BaseModel):
    first_name: Optional[str] = Field(None, max_length=255)
    last_name: Optional[str] = Field(None, max_length=255)
    clinic_id: Optional[str] = None
    dob: Optional[date] = None
    email: Optional[str] = Field(None, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    mrn: Optional[str] = Field(None, max_length=100)
    referring_provider: Optional[str] = Field(None, max_length=255)
    referral_date: Optional[date] = None
    referral_note: Optional[str] = None


class PatientRead(BaseModel):
    id: str
    first_name: str
    last_name: str
    clinic_id: Optional[str] = None
    dob: Optional[date] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    mrn: Optional[str] = None
    referring_provider: Optional[str] = None
    referral_date: Optional[date] = None
    referral_note: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
