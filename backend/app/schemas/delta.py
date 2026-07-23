"""Transport schemas for the tree delta layer.

The frontend Zod DeltaOpSchema is the canonical validator for delta payloads;
here they travel as verbatim dicts. The server validates the envelope
(op name, seq, status) and stores the payload for the frontend compiler.
"""
from datetime import datetime
from typing import List, Literal, Optional, Union
from pydantic import BaseModel, Field

from app.schemas.tree import TreeFullUpdate

DeltaOpName = Literal[
    "bind_terminal",
    "set_urgency",
    "set_threshold",
    "add_workup",
    "remove_workup",
    "suppress_branch",
    "set_scope",
    "add_rule",
    "reorder_priority",
    "reword",
]

DeltaStatus = Literal[
    "active",
    "stale_unresolved",
    "stale_ambiguous",
    "stale_conflict",
    "superseded",
    "dismissed",
]


class DeltaCreate(BaseModel):
    op: DeltaOpName
    payload: dict
    seq: Optional[int] = None  # omitted → appended after the current max
    expected: Optional[dict] = None
    provenance: dict = Field(default_factory=dict)
    specialist_id: Optional[str] = None
    base_hash: Optional[str] = None


class DeltaUpdate(BaseModel):
    payload: Optional[dict] = None
    seq: Optional[int] = None
    expected: Optional[dict] = None
    provenance: Optional[dict] = None
    specialist_id: Optional[str] = None
    status: Optional[DeltaStatus] = None
    stale_reason: Optional[str] = Field(None, max_length=500)


class DeltaRead(BaseModel):
    id: str
    tree_id: str
    seq: int
    op: str
    payload: dict
    expected: Optional[dict] = None
    provenance: dict
    specialist_id: Optional[str] = None
    status: str
    stale_reason: Optional[str] = None
    base_hash: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DeltaStatusUpdate(BaseModel):
    """One compile verdict to persist after a reconcile."""
    delta_id: str
    status: DeltaStatus
    stale_reason: Optional[str] = Field(None, max_length=500)


class ReconcileRequest(BaseModel):
    """Save a compiled tree + the compile's per-delta verdicts, transactionally.

    The frontend runs compile(base, deltas) and posts the result; the server
    replaces the draft rows (same mapping as PUT /trees/{id}/full), bumps the
    version, and records each delta's status — one explicit outcome per
    delta, never a silent drop.
    """
    tree: TreeFullUpdate
    base_hash: Optional[str] = None
    delta_results: List[DeltaStatusUpdate] = []


DeltaCreatePayload = Union[DeltaCreate, List[DeltaCreate]]
