import pytest
from app.schemas.tree import Tree, VariableNode, BranchNode, BranchCondition, ActionNode, EndNode
from app.services.tree.state_manager import TreeStateManager
from app.services.tree.sample_trees import knee_pain_tree

def test_variable_collection():
    manager = TreeStateManager(knee_pain_tree)
    manager.collect_variable("pain_duration", "1-4 weeks")
    
    assert manager.collected_variables["pain_duration"] == "1-4 weeks"
    assert manager.get_current_node().id == "v_duration"

def test_branch_evaluation_gt():
    # Test operator >= 8
    manager = TreeStateManager(knee_pain_tree)
    manager.advance_node("b_evaluate")
    manager.collect_variable("pain_level", "8") # Should trigger >= 8
    manager.collect_variable("swelling", "no")
    manager.collect_variable("popping_sound", "no")
    
    next_node = manager.evaluate_branch()
    assert next_node == "a_urgent_xray"

def test_branch_evaluation_eq():
    # Test operator == 'yes'
    manager = TreeStateManager(knee_pain_tree)
    manager.advance_node("b_evaluate")
    manager.collect_variable("pain_level", "5")
    manager.collect_variable("swelling", "yes") # Should trigger == yes
    manager.collect_variable("popping_sound", "no")
    
    next_node = manager.evaluate_branch()
    assert next_node == "a_urgent_xray"

def test_branch_evaluation_default():
    # Test fallback
    manager = TreeStateManager(knee_pain_tree)
    manager.advance_node("b_evaluate")
    manager.collect_variable("pain_level", "5")
    manager.collect_variable("swelling", "no")
    manager.collect_variable("popping_sound", "no")
    
    next_node = manager.evaluate_branch()
    assert next_node == "a_recommend_rest"

def test_action_ordering():
    manager = TreeStateManager(knee_pain_tree)
    manager.add_action({"action_type": "order_xray", "urgency": "high"})
    manager.add_action({"action_type": "schedule_followup", "days": 7})
    
    assert len(manager.ordered_actions) == 2
    assert manager.ordered_actions[0]["action_type"] == "order_xray"
    assert manager.ordered_actions[1]["action_type"] == "schedule_followup"

def test_conversation_history_capping():
    manager = TreeStateManager(knee_pain_tree)
    for i in range(10):
        manager.append_history("user", f"Turn {i}")
        
    assert len(manager.conversation_history) == 8
    assert manager.conversation_history[0]["text"] == "Turn 2"
    assert manager.conversation_history[-1]["text"] == "Turn 9"

def test_advance_node():
    manager = TreeStateManager(knee_pain_tree)
    assert manager.current_node_id == "v_duration"
    
    manager.advance_node("v_level")
    assert manager.current_node_id == "v_level"
    
    with pytest.raises(ValueError):
        manager.advance_node("non_existent_node")
