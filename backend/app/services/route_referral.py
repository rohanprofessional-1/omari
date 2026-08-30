"""Omari — referral routing service.

Orchestrates the deterministic routing engine against a stored tree to
automatically route incoming referrals to the correct specialist.

This is the glue between the DB layer and the pure routing engine. It:
1. Loads the clinic's active tree (nodes, branches, conditions) from the DB.
2. Converts the referral's extraction JSON into filled variables.
3. Runs the routing engine.
4. Resolves the specialist and updates the referral row.

Designed to be called after referral creation or when extraction data is
updated. The engine itself (routing_engine.py) has zero DB awareness.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.node import Node
from app.models.referral import Referral, ReferralStatus
from app.models.specialist import Specialist
from app.models.tree import Tree
from app.services.routing_engine import RoutingOutcome, RoutingResult, run_engine

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tree loading: DB rows → engine-compatible dicts
# ---------------------------------------------------------------------------

def _condition_to_dict(condition) -> dict[str, Any] | None:
    """Convert a Condition ORM row to the dict shape the engine expects."""
    if condition is None:
        return None

    cond_type = condition.condition_type
    if hasattr(cond_type, "value"):
        cond_type = cond_type.value

    if cond_type == "equals":
        # The DB stores all values as strings; the engine compares with ===.
        # Attempt to restore original types (booleans, numbers) but default to string.
        raw = condition.value_string
        value: Any = raw
        if raw == "true":
            value = True
        elif raw == "false":
            value = False
        elif raw is not None:
            try:
                value = int(raw)
            except (ValueError, TypeError):
                try:
                    value = float(raw)
                except (ValueError, TypeError):
                    pass  # keep as string
        return {"op": "equals", "value": value}

    elif cond_type == "range":
        result: dict[str, Any] = {"op": "range"}
        if condition.min_value is not None:
            result["min"] = float(condition.min_value)
        if condition.max_value is not None:
            result["max"] = float(condition.max_value)
        return result

    elif cond_type == "in":
        values = []
        if condition.values_list:
            try:
                values = json.loads(condition.values_list)
            except (json.JSONDecodeError, TypeError):
                values = []
        return {"op": "in", "values": values}

    return None


def _node_to_dict(node: Node) -> dict[str, Any]:
    """Convert a Node ORM row (with eager-loaded branches/conditions) to a dict."""
    node_type = node.node_type
    if hasattr(node_type, "value"):
        node_type = node_type.value

    result: dict[str, Any] = {
        "id": node.id,
        "type": node_type,
    }

    if node_type == "variable":
        result["variableKey"] = node.variable_key
        result["prompt"] = node.prompt
        result["dataSource"] = node.data_source.value if node.data_source else "patient"
        # Sort branches by branch_order for deterministic evaluation
        sorted_branches = sorted(node.branches, key=lambda b: b.branch_order)
        result["branches"] = [
            {
                "label": b.label,
                "patientLabel": b.patient_label,
                "condition": _condition_to_dict(b.condition),
                "nextNodeId": b.next_node_id,
            }
            for b in sorted_branches
        ]

    elif node_type == "specialist":
        result["specialistName"] = node.specialist_name
        result["specialty"] = node.specialty
        urgency = node.urgency
        result["urgency"] = urgency.value if urgency and hasattr(urgency, "value") else "routine"
        result["clinicalBasis"] = node.clinical_basis
        result["confirmWithDrLi"] = node.confirm_with_dr_li

    elif node_type == "escalation":
        result["reason"] = node.escalation_reason

    return result


async def load_tree_for_routing(db: AsyncSession, tree_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    """Load a tree's root node ID and all nodes as engine-compatible dicts.

    Returns (root_node_id, nodes_list) or None if the tree doesn't exist.
    """
    tree = (
        await db.execute(
            select(Tree)
            .options(selectinload(Tree.nodes).selectinload(Node.branches))
            .where(Tree.id == tree_id, Tree.is_active == True)
        )
    ).scalars().first()

    if not tree or not tree.root_node_id:
        return None

    nodes = [_node_to_dict(n) for n in tree.nodes]
    return tree.root_node_id, nodes


async def load_active_tree_for_clinic(db: AsyncSession, clinic_id: str) -> tuple[str, str, list[dict[str, Any]]] | None:
    """Load the active tree for a clinic.

    Returns (tree_id, root_node_id, nodes_list) or None if no active tree exists.
    """
    tree = (
        await db.execute(
            select(Tree)
            .options(selectinload(Tree.nodes).selectinload(Node.branches))
            .where(Tree.clinic_id == clinic_id, Tree.is_active == True)
            .order_by(Tree.updated_at.desc())
            .limit(1)
        )
    ).scalars().first()

    if not tree or not tree.root_node_id:
        return None

    nodes = [_node_to_dict(n) for n in tree.nodes]
    return tree.id, tree.root_node_id, nodes


# ---------------------------------------------------------------------------
# Extraction → filled variables
# ---------------------------------------------------------------------------

def extraction_to_filled(extraction: dict[str, Any] | None) -> dict[str, Any]:
    """Convert a referral's extraction JSON to the flat filled_variables dict.

    The extraction shape from the frontend is:
        { "variables": { "key": { "value": "...", "confidence": 0.9 }, ... } }

    Or the simplified shape (just key→value or key→{"value": ..., "confidence": ...}).
    The engine only needs key→value.
    """
    if not extraction:
        return {}

    # Handle nested { variables: { ... } } shape
    variables = extraction.get("variables", extraction)

    filled: dict[str, Any] = {}
    for key, val in variables.items():
        if isinstance(val, dict):
            # { "value": "...", "confidence": ... } shape
            filled[key] = val.get("value")
        else:
            # Direct key→value shape
            filled[key] = val

    return filled


# ---------------------------------------------------------------------------
# Main service entry point
# ---------------------------------------------------------------------------

async def route_referral(db: AsyncSession, referral: Referral) -> RoutingResult:
    """Route a referral using the tree it references (or the clinic's active tree).

    Mutates the referral row in place:
    - On 'routed': sets routed_specialist_id, status = needs_review
    - On 'escalated': sets status = needs_review, adds escalation to annotations
    - On 'incomplete': leaves status as-is (extraction is insufficient)

    The caller must commit the session after this returns.
    """
    # Determine which tree to use
    tree_id = referral.tree_id
    root_node_id: str | None = None
    nodes: list[dict[str, Any]] = []

    if tree_id:
        loaded = await load_tree_for_routing(db, tree_id)
        if loaded:
            root_node_id, nodes = loaded
    else:
        # Fall back to the clinic's active tree (via the patient's clinic association
        # or the first active tree in the system)
        first_tree = (
            await db.execute(
                select(Tree)
                .options(selectinload(Tree.nodes).selectinload(Node.branches))
                .where(Tree.is_active == True)
                .order_by(Tree.updated_at.desc())
                .limit(1)
            )
        ).scalars().first()

        if first_tree and first_tree.root_node_id:
            tree_id = first_tree.id
            root_node_id = first_tree.root_node_id
            nodes = [_node_to_dict(n) for n in first_tree.nodes]

    if not root_node_id or not nodes:
        logger.warning("route_referral: no usable tree found for referral %s", referral.id)
        return RoutingResult(
            outcome=RoutingOutcome.incomplete,
            missing_variables=["__no_tree__"],
        )

    # Update referral's tree_id if we resolved one
    if not referral.tree_id and tree_id:
        referral.tree_id = tree_id

    # Extract filled variables from the referral's extraction data
    filled = extraction_to_filled(referral.extraction)

    if not filled:
        logger.info("route_referral: no extraction data on referral %s, skipping", referral.id)
        return RoutingResult(
            outcome=RoutingOutcome.incomplete,
            missing_variables=["__no_extraction__"],
        )

    # Run the deterministic engine
    result = run_engine(nodes, root_node_id, filled)

    # Apply the result to the referral row
    if result.outcome == RoutingOutcome.routed and result.specialist:
        # Resolve specialist by name
        specialist = (
            await db.execute(
                select(Specialist).where(
                    Specialist.name == result.specialist.specialist_name
                )
            )
        ).scalars().first()

        if specialist:
            referral.routed_specialist_id = specialist.id
        else:
            logger.warning(
                "route_referral: specialist '%s' not found in DB for referral %s",
                result.specialist.specialist_name,
                referral.id,
            )

        referral.status = ReferralStatus.needs_review

        # Store routing metadata in annotations
        annotations = referral.annotations or {}
        annotations["routing"] = {
            "outcome": result.outcome.value,
            "specialist_name": result.specialist.specialist_name,
            "specialty": result.specialist.specialty,
            "urgency": result.specialist.urgency,
            "path_taken": result.path_taken,
        }
        referral.annotations = annotations

    elif result.outcome == RoutingOutcome.escalated:
        referral.status = ReferralStatus.needs_review

        annotations = referral.annotations or {}
        annotations["routing"] = {
            "outcome": "escalated",
            "escalation_reason": result.escalation_reason,
            "path_taken": result.path_taken,
        }
        referral.annotations = annotations

    elif result.outcome == RoutingOutcome.incomplete:
        # Don't change status — extraction isn't complete enough
        annotations = referral.annotations or {}
        annotations["routing"] = {
            "outcome": "incomplete",
            "missing_variables": result.missing_variables,
            "path_taken": result.path_taken,
        }
        referral.annotations = annotations

    return result
