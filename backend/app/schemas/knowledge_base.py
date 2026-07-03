from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class KnowledgeBaseFileSummary(BaseModel):
    filename: str
    content_type: Optional[str] = None
    file_type: str
    text_length: int
    selected_length: int
    selected_chunk_count: int
    relevant_topics: list[str] = Field(default_factory=list)
    matched_specialists: list[str] = Field(default_factory=list)
    matched_diagnoses: list[str] = Field(default_factory=list)
    summary: str
    key_points: list[str] = Field(default_factory=list)
    evidence_quotes: list[str] = Field(default_factory=list)
    model_used: Optional[str] = None


class KnowledgeBasePreviewResponse(BaseModel):
    clinic_id: str
    clinic_name: str
    tree_id: str
    tree_name: str
    overview: str
    focus_terms: list[str] = Field(default_factory=list)
    files: list[KnowledgeBaseFileSummary] = Field(default_factory=list)
    persisted: bool = False
    updated_at: datetime
