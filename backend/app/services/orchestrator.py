from typing import Dict, Any, Optional
from app.services.tree.state_manager import TreeStateManager
from app.schemas.tree import VariableNode, BranchNode, ActionNode, EndNode
from app.services.llm.client import call_llm
from app.services.llm.prompts import (
    build_opening_prompt, 
    build_extraction_prompt, 
    build_clarification_prompt, 
    build_guardrails_prompt
)
from app.schemas.llm import OpeningResponse, ExtractionResponse, GuardrailsResponse

class IntakeOrchestrator:
    def __init__(self, state_manager: TreeStateManager, model_name: str = "claude-3-haiku-20240307"):
        self.state_manager = state_manager
        self.model_name = model_name

    def process_turn(self, patient_message: Optional[str]) -> Dict[str, Any]:
        current_node = self.state_manager.get_current_node()

        # 1. Extraction Phase
        if patient_message:
            self.state_manager.append_history("user", patient_message)
            
            if isinstance(current_node, VariableNode):
                system_prompt = build_extraction_prompt(
                    node=current_node,
                    collected_state=self.state_manager.collected_variables,
                    history=self.state_manager.conversation_history,
                    patient_message=patient_message
                )
                
                ext_response = call_llm(
                    system_prompt=system_prompt,
                    user_message="Extract the variable based on my last message.",
                    model_name=self.model_name,
                    response_model=ExtractionResponse
                )
                
                if ext_response.extraction.needs_clarification:
                    # Generate clarification prompt
                    clarification_prompt = build_clarification_prompt(current_node, patient_message)
                    clarif_resp = call_llm(clarification_prompt, "Please clarify.", self.model_name, OpeningResponse)
                    
                    return self._apply_guardrails_and_return(clarif_resp.message)
                else:
                    # Collect the variable
                    self.state_manager.collect_variable(
                        current_node.variable_name, 
                        ext_response.extraction.value
                    )
                    
                    if current_node.next_node_id:
                        self.state_manager.advance_node(current_node.next_node_id)
            else:
                # If they respond on a non-variable node? Theoretically shouldn't happen, 
                # as the engine blocks on VariableNodes.
                pass
                
        # 2. Graph Traversal Phase
        while True:
            current_node = self.state_manager.get_current_node()
            
            if isinstance(current_node, BranchNode):
                next_id = self.state_manager.evaluate_branch()
                self.state_manager.advance_node(next_id)
                
            elif isinstance(current_node, ActionNode):
                self.state_manager.add_action({
                    "action_type": current_node.action_type,
                    "payload": current_node.payload
                })
                if current_node.next_node_id:
                    self.state_manager.advance_node(current_node.next_node_id)
                else:
                    break
                    
            elif isinstance(current_node, EndNode):
                return {
                    "message": "You have reached the end of the intake flow. Thank you.",
                    "status": "completed",
                    "actions": self.state_manager.ordered_actions
                }
                
            elif isinstance(current_node, VariableNode):
                # Break loop to generate question for the new variable
                break

        # 3. Generation Phase
        current_node = self.state_manager.get_current_node()
        if isinstance(current_node, VariableNode):
            open_prompt = build_opening_prompt(current_node, self.state_manager.collected_variables)
            open_resp = call_llm(open_prompt, "Generate the question.", self.model_name, OpeningResponse)
            
            return self._apply_guardrails_and_return(open_resp.message)
        
        return {
            "message": "An unexpected error occurred.",
            "status": "error"
        }

    def _apply_guardrails_and_return(self, outbound_message: str) -> Dict[str, Any]:
        # 4. Guardrails Phase
        guard_prompt = build_guardrails_prompt(outbound_message)
        guard_resp = call_llm(
            system_prompt=guard_prompt,
            user_message="Review the outbound message.",
            model_name=self.model_name,
            response_model=GuardrailsResponse
        )
        
        final_message = outbound_message
        if not guard_resp.is_safe:
            final_message = "I'm sorry, but I cannot provide medical advice or diagnoses. Let's continue."
            
        self.state_manager.append_history("assistant", final_message)
        return {
            "message": final_message,
            "status": "in_progress",
            "actions": self.state_manager.ordered_actions
        }
