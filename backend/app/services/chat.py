"""
Blume — Chat orchestration service.

Handles a single conversation turn:
1. Store the patient's message
2. Triage the turn (symptom content vs greeting/question/emotional)
3. Extract variables via Anthropic (if symptom content)
4. Store extracted patient variables
5. RUN THE TREE ENGINE LOCALLY to determine the next step
6. Return response + updated state
"""
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import selectinload
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

    async def build_extraction_tool(self, tree_id: str) -> dict[str, Any]:
        """Dynamically build an Anthropic tool schema for the variables in this tree."""
        import json as json_mod
        from app.models.node import Node, NodeType
        from app.models.variable import Variable

        # 1. Get all variables used in this tree's nodes
        query = (
            select(Variable)
            .join(Node, Node.variable_key == Variable.key)
            .where(Node.tree_id == tree_id, Node.node_type == NodeType.variable)
        )
        result = await self.db.execute(query)
        variables = result.scalars().all()

        properties = {}
        for var in variables:
            # Build the value schema
            if var.answer_type == "single_choice":
                val_schema = {"type": "string", "description": "The extracted value — must be EXACTLY one of the allowed options."}
                if var.options_json:
                    val_schema["enum"] = var.options_json
            elif var.answer_type == "number":
                val_schema = {"type": "number", "description": "The extracted numeric value."}
            elif var.answer_type == "boolean":
                val_schema = {"type": "boolean", "description": "The extracted true/false value."}
            else:
                val_schema = {"type": "string", "description": "The extracted value as a short string."}

            # Build the description with domain knowledge context
            desc_parts = []
            if var.clinical_prompt:
                desc_parts.append(var.clinical_prompt)
            if var.extraction_hints:
                desc_parts.append(f"Recognise this variable from cues such as: {var.extraction_hints}")
            if var.synonyms:
                synonyms_str = ", ".join(var.synonyms) if isinstance(var.synonyms, list) else json_mod.dumps(var.synonyms)
                desc_parts.append(f"Known synonyms and related terms: {synonyms_str}")
            if var.patient_examples:
                examples_str = json_mod.dumps(var.patient_examples)
                desc_parts.append(f"Patient language examples (patient_says → maps_to): {examples_str}")
            if var.clinical_mappings:
                mappings_str = json_mod.dumps(var.clinical_mappings)
                desc_parts.append(f"Clinical term mappings: {mappings_str}")

            # Build the full variable schema (value + confidence)
            properties[var.key] = {
                "type": "object",
                "description": " ".join(desc_parts) if desc_parts else f"Extract the value for {var.key}.",
                "properties": {
                    "value": val_schema,
                    "confidence": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "Your confidence from 0 to 1 that this value is correct, based ONLY on the patient text. Use lower values when the text is vague, hedged, or indirect."
                    }
                },
                "required": ["value", "confidence"],
                "additionalProperties": False,
            }

        input_schema = {
            "type": "object",
            "description": "Clinical variables extracted from the patient's free-text description. Include a key ONLY when the text gives evidence for it; omit anything not mentioned. You are extracting information only — never infer routing, specialists, or a destination. Extract ALL variables you can identify, not just the one currently being asked about.",
            "properties": properties,
            "required": [],
            "additionalProperties": False,
        }

        return {
            "name": "record_extracted_variables",
            "description": "Record the clinical variables you can identify in the patient's message. You ONLY extract information from what the patient said. You never decide where the patient is routed, never see or name specialists, and never recommend a destination. Extract ALL identifiable variables, even if you were not explicitly asked about them.",
            "input_schema": input_schema,
        }

    async def process_message(
        self,
        conversation: Conversation,
        patient_message: str,
        current_question: Optional[str] = None,
        situation: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Process a patient message within an ongoing conversation.

        Args:
            conversation: The active conversation (must have tree and turns loaded).
            patient_message: What the patient said.
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
            "filled_variables": {},
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
                logger.warning(f"Triage failed: {e}")
                from fastapi import HTTPException
                raise HTTPException(status_code=500, detail=f"Anthropic API Error: {str(e)}")

        # 4. Retrieve relevant knowledge context (RAG) for better extraction
        knowledge_context = ""
        if conversation.tree_id:
            try:
                from app.services.retrieval import retrieve_relevant_chunks, format_knowledge_context
                chunks = await retrieve_relevant_chunks(
                    db=self.db,
                    tree_id=conversation.tree_id,
                    query=patient_message,
                    top_k=3,
                )
                knowledge_context = format_knowledge_context(chunks)
            except Exception as e:
                logger.debug(f"Knowledge retrieval skipped: {e}")

        # 5. Extract variables if we have symptom content
        extracted_variables: dict[str, Any] = {}
        if anthropic_service.is_available and conversation.tree_id:
            try:
                extraction_tool = await self.build_extraction_tool(conversation.tree_id)

                # Prepend knowledge context to patient text if available
                extraction_text = patient_message
                if knowledge_context:
                    extraction_text = (
                        f"{knowledge_context}\n\n"
                        f"---\n\n"
                        f"Patient message: {patient_message}"
                    )

                extracted_variables = await anthropic_service.extract(
                    patient_text=extraction_text,
                    tool=extraction_tool,
                )
                result["filled_variables"] = extracted_variables

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

                await self.db.flush()

            except Exception as e:
                logger.warning(f"Extraction failed: {e}")
                from fastapi import HTTPException
                raise HTTPException(status_code=500, detail=f"Anthropic API Error: {str(e)}")

        # 5. Run the tree engine to figure out the next step
        if conversation.tree_id:
            from app.models.tree import Tree
            from app.schemas.tree import TreeReadFull
            from app.services.tree_engine import run_engine

            # Re-fetch all patient variables for this conversation
            var_query = select(PatientVariable).where(PatientVariable.conversation_id == conversation.id)
            var_result = await self.db.execute(var_query)
            all_pvs = var_result.scalars().all()

            filled = {}
            for pv in all_pvs:
                # Get the actual value
                if pv.value_boolean is not None: val = pv.value_boolean
                elif pv.value_number is not None: val = pv.value_number
                elif pv.value_string is not None: val = pv.value_string
                elif pv.value_json is not None: val = pv.value_json
                else: continue
                filled[pv.variable_key] = val

            from app.models.tree import Tree
            from app.models.node import Node
            from app.models.branch import Branch
            from app.schemas.tree import TreeReadFull
            from app.services.tree_engine import run_engine
            
            # Fetch the full tree
            tree_query = select(Tree).where(Tree.id == conversation.tree_id).options(
                selectinload(Tree.nodes).selectinload(Node.branches).selectinload(Branch.condition),
                selectinload(Tree.nodes).selectinload(Node.workup_items),
            )
            tree_obj = (await self.db.execute(tree_query)).scalars().first()

            if tree_obj:
                tree_schema = TreeReadFull.model_validate(tree_obj)
                engine_result = run_engine(tree_schema, filled)

                if engine_result.outcome == "incomplete":
                    result["status"] = "in_progress"
                    conversation.status = ConversationStatus.in_progress
                else:
                    result["status"] = engine_result.outcome
                    conversation.status = ConversationStatus(engine_result.outcome)

                if engine_result.outcome == "routed":
                    spec = engine_result.specialist
                    result["specialist"] = {"specialist_name": spec.specialist_name, "specialty": spec.specialty}
                    
                    # Look up the actual specialist record by name to satisfy the foreign key
                    from app.models.specialist import Specialist
                    specialist_record = (await self.db.execute(
                        select(Specialist).where(Specialist.name == spec.specialist_name)
                    )).scalars().first()
                    
                    if specialist_record:
                        conversation.outcome_specialist_id = specialist_record.id
                        
                    result["response"] = f"Thank you! Based on your symptoms, we are routing you to {spec.specialist_name or spec.specialty}."
                
                elif engine_result.outcome == "escalated":
                    result["escalation_reason"] = engine_result.escalation_reason
                    conversation.escalation_reason = engine_result.escalation_reason
                    result["response"] = "Please contact our clinic directly as your symptoms require immediate attention."
                
                elif engine_result.outcome == "incomplete":
                    missing_key = engine_result.missing_variables[0]
                    
                    # Find the prompt for this variable
                    missing_node = next((n for n in tree_schema.nodes if n.node_type == "variable" and n.variable_key == missing_key), None)
                    if missing_node and missing_node.prompt:
                        question_text = missing_node.prompt
                        options = []
                        if missing_node.branches:
                            options = [b.patient_label or b.label for b in missing_node.branches]
                        # Optionally voice it
                        question_text = await self.voice_question(question_text, patient_message, options)
                        result["response"] = question_text
                        result["current_node_id"] = missing_node.id
                        result["options"] = options
                    else:
                        result["response"] = f"Please tell me more about your {missing_key}."
                        
                # Always add path_taken to the result
                result["path_taken"] = engine_result.path_taken

        # 6. Log the action
        action = Action(
            conversation_id=conversation.id,
            action_type="chat_turn",
            payload={
                "turn_number": turn_number,
                "triage_type": result["triage_type"],
                "extracted_count": len(extracted_variables),
                "engine_outcome": result.get("status"),
            },
        )
        self.db.add(action)

        # Store the assistant's reply if any
        if result["response"]:
            assistant_turn = ConversationTurn(
                conversation_id=conversation.id,
                turn_number=turn_number + 1,
                role=TurnRole.assistant,
                message=result["response"],
            )
            self.db.add(assistant_turn)

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
