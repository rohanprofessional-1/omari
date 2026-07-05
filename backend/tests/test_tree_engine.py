import pytest
from app.services.tree_engine import run_engine, RoutingResult, evaluate_condition
from app.schemas.tree import TreeReadFull
from app.schemas.node import NodeRead
from app.schemas.branch import BranchRead
from app.schemas.condition import ConditionRead

def test_evaluate_condition_equals():
    cond = ConditionRead(id="c1", branch_id="b1", condition_type="equals", value_string="yes", created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z")
    assert evaluate_condition(cond, "yes") == True
    assert evaluate_condition(cond, "no") == False

def test_evaluate_condition_range():
    cond = ConditionRead(id="c1", branch_id="b1", condition_type="range", min_value=5, max_value=10, created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z")
    assert evaluate_condition(cond, 7) == True
    assert evaluate_condition(cond, "7") == True
    assert evaluate_condition(cond, 4) == False
    assert evaluate_condition(cond, 11) == False

def test_evaluate_condition_in():
    cond = ConditionRead(id="c1", branch_id="b1", condition_type="in", values_list='["apple", "banana"]', created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z")
    assert evaluate_condition(cond, "apple") == True
    assert evaluate_condition(cond, "banana") == True
    assert evaluate_condition(cond, "orange") == False


def test_run_engine_incomplete():
    node1 = NodeRead(
        id="n1", tree_id="t1", node_type="variable", variable_key="symptom",
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z",
        branches=[]
    )
    tree = TreeReadFull(
        id="t1", name="Test Tree", version=1, is_active=True, root_node_id="n1",
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z",
        nodes=[node1]
    )
    
    # Missing variable "symptom"
    result = run_engine(tree, {})
    assert result.outcome == "incomplete"
    assert result.missing_variables == ["symptom"]
    assert result.path_taken == ["n1"]

def test_run_engine_routed():
    # Setup
    branch = BranchRead(
        id="b1", node_id="n1", tree_id="t1", label="b1", next_node_id="n2", branch_order=0,
        condition=ConditionRead(id="c1", branch_id="b1", condition_type="equals", value_string="pain", created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z"),
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z"
    )
    node1 = NodeRead(
        id="n1", tree_id="t1", node_type="variable", variable_key="symptom", branches=[branch],
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z"
    )
    node2 = NodeRead(
        id="n2", tree_id="t1", node_type="specialist", specialist_name="Dr. Smith",
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z"
    )
    tree = TreeReadFull(
        id="t1", name="Test Tree", version=1, is_active=True, root_node_id="n1",
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z",
        nodes=[node1, node2]
    )
    
    # Variable is provided, should route to n2
    result = run_engine(tree, {"symptom": "pain"})
    assert result.outcome == "routed"
    assert result.specialist.specialist_name == "Dr. Smith"
    assert result.path_taken == ["n1", "n2"]

def test_run_engine_escalated_no_branch_match():
    # Setup
    branch = BranchRead(
        id="b1", node_id="n1", tree_id="t1", label="b1", next_node_id="n2", branch_order=0,
        condition=ConditionRead(id="c1", branch_id="b1", condition_type="equals", value_string="pain", created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z"),
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z"
    )
    node1 = NodeRead(
        id="n1", tree_id="t1", node_type="variable", variable_key="symptom", branches=[branch],
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z"
    )
    tree = TreeReadFull(
        id="t1", name="Test Tree", version=1, is_active=True, root_node_id="n1",
        created_at="2020-01-01T00:00:00Z", updated_at="2020-01-01T00:00:00Z",
        nodes=[node1]
    )
    
    # Variable provided does NOT match the branch
    result = run_engine(tree, {"symptom": "itching"})
    assert result.outcome == "escalated"
    assert "No branch matched" in result.escalation_reason
    assert result.path_taken == ["n1"]
