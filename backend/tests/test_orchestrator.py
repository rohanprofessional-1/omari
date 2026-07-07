import pytest
from unittest.mock import patch, MagicMock
from app.services.orchestrator import IntakeOrchestrator
from app.services.tree.state_manager import TreeStateManager
from app.services.tree.sample_trees import knee_pain_tree
from app.schemas.llm import OpeningResponse, ExtractionResponse, ExtractionValue, GuardrailsResponse

@pytest.fixture
def orchestrator():
    manager = TreeStateManager(knee_pain_tree)
    return IntakeOrchestrator(manager)

@patch('app.services.orchestrator.call_llm')
def test_orchestrator_initial_turn(mock_call_llm, orchestrator):
    # Mocking OpeningResponse and GuardrailsResponse
    mock_call_llm.side_effect = [
        OpeningResponse(message="How long have you had pain?"),
        GuardrailsResponse(is_safe=True, reason="Standard question")
    ]
    
    result = orchestrator.process_turn(None)
    
    assert result["status"] == "in_progress"
    assert result["message"] == "How long have you had pain?"
    assert len(orchestrator.state_manager.conversation_history) == 1

@patch('app.services.orchestrator.call_llm')
def test_orchestrator_extraction_and_advance(mock_call_llm, orchestrator):
    # Turn 1: Extracted <1 week successfully. Traverses to v_level.
    mock_call_llm.side_effect = [
        ExtractionResponse(patient_message="A few days", extraction=ExtractionValue(
            variable="pain_duration", value="<1 week", confidence=0.9, needs_clarification=False, raw_patient_language="A few days"
        )),
        OpeningResponse(message="Rate your pain from 1 to 10."),
        GuardrailsResponse(is_safe=True, reason="Safe")
    ]
    
    result = orchestrator.process_turn("A few days")
    
    assert orchestrator.state_manager.collected_variables["pain_duration"] == "<1 week"
    assert orchestrator.state_manager.current_node_id == "v_level"
    assert result["message"] == "Rate your pain from 1 to 10."

@patch('app.services.orchestrator.call_llm')
def test_orchestrator_needs_clarification(mock_call_llm, orchestrator):
    # Turn 1: Needs clarification
    mock_call_llm.side_effect = [
        ExtractionResponse(patient_message="It hurts when I walk", extraction=ExtractionValue(
            variable="pain_duration", value="", confidence=0.2, needs_clarification=True, raw_patient_language="It hurts when I walk"
        )),
        OpeningResponse(message="Could you clarify how many days or weeks?"),
        GuardrailsResponse(is_safe=True, reason="Safe")
    ]
    
    result = orchestrator.process_turn("It hurts when I walk")
    
    assert "pain_duration" not in orchestrator.state_manager.collected_variables
    assert orchestrator.state_manager.current_node_id == "v_duration" # Did not advance
    assert result["message"] == "Could you clarify how many days or weeks?"

@patch('app.services.orchestrator.call_llm')
def test_orchestrator_unsafe_guardrail(mock_call_llm, orchestrator):
    mock_call_llm.side_effect = [
        OpeningResponse(message="You probably have a torn ACL."),
        GuardrailsResponse(is_safe=False, reason="Provides a diagnosis")
    ]
    
    result = orchestrator.process_turn(None)
    
    assert result["message"] == "I'm sorry, but I cannot provide medical advice or diagnoses. Let's continue."
