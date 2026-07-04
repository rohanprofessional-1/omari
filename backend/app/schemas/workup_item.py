from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class WorkupItemCreate(BaseModel):
    name: str = Field(..., max_length=255)
    protocol: Optional[str] = None
    rationale: Optional[str] = None
    item_order: int = 0


class WorkupItemUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    protocol: Optional[str] = None
    rationale: Optional[str] = None
    item_order: Optional[int] = None


class WorkupItemRead(BaseModel):
    id: str
    node_id: str
    tree_id: str
    name: str
    protocol: Optional[str] = None
    rationale: Optional[str] = None
    item_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
