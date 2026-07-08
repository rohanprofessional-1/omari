from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Dict, Any


class TreeCreate(BaseModel):
    name: str = Field(..., max_length=255)
    clinic_id: Optional[str] = None
    description: Optional[str] = None
    root_node_id: Optional[str] = None
    version: int = 1
    is_active: bool = True
    authored_by: Optional[str] = None


class TreeUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    clinic_id: Optional[str] = None
    description: Optional[str] = None
    root_node_id: Optional[str] = None
    version: Optional[int] = None
    is_active: Optional[bool] = None
    authored_by: Optional[str] = None


class TreeRead(BaseModel):
    id: str
    clinic_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    root_node_id: Optional[str] = None
    version: int
    is_active: bool
    authored_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TreeReadFull(TreeRead):
    """Tree with all nested nodes, branches, conditions for engine consumption."""
    nodes: List["NodeRead"] = []

    model_config = {"from_attributes": True}


# Forward reference resolution
from app.schemas.node import NodeRead  # noqa: E402
TreeReadFull.model_rebuild()


class BranchCondition(BaseModel):
    variable_name: str
    operator: str
    value: Any
    next_node_id: Optional[str] = None


class VariableNode(BaseModel):
    id: str
    label: str
    variable_name: str
    valid_values: List[str] = Field(default_factory=list)
    value_definitions: Dict[str, Any] = Field(default_factory=dict)
    few_shot_examples: List[Dict[str, Any]] = Field(default_factory=list)
    next_node_id: Optional[str] = None


class BranchNode(BaseModel):
    id: str
    conditions: List[BranchCondition] = Field(default_factory=list)
    default_next_node_id: Optional[str] = None


class ActionNode(BaseModel):
    id: str
    action_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    next_node_id: Optional[str] = None


class EndNode(BaseModel):
    id: str


class Tree(BaseModel):
    root_node_id: str
    nodes: Dict[str, Any] = Field(default_factory=dict)


TreeNode = VariableNode | BranchNode | ActionNode | EndNode
