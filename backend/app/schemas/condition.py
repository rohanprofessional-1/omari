from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from decimal import Decimal


class ConditionCreate(BaseModel):
    condition_type: str  # equals | range | in
    value_string: Optional[str] = None
    values_list: Optional[str] = None
    min_value: Optional[Decimal] = None
    max_value: Optional[Decimal] = None


class ConditionUpdate(BaseModel):
    condition_type: Optional[str] = None
    value_string: Optional[str] = None
    values_list: Optional[str] = None
    min_value: Optional[Decimal] = None
    max_value: Optional[Decimal] = None


class ConditionRead(BaseModel):
    id: str
    branch_id: str
    condition_type: str
    value_string: Optional[str] = None
    values_list: Optional[str] = None
    min_value: Optional[Decimal] = None
    max_value: Optional[Decimal] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
