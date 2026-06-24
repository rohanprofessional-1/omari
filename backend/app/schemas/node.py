from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class NodeCreate(BaseModel):
    id: Optional[str] = None  # Allow client-specified IDs
    node_type: str  # variable | specialist | escalation
    # Variable fields
    variable_key: Optional[str] = None
    prompt: Optional[str] = None
    data_source: Optional[str] = None  # patient | referral | record
    # Specialist fields
    specialist_name: Optional[str] = None
    specialty: Optional[str] = None
    urgency: Optional[str] = None  # routine | expedited | urgent
    reasoning_template: Optional[str] = None
    clinical_basis: Optional[str] = None
    confirm_with_dr_li: Optional[bool] = None
    # Escalation fields
    escalation_reason: Optional[str] = None
    # Nested creates
    branches: List["BranchCreate"] = []
    workup_items: List["WorkupItemCreate"] = []


class NodeUpdate(BaseModel):
    node_type: Optional[str] = None
    variable_key: Optional[str] = None
    prompt: Optional[str] = None
    data_source: Optional[str] = None
    specialist_name: Optional[str] = None
    specialty: Optional[str] = None
    urgency: Optional[str] = None
    reasoning_template: Optional[str] = None
    clinical_basis: Optional[str] = None
    confirm_with_dr_li: Optional[bool] = None
    escalation_reason: Optional[str] = None


class NodeRead(BaseModel):
    id: str
    tree_id: str
    node_type: str
    variable_key: Optional[str] = None
    prompt: Optional[str] = None
    data_source: Optional[str] = None
    specialist_name: Optional[str] = None
    specialty: Optional[str] = None
    urgency: Optional[str] = None
    reasoning_template: Optional[str] = None
    clinical_basis: Optional[str] = None
    confirm_with_dr_li: Optional[bool] = None
    escalation_reason: Optional[str] = None
    branches: List["BranchRead"] = []
    workup_items: List["WorkupItemRead"] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


from app.schemas.branch import BranchCreate, BranchRead  # noqa: E402
from app.schemas.workup_item import WorkupItemCreate, WorkupItemRead  # noqa: E402
NodeCreate.model_rebuild()
NodeRead.model_rebuild()
