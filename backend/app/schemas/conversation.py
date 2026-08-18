from pydantic import BaseModel, Field
from datetime import datetime
from decimal import Decimal
from typing import Optional, Any, List


class ConversationCreate(BaseModel):
    patient_id: Optional[str] = None
    referral_id: Optional[str] = None
    tree_id: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)


class ChatResponse(BaseModel):
    response: str
    status: str  # in_progress | routed | escalated
    turn_number: int
    filled_variables: dict[str, Any] = {}
    current_node_id: Optional[str] = None
    options: Optional[List[str]] = None
    specialist: Optional[dict] = None  # When routed
    escalation_reason: Optional[str] = None  # When escalated
    path_taken: Optional[List[str]] = None


class ConversationTurnRead(BaseModel):
    id: str
    conversation_id: str
    turn_number: int
    role: str
    message: Optional[str] = None
    node_id: Optional[str] = None
    variable_key: Optional[str] = None
    is_confirmation: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PatientVariableRead(BaseModel):
    id: str
    conversation_id: str
    variable_key: str
    value_string: Optional[str] = None
    value_number: Optional[Decimal] = None
    value_boolean: Optional[bool] = None
    value_json: Optional[Any] = None
    confidence: Decimal
    via: str
    reason_for_clarification: Optional[str] = None
    filled_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ActionRead(BaseModel):
    id: str
    conversation_id: str
    action_type: str
    payload: Optional[Any] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationRead(BaseModel):
    id: str
    patient_id: Optional[str] = None
    referral_id: Optional[str] = None
    tree_id: Optional[str] = None
    status: str
    outcome_specialist_id: Optional[str] = None
    outcome_urgency: Optional[str] = None
    escalation_reason: Optional[str] = None
    path_taken: Optional[Any] = None
    iterations: int
    questions_asked: int
    confirmations: int
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    turns: List[ConversationTurnRead] = []
    patient_variables: List[PatientVariableRead] = []

    model_config = {"from_attributes": True}
