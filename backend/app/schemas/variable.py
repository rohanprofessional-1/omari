from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, Any


class VariableCreate(BaseModel):
    key: str = Field(..., max_length=100)
    clinical_prompt: Optional[str] = None
    patient_question: Optional[str] = None
    answer_type: str  # single_choice | number | boolean | text
    options_json: Optional[Any] = None
    extraction_hints: Optional[str] = None


class VariableUpdate(BaseModel):
    clinical_prompt: Optional[str] = None
    patient_question: Optional[str] = None
    answer_type: Optional[str] = None
    options_json: Optional[Any] = None
    extraction_hints: Optional[str] = None


class VariableRead(BaseModel):
    key: str
    clinical_prompt: Optional[str] = None
    patient_question: Optional[str] = None
    answer_type: str
    options_json: Optional[Any] = None
    extraction_hints: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
