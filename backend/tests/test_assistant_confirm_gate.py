"""The Builder assistant's CONFIRM GATE, asserted structurally.

Unlike the generator jobs (test_llm_invariant.py), the assistant's proposed
operations DO carry clinical fields (specialistName, urgency, workup) —
because the clinician states those decisions in chat and the model
transcribes them. What keeps authorship with the clinician is the gate:
the endpoint can only PROPOSE. These tests pin that shape so nobody can
quietly add an auto-apply channel.
"""
import inspect

from app.api.v1 import assistant as assistant_router
from app.schemas.assistant import TreeChatResponse


def test_response_carries_proposals_only():
    """Reply + mode + proposed operations + presentation-only focus ids — no
    applied tree, no persistence id, no auto-apply flag. Application happens
    in the Builder after the clinician reviews the diff and confirms."""
    fields = set(TreeChatResponse.model_fields)
    assert fields == {"mode", "message", "operations", "focusNodeIds"}
    for f in fields:
        assert "appl" not in f.lower() and "commit" not in f.lower() and "save" not in f.lower()


def test_modes_include_no_auto_apply():
    """The mode enum is closed: answer/clarify/propose/decline. There is no
    mode in which the backend acts on the tree."""
    mode_field = TreeChatResponse.model_fields["mode"]
    allowed = set(mode_field.annotation.__args__)
    assert allowed == {"answer", "clarify", "propose", "decline"}


def test_assistant_endpoint_is_stateless():
    """The assistant router must never touch the database: no session
    dependency, no model imports. If someone wires persistence into this
    endpoint, proposals could become writes — this test fails first."""
    src = inspect.getsource(assistant_router)
    assert "get_db" not in src
    assert "AsyncSession" not in src
    assert "app.models" not in src
