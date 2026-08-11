"""Omari — deterministic routing engine (Python port).

This is a faithful port of frontend/src/lib/engine.ts. The engine walks a
decision tree using filled variable values and determines where a patient
routes. It is:

- DETERMINISTIC: same inputs always produce the same output.
- PURE: no I/O, no LLM, no side effects.
- TOTAL: always terminates with one of three outcomes.

The LLM fills variables (extraction); this engine only evaluates branch
conditions. Separation of concerns is non-negotiable for auditability.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class RoutingOutcome(str, Enum):
    """The three possible engine outcomes."""
    routed = "routed"
    escalated = "escalated"
    incomplete = "incomplete"


@dataclass(frozen=True)
class SpecialistResult:
    """The specialist destination when outcome is 'routed'."""
    specialist_name: str
    specialty: str
    urgency: str
    node_id: str


@dataclass(frozen=True)
class RoutingResult:
    """Complete output of a single engine run."""
    outcome: RoutingOutcome
    specialist: SpecialistResult | None = None
    path_taken: list[str] = field(default_factory=list)
    missing_variables: list[str] = field(default_factory=list)
    escalation_reason: str | None = None


# ---------------------------------------------------------------------------
# Condition evaluation
# ---------------------------------------------------------------------------

def evaluate_condition(condition: dict[str, Any], value: Any) -> bool:
    """Evaluate a single branch condition against a resolved variable value.

    Mirrors the frontend's evaluateCondition exactly:
    - 'equals': strict equality (no type coercion)
    - 'range': numeric min/max bounds
    - 'in': value's string form is in the values list
    """
    op = condition.get("op")

    if op == "equals":
        return value == condition.get("value")

    elif op == "range":
        if not isinstance(value, (int, float)):
            return False
        min_val = condition.get("min")
        max_val = condition.get("max")
        if min_val is not None and value < min_val:
            return False
        if max_val is not None and value > max_val:
            return False
        return True

    elif op == "in":
        values_list = condition.get("values", [])
        return str(value) in values_list

    return False


# ---------------------------------------------------------------------------
# Engine core
# ---------------------------------------------------------------------------

def run_engine(
    nodes: list[dict[str, Any]],
    root_node_id: str,
    filled_variables: dict[str, Any],
) -> RoutingResult:
    """Walk the tree using filled_variables, returning where the patient routes.

    Args:
        nodes: The tree's node list (each node is a dict with at minimum
               'id' and 'type').
        root_node_id: The id of the root node to start traversal from.
        filled_variables: Mapping of variable_key -> value. Values can be
                         plain strings/numbers/bools (the engine does not
                         use confidence scores for routing decisions).

    Returns:
        A RoutingResult indicating the outcome.

    The engine is resumable: it walks as far as the current variables allow.
    When it hits a variable node whose key is missing from filled_variables,
    it stops and reports that one variable as 'incomplete'.
    """
    nodes_by_id: dict[str, dict[str, Any]] = {n["id"]: n for n in nodes}
    path_taken: list[str] = []
    visited: set[str] = set()

    current_id = root_node_id

    while True:
        # Cycle detection
        if current_id in visited:
            return RoutingResult(
                outcome=RoutingOutcome.escalated,
                path_taken=path_taken,
                escalation_reason=f'Cycle detected at node "{current_id}"; tree is malformed.',
            )

        # Missing node
        node = nodes_by_id.get(current_id)
        if node is None:
            return RoutingResult(
                outcome=RoutingOutcome.escalated,
                path_taken=path_taken,
                escalation_reason=f'Node "{current_id}" not found; tree is malformed.',
            )

        visited.add(current_id)
        path_taken.append(current_id)

        node_type = node.get("type")

        # Terminal: specialist destination
        if node_type == "specialist":
            return RoutingResult(
                outcome=RoutingOutcome.routed,
                specialist=SpecialistResult(
                    specialist_name=node.get("specialistName", ""),
                    specialty=node.get("specialty", ""),
                    urgency=node.get("urgency", "routine"),
                    node_id=node["id"],
                ),
                path_taken=path_taken,
            )

        # Terminal: escalation
        if node_type == "escalation":
            return RoutingResult(
                outcome=RoutingOutcome.escalated,
                path_taken=path_taken,
                escalation_reason=node.get("reason"),
            )

        # Variable node: check if we have the value
        variable_key = node.get("variableKey")
        if variable_key is None:
            return RoutingResult(
                outcome=RoutingOutcome.escalated,
                path_taken=path_taken,
                escalation_reason=f'Node "{current_id}" is type "{node_type}" but has no variableKey.',
            )

        value = filled_variables.get(variable_key)
        if value is None:
            return RoutingResult(
                outcome=RoutingOutcome.incomplete,
                path_taken=path_taken,
                missing_variables=[variable_key],
            )

        # Follow the FIRST matching branch (authoring order is significant)
        branches = node.get("branches", [])
        matched_next: str | None = None
        for branch in branches:
            condition = branch.get("condition")
            if condition and evaluate_condition(condition, value):
                matched_next = branch.get("nextNodeId")
                break

        if matched_next is None:
            return RoutingResult(
                outcome=RoutingOutcome.escalated,
                path_taken=path_taken,
                escalation_reason=(
                    f'No branch matched value {value!r} for variable '
                    f'"{variable_key}" at node "{current_id}".'
                ),
            )

        current_id = matched_next
