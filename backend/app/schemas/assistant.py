"""Blume — Builder assistant transport schemas.

THE CONFIRM GATE, pinned structurally: the assistant endpoint can only
return a reply plus PROPOSED operations. There is no field for an applied
tree, no persistence id, no auto-apply flag — application happens in the
Builder, after the clinician reviews the diff and confirms, through the
same Zod validation as manual edits. (Pinned by tests/test_assistant_confirm_gate.py.)
"""
from typing import Any, List, Literal

from pydantic import BaseModel


class AssistantTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class TreeChatRequest(BaseModel):
    tree: dict                      # the frontend Tree JSON (camelCase), read-only context
    message: str                    # the clinician's latest instruction/question
    history: List[AssistantTurn] = []
    warnings: List[str] = []        # current validateTreeGraph warnings, for gap questions
    selectedNodeIds: List[str] = [] # nodes the clinician selected on the canvas — scopes "these"/"this"


class DeltaChatRequest(BaseModel):
    """Reconcile-session assistant turn: compiled tree + message in,
    reply + proposed DELTAS out. Same confirm gate as tree chat — no
    persistence, no auto-apply; the frontend anchor-repairs, validates,
    dry-compiles, and gates on the surgeon's confirm."""
    tree: dict
    message: str
    history: List[AssistantTurn] = []


class DeltaChatResponse(BaseModel):
    mode: Literal["answer", "clarify", "propose", "decline"]
    message: str
    deltas: List[dict] = []  # proposed DeltaOp payloads; frontend Zod-validates


class TreeChatResponse(BaseModel):
    # answer: question about the tree · clarify: instruction underspecified ·
    # propose: operations drafted for review · decline: asked to author a
    # clinical decision (workup choice, routing target, threshold) — refused.
    mode: Literal["answer", "clarify", "propose", "decline"]
    message: str
    operations: List[dict] = []     # proposals only; the Builder Zod-validates and diffs
    focusNodeIds: List[str] = []    # presentation-only: nodes the reply refers to, for canvas highlight
