from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import re
from typing import Any, Callable, Dict, List, Optional, Protocol

from pydantic import BaseModel, Field

from app.services.tree.state_manager import TreeStateManager
from app.schemas.tree import ActionNode, BranchNode, BranchCondition, EndNode, Tree as LegacyTree, VariableNode
from app.services.llm.client import call_llm
from app.services.llm.prompts import (
    build_opening_prompt,
    build_extraction_prompt,
    build_clarification_prompt,
    build_guardrails_prompt,
)
from app.schemas.llm import OpeningResponse, ExtractionResponse, ExtractionValue, GuardrailsResponse


class ChatMessageDict(Dict[str, str]):
    pass


class SymptomValue(Dict[str, Any]):
    pass


class ClinicalContext(BaseModel):
    data: Optional[Any] = None


class ClinicalContextProvider(Protocol):
    async def getContext(self, currentNodeId: str, patientState: "PatientState") -> Optional[Any]:
        ...


class NullClinicalContextProvider:
    async def getContext(self, currentNodeId: str, patientState: "PatientState") -> Optional[Any]:
        return None


class Symptom(BaseModel):
    value: str
    normalizedValue: Optional[str] = None


class ChatMessage(BaseModel):
    role: str
    content: str


class PatientState(BaseModel):
    chiefComplaint: Optional[str] = None
    symptoms: List[Symptom] = Field(default_factory=list)
    variables: Dict[str, Any] = Field(default_factory=dict)
    extractedFacts: Dict[str, Any] = Field(default_factory=dict)
    currentNodeId: str = ""
    visitedNodes: List[str] = Field(default_factory=list)
    conversationHistory: List[ChatMessage] = Field(default_factory=list)


class TreeEvaluation(BaseModel):
    status: str
    nextNode: Optional[str] = None
    missingVariables: List[str] = Field(default_factory=list)
    matchedBucket: Optional[str] = None


class ConversationGoal(BaseModel):
    objective: str
    missingVariables: List[str] = Field(default_factory=list)
    knownFacts: Dict[str, Any] = Field(default_factory=dict)
    conversationSummary: str = ""


class OrchestratorEvent(BaseModel):
    timestamp: datetime
    nodeId: str
    event: str
    payload: Any


@dataclass
class _SessionContext:
    tree: Any
    node_index: Dict[str, Any] = field(default_factory=dict)
    patient_state: Optional[PatientState] = None


class IntakeOrchestrator:
    def __init__(
        self,
        state_manager: Optional[TreeStateManager] = None,
        model_name: str = "claude-3-haiku-20240307",
        tree: Any | None = None,
        extractor: Optional[Callable[[str, PatientState], Dict[str, Any]]] = None,
        question_generator: Optional[Callable[[ConversationGoal, PatientState], str]] = None,
        context_provider: Optional[ClinicalContextProvider] = None,
    ):
        self.state_manager = state_manager
        self.model_name = model_name
        self.tree = tree or getattr(state_manager, "tree", None)
        self.context_provider = context_provider or NullClinicalContextProvider()
        self.extractor = extractor or self._default_extract_information
        self.question_generator = question_generator or self._default_generate_question
        self.events: List[OrchestratorEvent] = []
        self.patient_state: Optional[PatientState] = None
        self.session_status: str = "not_started"
        self._session: Optional[_SessionContext] = None

        if self.tree is not None:
            self.initializeSession(self.tree)

    def initializeSession(self, tree: Any | None = None, patient_state: Optional[PatientState] = None) -> PatientState:
        active_tree = tree or self.tree
        if active_tree is None:
            raise ValueError("A tree is required to initialize a session.")

        self.tree = active_tree
        node_index = self._build_node_index(active_tree)
        root_node_id = getattr(active_tree, "root_node_id", None)
        if not root_node_id:
            raise ValueError("Tree is missing a root_node_id.")

        self.patient_state = patient_state or PatientState(currentNodeId=root_node_id)
        self.patient_state.currentNodeId = root_node_id
        self.patient_state.visitedNodes = [root_node_id]
        self._session = _SessionContext(tree=active_tree, node_index=node_index, patient_state=self.patient_state)
        self.session_status = "active"
        return self.patient_state

    def processPatientMessage(self, message: str) -> Dict[str, Any]:
        self._require_session()
        assert self.patient_state is not None

        self.patient_state.conversationHistory.append(ChatMessage(role="patient", content=message))
        self._log_event("MESSAGE_RECEIVED", self.patient_state.currentNodeId, {"message": message})

        extracted = self.extractor(message, self.patient_state)
        normalized = self._normalize_extraction(extracted)
        self._log_event("FACTS_EXTRACTED", self.patient_state.currentNodeId, normalized)
        self._merge_extracted_information(normalized)
        self._log_event("STATE_UPDATED", self.patient_state.currentNodeId, self.patient_state.model_dump())

        while True:
            evaluation = self.evaluateCurrentNode()
            self._log_event("NODE_EVALUATED", self.patient_state.currentNodeId, evaluation.model_dump())

            if evaluation.status == "INCOMPLETE":
                goal = self.generateConversationGoal(evaluation.missingVariables)
                question = self.generateNextQuestion(goal)
                self.patient_state.conversationHistory.append(ChatMessage(role="assistant", content=question))
                self._log_event("QUESTION_GENERATED", self.patient_state.currentNodeId, {"goal": goal.model_dump(), "question": question})
                return {
                    "response": question,
                    "message": question,
                    "status": "in_progress",
                    "goal": goal.model_dump(),
                    "evaluation": evaluation.model_dump(),
                    "currentNodeId": self.patient_state.currentNodeId,
                    "missingVariables": evaluation.missingVariables,
                    "events": [event.model_dump() for event in self.events],
                }

            if evaluation.status == "ESCALATE":
                self._log_event("ESCALATED", self.patient_state.currentNodeId, evaluation.model_dump())
                self.completeSession("escalated")
                return {
                    "response": "Please contact the clinic directly so we can help with next steps.",
                    "message": "Please contact the clinic directly so we can help with next steps.",
                    "status": "escalated",
                    "evaluation": evaluation.model_dump(),
                    "currentNodeId": self.patient_state.currentNodeId,
                    "events": [event.model_dump() for event in self.events],
                }

            if evaluation.nextNode:
                self.advanceTree(evaluation.nextNode)
                continue

            current_node = self._get_current_node()
            current_type = self._node_type(current_node)
            if current_type == "specialist":
                self.completeSession("completed")
                return {
                    "response": self._specialist_completion_message(current_node),
                    "message": self._specialist_completion_message(current_node),
                    "status": "completed",
                    "currentNodeId": self.patient_state.currentNodeId,
                    "events": [event.model_dump() for event in self.events],
                }

            if current_type == "escalation":
                self.completeSession("escalated")
                return {
                    "response": "Please contact the clinic directly so we can help with next steps.",
                    "message": "Please contact the clinic directly so we can help with next steps.",
                    "status": "escalated",
                    "currentNodeId": self.patient_state.currentNodeId,
                    "events": [event.model_dump() for event in self.events],
                }

            self.completeSession("completed")
            return {
                "response": "The intake is complete.",
                "message": "The intake is complete.",
                "status": "completed",
                "currentNodeId": self.patient_state.currentNodeId,
                "events": [event.model_dump() for event in self.events],
            }

    def evaluateCurrentNode(self) -> TreeEvaluation:
        self._require_session()
        assert self.patient_state is not None
        current_node = self._get_current_node()
        node_type = self._node_type(current_node)

        if node_type == "escalation":
            return TreeEvaluation(status="ESCALATE", matchedBucket=self._node_label(current_node))

        if node_type == "specialist":
            return TreeEvaluation(status="ADVANCE", matchedBucket=self._node_label(current_node))

        if node_type == "branch":
            return self._evaluate_branch_node(current_node)

        if node_type == "variable":
            variable_key = self._variable_key(current_node)
            value = self._resolve_value(variable_key)
            if value is None:
                return TreeEvaluation(status="INCOMPLETE", missingVariables=[variable_key])

            next_node = self._next_node_for_variable(current_node, value)
            if next_node is None and self._node_next_id(current_node) is None:
                return TreeEvaluation(status="ADVANCE", matchedBucket=self._node_label(current_node))

            if next_node is None:
                return TreeEvaluation(status="ESCALATE", matchedBucket=self._node_label(current_node))

            return TreeEvaluation(status="ADVANCE", nextNode=next_node, matchedBucket=self._node_label(current_node))

        return TreeEvaluation(status="ESCALATE", matchedBucket=self._node_label(current_node))

    def generateConversationGoal(self, missing_variables: Optional[List[str]] = None) -> ConversationGoal:
        self._require_session()
        assert self.patient_state is not None
        current_node = self._get_current_node()
        if missing_variables is None:
            evaluation = self.evaluateCurrentNode()
            missing_variables = evaluation.missingVariables if evaluation.status == "INCOMPLETE" else []

        objective = self._goal_objective(current_node, missing_variables)
        known_facts = self._known_facts_snapshot()
        summary = self._conversation_summary()
        goal = ConversationGoal(
            objective=objective,
            missingVariables=missing_variables,
            knownFacts=known_facts,
            conversationSummary=summary,
        )
        return goal

    def generateNextQuestion(self) -> str:
        goal = self.generateConversationGoal()
        question = self.question_generator(goal, self.patient_state or PatientState())
        return self._ensure_single_question(question)

    def advanceTree(self, next_node_id: Optional[str] = None) -> None:
        self._require_session()
        assert self.patient_state is not None
        if next_node_id is None:
            current_evaluation = self.evaluateCurrentNode()
            next_node_id = current_evaluation.nextNode

        if not next_node_id:
            return

        self.patient_state.currentNodeId = next_node_id
        if next_node_id not in self.patient_state.visitedNodes:
            self.patient_state.visitedNodes.append(next_node_id)
        self._log_event("NODE_ADVANCED", next_node_id, {"currentNodeId": next_node_id})

    def completeSession(self, status: str = "completed") -> None:
        self.session_status = status
        self._log_event("SESSION_COMPLETED", self.patient_state.currentNodeId if self.patient_state else "", {"status": status})

    def get_event_log(self) -> List[Dict[str, Any]]:
        return [event.model_dump() for event in self.events]

    def process_turn(self, patient_message: Optional[str]) -> Dict[str, Any]:
        if self.state_manager is not None:
            return self._process_turn_legacy(patient_message)

        if patient_message is None:
            patient_message = ""
        return self.processPatientMessage(patient_message)

    def _process_turn_legacy(self, patient_message: Optional[str]) -> Dict[str, Any]:
        current_node = self.state_manager.get_current_node()

        if patient_message:
            self.state_manager.append_history("user", patient_message)

            if isinstance(current_node, VariableNode):
                system_prompt = build_extraction_prompt(
                    node=current_node,
                    collected_state=self.state_manager.collected_variables,
                    history=self.state_manager.conversation_history,
                    patient_message=patient_message,
                )

                ext_response = call_llm(
                    system_prompt=system_prompt,
                    user_message="Extract the variable based on my last message.",
                    model_name=self.model_name,
                    response_model=ExtractionResponse,
                )

                if ext_response.extraction.needs_clarification:
                    clarification_prompt = build_clarification_prompt(current_node, patient_message)
                    clarif_resp = call_llm(clarification_prompt, "Please clarify.", self.model_name, OpeningResponse)
                    return self._apply_guardrails_and_return(clarif_resp.message)

                self.state_manager.collect_variable(current_node.variable_name, ext_response.extraction.value)
                if current_node.next_node_id:
                    self.state_manager.advance_node(current_node.next_node_id)

        while True:
            current_node = self.state_manager.get_current_node()

            if isinstance(current_node, BranchNode):
                next_id = self.state_manager.evaluate_branch()
                self.state_manager.advance_node(next_id)

            elif isinstance(current_node, ActionNode):
                self.state_manager.add_action({"action_type": current_node.action_type, "payload": current_node.payload})
                if current_node.next_node_id:
                    self.state_manager.advance_node(current_node.next_node_id)
                else:
                    break

            elif isinstance(current_node, EndNode):
                return {
                    "message": "You have reached the end of the intake flow. Thank you.",
                    "status": "completed",
                    "actions": self.state_manager.ordered_actions,
                }

            elif isinstance(current_node, VariableNode):
                break

        current_node = self.state_manager.get_current_node()
        if isinstance(current_node, VariableNode):
            open_prompt = build_opening_prompt(current_node, self.state_manager.collected_variables)
            open_resp = call_llm(open_prompt, "Generate the question.", self.model_name, OpeningResponse)
            return self._apply_guardrails_and_return(open_resp.message)

        return {"message": "An unexpected error occurred.", "status": "error"}

    def _apply_guardrails_and_return(self, outbound_message: str) -> Dict[str, Any]:
        guard_prompt = build_guardrails_prompt(outbound_message)
        guard_resp = call_llm(
            system_prompt=guard_prompt,
            user_message="Review the outbound message.",
            model_name=self.model_name,
            response_model=GuardrailsResponse,
        )

        final_message = outbound_message
        if not guard_resp.is_safe:
            final_message = "I'm sorry, but I cannot provide medical advice or diagnoses. Let's continue."

        self.state_manager.append_history("assistant", final_message)
        return {
            "message": final_message,
            "status": "in_progress",
            "actions": self.state_manager.ordered_actions,
        }

    def _require_session(self) -> None:
        if self.patient_state is not None and self._session is not None:
            return
        if self.tree is None:
            raise ValueError("No tree has been initialized for this orchestrator.")
        self.initializeSession(self.tree)

    def _build_node_index(self, tree: Any) -> Dict[str, Any]:
        nodes = getattr(tree, "nodes", {})
        if isinstance(nodes, dict):
            return dict(nodes)
        return {getattr(node, "id"): node for node in nodes}

    def _get_current_node(self) -> Any:
        assert self._session is not None
        assert self.patient_state is not None
        current_node = self._session.node_index.get(self.patient_state.currentNodeId)
        if current_node is None:
            raise ValueError(f"Current node '{self.patient_state.currentNodeId}' not found in tree.")
        return current_node

    def _log_event(self, event: str, node_id: str, payload: Any) -> None:
        self.events.append(
            OrchestratorEvent(
                timestamp=datetime.now(timezone.utc),
                nodeId=node_id,
                event=event,
                payload=payload,
            )
        )

    def _normalize_extraction(self, extracted: Dict[str, Any]) -> Dict[str, Any]:
        if not extracted:
            return {"symptoms": [], "variables": {}, "facts": {}}

        if "symptoms" in extracted or "variables" in extracted or "chiefComplaint" in extracted:
            normalized = dict(extracted)
            normalized.setdefault("symptoms", [])
            normalized.setdefault("variables", {})
            normalized.setdefault("facts", {})
            return normalized

        return {"symptoms": [], "variables": dict(extracted), "facts": {}}

    def _merge_extracted_information(self, extracted: Dict[str, Any]) -> None:
        assert self.patient_state is not None

        chief_complaint = extracted.get("chiefComplaint")
        if chief_complaint and not self.patient_state.chiefComplaint:
            self.patient_state.chiefComplaint = str(chief_complaint)

        for symptom in extracted.get("symptoms", []):
            if isinstance(symptom, dict):
                symptom_value = symptom.get("value") or symptom.get("name") or symptom.get("text")
                normalized_value = symptom.get("normalizedValue")
            else:
                symptom_value = str(symptom)
                normalized_value = None
            if symptom_value and symptom_value not in [item.value for item in self.patient_state.symptoms]:
                self.patient_state.symptoms.append(Symptom(value=symptom_value, normalizedValue=normalized_value))

        for key, value in extracted.get("variables", {}).items():
            self.patient_state.variables[key] = value

        for key, value in extracted.get("facts", {}).items():
            self.patient_state.extractedFacts[key] = value

    def _goal_objective(self, node: Any, missing_variables: List[str]) -> str:
        prompt = getattr(node, "prompt", None)
        if prompt:
            return prompt

        label = self._node_label(node)
        if missing_variables:
            return f"Determine {missing_variables[0]}"
        if label:
            return f"Determine {label.lower()}"
        return "Determine the next missing intake detail"

    def _known_facts_snapshot(self) -> Dict[str, Any]:
        assert self.patient_state is not None
        known_facts: Dict[str, Any] = {}
        if self.patient_state.chiefComplaint:
            known_facts["chiefComplaint"] = self.patient_state.chiefComplaint
        if self.patient_state.symptoms:
            known_facts["symptoms"] = [symptom.model_dump() for symptom in self.patient_state.symptoms]
        known_facts.update(self.patient_state.variables)
        known_facts.update(self.patient_state.extractedFacts)
        return known_facts

    def _conversation_summary(self) -> str:
        assert self.patient_state is not None
        recent_messages = self.patient_state.conversationHistory[-4:]
        return " | ".join(f"{message.role}: {message.content}" for message in recent_messages)

    def _default_extract_information(self, message: str, patient_state: PatientState) -> Dict[str, Any]:
        message_text = message.strip()
        lower_message = message_text.lower()

        symptoms: List[Dict[str, Any]] = []
        variables: Dict[str, Any] = {}

        if message_text:
            symptoms.append({"value": message_text, "normalizedValue": None})

        if any(token in lower_message for token in ["pain", "hurt", "sore"]):
            patient_state.extractedFacts.setdefault("chiefComplaintHint", "pain")

        duration_match = re.search(r"\b\d+\s*(?:day|days|week|weeks|month|months|year|years)\b", lower_message)
        if duration_match:
            variables["duration"] = duration_match.group(0)

        if any(token in lower_message for token in ["weak", "weakness", "grip"]):
            variables["weakness"] = True

        if "numb" in lower_message:
            symptoms.append({"value": "numbness", "normalizedValue": "numbness"})

        return {
            "chiefComplaint": message_text or None,
            "symptoms": symptoms,
            "variables": variables,
            "facts": {},
        }

    def _default_generate_question(self, goal: ConversationGoal, patient_state: PatientState) -> str:
        objective = goal.objective.lower()
        if "duration" in objective:
            return "When did you first start noticing the symptoms?"
        if "weakness" in objective:
            return "Have you noticed any weakness or trouble gripping objects?"
        if "numb" in objective:
            return "Have you noticed any numbness or tingling anywhere else?"
        return f"Can you tell me more about {goal.objective.lower()}?"

    def _ensure_single_question(self, question: str) -> str:
        cleaned = question.strip()
        if not cleaned.endswith("?"):
            cleaned = cleaned.rstrip(".") + "?"
        if cleaned.count("?") > 1:
            first_question = cleaned.split("?")[0].strip()
            cleaned = first_question + "?"
        return cleaned

    def _node_type(self, node: Any) -> str:
        node_type = getattr(node, "node_type", None)
        if hasattr(node_type, "value"):
            return str(node_type.value)
        if isinstance(node, VariableNode):
            return "variable"
        if isinstance(node, BranchNode):
            return "branch"
        if isinstance(node, ActionNode):
            return "action"
        if isinstance(node, EndNode):
            return "end"
        if node_type:
            return str(node_type)
        if getattr(node, "specialist_name", None):
            return "specialist"
        if getattr(node, "escalation_reason", None):
            return "escalation"
        if getattr(node, "variable_name", None) or getattr(node, "variable_key", None):
            return "variable"
        return "unknown"

    def _node_label(self, node: Any) -> str:
        return str(getattr(node, "label", None) or getattr(node, "prompt", None) or getattr(node, "specialist_name", None) or getattr(node, "variable_name", None) or getattr(node, "variable_key", None) or getattr(node, "id", ""))

    def _variable_key(self, node: Any) -> str:
        return str(getattr(node, "variable_key", None) or getattr(node, "variable_name", None) or getattr(node, "id", ""))

    def _node_next_id(self, node: Any) -> Optional[str]:
        return getattr(node, "next_node_id", None)

    def _resolve_value(self, key: str) -> Any:
        assert self.patient_state is not None
        if key in self.patient_state.variables:
            return self.patient_state.variables[key]
        if key in self.patient_state.extractedFacts:
            return self.patient_state.extractedFacts[key]
        if key == "chiefComplaint":
            return self.patient_state.chiefComplaint
        return None

    def _next_node_for_variable(self, node: Any, value: Any) -> Optional[str]:
        next_node_id = self._node_next_id(node)
        if next_node_id:
            return next_node_id

        branches = getattr(node, "branches", None) or []
        if not branches:
            return None

        sorted_branches = sorted(branches, key=lambda branch: getattr(branch, "branch_order", 0))
        for branch in sorted_branches:
            condition = getattr(branch, "condition", None)
            if condition is None:
                return getattr(branch, "next_node_id", None)
            if self._condition_matches(condition, value):
                return getattr(branch, "next_node_id", None)

        default_next = getattr(node, "default_next_node_id", None)
        return default_next

    def _evaluate_branch_node(self, node: Any) -> TreeEvaluation:
        conditions = getattr(node, "conditions", []) or []
        for condition in conditions:
            variable_name = getattr(condition, "variable_name", None)
            if not variable_name:
                continue
            value = self._resolve_value(variable_name)
            if value is None:
                return TreeEvaluation(status="INCOMPLETE", missingVariables=[variable_name])
            if self._legacy_condition_matches(condition, value):
                return TreeEvaluation(status="ADVANCE", nextNode=getattr(condition, "next_node_id", None), matchedBucket=variable_name)

        default_next_node_id = getattr(node, "default_next_node_id", None)
        if default_next_node_id:
            return TreeEvaluation(status="ADVANCE", nextNode=default_next_node_id, matchedBucket="default")
        return TreeEvaluation(status="ESCALATE", matchedBucket=self._node_label(node))

    def _condition_matches(self, condition: Any, value: Any) -> bool:
        condition_type = getattr(condition, "condition_type", None)
        if condition_type == "equals":
            return str(value) == str(getattr(condition, "value_string", ""))
        if condition_type == "range":
            try:
                numeric_value = float(value)
            except (TypeError, ValueError):
                return False
            min_value = getattr(condition, "min_value", None)
            max_value = getattr(condition, "max_value", None)
            if min_value is not None and numeric_value < float(min_value):
                return False
            if max_value is not None and numeric_value > float(max_value):
                return False
            return True
        if condition_type == "in":
            values_list = getattr(condition, "values_list", None)
            if not values_list:
                return False
            try:
                import json

                allowed_values = json.loads(values_list)
            except Exception:
                return False
            return str(value) in [str(item) for item in allowed_values]
        return str(value) == str(getattr(condition, "value", ""))

    def _legacy_condition_matches(self, condition: Any, value: Any) -> bool:
        operator = getattr(condition, "operator", None)
        expected = getattr(condition, "value", None)

        try:
            if isinstance(expected, bool):
                if isinstance(value, str):
                    value = value.lower() == "true"
                else:
                    value = bool(value)
            elif isinstance(expected, int):
                value = int(value)
            elif isinstance(expected, float):
                value = float(value)
        except (TypeError, ValueError):
            return False

        if operator == "==":
            return value == expected
        if operator == "!=":
            return value != expected
        if operator == "<":
            return value < expected
        if operator == ">":
            return value > expected
        if operator == "<=":
            return value <= expected
        if operator == ">=":
            return value >= expected
        return False

    def _specialist_completion_message(self, node: Any) -> str:
        specialist_name = getattr(node, "specialist_name", None) or getattr(node, "specialty", None) or "the appropriate specialist"
        return f"Thank you. Based on the information so far, we are routing you to {specialist_name}."
