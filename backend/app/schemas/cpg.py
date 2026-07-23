"""Transport schemas for the CPG-to-tree scaffold pipeline.

Accepts a clinical practice guideline document and returns a draft tree
scaffold in TreeFullCreate-compatible shape for the Builder to render.
"""
from typing import Optional, List, Any
from pydantic import BaseModel, Field


class CPGScaffoldRequest(BaseModel):
    """Request body for CPG scaffold generation.

    The document text can be provided directly or extracted from an uploaded
    file (multipart handled at the route level).
    """
    subspecialty: str
    clinic_id: Optional[str] = None
    # Direct text input (alternative to file upload)
    document_text: Optional[str] = None


class CPGSectionInfo(BaseModel):
    """Metadata about a detected CPG section — for transparency."""
    name: str
    char_count: int
    node_count: int = 0


class CPGValidationIssue(BaseModel):
    """A structural issue found in the generated scaffold."""
    kind: str  # cycle | dead_end | orphan | no_default_branch | overlapping_conditions
    detail: str
    node_id: Optional[str] = None


class CPGScaffoldResponse(BaseModel):
    """The generated tree scaffold plus diagnostics."""
    tree: dict[str, Any]  # TreeFullCreate-compatible JSON
    sections: List[CPGSectionInfo] = []
    validation_issues: List[CPGValidationIssue] = []
    placeholder_count: int = 0  # how many specialist endpoints need clinician input
    total_nodes: int = 0
    total_variables: int = 0
    # Anchoring metadata for the delta layer: which document/sections produced
    # this scaffold. Stored alongside the base tree so deltas can scope anchors.
    base_meta: Optional[dict[str, Any]] = None
