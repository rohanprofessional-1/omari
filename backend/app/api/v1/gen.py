"""Blume — generator pipeline API (/api/v1/gen).

Persistence + the three bounded LLM jobs (case generation, highlight
classify fallback, gap phrasing). The deterministic pipeline stages —
accumulation, induction, assembly, gap detection, validation — run as pure
TS in the frontend (adapted-spec D3) and POST their outputs here, so the
database, not browser state, is the record.
"""
import logging
import re
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
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
    ReferralIngestRequest,
    ConsistencyFlag,
    WorkupStructureRequest,
    WorkupStructureResponse,
    HighlightCreate,
    HighlightRead,
    ObservationsUpdate,
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
from app.schemas.cpg import CPGScaffoldResponse
from app.services.cpg_service import generate_scaffold_from_cpg

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
        seed = {
            "narrative": seed_case.narrative,
            "ground_truth": seed_case.ground_truth_json or {},
            # Boundary-targeting: which flips are most likely to sit near the
            # surgeon's decision boundary, given how they decided the seed.
            "parent_decision": body.parent_decision,
        }

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


@router.post("/cases/ingest", response_model=List[CaseRead], status_code=status.HTTP_201_CREATED)
async def ingest_referral_letters(body: ReferralIngestRequest, db: AsyncSession = Depends(get_db)) -> Any:
    """LLM job 4 — de-identified referral letters → synthetic cases. The
    highest-leverage case source: real letters carry the messiness and tacit
    variables from-scratch generation can't invent. Rewritten, never copied;
    every case still lands unreviewed until a human approves it."""
    if not anthropic_service.is_available:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured on the backend.")
    if not body.letters.strip():
        raise HTTPException(status_code=422, detail="No referral letter text provided.")

    try:
        derived = await anthropic_service.ingest_referrals(
            subspecialty=body.subspecialty, letters_text=body.letters
        )
    except Exception as e:
        logger.exception("referral ingestion failed")
        raise HTTPException(status_code=502, detail=f"Referral ingestion failed: {e}")

    rows: list[SyntheticCase] = []
    for c in derived:
        narrative = (c.get("narrative") or "").strip()
        if not narrative:
            continue
        rows.append(
            SyntheticCase(
                subspecialty=body.subspecialty,
                clinic_id=body.clinic_id,
                narrative=narrative,
                ground_truth_json=c.get("groundTruth") or {},
                source="real_deidentified",
                quality_reviewed=False,
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


def _locate(span: str, needle: str) -> tuple[int, int] | None:
    """Case-insensitive location of `needle` inside `span`; None if absent."""
    idx = span.lower().find(needle.lower())
    return (idx, idx + len(needle)) if idx >= 0 else None


def _match_ground_truth_all(
    span: str,
    ground_truth: dict,
    axis: str,
    span_start: int | None,
) -> list[dict]:
    """Deterministic decomposition: return an observation for EVERY planted
    variable that appears inside the highlighted span (not just the first).
    Tolerant by construction — we search within whatever sloppy region the
    surgeon selected. Value matches beat key-mention matches; one observation
    per key. Runs before (and outranks) any LLM proposal."""
    observations: list[dict] = []
    seen: set[str] = set()

    def add(key: str, value, loc: tuple[int, int] | None) -> None:
        if key in seen:
            return
        seen.add(key)
        observations.append({
            "key": key,
            "label": None,
            "value": value,
            "spanText": span[loc[0]:loc[1]] if loc else span.strip()[:120],
            "spanStart": (span_start + loc[0]) if (loc and span_start is not None) else None,
            "spanEnd": (span_start + loc[1]) if (loc and span_start is not None) else None,
            "axis": axis,
            "source": "ground_truth",
        })

    # Pass 1 — value matches (strongest evidence).
    for key, value in (ground_truth or {}).items():
        if isinstance(value, bool):
            continue  # 'true'/'false' never appear verbatim in prose
        text = str(value)
        if isinstance(value, (int, float)):
            # Word-boundary numeric match: '8' matches '8 months', not '2019'.
            m = re.search(rf"(?<![\d.]){re.escape(text)}(?![\d.])", span)
            if m:
                add(key, value, (m.start(), m.end()))
            continue
        if len(text) >= 3:
            loc = _locate(span, text)
            if loc:
                add(key, value, loc)
                continue
            # Planted values are often snake_case ('numbness_tingling') while
            # prose has spaces — retry with underscores as spaces.
            loc = _locate(span, text.replace("_", " "))
            if loc:
                add(key, value, loc)

    # Pass 2 — key mentions ('symptom duration' appearing verbatim).
    for key, value in (ground_truth or {}).items():
        loc = _locate(span, key.replace("_", " "))
        if loc:
            add(key, value, loc)

    return observations


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

    # 1. Deterministic decomposition — EVERY planted variable inside the span.
    observations = _match_ground_truth_all(
        body.span_text, case.ground_truth_json or {}, body.axis, body.span_start
    )
    found_keys = {o["key"] for o in observations}

    # 2. LLM decomposition (job 2) — ADDITIVE: proposes further distinct
    #    clinical concepts the ground truth didn't label. Deterministic matches
    #    win key collisions; the surgeon curates everything afterward (chips).
    if anthropic_service.is_available:
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
            proposed = await anthropic_service.decompose_highlight(
                span_text=body.span_text,
                axis=body.axis,
                known_variables=[{"key": v.key, "label": v.label} for v in known],
                already_found=sorted(found_keys),
            )
            for p in proposed:
                key = (p.get("key") or "").strip()
                if not key or key in found_keys:
                    continue  # deterministic wins; no duplicates
                found_keys.add(key)
                sub = (p.get("spanText") or "").strip()
                loc = _locate(body.span_text, sub) if sub else None
                observations.append({
                    "key": key,
                    "label": p.get("label"),
                    "value": p.get("value"),
                    "spanText": sub or body.span_text.strip()[:120],
                    "spanStart": (body.span_start + loc[0]) if (loc and body.span_start is not None) else None,
                    "spanEnd": (body.span_start + loc[1]) if (loc and body.span_start is not None) else None,
                    # The surgeon's tag governs the axis; the LLM's per-item
                    # suggestion is advisory and merely recorded.
                    "axis": body.axis,
                    "source": "llm",
                    "confidence": p.get("confidence"),
                })
        except Exception:
            logger.warning("highlight decomposition LLM failed; deterministic-only", exc_info=True)

    # 3. Last resort — never lose a highlight: slug the whole span.
    if not observations:
        observations.append({
            "key": _slugify(body.span_text),
            "label": None,
            "value": body.span_text.strip(),
            "spanText": body.span_text.strip()[:120],
            "spanStart": body.span_start,
            "spanEnd": body.span_end,
            "axis": body.axis,
            "source": "fallback",
        })

    highlight = CaseHighlight(
        session_id=session.id,
        case_id=case.id,
        span_text=body.span_text,
        span_start=body.span_start,
        span_end=body.span_end,
        axis=body.axis,
        mapped_variable_key=observations[0]["key"],  # legacy mirror
        observations_json=observations,
    )
    db.add(highlight)
    # One generous highlight bumps EVERY variable it contains.
    for o in observations:
        await _bump_candidate(db, session.id, o["key"], o["axis"], o.get("label"), o.get("value"))
    if session.stage == "setup":
        session.stage = "highlight"
    await db.commit()
    await db.refresh(highlight)
    return highlight


async def _rebuild_candidates(db: AsyncSession, session_id: str) -> None:
    """Recompute the session's candidate-variable tally from every highlight's
    observations. Used after curation (chip removal) so frequencies never
    drift — correct decrement semantics without bookkeeping."""
    await db.execute(delete(CandidateVariable).where(CandidateVariable.session_id == session_id))
    result = await db.execute(select(CaseHighlight).where(CaseHighlight.session_id == session_id))
    for h in result.scalars().all():
        for o in h.observations_json or []:
            await _bump_candidate(
                db, session_id, o["key"], o.get("axis", h.axis), o.get("label"), o.get("value")
            )


@router.put("/highlights/{highlight_id}/observations", response_model=HighlightRead)
async def update_highlight_observations(
    highlight_id: str, body: ObservationsUpdate, db: AsyncSession = Depends(get_db)
) -> Any:
    """Surgeon curation: replace a highlight's observation set (chip removal /
    correction). Removing the last observation keeps the highlight row with an
    empty set — the span stays visible, contributing nothing to the tally."""
    highlight = await db.get(CaseHighlight, highlight_id)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    highlight.observations_json = [o.model_dump(exclude_none=True) for o in body.observations]
    highlight.mapped_variable_key = body.observations[0].key if body.observations else None
    await _rebuild_candidates(db, highlight.session_id)
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
    if not body.escalated and not body.routed_specialist_name and not body.skipped:
        raise HTTPException(
            status_code=422,
            detail="Provide routed_specialist_name, escalated=true, or skipped=true (with a reason).",
        )

    # One decision per (session, case): re-deciding replaces the earlier answer.
    await db.execute(
        delete(CaseDecision).where(
            CaseDecision.session_id == body.session_id, CaseDecision.case_id == body.case_id
        )
    )
    decision = CaseDecision(
        session_id=body.session_id,
        case_id=body.case_id,
        routed_specialist_name=None if body.skipped else body.routed_specialist_name,
        escalated=body.escalated,
        skipped=body.skipped,
        skip_reason=body.skip_reason if body.skipped else None,
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


@router.post("/sessions/{session_id}/consistency", response_model=List[ConsistencyFlag])
async def check_decision_consistency(session_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    """LLM job 5 — Layer 2 live coaching. Flags clinically-similar cases the
    surgeon decided differently, phrased as questions. ADVISORY ONLY: flags are
    returned, never persisted into the logic — the surgeon resolves each one
    (there may be a real distinction the model can't see)."""
    session = await _get_session(session_id, db)
    if not anthropic_service.is_available:
        return []

    decisions = (
        (await db.execute(select(CaseDecision).where(CaseDecision.session_id == session_id)))
        .scalars()
        .all()
    )
    if len(decisions) < 3:
        return []  # too few decisions to meaningfully compare

    case_ids = [d.case_id for d in decisions]
    cases = (
        (await db.execute(select(SyntheticCase).where(SyntheticCase.id.in_(case_ids))))
        .scalars()
        .all()
    )
    narrative_by_id = {c.id: c.narrative for c in cases}

    payload = [
        {
            "caseId": d.case_id,
            "summary": narrative_by_id.get(d.case_id, "")[:220],
            "routedTo": d.routed_specialist_name,
            "escalated": d.escalated,
            "workup": [w.get("name") for w in (d.workup_json or []) if isinstance(w, dict)],
            "wouldNotOrder": d.would_not_order_json or [],
        }
        for d in decisions
    ]
    try:
        flags = await anthropic_service.check_consistency(payload, roster=session.roster_json or [])
    except Exception:
        logger.warning("consistency check failed; returning no flags", exc_info=True)
        return []
    valid_ids = set(case_ids)
    return [
        ConsistencyFlag(caseIds=[i for i in (f.get("caseIds") or []) if i in valid_ids], concern=f.get("concern", ""))
        for f in flags
        if f.get("concern")
    ]


@router.post("/workup/structure", response_model=WorkupStructureResponse)
async def structure_workup_text(body: WorkupStructureRequest) -> Any:
    """LLM job 6 — transcribe the surgeon's free-text workup description into
    structured items + explicit refusals. A transcription aid only: it never
    adds tests the surgeon didn't imply, and the surgeon edits every row."""
    if not anthropic_service.is_available:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured on the backend.")
    if not body.text.strip():
        raise HTTPException(status_code=422, detail="No workup text provided.")
    try:
        out = await anthropic_service.structure_workup(text=body.text, known_tests=body.known_tests)
    except Exception as e:
        logger.exception("workup structuring failed")
        raise HTTPException(status_code=502, detail=f"Workup structuring failed: {e}")
    return WorkupStructureResponse(items=out["items"], wouldNotOrder=out["wouldNotOrder"])


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
        # LLM job 3 — phrasing ONLY (detection already happened, deterministically).
        # The provided template question is the guaranteed fallback.
        if g.phrase_with_llm and anthropic_service.is_available:
            try:
                phrased = await anthropic_service.phrase_gap(g.kind, g.detail or {})
                if phrased:
                    question = phrased
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


# --- CPG scaffold generation ---------------------------------------------------


@router.post("/sessions/{session_id}/cpg-scaffold", response_model=CPGScaffoldResponse)
async def generate_cpg_scaffold(
    session_id: str,
    file: Optional[UploadFile] = File(None),
    document_text: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Generate a draft tree scaffold from a Clinical Practice Guideline.

    Accepts either a file upload (PDF, EPUB, TXT) or raw text via
    document_text.  The generated scaffold lands as an editable draft
    the clinician reviews and completes in the Builder.
    """
    session = await _get_session(session_id, db)

    if not anthropic_service.is_available:
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key not configured — required for CPG extraction.",
        )

    # Read file bytes if uploaded
    file_data: bytes | None = None
    filename: str | None = None
    content_type: str | None = None
    if file:
        file_data = await file.read()
        filename = file.filename
        content_type = file.content_type
    elif not document_text or not document_text.strip():
        raise HTTPException(
            status_code=422,
            detail="Provide either a file upload or document_text.",
        )

    try:
        result = await generate_scaffold_from_cpg(
            subspecialty=session.subspecialty,
            document_text=document_text,
            file_data=file_data,
            filename=filename,
            content_type=content_type,
            existing_tree=session.draft_tree_json,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("CPG scaffold generation failed")
        raise HTTPException(status_code=502, detail=f"CPG scaffold generation failed: {e}")

    # Persist the draft tree on the session
    session.draft_tree_json = result.tree
    session.stage = "assemble"
    await db.commit()

    return result
