"""Transport schemas for the generator pipeline (/api/v1/gen).

Heavy JSON payloads (rules, gaps, draft trees, validation results) are
computed by the deterministic TS modules in frontend/src/lib/generator and
validated there by Zod; these models transport-validate shape and the DB is
the system of record (adapted-spec decision D3).
"""
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field


# --- sessions ---------------------------------------------------------------

class RosterEntry(BaseModel):
    name: str
    specialty: str = ""
    focus: str = ""


class SessionCreate(BaseModel):
    subspecialty: str
    surgeon_name: Optional[str] = None
    clinic_id: Optional[str] = None
    roster: List[RosterEntry] = []


class SessionUpdate(BaseModel):
    stage: Optional[str] = None
    status: Optional[str] = None
    tree_id: Optional[str] = None
    roster: Optional[List[RosterEntry]] = None


class SessionRead(BaseModel):
    id: str
    clinic_id: Optional[str] = None
    tree_id: Optional[str] = None
    subspecialty: str
    surgeon_name: Optional[str] = None
    stage: str
    status: str
    roster_json: Optional[list] = None
    draft_tree_json: Optional[dict] = None
    validation_summary_json: Optional[dict] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- cases ------------------------------------------------------------------

class CaseCreate(BaseModel):
    subspecialty: str
    narrative: str
    ground_truth: dict[str, Any] = {}
    source: str = "hand_authored"
    clinic_id: Optional[str] = None
    minimal_pair_of: Optional[str] = None
    varied_variable: Optional[str] = None


class CaseGenerateRequest(BaseModel):
    subspecialty: str
    count: int = Field(5, ge=1, le=15)
    variable_hints: List[str] = []
    roster: List[RosterEntry] = []
    # Generate minimal pairs of an existing case instead of fresh cases.
    minimal_pair_of: Optional[str] = None


class CaseRead(BaseModel):
    id: str
    clinic_id: Optional[str] = None
    subspecialty: str
    narrative: str
    ground_truth_json: Optional[dict] = None
    source: str
    quality_reviewed: bool
    minimal_pair_of: Optional[str] = None
    varied_variable: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CaseUpdate(BaseModel):
    narrative: Optional[str] = None
    ground_truth: Optional[dict[str, Any]] = None
    quality_reviewed: Optional[bool] = None


# --- layer 1: highlights & candidate variables -------------------------------

class HighlightCreate(BaseModel):
    session_id: str
    case_id: str
    span_text: str
    span_start: Optional[int] = None
    span_end: Optional[int] = None
    axis: str = Field(..., pattern="^(routing|workup|both)$")


class HighlightRead(BaseModel):
    id: str
    session_id: str
    case_id: str
    span_text: str
    span_start: Optional[int] = None
    span_end: Optional[int] = None
    axis: str
    mapped_variable_key: Optional[str] = None

    model_config = {"from_attributes": True}


class CandidateVariableRead(BaseModel):
    id: str
    session_id: str
    key: str
    label: Optional[str] = None
    axis: str
    value_samples_json: Optional[list] = None
    frequency: int

    model_config = {"from_attributes": True}


# --- layer 2: decisions -------------------------------------------------------

class DecisionCreate(BaseModel):
    session_id: str
    case_id: str
    routed_specialist_name: Optional[str] = None
    escalated: bool = False
    urgency: Optional[str] = None
    workup: List[dict] = []          # [{ name, protocol?, rationale? }]
    workup_counterfactual: Optional[str] = None
    would_not_order: List[str] = []  # test names the surgeon deliberately skips
    case_variables: dict[str, Any] = {}


class DecisionRead(BaseModel):
    id: str
    session_id: str
    case_id: str
    routed_specialist_name: Optional[str] = None
    escalated: bool
    urgency: Optional[str] = None
    workup_json: Optional[list] = None
    workup_counterfactual: Optional[str] = None
    would_not_order_json: Optional[list] = None
    case_variables_json: Optional[dict] = None

    model_config = {"from_attributes": True}


# --- layers 2/3 persistence: rules, draft, gaps, validation -------------------

class RuleIn(BaseModel):
    kind: str
    condition: Optional[dict] = None
    target: Optional[dict] = None
    support_case_ids: List[str] = []
    confidence: float = 0.0


class RuleRead(BaseModel):
    id: str
    session_id: str
    kind: str
    condition_json: Optional[dict] = None
    target_json: Optional[dict] = None
    support_case_ids_json: Optional[list] = None
    confidence: float

    model_config = {"from_attributes": True}


class InduceRequest(BaseModel):
    rules: List[RuleIn]


class AssembleRequest(BaseModel):
    tree: dict  # frontend camelCase Tree JSON (Zod-validated client-side)


class GapIn(BaseModel):
    kind: str
    detail: Optional[dict] = None
    question: Optional[str] = None
    # Ask the LLM to phrase the question from detail when true and none given.
    phrase_with_llm: bool = False


class GapsRequest(BaseModel):
    gaps: List[GapIn]


class GapRead(BaseModel):
    id: str
    session_id: str
    kind: str
    detail_json: Optional[dict] = None
    question: Optional[str] = None
    status: str

    model_config = {"from_attributes": True}


class GapUpdate(BaseModel):
    status: str = Field(..., pattern="^(open|resolved|dismissed)$")


class ValidationResultIn(BaseModel):
    case_id: str
    expected: Optional[dict] = None
    engine: Optional[dict] = None
    routing_match: bool = False
    workup_under_order: bool = False
    workup_over_order: bool = False


class ValidateRequest(BaseModel):
    tree: dict
    summary: dict
    results: List[ValidationResultIn]


class ValidationRunRead(BaseModel):
    id: str
    session_id: str
    summary_json: Optional[dict] = None
    ran_at: datetime

    model_config = {"from_attributes": True}
