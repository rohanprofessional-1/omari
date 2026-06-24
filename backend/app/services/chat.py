"""
Blume — Chat orchestration service.

Handles a single conversation turn:
1. Store the patient's message
2. Triage the turn (symptom content vs greeting/question/emotional)
3. If symptom content → extract variables via Anthropic
4. Store extracted patient variables
5. Return response + updated state

NOTE: The deterministic routing engine runs on the FRONTEND.
This service handles LLM interactions (extraction, voice, triage) and persistence.
The frontend is responsible for running the tree engine and deciding the next question.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import (
    Conversation,
    ConversationTurn,
    PatientVariable,
    Action,
    ConversationStatus,
    TurnRole,
    VariableVia,
)
from app.models.variable import Variable
from app.services.anthropic import anthropic_service

logger = logging.getLogger(__name__)


class ChatService:
    """Orchestrates a single chat turn within a conversation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def process_message(
        self,
        conversation: Conversation,
        patient_message: str,
        extraction_tool: Optional[dict[str, Any]] = None,
        current_question: Optional[str] = None,
        situation: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Process a patient message within an ongoing conversation.

        Args:
            conversation: The active conversation.
            patient_message: What the patient said.
            extraction_tool: Anthropic tool schema for variable extraction (built by frontend).
            current_question: The question the patient is answering (for triage context).
            situation: Conversation situation ('question', 'confirm', or None for start).

        Returns:
            {
                response: str,
                status: str,
                turn_number: int,
                triage_type: str,
                contains_symptom_content: bool,
                extracted_variables: dict,
            }
        """
        # 1. Determine the next turn number
        turn_number = len(conversation.turns) + 1

        # 2. Store the patient's turn
        patient_turn = ConversationTurn(
            conversation_id=conversation.id,
            turn_number=turn_number,
            role=TurnRole.patient,
            message=patient_message,
        )
        self.db.add(patient_turn)
        conversation.iterations += 1

        result: dict[str, Any] = {
            "response": "",
            "status": conversation.status.value,
            "turn_number": turn_number,
            "triage_type": "SYMPTOM_CONTENT",
            "contains_symptom_content": True,
            "extracted_variables": {},
        }

        # 3. Triage the turn if Anthropic is available
        if anthropic_service.is_available:
            try:
                triage_result = await anthropic_service.triage(
                    patient_text=patient_message,
                    situation=situation,
                    current_question=current_question,
                )
                result["triage_type"] = triage_result["type"]
                result["contains_symptom_content"] = triage_result["containsSymptomContent"]

                # If not symptom content, return Omari's warm reply directly
                if not triage_result["containsSymptomContent"] and triage_result["reply"]:
                    result["response"] = triage_result["reply"]

                    # Store assistant turn
                    assistant_turn = ConversationTurn(
                        conversation_id=conversation.id,
                        turn_number=turn_number + 1,
                        role=TurnRole.assistant,
                        message=triage_result["reply"],
                    )
                    self.db.add(assistant_turn)
                    await self.db.flush()
                    return result

            except Exception as e:
                logger.warning(f"Triage failed, treating as symptom content: {e}")

        # 4. Extract variables if we have symptom content and a tool
        extracted_variables: dict[str, Any] = {}
        if extraction_tool and anthropic_service.is_available:
            try:
                extracted_variables = await anthropic_service.extract(
                    patient_text=patient_message,
                    tool=extraction_tool,
                )
                result["extracted_variables"] = extracted_variables

                # Store extracted variables
                for var_key, var_data in extracted_variables.items():
                    if isinstance(var_data, dict) and "value" in var_data:
                        value = var_data["value"]
                        confidence = var_data.get("confidence", 0.5)

                        pv = PatientVariable(
                            conversation_id=conversation.id,
                            variable_key=var_key,
                            confidence=confidence,
                            via=VariableVia.extraction,
                            filled_at=datetime.now(timezone.utc),
                        )

                        # Store value in the appropriate column
                        if isinstance(value, bool):
                            pv.value_boolean = value
                        elif isinstance(value, (int, float)):
                            pv.value_number = value
                        elif isinstance(value, str):
                            pv.value_string = value
                        else:
                            pv.value_json = value

                        self.db.add(pv)

            except Exception as e:
                logger.warning(f"Extraction failed: {e}")

        # 5. Log the action
        action = Action(
            conversation_id=conversation.id,
            action_type="chat_turn",
            payload={
                "turn_number": turn_number,
                "triage_type": result["triage_type"],
                "extracted_count": len(extracted_variables),
            },
        )
        self.db.add(action)

        await self.db.flush()
        return result

    async def voice_question(
        self,
        question: str,
        last_patient_message: Optional[str] = None,
        options: Optional[list[str]] = None,
        progress_hint: bool = False,
    ) -> str:
        """Wrap a question in Omari's warm voice."""
        if not anthropic_service.is_available:
            return question

        try:
            return await anthropic_service.voice(
                question=question,
                last_patient_message=last_patient_message,
                options=options,
                progress_hint=progress_hint,
            )
        except Exception as e:
            logger.warning(f"Voice failed, returning plain question: {e}")
            return question

    async def update_conversation_status(
        self,
        conversation: Conversation,
        status: ConversationStatus,
        specialist_id: Optional[str] = None,
        urgency: Optional[str] = None,
        escalation_reason: Optional[str] = None,
        path_taken: Optional[list[str]] = None,
    ) -> None:
        """Update conversation outcome when routing is complete."""
        conversation.status = status
        if specialist_id:
            conversation.outcome_specialist_id = specialist_id
        if urgency:
            from app.models.conversation import OutcomeUrgency
            conversation.outcome_urgency = OutcomeUrgency(urgency)
        if escalation_reason:
            conversation.escalation_reason = escalation_reason
        if path_taken:
            conversation.path_taken = path_taken
        conversation.completed_at = datetime.now(timezone.utc)
        await self.db.flush()
