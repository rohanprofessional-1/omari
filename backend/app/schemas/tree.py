from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Literal, Any, Union


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
    status: str = "draft"
    subspecialty: Optional[str] = None
    current_version_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TreePublish(BaseModel):
    """Publish request: snapshot the draft into an immutable version."""
    signed_by: Optional[str] = None
    validation_summary: Optional[dict] = None


class TreeVersionRead(BaseModel):
    id: str
    tree_id: str
    version_no: int
    tree_json: dict
    validation_summary_json: Optional[dict] = None
    signed_by: Optional[str] = None
    signed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TreeReadFull(TreeRead):
    """Tree with all nested nodes, branches, conditions for engine consumption."""
    nodes: List["NodeRead"] = []

    model_config = {"from_attributes": True}


# Forward reference resolution
from app.schemas.node import NodeRead  # noqa: E402
TreeReadFull.model_rebuild()


# ---------------------------------------------------------------------------
# Full nested-tree create — accepts the FRONTEND tree shape (camelCase) so the
# Builder/Runner can persist a complete tree (nodes, branches, conditions,
# workup) in one call. Mirrors, in reverse, the mapping in frontend lib/api.ts.
# ---------------------------------------------------------------------------


class ConditionIn(BaseModel):
    op: Literal["equals", "range", "in"]
    value: Optional[Any] = None  # equals
    min: Optional[float] = None  # range
    max: Optional[float] = None  # range
    values: Optional[List[str]] = None  # in


class BranchIn(BaseModel):
    label: str
    patientLabel: Optional[str] = None
    condition: ConditionIn
    nextNodeId: str


class WorkupItemIn(BaseModel):
    name: str
    protocol: str = ""
    rationale: str = ""


class WorkupSpecIn(BaseModel):
    """Schema v2 path-conditioned workup. The rule internals (KeyedCondition
    etc.) are transport-validated loosely here — the frontend Zod schema is
    the canonical validator; this JSON is stored verbatim on the node."""
    always: List[WorkupItemIn] = []
    conditional: List[dict] = []
    doNotOrderUnless: List[dict] = []
    escalateWorkupIf: Optional[dict] = None


class NodeIn(BaseModel):
    id: str
    type: Literal["variable", "specialist", "escalation"]
    # variable
    variableKey: Optional[str] = None
    prompt: Optional[str] = None
    dataSource: Optional[str] = None
    branches: Optional[List[BranchIn]] = None
    # specialist
    specialistName: Optional[str] = None
    specialty: Optional[str] = None
    urgency: Optional[str] = None
    reasoningTemplate: Optional[str] = None
    clinicalBasis: Optional[str] = None
    confirmWithDrLi: Optional[bool] = None
    # Legacy flat list (v1) or the path-conditioned spec (v2) — both accepted;
    # the router normalizes to a WorkupSpec dict for storage.
    workup: Optional[Union[List[WorkupItemIn], WorkupSpecIn]] = None
    # escalation
    reason: Optional[str] = None


class TreeFullCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    clinic_id: Optional[str] = None
    authored_by: Optional[str] = None
    rootNodeId: str
    nodes: List[NodeIn]


class TreeFullUpdate(BaseModel):
    """Replace an existing tree's draft in place (PUT /trees/{id}/full)."""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    rootNodeId: str
    nodes: List[NodeIn]
