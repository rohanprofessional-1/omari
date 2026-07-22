import pytest
from app.services.cpg_service import _merge_cpg_subtrees

def test_merge_single_section():
    subtrees = [
        ("Section 1", [
            {
                "id": "node_1",
                "type": "variable",
                "branches": [
                    {"nextNodeId": "node_2"}
                ]
            },
            {
                "id": "node_2",
                "type": "specialist"
            }
        ])
    ]
    
    merged_nodes, root_id = _merge_cpg_subtrees(subtrees)
    
    # Prefix added
    assert len(merged_nodes) == 2
    assert root_id.endswith("s0_node_1")
    assert merged_nodes[0]["id"].endswith("s0_node_1")
    assert merged_nodes[1]["id"].endswith("s0_node_2")
    assert merged_nodes[0]["branches"][0]["nextNodeId"].endswith("s0_node_2")

def test_merge_multiple_sections_with_root():
    subtrees = [
        ("Section A", [
            {"id": "node_a", "type": "variable", "branches": [{"nextNodeId": "end_a"}]},
            {"id": "end_a", "type": "specialist"}
        ]),
        ("Section B", [
            {"id": "node_b", "type": "variable"}
        ])
    ]
    
    merged_nodes, root_id = _merge_cpg_subtrees(subtrees)
    
    # Root node added + 3 original nodes
    assert len(merged_nodes) == 4
    assert root_id.endswith("cpg_root")
    
    root_node = merged_nodes[0]
    assert root_node["id"].endswith("cpg_root")
    assert len(root_node["branches"]) == 2
    
    assert root_node["branches"][0]["label"] == "Section A"
    assert root_node["branches"][0]["nextNodeId"].endswith("s0_node_a")
    
    assert root_node["branches"][1]["label"] == "Section B"
    assert root_node["branches"][1]["nextNodeId"].endswith("s1_node_b")

def test_merge_creates_placeholders_for_dangling_references():
    subtrees = [
        ("Section 1", [
            {
                "id": "node_1",
                "type": "variable",
                "branches": [
                    {"nextNodeId": "action_do_surgery"}  # Dangling reference
                ]
            }
        ])
    ]
    
    merged_nodes, root_id = _merge_cpg_subtrees(subtrees)
    
    # Original node + 1 placeholder created
    assert len(merged_nodes) == 2
    assert merged_nodes[0]["id"].endswith("s0_node_1")
    
    placeholder_id = merged_nodes[0]["branches"][0]["nextNodeId"]
    assert placeholder_id.startswith("placeholder_")
    
    placeholder_node = merged_nodes[1]
    assert placeholder_node["id"] == placeholder_id
    assert placeholder_node["type"] == "specialist"
    assert placeholder_node["specialty"] == "Action Do Surgery"

def test_merge_into_existing_tree():
    existing_tree = {
        "rootNodeId": "s0_root_a",
        "nodes": [
            {"id": "s0_root_a", "type": "variable", "branches": [{"nextNodeId": "n1"}]},
            {"id": "n1", "type": "specialist"}
        ]
    }
    
    subtrees = [
        ("Section 1", [
            {"id": "node_b", "type": "variable", "branches": [{"nextNodeId": "n2"}]},
            {"id": "n2", "type": "specialist"}
        ])
    ]
    
    merged_nodes, root_id = _merge_cpg_subtrees(subtrees, existing_tree=existing_tree, document_name="Doc B")
    
    assert root_id == "master_cpg_root"
    assert len(merged_nodes) == 5  # 2 old + 2 new + 1 master root
    
    master_root = next(n for n in merged_nodes if n["id"] == "master_cpg_root")
    assert master_root["variableKey"] == "master_cpg_root"
    assert len(master_root["branches"]) == 2
    assert master_root["branches"][0]["label"] == "Previous Pathway"
    assert master_root["branches"][0]["nextNodeId"] == "s0_root_a"
    
    assert master_root["branches"][1]["label"] == "Doc B"
    assert master_root["branches"][1]["nextNodeId"].endswith("node_b")

def test_merge_into_existing_tree_with_master_root():
    existing_tree = {
        "rootNodeId": "master_cpg_root",
        "nodes": [
            {
                "id": "master_cpg_root", 
                "type": "variable", 
                "variableKey": "master_cpg_root",
                "branches": [
                    {"label": "Doc A", "condition": {"op": "equals"}, "nextNodeId": "n1"}
                ]
            },
            {"id": "n1", "type": "specialist"}
        ]
    }
    
    subtrees = [
        ("Section 1", [
            {"id": "node_b", "type": "variable"}
        ])
    ]
    
    merged_nodes, root_id = _merge_cpg_subtrees(subtrees, existing_tree=existing_tree, document_name="Doc B")
    
    assert root_id == "master_cpg_root"
    assert len(merged_nodes) == 3  # 1 master root + 1 old + 1 new
    
    master_root = next(n for n in merged_nodes if n["id"] == "master_cpg_root")
    assert len(master_root["branches"]) == 2
    assert master_root["branches"][1]["label"] == "Doc B"
    assert master_root["branches"][1]["nextNodeId"].endswith("node_b")
