"""Blume — serialize a relational tree draft into the frontend camelCase shape.

This mirrors, in reverse, the mapping in frontend/src/lib/api.ts (fetchTree).
The output is exactly what TreeSchema.parse accepts and the deterministic
engine consumes — publishing stores THIS shape in tree_versions.tree_json so
the runtime needs zero re-mapping.

The condition value coercion ('true'→True, numeric strings→numbers) must stay
byte-identical to api.ts mapCondition: the engine uses STRICT equality, so a
'5' vs 5 mismatch silently breaks a branch.
"""
import json
from typing import Any

from app.models.tree import Tree
from app.models.node import Node
from app.models.condition import Condition


def _coerce_equals_value(value_string: str | None) -> Any:
    if value_string is None:
        return None
    if value_string == "true":
        return True
    if value_string == "false":
        return False
    try:
        num = float(value_string)
        return int(num) if num.is_integer() and "." not in value_string else num
    except ValueError:
        return value_string


def _serialize_condition(cond: Condition | None) -> dict | None:
    if cond is None:
        return None
    kind = cond.condition_type.value if hasattr(cond.condition_type, "value") else str(cond.condition_type)
    if kind == "equals":
        return {"op": "equals", "value": _coerce_equals_value(cond.value_string)}
    if kind == "range":
        out: dict[str, Any] = {"op": "range"}
        if cond.min_value is not None:
            out["min"] = float(cond.min_value)
        if cond.max_value is not None:
            out["max"] = float(cond.max_value)
        return out
    if kind == "in":
        return {"op": "in", "values": json.loads(cond.values_list) if cond.values_list else []}
    return None


def _serialize_node(n: Node) -> dict:
    node_type = n.node_type.value if hasattr(n.node_type, "value") else str(n.node_type)
    base: dict[str, Any] = {"id": n.id, "type": node_type}

    if node_type == "variable":
        base["variableKey"] = n.variable_key
        base["prompt"] = n.prompt
        base["dataSource"] = n.data_source.value if n.data_source else "patient"
        branches = []
        for b in sorted(n.branches, key=lambda b: b.branch_order):
            branch: dict[str, Any] = {
                "label": b.label,
                "nextNodeId": b.next_node_id or "",
                "condition": _serialize_condition(b.condition),
            }
            if b.patient_label:
                branch["patientLabel"] = b.patient_label
            branches.append(branch)
        base["branches"] = branches

    elif node_type == "specialist":
        base["specialistName"] = n.specialist_name
        base["specialty"] = n.specialty
        base["urgency"] = n.urgency.value if n.urgency else "routine"
        base["reasoningTemplate"] = n.reasoning_template or ""
        if n.clinical_basis:
            base["clinicalBasis"] = n.clinical_basis
        if n.confirm_with_dr_li:
            base["confirmWithDrLi"] = n.confirm_with_dr_li
        # Prefer the v2 path-conditioned spec; fall back to legacy flat rows.
        if n.workup_spec is not None:
            base["workup"] = n.workup_spec
        else:
            base["workup"] = [
                {"name": w.name, "protocol": w.protocol or "", "rationale": w.rationale or ""}
                for w in sorted(n.workup_items, key=lambda w: w.item_order)
            ]

    elif node_type == "escalation":
        base["reason"] = n.escalation_reason or ""

    return base


def serialize_tree(tree: Tree) -> dict:
    """Full tree → frontend camelCase Tree JSON (TreeSchema-parseable)."""
    return {
        "treeId": tree.id,
        "rootNodeId": tree.root_node_id or "",
        "nodes": [_serialize_node(n) for n in tree.nodes],
    }
