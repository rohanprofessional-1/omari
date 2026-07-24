"""
Referral ingestion orchestration.

End-to-end pipeline: Epic auth → fetch C-CDA → parse sections → LLM extract
→ tree engine → create Conversation + Referral records → return advisory result.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.tree import Tree
from app.models.node import Node
from app.models.patient import Patient
from app.models.variable import Variable
from app.models.conversation import (
    Conversation,
    ConversationStatus,
    PatientVariable,
    VariableVia,
)
from app.models.referral import Referral

from app.schemas.referral import (
    ReferralIngestResponse,
    ExtractedVariableRead,
)

from app.services.epic.epic_client import EpicFHIRClient, EpicFHIRError
from app.services.epic.ccda_parser import extract_sections
from app.services.epic.ccda_extractor import extract_variables
from app.services.tree_engine import run_engine

from app.schemas.tree import TreeReadFull

logger = logging.getLogger(__name__)


async def _load_tree_full(db: AsyncSession, tree_id: str) -> Tree:
    """Load a tree with all nested relationships for engine consumption."""
    node_cls = Tree.nodes.property.mapper.class_
    query = (
        select(Tree)
        .where(Tree.id == tree_id)
        .options(
            selectinload(Tree.nodes)
            .selectinload(node_cls.branches)
            .selectinload(node_cls.branches.property.mapper.class_.condition),
            selectinload(Tree.nodes).selectinload(node_cls.workup_items),
        )
    )
    result = await db.execute(query)
    return result.scalars().first()


async def _load_tree_variables(db: AsyncSession, tree: Tree) -> list:
    """
    Load Variable definitions for all variable_keys used in this tree.
    """
    variable_keys = [
        n.variable_key for n in tree.nodes
        if n.variable_key is not None
    ]
    if not variable_keys:
        return []

    result = await db.execute(
        select(Variable).where(Variable.key.in_(variable_keys))
    )
    return list(result.scalars().all())


async def _find_or_create_patient(
    db: AsyncSession,
    epic_patient: dict,
    mrn: Optional[str] = None,
) -> Patient:
    """
    Find an existing patient by MRN, or create a minimal record
    from the FHIR Patient resource.
    """
    # Try to find by MRN first
    if mrn:
        result = await db.execute(
            select(Patient).where(Patient.mrn == mrn)
        )
        existing = result.scalars().first()
        if existing:
            return existing

    # Extract name from FHIR resource
    names = epic_patient.get("name", [{}])
    name_obj = names[0] if names else {}
    given_names = name_obj.get("given", [])
    first_name = given_names[0] if given_names else "Unknown"
    last_name = name_obj.get("family", "Unknown")

    # Extract DOB
    dob = None
    dob_str = epic_patient.get("birthDate")
    if dob_str:
        try:
            from datetime import date
            dob = date.fromisoformat(dob_str)
        except ValueError:
            pass

    patient = Patient(
        first_name=first_name,
        last_name=last_name,
        dob=dob,
        mrn=mrn or epic_patient.get("identifier", [{}])[0].get("value"),
    )
    db.add(patient)
    await db.flush()
    return patient


async def ingest_referral(
    db: AsyncSession,
    tree_id: str,
    patient_mrn: Optional[str] = None,
    epic_patient_id: Optional[str] = None,
) -> ReferralIngestResponse:
    """
    Full referral ingestion pipeline.

    Steps:
    1. Load tree and variable definitions from DB
    2. Authenticate with Epic and resolve patient
    3. Fetch C-CDA document from Epic
    4. Parse C-CDA sections
    5. Extract tree variables via LLM
    6. Create Conversation (mode=referral) and Referral records
    7. Store PatientVariables
    8. Run tree engine for advisory routing
    9. Update Conversation with routing result
    10. Return response
    """
    if not patient_mrn and not epic_patient_id:
        raise ValueError("Either patient_mrn or epic_patient_id must be provided")

    # ── Step 1: Load tree ────────────────────────────────────────────
    tree = await _load_tree_full(db, tree_id)
    if not tree:
        raise ValueError(f"Tree '{tree_id}' not found")

    tree_variables = await _load_tree_variables(db, tree)
    logger.info(
        "Loaded tree '%s' with %d nodes, %d variable definitions",
        tree.name,
        len(tree.nodes),
        len(tree_variables),
    )

    # ── Steps 2-3: Authenticate with Epic and fetch C-CDA ───────────
    async with EpicFHIRClient() as epic:
        # Resolve patient
        if patient_mrn:
            fhir_patient = await epic.get_patient_by_mrn(patient_mrn)
        else:
            fhir_patient = await epic.get_patient_by_fhir_id(epic_patient_id)

        fhir_patient_id = fhir_patient.get("id")

        # Get C-CDA documents
        doc_refs = await epic.get_document_references(fhir_patient_id)
        if not doc_refs:
            raise EpicFHIRError(
                f"No C-CDA documents found for patient {fhir_patient_id}"
            )

        # Use the most recent document
        doc_ref = doc_refs[0]
        ccda_xml = await epic.get_document_content(doc_ref)

    logger.info(
        "Fetched C-CDA (%d bytes) for patient %s",
        len(ccda_xml),
        fhir_patient_id,
    )

    # ── Step 4: Parse C-CDA sections ────────────────────────────────
    sections = extract_sections(ccda_xml)

    # ── Step 5: LLM extraction ──────────────────────────────────────
    extraction_result = extract_variables(sections, tree_variables)

    # ── Step 6: Create Patient + Conversation + Referral ────────────
    patient = await _find_or_create_patient(db, fhir_patient, patient_mrn)

    conversation = Conversation(
        patient_id=patient.id,
        tree_id=tree_id,
        mode="referral",
        status=ConversationStatus.in_progress,
        started_at=datetime.now(timezone.utc),
    )
    db.add(conversation)
    await db.flush()

    referral = Referral(
        conversation_id=conversation.id,
        patient_id=patient.id,
        epic_patient_fhir_id=fhir_patient_id,
        document_reference_id=doc_ref.get("id"),
        document_url=doc_ref.get("content", [{}])[0].get("attachment", {}).get("url"),
        ccda_raw=ccda_xml,
        sections_json=sections,
        extraction_json=extraction_result.model_dump(),
        extraction_summary=extraction_result.summary,
        status="extracted",
    )
    db.add(referral)

    # ── Step 7: Store PatientVariables ──────────────────────────────
    filled: dict[str, str] = {}

    for ev in extraction_result.extracted:
        if ev.value is not None and ev.confidence >= 0.3:
            filled[ev.variable_key] = ev.value

        pv = PatientVariable(
            conversation_id=conversation.id,
            variable_key=ev.variable_key,
            value_string=ev.value,
            confidence=Decimal(str(round(ev.confidence, 2))),
            via=VariableVia.referral_document,
            filled_at=datetime.now(timezone.utc) if ev.value else None,
        )
        db.add(pv)

    # ── Step 8: Run tree engine ─────────────────────────────────────
    tree_schema = TreeReadFull.model_validate(tree, from_attributes=True)
    routing_result = run_engine(tree_schema, filled)

    # ── Step 9: Update Conversation with routing result ─────────────
    conversation.status = ConversationStatus(routing_result.outcome)
    conversation.path_taken = routing_result.path_taken
    conversation.completed_at = datetime.now(timezone.utc)

    if routing_result.specialist:
        conversation.outcome_specialist_id = routing_result.specialist.id if hasattr(routing_result.specialist, "id") else None
    if routing_result.escalation_reason:
        conversation.escalation_reason = routing_result.escalation_reason

    referral.status = "routed"

    await db.flush()

    # ── Step 10: Build response ─────────────────────────────────────
    specialist_name = None
    if routing_result.specialist:
        specialist_name = getattr(routing_result.specialist, "specialist_name", None)

    extracted_reads = [
        ExtractedVariableRead(
            variable_key=ev.variable_key,
            value=ev.value,
            confidence=ev.confidence,
            source_section=ev.source_section,
            reasoning=ev.reasoning,
        )
        for ev in extraction_result.extracted
    ]

    confidences = [ev.confidence for ev in extraction_result.extracted]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    return ReferralIngestResponse(
        referral_id=referral.id,
        conversation_id=conversation.id,
        routing_outcome=routing_result.outcome,
        specialist_name=specialist_name,
        escalation_reason=routing_result.escalation_reason,
        extraction_summary=extraction_result.summary,
        variables_extracted=sum(1 for ev in extraction_result.extracted if ev.value is not None),
        variables_missing=routing_result.missing_variables,
        confidence_avg=round(avg_confidence, 3),
        path_taken=routing_result.path_taken,
        extracted_variables=extracted_reads,
    )
