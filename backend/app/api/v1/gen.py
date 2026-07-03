"""Blume — generator pipeline API (/api/v1/gen).

Persistence + the three bounded LLM jobs (case generation, highlight
classify fallback, gap phrasing). The deterministic pipeline stages —
accumulation, induction, assembly, gap detection, validation — run as pure
TS in the frontend (adapted-spec D3) and POST their outputs here, so the
database, not browser state, is the record.
"""
import logging
import re
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.generator import (
    GenerationSession,
    SyntheticCase,
    CaseHighlight,
    CandidateVariable,
    CaseDecision,
    InducedRule,
    Gap,
    ValidationRun,
    ValidationResult,
)
from app.schemas.generator import (
    SessionCreate,
    SessionUpdate,
    SessionRead,
    CaseCreate,
    CaseGenerateRequest,
    CaseRead,
    CaseUpdate,
    HighlightCreate,
    HighlightRead,
    CandidateVariableRead,
    DecisionCreate,
    DecisionRead,
    InduceRequest,
    RuleRead,
    AssembleRequest,
    GapsRequest,
    GapRead,
    GapUpdate,
    ValidateRequest,
    ValidationRunRead,
)
from app.services.anthropic import anthropic_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gen")


# --- sessions ---------------------------------------------------------------


@router.post("/sessions", response_model=SessionRead, status_code=status.HTTP_201_CREATED)
async def create_session(body: SessionCreate, db: AsyncSession = Depends(get_db)) -> Any:
    session = GenerationSession(
        subspecialty=body.subspecialty,
        surgeon_name=body.surgeon_name,
        clinic_id=body.clinic_id,
        roster_json=[r.model_dump() for r in body.roster],
        stage="setup",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/sessions", response_model=List[SessionRead])
async def list_sessions(db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(
        select(GenerationSession).order_by(GenerationSession.created_at.desc())
    )
    return result.scalars().all()


async def _get_session(session_id: str, db: AsyncSession) -> GenerationSession:
    session = await db.get(GenerationSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Generation session not found")
    return session


@router.get("/sessions/{session_id}", response_model=SessionRead)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    return await _get_session(session_id, db)


@router.patch("/sessions/{session_id}", response_model=SessionRead)
async def update_session(
    session_id: str, body: SessionUpdate, db: AsyncSession = Depends(get_db)
) -> Any:
    session = await _get_session(session_id, db)
    if body.stage is not None:
        session.stage = body.stage
    if body.status is not None:
        session.status = body.status
    if body.tree_id is not None:
        session.tree_id = body.tree_id
    if body.roster is not None:
        session.roster_json = [r.model_dump() for r in body.roster]
    await db.commit()
    await db.refresh(session)
    return session


# --- cases (Layer 1 inputs) ---------------------------------------------------


@router.post("/cases", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
async def create_case(body: CaseCreate, db: AsyncSession = Depends(get_db)) -> Any:
    case = SyntheticCase(
        subspecialty=body.subspecialty,
        narrative=body.narrative,
        ground_truth_json=body.ground_truth,
        source=body.source,
        clinic_id=body.clinic_id,
        minimal_pair_of=body.minimal_pair_of,
        varied_variable=body.varied_variable,
        quality_reviewed=body.source == "hand_authored",
    )
    db.add(case)
    await db.commit()
    await db.refresh(case)
    return case


@router.post("/cases/generate", response_model=List[CaseRead], status_code=status.HTTP_201_CREATED)
async def generate_cases(body: CaseGenerateRequest, db: AsyncSession = Depends(get_db)) -> Any:
    """LLM job 1 — generate synthetic cases (curated: quality_reviewed=False
    until a human approves each one)."""
    if not anthropic_service.is_available:
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key not configured on the backend — add ANTHROPIC_API_KEY to .env, or hand-author cases via POST /gen/cases.",
        )

    seed = None
    if body.minimal_pair_of:
        seed_case = await db.get(SyntheticCase, body.minimal_pair_of)
        if not seed_case:
            raise HTTPException(status_code=404, detail="Seed case for minimal pairs not found")
        seed = {"narrative": seed_case.narrative, "ground_truth": seed_case.ground_truth_json or {}}

    try:
        generated = await anthropic_service.generate_cases(
            subspecialty=body.subspecialty,
            count=body.count,
            variable_hints=body.variable_hints,
            roster=[r.model_dump() for r in body.roster],
            minimal_pair_seed=seed,
        )
    except Exception as e:  # surface LLM failures loudly, never silently
        logger.exception("case generation failed")
        raise HTTPException(status_code=502, detail=f"Case generation failed: {e}")

    rows: list[SyntheticCase] = []
    for c in generated:
        narrative = (c.get("narrative") or "").strip()
        if not narrative:
            continue
        rows.append(
            SyntheticCase(
                subspecialty=body.subspecialty,
                narrative=narrative,
                ground_truth_json=c.get("groundTruth") or {},
                source="generated",
                quality_reviewed=False,
                minimal_pair_of=body.minimal_pair_of,
                varied_variable=c.get("variedVariable"),
            )
        )
    db.add_all(rows)
    await db.commit()
    for r in rows:
        await db.refresh(r)
    return rows


@router.get("/cases", response_model=List[CaseRead])
async def list_cases(
    subspecialty: str | None = None,
    reviewed_only: bool = False,
    db: AsyncSession = Depends(get_db),
) -> Any:
    query = select(SyntheticCase).order_by(SyntheticCase.created_at)
    if subspecialty:
        query = query.where(SyntheticCase.subspecialty == subspecialty)
    if reviewed_only:
        query = query.where(SyntheticCase.quality_reviewed.is_(True))
    result = await db.execute(query)
    return result.scalars().all()


@router.patch("/cases/{case_id}", response_model=CaseRead)
async def update_case(case_id: str, body: CaseUpdate, db: AsyncSession = Depends(get_db)) -> Any:
    case = await db.get(SyntheticCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if body.narrative is not None:
        case.narrative = body.narrative
    if body.ground_truth is not None:
        case.ground_truth_json = body.ground_truth
    if body.quality_reviewed is not None:
        case.quality_reviewed = body.quality_reviewed
    await db.commit()
    await db.refresh(case)
    return case


# --- layer 1: highlights → candidate variable accumulator ---------------------


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")
    return slug[:60] or "unlabeled"


def _match_ground_truth(span: str, ground_truth: dict) -> tuple[str | None, Any]:
    """Deterministic mapping: does the span mention a planted variable's value
    or key? Checked before any LLM fallback."""
    span_lower = span.lower()
    for key, value in (ground_truth or {}).items():
        if str(value).lower() in span_lower and len(str(value)) >= 3:
            return key, value
        if key.replace("_", " ") in span_lower:
            return key, value
    return None, None


async def _bump_candidate(
    db: AsyncSession,
    session_id: str,
    key: str,
    axis: str,
    label: str | None,
    value_sample: Any,
) -> None:
    result = await db.execute(
        select(CandidateVariable).where(
            CandidateVariable.session_id == session_id, CandidateVariable.key == key
        )
    )
    cand = result.scalars().first()
    if cand is None:
        cand = CandidateVariable(
            session_id=session_id,
            key=key,
            label=label or key.replace("_", " ").capitalize(),
            axis=axis,
            value_samples_json=[],
            frequency=0,
        )
        db.add(cand)
    cand.frequency += 1
    if cand.axis != axis:
        cand.axis = "both"  # seen under both axes → it drives routing AND workup
    samples = list(cand.value_samples_json or [])
    if value_sample is not None and value_sample not in samples:
        samples.append(value_sample)
        cand.value_samples_json = samples[:20]


@router.post("/highlights", response_model=HighlightRead, status_code=status.HTTP_201_CREATED)
async def create_highlight(body: HighlightCreate, db: AsyncSession = Depends(get_db)) -> Any:
    session = await _get_session(body.session_id, db)
    case = await db.get(SyntheticCase, body.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    # 1. Deterministic mapping against the case's planted ground truth.
    key, value_sample = _match_ground_truth(body.span_text, case.ground_truth_json or {})
    label = None

    # 2. LLM fallback (job 2) only for unmatched spans, only if configured.
    if key is None and anthropic_service.is_available:
        try:
            known = (
                (
                    await db.execute(
                        select(CandidateVariable).where(CandidateVariable.session_id == session.id)
                    )
                )
                .scalars()
                .all()
            )
            out = await anthropic_service.classify_highlight(
                span_text=body.span_text,
                axis=body.axis,
                known_variables=[{"key": v.key, "label": v.label} for v in known],
            )
            key = out.get("key") or None
            label = out.get("label")
            value_sample = out.get("valueSample")
        except Exception:
            logger.warning("highlight classify fallback failed; slugifying", exc_info=True)

    # 3. Last resort: deterministic slug of the span itself.
    if key is None:
        key = _slugify(body.span_text)
        value_sample = body.span_text.strip()

    highlight = CaseHighlight(
        session_id=session.id,
        case_id=case.id,
        span_text=body.span_text,
        span_start=body.span_start,
        span_end=body.span_end,
        axis=body.axis,
        mapped_variable_key=key,
    )
    db.add(highlight)
    await _bump_candidate(db, session.id, key, body.axis, label, value_sample)
    if session.stage == "setup":
        session.stage = "highlight"
    await db.commit()
    await db.refresh(highlight)
    return highlight


@router.get("/sessions/{session_id}/highlights", response_model=List[HighlightRead])
async def list_highlights(session_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(
        select(CaseHighlight).where(CaseHighlight.session_id == session_id)
    )
    return result.scalars().all()


@router.get("/sessions/{session_id}/variables", response_model=List[CandidateVariableRead])
async def list_candidate_variables(session_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(
        select(CandidateVariable)
        .where(CandidateVariable.session_id == session_id)
        .order_by(CandidateVariable.frequency.desc())
    )
    return result.scalars().all()


# --- layer 2: case decisions ---------------------------------------------------


@router.post("/decisions", response_model=DecisionRead, status_code=status.HTTP_201_CREATED)
async def create_decision(body: DecisionCreate, db: AsyncSession = Depends(get_db)) -> Any:
    session = await _get_session(body.session_id, db)
    if not body.escalated and not body.routed_specialist_name:
        raise HTTPException(status_code=422, detail="Provide routed_specialist_name or escalated=true.")

    # One decision per (session, case): re-deciding replaces the earlier answer.
    await db.execute(
        delete(CaseDecision).where(
            CaseDecision.session_id == body.session_id, CaseDecision.case_id == body.case_id
        )
    )
    decision = CaseDecision(
        session_id=body.session_id,
        case_id=body.case_id,
        routed_specialist_name=body.routed_specialist_name,
        escalated=body.escalated,
        urgency=body.urgency,
        workup_json=body.workup,
        workup_counterfactual=body.workup_counterfactual,
        would_not_order_json=body.would_not_order,
        case_variables_json=body.case_variables,
    )
    db.add(decision)
    if session.stage in ("setup", "highlight"):
        session.stage = "decide"
    await db.commit()
    await db.refresh(decision)
    return decision


@router.get("/sessions/{session_id}/decisions", response_model=List[DecisionRead])
async def list_decisions(session_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(
        select(CaseDecision).where(CaseDecision.session_id == session_id)
    )
    return result.scalars().all()


# --- layers 2/3: persist deterministic pipeline outputs -------------------------


@router.post("/sessions/{session_id}/induce", response_model=List[RuleRead])
async def persist_induced_rules(
    session_id: str, body: InduceRequest, db: AsyncSession = Depends(get_db)
) -> Any:
    session = await _get_session(session_id, db)
    await db.execute(delete(InducedRule).where(InducedRule.session_id == session_id))
    rows = [
        InducedRule(
            session_id=session_id,
            kind=r.kind,
            condition_json=r.condition,
            target_json=r.target,
            support_case_ids_json=r.support_case_ids,
            confidence=r.confidence,
        )
        for r in body.rules
    ]
    db.add_all(rows)
    session.stage = "induce"
    await db.commit()
    for r in rows:
        await db.refresh(r)
    return rows


@router.post("/sessions/{session_id}/assemble", response_model=SessionRead)
async def persist_draft_tree(
    session_id: str, body: AssembleRequest, db: AsyncSession = Depends(get_db)
) -> Any:
    session = await _get_session(session_id, db)
    if not body.tree.get("rootNodeId") or not body.tree.get("nodes"):
        raise HTTPException(status_code=422, detail="Draft tree must have rootNodeId and nodes.")
    session.draft_tree_json = body.tree
    session.stage = "assemble"
    await db.commit()
    await db.refresh(session)
    return session


@router.post("/sessions/{session_id}/gaps", response_model=List[GapRead])
async def persist_gaps(
    session_id: str, body: GapsRequest, db: AsyncSession = Depends(get_db)
) -> Any:
    session = await _get_session(session_id, db)
    await db.execute(delete(Gap).where(Gap.session_id == session_id))
    rows: list[Gap] = []
    for g in body.gaps:
        question = g.question
        # LLM job 3 — phrasing only, deterministic template as fallback.
        if not question and g.phrase_with_llm and anthropic_service.is_available:
            try:
                question = await anthropic_service.phrase_gap(g.kind, g.detail or {})
            except Exception:
                logger.warning("gap phrasing failed; using template", exc_info=True)
        rows.append(Gap(session_id=session_id, kind=g.kind, detail_json=g.detail, question=question))
    db.add_all(rows)
    session.stage = "gaps"
    await db.commit()
    for r in rows:
        await db.refresh(r)
    return rows


@router.get("/sessions/{session_id}/gaps", response_model=List[GapRead])
async def list_gaps(session_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(select(Gap).where(Gap.session_id == session_id))
    return result.scalars().all()


@router.patch("/gaps/{gap_id}", response_model=GapRead)
async def update_gap(gap_id: str, body: GapUpdate, db: AsyncSession = Depends(get_db)) -> Any:
    gap = await db.get(Gap, gap_id)
    if not gap:
        raise HTTPException(status_code=404, detail="Gap not found")
    gap.status = body.status
    await db.commit()
    await db.refresh(gap)
    return gap


@router.post("/sessions/{session_id}/validate", response_model=ValidationRunRead)
async def persist_validation_run(
    session_id: str, body: ValidateRequest, db: AsyncSession = Depends(get_db)
) -> Any:
    session = await _get_session(session_id, db)
    run = ValidationRun(session_id=session_id, tree_json=body.tree, summary_json=body.summary)
    db.add(run)
    await db.flush()
    db.add_all(
        ValidationResult(
            run_id=run.id,
            case_id=r.case_id,
            expected_json=r.expected,
            engine_json=r.engine,
            routing_match=r.routing_match,
            workup_under_order=r.workup_under_order,
            workup_over_order=r.workup_over_order,
        )
        for r in body.results
    )
    session.validation_summary_json = body.summary
    session.stage = "validate"
    await db.commit()
    await db.refresh(run)
    return run
