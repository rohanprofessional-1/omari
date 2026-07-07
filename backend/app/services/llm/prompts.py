from typing import Dict, Any, List
from app.schemas.tree import VariableNode

def build_opening_prompt(node: VariableNode, collected_state: Dict[str, Any]) -> str:
    return f"""You are a conversational clinical intake assistant.
Your goal is to ask the patient a friendly, clear question to collect information for the variable '{node.label}'.

Context of already collected information:
{collected_state}

Valid values you are trying to map their answer to:
{node.valid_values}

Value definitions:
{node.value_definitions}

Few-shot examples of how patients might answer:
{node.few_shot_examples}

Generate ONLY the opening question you will ask the patient. Keep it empathetic and professional.
Respond with a JSON object containing a single key "message" with your question.
"""

def build_extraction_prompt(node: VariableNode, collected_state: Dict[str, Any], history: List[Dict[str, str]], patient_message: str) -> str:
    return f"""You are a clinical data extraction engine.
Your goal is to extract the value for the variable '{node.label}' from the patient's message.

Target Variable: {node.variable_name}
Valid values: {node.valid_values}
Value definitions: {node.value_definitions}

Conversation History:
{history}

Patient's latest message:
"{patient_message}"

Extract the value that best matches the patient's response based on the valid values and definitions.
If the patient's response is ambiguous and none of the valid values confidently match, set "needs_clarification" to true.
Respond with a JSON object conforming strictly to the requested schema.
"""

def build_clarification_prompt(node: VariableNode, patient_message: str) -> str:
    return f"""You are a conversational clinical intake assistant.
The patient was asked about '{node.label}', but their answer was ambiguous or didn't clearly map to our valid values.

Valid values we need: {node.valid_values}
Value definitions: {node.value_definitions}

Patient's ambiguous message: "{patient_message}"

Generate a polite, empathetic follow-up question asking them to clarify their answer so we can categorize it correctly.
Respond with a JSON object containing a single key "message" with your question.
"""

def build_guardrails_prompt(outbound_message: str) -> str:
    return f"""You are a clinical safety guardrail classifier.
Your job is to review the following outbound message intended for a patient and determine if it is clinically safe.

CRITICAL RULE: You MUST NOT provide medical diagnoses or prescribe any treatments.
If the message contains a diagnosis or a prescription, it is UNSAFE.

Outbound Message to review:
"{outbound_message}"

Respond with a JSON object containing a boolean "is_safe" and a string "reason".
"""
