from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class ClinicCreate(BaseModel):
    name: str = Field(..., max_length=255)
    type: Optional[str] = Field(None, max_length=100)
    knowledge_base: Optional[str] = None
    group: Optional[str] = Field(None, max_length=255)


class ClinicUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    type: Optional[str] = Field(None, max_length=100)
    knowledge_base: Optional[str] = None
    group: Optional[str] = Field(None, max_length=255)


class ClinicRead(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    knowledge_base: Optional[str] = None
    group: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
