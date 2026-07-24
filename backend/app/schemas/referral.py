"""Pydantic schemas for the referral ingestion API."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ReferralIngestRequest(BaseModel):
    """Request body for ingesting a referral via Epic C-CDA."""

    tree_id: str = Field(..., description="ID of the decision tree to route against")
    patient_mrn: Optional[str] = Field(
        None, description="Patient MRN to look up in Epic"
    )
    epic_patient_id: Optional[str] = Field(
        None, description="FHIR Patient resource ID (alternative to MRN)"
    )


class ExtractedVariableRead(BaseModel):
    """A single extracted variable in the response."""

    variable_key: str
    value: Optional[str] = None
    confidence: float = 0.0
    source_section: str = ""
    reasoning: str = ""


class ReferralIngestResponse(BaseModel):
    """Response from the referral ingestion endpoint."""

    referral_id: str
    conversation_id: str
    routing_outcome: str  # "routed" | "escalated" | "incomplete"
    specialist_name: Optional[str] = None
    escalation_reason: Optional[str] = None
    extraction_summary: str = ""
    variables_extracted: int = 0
    variables_missing: List[str] = Field(default_factory=list)
    confidence_avg: float = 0.0
    path_taken: List[str] = Field(default_factory=list)
    extracted_variables: List[ExtractedVariableRead] = Field(default_factory=list)


class ReferralRead(BaseModel):
    """Full referral record for GET endpoints."""

    id: str
    conversation_id: str
    patient_id: Optional[str] = None
    epic_patient_fhir_id: Optional[str] = None
    document_reference_id: Optional[str] = None
    extraction_summary: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
