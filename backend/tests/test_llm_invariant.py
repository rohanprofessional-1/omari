"""THE HARD INVARIANT, asserted structurally.

The LLM may generate case variants, flag possible inconsistencies, structure
free text, and phrase questions — it must NEVER select the specialist, decide
the urgency, or decide the workup. These tests pin the transport schemas so
no LLM-facing endpoint is even CAPABLE of returning a routing/urgency
decision: if someone adds a `suggested_specialist` field to one of these
models, a test fails before any UI could display it.

(The complementary guarantee — that case_decisions rows are only written by
the surgeon-driven /gen/decisions endpoint with explicit routed/escalated/
skipped input — is enforced by that endpoint's validation, exercised live.)
"""
from app.schemas.generator import (
    ConsistencyFlag,
    WorkupStructureResponse,
    DecisionCreate,
)


FORBIDDEN_DECISION_WORDS = ("specialist", "urgency", "route", "routing", "escalat")


def test_workup_structuring_cannot_carry_a_routing_decision():
    """Job 6 output: items + refusals, nothing else. The model structures
    the surgeon's words; it has no channel to name a specialist or urgency."""
    fields = set(WorkupStructureResponse.model_fields)
    assert fields == {"items", "wouldNotOrder"}
    for f in fields:
        assert not any(w in f.lower() for w in FORBIDDEN_DECISION_WORDS)


def test_consistency_flags_are_advisory_only():
    """Job 5 output: which cases + one question. No field can carry a
    'corrected' decision, so a flag can never change a decision by itself."""
    fields = set(ConsistencyFlag.model_fields)
    assert fields == {"caseIds", "concern"}
    for f in fields:
        assert not any(w in f.lower() for w in FORBIDDEN_DECISION_WORDS)


def test_decisions_require_explicit_surgeon_input():
    """The ONLY path that writes clinical decisions requires the surgeon to
    explicitly route, escalate, or skip — all human-originated booleans/names,
    none of which any LLM job's output schema can populate."""
    fields = set(DecisionCreate.model_fields)
    assert {"routed_specialist_name", "escalated", "skipped", "skip_reason"} <= fields
    # The decision payload has no field for model confidence/suggestion —
    # nothing for an LLM proposal to ride in on.
    assert not any("suggest" in f or "confidence" in f or "llm" in f for f in fields)
