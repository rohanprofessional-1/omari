from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class BranchCreate(BaseModel):
    label: str = Field(..., max_length=500)
    patient_label: Optional[str] = Field(None, max_length=500)
    next_node_id: Optional[str] = None
    branch_order: int = 0
    condition: Optional["ConditionCreate"] = None


class BranchUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=500)
    patient_label: Optional[str] = Field(None, max_length=500)
    next_node_id: Optional[str] = None
    branch_order: Optional[int] = None


class BranchRead(BaseModel):
    id: str
    node_id: str
    tree_id: str
    label: str
    patient_label: Optional[str] = None
    next_node_id: Optional[str] = None
    branch_order: int
    condition: Optional["ConditionRead"] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


from app.schemas.condition import ConditionCreate, ConditionRead  # noqa: E402
BranchCreate.model_rebuild()
BranchRead.model_rebuild()
