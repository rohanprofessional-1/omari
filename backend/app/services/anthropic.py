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
    "problem. You do NOT diagnose, route, or decide anything. For each variable, "
    "provide a value ONLY if the patient's words support it, plus a confidence "
    "0–1 reflecting how clearly they indicated it. If the patient did not mention "
    "something, OMIT it or set confidence 0. Never guess to seem helpful — a "
    "missing value is correct and expected."
)

PHRASE_SYSTEM_PROMPT = (
    "Rephrase this single intake question to be warm and clear for a non-medical "
    "patient. Do not add medical content, do not ask about anything other than the "
    "given variable, do not combine questions. Return only the rephrased question."
)

VOICE_SYSTEM_PROMPT = (
    "You are Omari, a warm but EFFICIENT AI care coordinator doing patient intake so "
    "they reach the right specialist. Think calm, competent nurse who respects the "
    "patient's time — not an over-apologetic chatbot. You are NOT a doctor: never "
    "give medical advice, interpret symptoms, suggest diagnoses, or comment on how "
    "serious or mild anything is (no \"I'm sure it's fine\", \"that sounds serious\", "
    "or \"this could be X\").\n\n"
    "You are given (1) the patient's last message and (2) the EXACT next question "
    "the engine chose. Rephrase that question as ONE short, natural sentence and "
    "return only that. Rules:\n"
    "- NEVER list, repeat, or hint at the answer options — the patient already sees "
    "them as clickable buttons. Ask the question ONLY. E.g. say \"What's bothering "
    "you the most?\" — NOT \"...pain, numbness, weakness, or a mix?\".\n"
    "- Do NOT add an acknowledgment before every question. Usually just ask it. "
    "Only occasionally, when the patient shared something genuinely notable, you may "
    "prepend a SHORT (max ~6 words) human acknowledgment. Never formulaic filler "
    "like \"thank you for sharing that\", \"I hear you\", or \"I know that's not easy\".\n"
    "- Keep it to one sentence, warm and plain. Do NOT change WHICH question is "
    "asked or invent new questions. No medical content, no preamble, no quotation "
    "marks.\n\n"
    "Return ONLY the message text."
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

        user_content = f'The question to ask the patient: "{question}"'
        if options:
            # Deliberately do NOT send the option text — the patient taps buttons,
            # so the reply must ask the question WITHOUT listing them.
            user_content += (
                "\n(The patient answers by tapping on-screen buttons — do NOT list, "
                "name, or hint at the options; ask the question only.)"
            )
        if last_patient_message and last_patient_message.strip():
            user_content += (
                f'\n\nThe patient just said: "{last_patient_message.strip()[:800]}"'
            )
        else:
            user_content += "\n\n(First question — no earlier message; just ask it in one short line.)"
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

    # ------------------------------------------------------------------
    # Generator jobs (tree-generator spec §6.1, jobs 1–3).
    # The LLM generates/classifies/phrases here — it NEVER authors routing
    # or workup logic. Induction, assembly, gap detection, and validation
    # are deterministic code operating on the surgeon's recorded decisions.
    # ------------------------------------------------------------------

    async def generate_cases(
        self,
        subspecialty: str,
        count: int = 5,
        variable_hints: Optional[list[str]] = None,
        roster: Optional[list[dict]] = None,
        minimal_pair_seed: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Job 1 — synthetic case generation (offline/curated; surgeon reviews
        before use). Returns [{narrative, groundTruth, variedVariable?}]."""
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        tool = {
            "name": "record_cases",
            "description": "Record the generated synthetic referral cases.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "cases": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "narrative": {
                                    "type": "string",
                                    "description": "The rich, messy, first-person-or-referral-note patient story (150-300 words).",
                                },
                                "groundTruth": {
                                    "type": "object",
                                    "description": "The clinical variables deliberately planted in the narrative, as snake_case keys with simple values.",
                                },
                                "variedVariable": {
                                    "type": "string",
                                    "description": "For minimal-pair cases only: the single variable flipped vs the seed case.",
                                },
                            },
                            "required": ["narrative", "groundTruth"],
                        },
                    }
                },
                "required": ["cases"],
            },
        }

        system = (
            "You write SYNTHETIC patient referral cases for eliciting a surgeon's "
            "routing and workup judgment. Cases must be clinically realistic, rich, "
            "and messy — the way real referrals read: buried salient facts, irrelevant "
            "detail, colloquial symptom descriptions, occasional red herrings. Every "
            "case is FICTIONAL; never reuse real patient details. Each case plants "
            "specific clinical variables (the groundTruth) INSIDE the narrative so a "
            "surgeon reading it can recognize them. Vary ages, presentations, durations, "
            "comorbidities (e.g. pacemakers, anticoagulants, prior surgery) — including "
            "facts that change the pre-visit WORKUP without changing WHO the patient "
            "should see, and vice versa. Do not state conclusions or diagnoses; the "
            "narrative shows, the surgeon decides."
        )

        user = f"Generate {count} synthetic referral cases for the subspecialty: {subspecialty}."
        if variable_hints:
            user += (
                "\n\nPlant (a varied subset of) these clinical variables across the cases, "
                f"as groundTruth keys: {', '.join(variable_hints)}. Add 2-4 further variables "
                "you judge clinically salient for this subspecialty, including at least one "
                "workup-only determinant (changes what should be done before the visit, not who sees them)."
            )
        if roster:
            names = ", ".join(f"{r.get('name')} ({r.get('specialty', '')})" for r in roster)
            user += (
                f"\n\nThe department roster (for coverage, NOT to mention in narratives): {names}. "
                "Ensure the case set plausibly spans the whole roster's territory plus 1-2 genuinely ambiguous cases."
            )
        if minimal_pair_seed:
            user += (
                "\n\nMINIMAL-PAIR MODE: each generated case must be a near-copy of this seed case "
                f"with exactly ONE clinically meaningful variable flipped (set variedVariable):\n"
                f"SEED NARRATIVE: {minimal_pair_seed.get('narrative', '')[:1500]}\n"
                f"SEED GROUND TRUTH: {minimal_pair_seed.get('ground_truth', {})}"
            )

        logger.info(f"[blume/gen-cases] → model={settings.ANTHROPIC_MODEL} · {count} cases · {subspecialty}")
        message = await self.client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=4096,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"], "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": user}],
        )
        tool_use = next((b for b in message.content if b.type == "tool_use"), None)
        cases = (tool_use.input if tool_use else {}).get("cases", [])
        logger.info(f"[blume/gen-cases] ✓ {len(cases)} cases")
        return cases

    async def classify_highlight(
        self,
        span_text: str,
        axis: str,
        known_variables: Optional[list[dict]] = None,
    ) -> dict[str, Any]:
        """Job 2 — fallback classifier for a highlighted span that didn't match
        the case's ground truth. Returns {key, label, valueSample}."""
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        tool = {
            "name": "record_variable",
            "description": "Record the clinical variable this highlighted phrase represents.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "snake_case variable key, e.g. symptom_duration"},
                    "label": {"type": "string", "description": "Short human label, e.g. 'Symptom duration'"},
                    "valueSample": {"type": "string", "description": "The value this span indicates, e.g. '8 months'"},
                },
                "required": ["key", "label", "valueSample"],
            },
        }
        system = (
            "You map a phrase a surgeon highlighted in a patient case to the clinical "
            "VARIABLE it represents. You classify only — you never decide routing or "
            "workup. Prefer reusing a known variable key when the phrase is another "
            "value of the same underlying fact; only mint a new snake_case key when "
            "none fits."
        )
        user = f'Highlighted phrase: "{span_text.strip()[:500]}"\nTagged axis: {axis}'
        if known_variables:
            listing = "\n".join(f"- {v.get('key')}: {v.get('label') or ''}" for v in known_variables[:40])
            user += f"\n\nKnown variable keys so far:\n{listing}"

        message = await self.client.messages.create(
            model=settings.ANTHROPIC_EXTRACT_MODEL or settings.ANTHROPIC_MODEL,
            max_tokens=256,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"], "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": user}],
        )
        tool_use = next((b for b in message.content if b.type == "tool_use"), None)
        return tool_use.input if tool_use else {}

    async def phrase_gap(self, kind: str, detail: dict[str, Any]) -> str:
        """Job 3 — phrase a deterministically-detected gap as one plain-language
        question for the surgeon. Phrasing only; detection already happened."""
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        system = (
            "You phrase ONE short, direct question to a surgeon about a hole detected "
            "in their draft referral tree. The gap was found by deterministic checks — "
            "you only put it into natural clinical language. Be specific and concrete, "
            "one sentence, no preamble, no hedging, no medical advice."
        )
        user = f"Gap kind: {kind}\nGap details (structured): {detail}"
        message = await self.client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=200,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text_block = next((b for b in message.content if b.type == "text"), None)
        return (text_block.text.strip().strip("\"'") if text_block else "") or ""


# Singleton instance
anthropic_service = AnthropicService()
