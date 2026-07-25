import pytest
from app.services.cpg_service import _validate_scaffold

def test_validate_valid_tree():
    nodes = [
        {"id": "root", "type": "variable", "branches": [{"nextNodeId": "n1"}]},
        {"id": "n1", "type": "specialist"}
    ]
    issues = _validate_scaffold(nodes, "root")
    assert len(issues) == 0

def test_validate_missing_root():
    nodes = [
        {"id": "n1", "type": "specialist"}
    ]
    issues = _validate_scaffold(nodes, "root")
    assert len(issues) == 1
    assert issues[0].kind == "missing_root"

def test_validate_dead_end_reference():
    nodes = [
        {"id": "root", "type": "variable", "branches": [{"nextNodeId": "n1"}]}
    ]
    issues = _validate_scaffold(nodes, "root")
    assert len(issues) == 1
    assert issues[0].kind == "dead_end"
    assert issues[0].node_id == "root"

def test_validate_orphan_node():
    nodes = [
        {"id": "root", "type": "variable", "branches": [{"nextNodeId": "n1"}]},
        {"id": "n1", "type": "specialist"},
        {"id": "n2", "type": "specialist"}  # Orphan
    ]
    issues = _validate_scaffold(nodes, "root")
    assert len(issues) == 1
    assert issues[0].kind == "orphan"
    assert issues[0].node_id == "n2"

def test_validate_variable_no_branches():
    nodes = [
        {"id": "root", "type": "variable", "branches": [{"nextNodeId": "n1"}]},
        {"id": "n1", "type": "variable", "branches": []}  # No branches
    ]
    issues = _validate_scaffold(nodes, "root")
    assert len(issues) == 1
    assert issues[0].kind == "no_branches"
    assert issues[0].node_id == "n1"

def test_validate_variable_unwired_branches():
    nodes = [
        {"id": "root", "type": "variable", "branches": [{"nextNodeId": "n1"}]},
        {"id": "n1", "type": "variable", "branches": [{"nextNodeId": ""}]}  # Unwired branch
    ]
    issues = _validate_scaffold(nodes, "root")
    assert len(issues) == 1
    assert issues[0].kind == "dead_end"
    assert issues[0].node_id == "n1"
