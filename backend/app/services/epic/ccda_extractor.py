"""
Tree-aware LLM extraction from C-CDA sections.

Given the parsed C-CDA sections and a tree's variable definitions,
uses Claude to extract variable values with confidence scores.
"""

import json
import logging
from typing import List, Optional

from pydantic import BaseModel, Field

from app.services.llm.client import call_llm
from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Response Models ──────────────────────────────────────────────────

class ExtractedVariable(BaseModel):
    """A single variable extracted from the C-CDA document."""
    variable_key: str = Field(description="The variable key from the tree definition")
    value: Optional[str] = Field(
        None,
        description="The extracted value, or null if not found in the document"
    )
    confidence: float = Field(
        0.0,
        ge=0.0,
        le=1.0,
        description="Confidence score from 0.0 to 1.0"
    )
    source_section: str = Field(
        "",
        description="Which C-CDA section the value was found in"
    )
    reasoning: str = Field(
        "",
        description="Brief explanation of why this value was extracted"
    )


class CcdaExtractionResponse(BaseModel):
    """Full extraction result from a C-CDA document."""
    extracted: List[ExtractedVariable] = Field(
        default_factory=list,
        description="List of extracted variables"
    )
    summary: str = Field(
        "",
        description="Brief clinical summary of the referral document"
    )


# ── Prompt Building ─────────────────────────────────────────────────

def _build_variable_definitions(variables: list) -> str:
    """
    Format variable definitions for the extraction prompt.

    Each variable includes its key, clinical context, answer type,
    allowed options, and any extraction hints.
    """
    lines = []
    for v in variables:
        parts = [f"- **{v.key}**"]

        if hasattr(v, "clinical_prompt") and v.clinical_prompt:
            parts.append(f"  Clinical context: {v.clinical_prompt}")
        if hasattr(v, "patient_question") and v.patient_question:
            parts.append(f"  Question: {v.patient_question}")
        if hasattr(v, "answer_type"):
            parts.append(f"  Type: {v.answer_type}")
        if hasattr(v, "options_json") and v.options_json:
            try:
                options = v.options_json if isinstance(v.options_json, list) else json.loads(v.options_json)
                parts.append(f"  Allowed values: {json.dumps(options)}")
            except (json.JSONDecodeError, TypeError):
                pass
        if hasattr(v, "extraction_hints") and v.extraction_hints:
            parts.append(f"  Extraction hints: {v.extraction_hints}")

        lines.append("\n".join(parts))

    return "\n\n".join(lines)


def _build_extraction_prompt(
    sections: dict[str, str],
    variables: list,
) -> str:
    """
    Build the system prompt for C-CDA variable extraction.
    """
    sections_text = "\n\n".join(
        f"### {name.replace('_', ' ').title()}\n{content}"
        for name, content in sections.items()
    )

    variable_defs = _build_variable_definitions(variables)

    return f"""You are a clinical data extraction specialist. You are analyzing a C-CDA (Consolidated Clinical Document Architecture) referral document to extract specific clinical variables needed for patient triage and routing.

## C-CDA Document Sections

{sections_text}

## Variables to Extract

For each variable below, extract its value from the C-CDA document sections above. If a variable's value is not present or cannot be determined from the document, set its value to null and confidence to 0.0.

{variable_defs}

## Instructions

1. For each variable, search across ALL provided sections for relevant information.
2. For variables with a fixed set of allowed values, map the clinical information to the closest matching allowed value.
3. Set confidence scores:
   - **0.9–1.0**: Value is explicitly and clearly stated in the document
   - **0.7–0.89**: Value can be confidently inferred from the clinical context
   - **0.5–0.69**: Value is somewhat ambiguous but a reasonable interpretation exists
   - **0.0–0.49**: Value is a guess or not found — set value to null for scores below 0.3
4. In the reasoning field, briefly explain where the value was found and how it was determined.
5. Provide a brief clinical summary of the referral (2-3 sentences).
6. IMPORTANT: You must return an entry for EVERY variable listed above, even if the value is null.
"""


# ── Extraction ───────────────────────────────────────────────────────

def extract_variables(
    sections: dict[str, str],
    variables: list,
    model_name: Optional[str] = None,
) -> CcdaExtractionResponse:
    """
    Use the LLM to extract tree-specific variable values from parsed C-CDA sections.

    Args:
        sections: Dict of section_name -> text content (from ccda_parser).
        variables: List of Variable model instances from the tree's variable definitions.
        model_name: Override the Anthropic model to use for extraction.

    Returns:
        CcdaExtractionResponse with extracted variables and a clinical summary.
    """
    if not sections:
        logger.warning("No C-CDA sections provided for extraction")
        return CcdaExtractionResponse(
            extracted=[
                ExtractedVariable(
                    variable_key=v.key,
                    value=None,
                    confidence=0.0,
                    source_section="",
                    reasoning="No C-CDA sections were available for extraction",
                )
                for v in variables
            ],
            summary="No clinical document content was available for analysis.",
        )

    if not variables:
        logger.warning("No variables provided for extraction")
        return CcdaExtractionResponse(
            extracted=[],
            summary="No variables were requested for extraction.",
        )

    model = model_name or settings.ANTHROPIC_EXTRACT_MODEL
    system_prompt = _build_extraction_prompt(sections, variables)

    logger.info(
        "Extracting %d variables from %d C-CDA sections using %s",
        len(variables),
        len(sections),
        model,
    )

    response = call_llm(
        system_prompt=system_prompt,
        user_message="Extract all the specified clinical variables from this C-CDA document.",
        model_name=model,
        response_model=CcdaExtractionResponse,
    )

    # Log extraction summary
    found_count = sum(1 for v in response.extracted if v.value is not None)
    avg_conf = (
        sum(v.confidence for v in response.extracted) / len(response.extracted)
        if response.extracted
        else 0.0
    )
    logger.info(
        "Extraction complete: %d/%d variables found, avg confidence %.2f",
        found_count,
        len(response.extracted),
        avg_conf,
    )

    return response
