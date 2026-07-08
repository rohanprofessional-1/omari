"""
Blume — Anthropic LLM service.

Wraps the Anthropic Python SDK for extraction, triage, voice, and phrase calls.
System prompts are ported from the original Express server (server/index.mjs).
"""
import logging
from typing import Any, Optional

import anthropic

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompts — ported verbatim from Express server/index.mjs
# ---------------------------------------------------------------------------

EXTRACTION_SYSTEM_PROMPT = (
    "You extract clinical intake variables from how a patient describes their "
    "problem. You have access to clinical domain knowledge — including synonyms, "
    "patient language examples, and clinical term mappings — for each variable. "
    "Use this knowledge to bridge everyday patient language to clinical terms. "
    "For example, if a patient says 'my grip is weak' and the variable maps "
    "'weakness' to 'motor_deficit', extract 'motor_deficit'.\n\n"
    "Extract ALL variables you can identify from the patient's message — not "
    "just the one currently being asked about. If the patient's opening message "
    "mentions duration, location, and symptom type, extract all three. This "
    "lets the system skip questions the patient has already answered.\n\n"
    "For each variable, provide a value ONLY if the patient's words support it, "
    "plus a confidence 0–1 reflecting how clearly they indicated it. If the "
    "patient did not mention something, OMIT it or set confidence 0. Never "
    "guess to seem helpful — a missing value is correct and expected."
)

PHRASE_SYSTEM_PROMPT = (
    "Rephrase this single intake question to be warm and clear for a non-medical "
    "patient. Do not add medical content, do not ask about anything other than the "
    "given variable, do not combine questions. Return only the rephrased question."
)

VOICE_SYSTEM_PROMPT = (
    "You are Omari, a warm AI care coordinator helping a patient through intake so "
    "they reach exactly the right specialist. You are NOT a doctor. You must NEVER "
    "give medical advice, interpret what symptoms mean, suggest diagnoses, or "
    "comment on how serious or mild anything is — no reassurance like \"I'm sure "
    "it's fine\" or \"that sounds serious\", and never \"this could be X\". You may "
    "warmly acknowledge the patient's EXPERIENCE and feelings (stress, worry, "
    "frustration, how long it has gone on) — never the medical meaning.\n\n"
    "You will be given (1) the patient's last message and (2) the EXACT next "
    "question to ask. Reply with: first one or two short sentences of genuine, "
    "specific human warmth acknowledging their last message, then ask EXACTLY that "
    "question in friendlier, conversational language. Rules: do NOT change which "
    "question is asked; do NOT drop, rename, or alter any answer option; do NOT "
    "invent new questions; do NOT add medical content or opinions. If answer "
    "options are provided you may mention them naturally but must preserve all of "
    "them. Keep it concise, warm, and unhurried. Return ONLY the message text — no "
    "preamble, no quotation marks."
)

TRIAGE_SYSTEM_PROMPT = (
    "You are Omari, a warm AI care coordinator doing patient intake. You are NOT a "
    "doctor: never give medical advice, never interpret symptoms, never comment on "
    "how serious or mild anything is.\n\n"
    "Read ONLY the patient's latest message, classify it, and — if it is NOT "
    "clinical symptom content — write a brief, warm reply in your own voice.\n\n"
    "Set containsSymptomContent=true (and reply=\"\") when the message contains ANY "
    "information about the patient's actual problem or symptoms. That covers "
    "SYMPTOM_CONTENT and MIXED (a greeting/aside PLUS some symptom info). When in "
    "doubt and the message plausibly describes their problem, prefer true so no "
    "clinical detail is lost.\n\n"
    "Otherwise set containsSymptomContent=false and write reply for these types:\n"
    "- GREETING: greet back warmly and briefly and gently invite them to share "
    "what is going on. Do NOT say \"thanks for sharing\". Do NOT ask a clinical question.\n"
    "- QUESTION_TO_OMARI: answer honestly and briefly — you are an AI care "
    "coordinator (not a human, not a doctor) gathering a little information so the "
    "right specialist sees them; the visit itself is with a real specialist; intake "
    "takes a couple of minutes. If they ask a MEDICAL question, warmly DECLINE to "
    "give medical advice and say the specialist will cover that. Then gently steer "
    "back to intake.\n"
    "- EMOTIONAL: acknowledge their FEELING warmly and genuinely (about their "
    "experience, NEVER the medical meaning — no reassurance about severity), then "
    "gently continue.\n"
    "- CONFUSION: re-ask the SAME current question in simpler words. Do NOT "
    "introduce a new question.\n\n"
    "You are given the situation and (if any) the current question. When steering "
    "back: if there is a current question, gently return to it; if not, invite them "
    "to share in their own words. NEVER introduce a new clinical question or any "
    "medical content. NEVER decide where they are routed. Always call the "
    "triage_turn tool."
)

TRIAGE_TOOL = {
    "name": "triage_turn",
    "description": (
        "Classify the patient's latest message and, when it is not clinical "
        "symptom content, provide Omari's warm reply."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "type": {
                "type": "string",
                "enum": [
                    "SYMPTOM_CONTENT",
                    "MIXED",
                    "GREETING",
                    "QUESTION_TO_OMARI",
                    "EMOTIONAL",
                    "CONFUSION",
                    "OTHER",
                ],
                "description": "The kind of message this is.",
            },
            "containsSymptomContent": {
                "type": "boolean",
                "description": (
                    "true if the message contains ANY information about the "
                    "patient's symptoms/problem (SYMPTOM_CONTENT or MIXED)."
                ),
            },
            "reply": {
                "type": "string",
                "description": (
                    "Omari's warm, in-character reply — used ONLY when "
                    "containsSymptomContent is false. Empty string when true."
                ),
            },
        },
        "required": ["type", "containsSymptomContent", "reply"],
    },
}


class AnthropicService:
    """Service for interacting with the Anthropic API."""

    def __init__(self):
        self.client: anthropic.AsyncAnthropic | None = None
        if settings.ANTHROPIC_API_KEY:
            self.client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    @property
    def is_available(self) -> bool:
        return self.client is not None

    async def extract(
        self,
        patient_text: str,
        tool: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Extract clinical variables from patient text.

        Args:
            patient_text: What the patient said.
            tool: Anthropic tool definition with name, description, input_schema.

        Returns:
            Dict of extracted variables {key: {value, confidence}}.
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        model = settings.ANTHROPIC_EXTRACT_MODEL or settings.ANTHROPIC_MODEL
        logger.info(f"[blume/extract] → calling Anthropic · model={model}")

        message = await self.client.messages.create(
            model=model,
            max_tokens=1024,
            system=EXTRACTION_SYSTEM_PROMPT,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"], "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": patient_text}],
        )

        tool_use = next(
            (block for block in message.content if block.type == "tool_use"),
            None,
        )
        variables = tool_use.input if tool_use else {}
        logger.info(f"[blume/extract] ✓ model={message.model} · variables={variables}")
        return variables

    async def triage(
        self,
        patient_text: str,
        situation: Optional[str] = None,
        current_question: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Classify a patient's turn and generate Omari's response for non-symptom turns.

        Returns:
            {type: str, containsSymptomContent: bool, reply: str}
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        user_content = f'The patient just said: "{patient_text.strip()[:1000]}"'

        if situation == "question":
            where = "You are partway through intake, waiting for the answer to a question."
        elif situation == "confirm":
            where = "You are partway through intake, waiting for the patient to confirm something."
        else:
            where = "This is the very start — no question has been asked yet."
        user_content += f"\n\nSituation: {where}"

        if current_question:
            user_content += f'\nThe current question is: "{current_question.strip()}"'

        message = await self.client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=320,
            system=TRIAGE_SYSTEM_PROMPT,
            tools=[TRIAGE_TOOL],
            tool_choice={"type": "tool", "name": TRIAGE_TOOL["name"], "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": user_content}],
        )

        tool_use = next(
            (block for block in message.content if block.type == "tool_use"),
            None,
        )
        out = tool_use.input if tool_use else {}
        return {
            "type": out.get("type", "OTHER"),
            "containsSymptomContent": out.get("containsSymptomContent", False),
            "reply": (out.get("reply") or "").strip(),
        }

    async def voice(
        self,
        question: str,
        last_patient_message: Optional[str] = None,
        options: Optional[list[str]] = None,
        progress_hint: bool = False,
    ) -> str:
        """
        Wrap a clinical question in warm, human phrasing via Omari's voice.

        Returns:
            The warm phrasing of the question.
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        user_content = f'The exact question to ask the patient: "{question}"'
        if options:
            opts_str = ", ".join(f'"{o}"' for o in options)
            user_content += (
                f"\nAnswer options (keep ALL of them, do not drop or rename any): {opts_str}"
            )
        if last_patient_message and last_patient_message.strip():
            user_content += (
                f'\n\nThe patient just said: "{last_patient_message.strip()[:800]}"'
            )
        else:
            user_content += (
                "\n\n(This is the first question — there is no earlier patient message to "
                "acknowledge, so just open warmly and ask it.)"
            )
        if progress_hint:
            user_content += (
                "\n\nIf it feels natural, you may add a brief, light touch of encouragement "
                "(e.g. \"almost there\") — but only occasionally, never every turn."
            )

        message = await self.client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=320,
            system=VOICE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        text_block = next(
            (b for b in message.content if b.type == "text"),
            None,
        )
        out = text_block.text.strip() if text_block else ""
        # Strip wrapping quotes
        out = out.strip("\"'").strip()
        return out or question

    async def phrase(
        self,
        question: str,
        last_patient_turn: Optional[str] = None,
    ) -> str:
        """
        Rephrase a clinical question for warmth and clarity.

        Returns:
            The rephrased question.
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        user_content = f'Question to rephrase: "{question}"'
        if last_patient_turn and last_patient_turn.strip():
            user_content += (
                "\n\nFor tone only — do not answer it or reference its content — the "
                f'patient just said: "{last_patient_turn.strip()[:500]}"'
            )

        message = await self.client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=256,
            system=PHRASE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        text_block = next(
            (b for b in message.content if b.type == "text"),
            None,
        )
        phrased = text_block.text.strip() if text_block else ""
        phrased = phrased.strip("\"'").strip()
        return phrased or question


# Singleton instance
anthropic_service = AnthropicService()
