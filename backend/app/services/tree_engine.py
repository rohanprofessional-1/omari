import json
import logging
from typing import Any, Dict, List, Optional
from decimal import Decimal

from app.schemas.tree import TreeReadFull
from app.schemas.node import NodeRead
from app.schemas.branch import BranchRead
from app.schemas.condition import ConditionRead

logger = logging.getLogger(__name__)

class RoutingResult:
    def __init__(
        self,
        outcome: str,
        path_taken: List[str],
        missing_variables: List[str],
        specialist: Optional[NodeRead] = None,
        escalation_reason: Optional[str] = None
    ):
        self.outcome = outcome  # 'routed' | 'escalated' | 'incomplete'
        self.path_taken = path_taken
        self.missing_variables = missing_variables
        self.specialist = specialist
        self.escalation_reason = escalation_reason


def evaluate_condition(condition: ConditionRead, value: Any) -> bool:
    """
    Evaluate a single branch condition against a resolved variable value.
    Pure and total: any value the condition can't sensibly match returns false.
    """
    if condition.condition_type == "equals":
        # Strict string comparison mostly since values are stored as string or extracted as basic types
        return str(value) == condition.value_string

    elif condition.condition_type == "range":
        try:
            num_val = float(value)
        except (ValueError, TypeError):
            return False
            
        if condition.min_value is not None and num_val < float(condition.min_value):
            return False
        if condition.max_value is not None and num_val > float(condition.max_value):
            return False
        return True

    elif condition.condition_type == "in":
        if not condition.values_list:
            return False
        try:
            allowed_values = json.loads(condition.values_list)
            if not isinstance(allowed_values, list):
                return False
            return str(value) in [str(v) for v in allowed_values]
        except Exception:
            return False

    return False


def run_engine(tree: TreeReadFull, filled: Dict[str, Any]) -> RoutingResult:
    """
    Walk `tree` using `filled`, returning where the patient routes — or the
    single next variable still needed to continue.
    """
    nodes_by_id = {n.id: n for n in tree.nodes}
    path_taken: List[str] = []
    visited = set()

    current_id = tree.root_node_id

    # visited-set guard: every step moves to a not-yet-visited node, so the loop
    # can run at most `nodes.length` times before terminating.
    while True:
        if not current_id:
            return RoutingResult(
                outcome="escalated",
                path_taken=path_taken,
                missing_variables=[],
                escalation_reason="Reached a dead end with no next node."
            )
            
        if current_id in visited:
            return RoutingResult(
                outcome="escalated",
                path_taken=path_taken,
                missing_variables=[],
                escalation_reason=f"Cycle detected at node '{current_id}'; tree is malformed."
            )
            
        node = nodes_by_id.get(current_id)
        if not node:
            return RoutingResult(
                outcome="escalated",
                path_taken=path_taken,
                missing_variables=[],
                escalation_reason=f"Node '{current_id}' not found; tree is malformed."
            )

        visited.add(current_id)
        path_taken.append(current_id)

        if node.node_type == "specialist":
            return RoutingResult(
                outcome="routed",
                path_taken=path_taken,
                missing_variables=[],
                specialist=node
            )

        if node.node_type == "escalation":
            return RoutingResult(
                outcome="escalated",
                path_taken=path_taken,
                missing_variables=[],
                escalation_reason=node.escalation_reason or "Escalation requested."
            )

        # Variable node: resume point. Stop here if we don't yet have the value.
        if node.node_type == "variable":
            var_key = node.variable_key
            if not var_key:
                return RoutingResult(
                    outcome="escalated",
                    path_taken=path_taken,
                    missing_variables=[],
                    escalation_reason=f"Variable node '{node.id}' has no variable_key."
                )
                
            resolved_value = filled.get(var_key)
            if resolved_value is None:
                return RoutingResult(
                    outcome="incomplete",
                    path_taken=path_taken,
                    missing_variables=[var_key]
                )

            # Sort branches by branch_order before evaluating
            branches = sorted(node.branches, key=lambda b: b.branch_order)
            
            match = None
            for b in branches:
                if not b.condition:
                    # If branch has no condition, it acts as a fallback/default
                    match = b
                    break
                if evaluate_condition(b.condition, resolved_value):
                    match = b
                    break

            if not match:
                return RoutingResult(
                    outcome="escalated",
                    path_taken=path_taken,
                    missing_variables=[],
                    escalation_reason=f"No branch matched value '{resolved_value}' for variable '{var_key}' at node '{node.id}'."
                )

            current_id = match.next_node_id
            continue

        return RoutingResult(
            outcome="escalated",
            path_taken=path_taken,
            missing_variables=[],
            escalation_reason=f"Unknown node type '{node.node_type}' at node '{node.id}'."
        )
