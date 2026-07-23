"""
Blume — Anthropic LLM service.

Wraps the Anthropic Python SDK for extraction, triage, voice, and phrase calls.
System prompts are ported from the original Express server (server/index.mjs).
"""
import json
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


# ---------------------------------------------------------------------------
# Builder assistant — exact per-op shapes for the tree_chat tool schema,
# mirroring the frontend Zod TreeOpSchema (frontend/src/lib/assistant/ops.ts),
# which remains the authoritative gate. Precise schemas here just stop the
# model from improvising field shapes the gate would reject.
# ---------------------------------------------------------------------------

_COND = {
    "type": "object",
    "properties": {
        "op": {"type": "string", "enum": ["equals", "range", "in"]},
        "value": {"description": "for op=equals: string | number | boolean"},
        "min": {"type": "number"},
        "max": {"type": "number"},
        "values": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["op"],
}
_KEYED_COND = {
    "type": "object",
    "properties": {
        **_COND["properties"],
        "key": {"type": "string", "description": "the variableKey this condition reads"},
    },
    "required": ["op", "key"],
}
_WORKUP_ITEM = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "canonical test name, e.g. 'EMG/NCS'"},
        "protocol": {"type": "string"},
        "rationale": {"type": "string"},
    },
    "required": ["name"],
}
_BRANCH = {
    "type": "object",
    "properties": {
        "label": {"type": "string"},
        "patientLabel": {"type": "string"},
        "condition": _COND,
        "nextNodeId": {"type": "string", "description": "target node id; omit to leave unwired"},
    },
    "required": ["label", "condition"],
}


def _op(name: str, props: dict, required: tuple = ()) -> dict:
    return {
        "type": "object",
        "properties": {"op": {"type": "string", "enum": [name]}, **props},
        "required": ["op", *required],
        "additionalProperties": False,
    }


_NODE_ID = {"type": "string", "description": "exact id of an existing node (or a placeholder id from an earlier add op)"}
_DATA_SOURCE = {"type": "string", "enum": ["patient", "referral", "record"]}
_URGENCY = {"type": "string", "enum": ["routine", "expedited", "urgent"]}

_TREE_CHAT_OP_ITEMS = {
    "anyOf": [
        _op("add_variable", {
            "id": {"type": "string", "description": "placeholder id, e.g. 'new_1'"},
            "variableKey": {"type": "string"},
            "prompt": {"type": "string"},
            "dataSource": _DATA_SOURCE,
            "branches": {"type": "array", "items": _BRANCH},
        }, ("variableKey", "prompt")),
        _op("add_specialist", {
            "id": {"type": "string"},
            "specialistName": {"type": "string"},
            "specialty": {"type": "string"},
            "urgency": _URGENCY,
            "reasoningTemplate": {"type": "string"},
            "workup": {"type": "array", "items": _WORKUP_ITEM, "description": "always-ordered pre-visit workup"},
        }, ("specialistName",)),
        _op("add_escalation", {
            "id": {"type": "string"},
            "reason": {"type": "string"},
        }, ("reason",)),
        _op("update_variable", {
            "nodeId": _NODE_ID,
            "variableKey": {"type": "string"},
            "prompt": {"type": "string"},
            "dataSource": _DATA_SOURCE,
        }, ("nodeId",)),
        _op("update_specialist", {
            "nodeId": _NODE_ID,
            "specialistName": {"type": "string"},
            "specialty": {"type": "string"},
            "urgency": _URGENCY,
            "reasoningTemplate": {"type": "string"},
        }, ("nodeId",)),
        _op("update_escalation", {
            "nodeId": _NODE_ID,
            "reason": {"type": "string"},
        }, ("nodeId",)),
        _op("add_branch", {
            "nodeId": _NODE_ID,
            "branch": _BRANCH,
        }, ("nodeId", "branch")),
        _op("update_branch", {
            "nodeId": _NODE_ID,
            "branchIndex": {"type": "integer"},
            "branchLabel": {"type": "string"},
            "label": {"type": "string"},
            "patientLabel": {"type": "string"},
            "condition": _COND,
            "nextNodeId": {"type": "string", "description": "new target node id; empty string unwires"},
        }, ("nodeId",)),
        _op("remove_branch", {
            "nodeId": _NODE_ID,
            "branchIndex": {"type": "integer"},
            "branchLabel": {"type": "string"},
        }, ("nodeId",)),
        _op("delete_node", {"nodeId": _NODE_ID}, ("nodeId",)),
        _op("set_root", {"nodeId": _NODE_ID}, ("nodeId",)),
        _op("add_workup_item", {
            "nodeId": _NODE_ID,
            "item": _WORKUP_ITEM,
        }, ("nodeId", "item")),
        _op("update_workup_item", {
            "nodeId": _NODE_ID,
            "name": {"type": "string", "description": "current item name"},
            "newName": {"type": "string"},
            "protocol": {"type": "string"},
            "rationale": {"type": "string"},
        }, ("nodeId", "name")),
        _op("remove_workup_item", {
            "nodeId": _NODE_ID,
            "name": {"type": "string"},
        }, ("nodeId", "name")),
        _op("add_workup_conditional", {
            "nodeId": _NODE_ID,
            "when": _KEYED_COND,
            "item": _WORKUP_ITEM,
            "reason": {"type": "string", "description": "why the visit is wasted without it, if stated"},
        }, ("nodeId", "when", "item")),
        _op("remove_workup_conditional", {
            "nodeId": _NODE_ID,
            "itemName": {"type": "string"},
        }, ("nodeId", "itemName")),
        _op("add_workup_guard", {
            "nodeId": _NODE_ID,
            "item": {"type": "string", "description": "test name this guard protects"},
            "requiredCondition": _KEYED_COND,
        }, ("nodeId", "item", "requiredCondition")),
        _op("remove_workup_guard", {
            "nodeId": _NODE_ID,
            "itemName": {"type": "string"},
        }, ("nodeId", "itemName")),
        _op("move_nodes", {
            "nodeIds": {
                "type": "array",
                "items": _NODE_ID,
                "minItems": 1,
                "description": "exact ids of the nodes to reposition on the canvas",
            },
            "placement": {
                "type": "string",
                "enum": ["top", "bottom", "left", "right"],
                "description": "which edge of the canvas to park them on, relative to the rest of the tree",
            },
        }, ("nodeIds", "placement")),
    ]
}


def _extract_streaming_message(buf: str) -> str:
    """Pull the (possibly unterminated) `message` string out of a PARTIAL
    tool-call JSON buffer, unescaping as we go. Lets the UI stream the reply
    text while the rest of the structured payload is still generating."""
    i = buf.find('"message"')
    if i == -1:
        return ""
    colon = buf.find(":", i + len('"message"'))
    if colon == -1:
        return ""
    j = buf.find('"', colon + 1)
    if j == -1:
        return ""
    out: list[str] = []
    k = j + 1
    escapes = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f"}
    while k < len(buf):
        c = buf[k]
        if c == "\\":
            if k + 1 >= len(buf):
                break  # escape split across chunks — wait for more
            nxt = buf[k + 1]
            if nxt == "u":
                if k + 5 >= len(buf):
                    break
                try:
                    out.append(chr(int(buf[k + 2 : k + 6], 16)))
                except ValueError:
                    pass
                k += 6
                continue
            out.append(escapes.get(nxt, nxt))
            k += 2
            continue
        if c == '"':
            break  # message value complete
        out.append(c)
        k += 1
    return "".join(out)


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
            parent_decision = minimal_pair_seed.get("parent_decision")
            if parent_decision:
                dest = (
                    "escalated for their own review"
                    if parent_decision.get("escalated")
                    else f"routed to {parent_decision.get('routedTo', '?')}"
                )
                wu = ", ".join(parent_decision.get("workup") or []) or "no pre-visit tests"
                user += (
                    f"\n\nBOUNDARY TARGETING: the surgeon {dest} with workup: {wu}. "
                    "Do NOT flip variables at random — pick the single flips MOST LIKELY to "
                    "change that decision (push a variable across a plausible clinical "
                    "boundary: a mass appearing, an implanted device, a red-flag onset, an "
                    "age or duration crossing a threshold, a test result flipping). You are "
                    "manufacturing probes near the decision boundary; you never predict or "
                    "state what the new decision should be."
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

    async def decompose_highlight(
        self,
        span_text: str,
        axis: str,
        known_variables: Optional[list[dict]] = None,
        already_found: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        """Job 2 — decompose a highlighted span into the DISTINCT clinical
        variables inside it. Proposes only; the surgeon curates the result and
        the deterministic ground-truth matches always win key collisions.

        Returns [{key, label, value, spanText, axis, confidence}]."""
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        tool = {
            "name": "record_observations",
            "description": "Record every distinct clinical variable present in the highlighted phrase.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "observations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "key": {"type": "string", "description": "snake_case variable key, e.g. symptom_duration_months"},
                                "label": {"type": "string", "description": "Short human label, e.g. 'Symptom duration'"},
                                "value": {"type": "string", "description": "The value this span indicates, e.g. '8 months' or 'right'"},
                                "spanText": {"type": "string", "description": "The exact sub-phrase of the highlight this observation comes from."},
                                "axis": {
                                    "type": "string",
                                    "enum": ["routing", "workup", "both"],
                                    "description": "Suggested axis for THIS variable (advisory; the surgeon's tag governs).",
                                },
                                "confidence": {"type": "number", "description": "0-1"},
                            },
                            "required": ["key", "label", "value", "spanText"],
                        },
                    }
                },
                "required": ["observations"],
            },
        }
        system = (
            "A surgeon highlighted a phrase in a patient case. Identify EACH DISTINCT "
            "CLINICAL CONCEPT in it as its own variable observation. You classify only — "
            "you never decide routing or workup.\n\n"
            "THE RULE THAT MUST NOT BE BROKEN: decompose into distinct clinical concepts, "
            "NOT into tokens. Tokens that a clinician reads as one concept are ONE "
            "variable — e.g. 'thumb, index, and middle fingers' is a single symptom "
            "DISTRIBUTION (a median-nerve pattern), never three variables. Do not "
            "over-split; when in doubt, group.\n\n"
            "Example: '8 months he's had numbness and tingling in the right thumb, index "
            "and middle fingers' → four observations: symptom duration (8 months), "
            "laterality (right), symptom type (numbness/tingling), symptom distribution "
            "(thumb/index/middle fingers).\n\n"
            "Prefer reusing known variable keys when a sub-phrase is another value of the "
            "same underlying fact; only mint a new snake_case key when none fits. Skip "
            "concepts already captured (listed as already-found). Each spanText must be "
            "an exact substring of the highlight."
        )
        user = f'Highlighted phrase: "{span_text.strip()[:600]}"\nSurgeon tagged the whole highlight as axis: {axis}'
        if already_found:
            user += f"\n\nAlready captured deterministically (do NOT repeat): {', '.join(already_found)}"
        if known_variables:
            listing = "\n".join(f"- {v.get('key')}: {v.get('label') or ''}" for v in known_variables[:40])
            user += f"\n\nKnown variable keys so far:\n{listing}"

        message = await self.client.messages.create(
            model=settings.ANTHROPIC_EXTRACT_MODEL or settings.ANTHROPIC_MODEL,
            max_tokens=1024,
            temperature=0,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"], "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": user}],
        )
        tool_use = next((b for b in message.content if b.type == "tool_use"), None)
        return (tool_use.input if tool_use else {}).get("observations", [])

    async def ingest_referrals(
        self,
        subspecialty: str,
        letters_text: str,
    ) -> list[dict[str, Any]]:
        """Job 4 — convert DE-IDENTIFIED real referral letters into synthetic
        cases. This attacks the R1 case-quality bottleneck: real letters carry
        the messiness and tacit variables from-scratch generation can't invent.
        The model TRANSLATES (letter → case format); it decides nothing.

        Each case is REWRITTEN, never copied, and stripped of any residual
        identifying detail. Callers must only pass de-identified text; until a
        BAA is in place nothing containing PHI may reach this method.
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        tool = {
            "name": "record_cases",
            "description": "Record the synthetic cases derived from the referral letters.",
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
                                    "description": "The REWRITTEN case narrative (150-300 words) — same clinical content, new wording, zero identifying details.",
                                },
                                "groundTruth": {
                                    "type": "object",
                                    "description": "Every clinical variable present in the letter, as snake_case keys with simple values.",
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
            "You convert DE-IDENTIFIED clinical referral letters into synthetic "
            "elicitation cases. For each distinct letter in the input: REWRITE the "
            "clinical story in fresh wording (never copy sentences), preserve every "
            "clinically meaningful fact — symptoms, duration, laterality, distribution, "
            "prior tests and their results, comorbidities, devices, medications, "
            "failed treatments, occupation when clinically relevant — and plant each "
            "such fact as a groundTruth variable (snake_case key, simple value). "
            "REMOVE or genericize anything identifying: names, exact dates, "
            "institutions, locations, unusual occupations that could identify someone. "
            "You translate format only; you never add clinical facts that are not in "
            "the letter and never draw conclusions from them."
        )
        user = (
            f"Subspecialty: {subspecialty}\n\nDe-identified referral letters "
            f"(one or more, separated by blank lines or dashes):\n\n{letters_text.strip()[:12000]}"
        )
        logger.info(f"[blume/gen-ingest] → model={settings.ANTHROPIC_MODEL} · {len(letters_text)} chars")
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
        logger.info(f"[blume/gen-ingest] ✓ {len(cases)} cases")
        return cases

    async def check_consistency(
        self,
        decisions: list[dict[str, Any]],
        roster: Optional[list[dict]] = None,
    ) -> list[dict[str, Any]]:
        """Job 5 — Layer 2 live coaching: flag pairs of clinically similar
        cases the surgeon decided DIFFERENTLY. Advisory only — the surgeon
        resolves every flag (there may be a real distinction the system can't
        see); nothing here touches the induced logic.

        decisions: [{caseId, summary, routedTo, escalated, workup: [names],
        wouldNotOrder: [names]}]. Returns [{caseIds: [a, b], concern}].
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        tool = {
            "name": "record_flags",
            "description": "Record possible inconsistencies between the surgeon's case decisions.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "flags": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "caseIds": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "The 2+ case ids that appear inconsistent.",
                                },
                                "concern": {
                                    "type": "string",
                                    "description": "One sentence: what looks similar and what was decided differently. Phrased as a question to the surgeon, never an accusation.",
                                },
                            },
                            "required": ["caseIds", "concern"],
                        },
                    }
                },
                "required": ["flags"],
            },
        }
        system = (
            "You review a surgeon's routing and workup decisions across referral "
            "cases during an elicitation session. Flag decisions that look "
            "inconsistent: (a) clinically similar cases decided differently — "
            "different specialist, or materially different pre-visit workup — or "
            "(b) a case routed to a specialist whose stated focus doesn't plausibly "
            "cover that presentation. Phrase each flag as a short, respectful "
            "question ('cases X and Y both describe …, but one went to A and the "
            "other to B — is there a distinction, or was one a slip?'). There may "
            "well be a real distinction you cannot see — you surface, the surgeon "
            "decides. If nothing looks inconsistent, return an empty list. Never "
            "flag more than 3 concerns; pick the clearest."
        )
        lines = []
        if roster:
            lines.append(
                "The department roster: "
                + "; ".join(f"{r.get('name')} — {r.get('specialty') or 'unspecified focus'}" for r in roster)
            )
            lines.append("")
        for d in decisions:
            dest = "ESCALATE (see myself)" if d.get("escalated") else d.get("routedTo", "?")
            wu = ", ".join(d.get("workup") or []) or "none"
            refuse = ", ".join(d.get("wouldNotOrder") or [])
            line = f"- case {d.get('caseId')}: {d.get('summary', '')[:220]} → {dest}; workup: {wu}"
            if refuse:
                line += f"; would NOT order: {refuse}"
            lines.append(line)
        user = "The surgeon's decisions so far:\n" + "\n".join(lines)

        message = await self.client.messages.create(
            model=settings.ANTHROPIC_EXTRACT_MODEL or settings.ANTHROPIC_MODEL,
            max_tokens=600,
            temperature=0,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"], "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": user}],
        )
        tool_use = next((b for b in message.content if b.type == "tool_use"), None)
        return (tool_use.input if tool_use else {}).get("flags", [])

    async def structure_workup(
        self,
        text: str,
        known_tests: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Job 6 — normalize the surgeon's free-text workup description into
        structured items. Strictly a transcription aid: it must NEVER add a
        test the surgeon didn't imply, and explicit refusals become
        wouldNotOrder entries. The surgeon confirms/edits every row.

        Returns {items: [{name, protocol, rationale}], wouldNotOrder: [str]}.
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        tool = {
            "name": "record_workup",
            "description": "Record the structured pre-visit workup the surgeon described.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Canonical test name, e.g. 'EMG/NCS', 'MRI brachial plexus'"},
                                "protocol": {"type": "string", "description": "Protocol/sequence detail if the surgeon gave any, else empty."},
                                "rationale": {"type": "string", "description": "Why, in the surgeon's words, if stated; else empty."},
                                "conditionalHint": {
                                    "type": "string",
                                    "description": "If the surgeon phrased this test conditionally ('MRI only if there's a mass'), the stated condition verbatim-ish. Captured as a LEAD for later induction to confirm — never as logic. Empty when unconditional.",
                                },
                            },
                            "required": ["name"],
                        },
                    },
                    "wouldNotOrder": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Tests the surgeon EXPLICITLY said they would not order here.",
                    },
                },
                "required": ["items", "wouldNotOrder"],
            },
        }
        system = (
            "You transcribe a surgeon's free-text description of pre-visit workup "
            "into structured orders. STRICT RULES: include ONLY tests the surgeon's "
            "words state or clearly imply ('get nerves tested' → EMG/NCS); NEVER add "
            "a test from your own medical knowledge; explicit refusals or 'I'd hold "
            "off on X' go in wouldNotOrder, not items; conditional phrasing ('MRI if "
            "there's a mass') still lists the test — the condition is elicited from "
            "case decisions, not from you. Use canonical test names. You transcribe; "
            "you never prescribe."
        )
        user = f'The surgeon said: "{text.strip()[:1200]}"'
        if known_tests:
            user += f"\n\nTest names already used in this session (reuse exact spellings when they match): {', '.join(known_tests[:30])}"

        message = await self.client.messages.create(
            model=settings.ANTHROPIC_EXTRACT_MODEL or settings.ANTHROPIC_MODEL,
            max_tokens=600,
            temperature=0,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": tool["name"], "disable_parallel_tool_use": True},
            messages=[{"role": "user", "content": user}],
        )
        tool_use = next((b for b in message.content if b.type == "tool_use"), None)
        out = tool_use.input if tool_use else {}
        return {"items": out.get("items", []), "wouldNotOrder": out.get("wouldNotOrder", [])}

    # ------------------------------------------------------------------
    # CPG-to-tree extraction — section-level node extraction.
    # The LLM reads a CPG section and produces structured decision-tree
    # nodes in the Omari NodeIn schema.  It extracts ONLY what the text
    # states — no routing, no invented thresholds, no workup the text
    # doesn't mention.
    # ------------------------------------------------------------------

    async def cpg_extract_section(
        self,
        section_text: str,
        section_name: str,
        subspecialty: str,
        existing_variable_keys: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Extract decision tree nodes from a single CPG section.

        Returns a list of node dicts compatible with the Omari NodeIn schema.
        Each node is a variable (with multi-branch conditions), a placeholder
        specialist endpoint, or an escalation node.
        """
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        tool = {
            "name": "record_cpg_nodes",
            "description": (
                "Record the decision tree nodes extracted from the clinical "
                "practice guideline section.  Each node represents a clinical "
                "decision point, an action endpoint, or an escalation."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "analysis": {
                        "type": "string",
                        "description": "Chain-of-thought analysis of the clinical scenarios. Identify the key variables, conditions, and actions before attempting to structure them into nodes."
                    },
                    "nodes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": (
                                        "Short unique id for this node within "
                                        "the section, e.g. 'psa_check', 'dre_eval'."
                                    ),
                                },
                                "type": {
                                    "type": "string",
                                    "enum": ["variable", "specialist", "escalation"],
                                    "description": (
                                        "variable: a clinical question/decision point. "
                                        "specialist: an action endpoint (placeholder — "
                                        "the clinician assigns the real specialist). "
                                        "escalation: a safety-net or complex-case flag."
                                    ),
                                },
                                "variableKey": {
                                    "type": "string",
                                    "description": (
                                        "snake_case key for the clinical variable, "
                                        "e.g. 'psa_level', 'has_bone_pain'. "
                                        "Only for type=variable."
                                    ),
                                },
                                "prompt": {
                                    "type": "string",
                                    "description": (
                                        "A patient-facing question derived from the "
                                        "guideline, e.g. 'Are you experiencing bone pain?'. "
                                        "Only for type=variable."
                                    ),
                                },
                                "branches": {
                                    "type": "array",
                                    "description": "Only for type=variable.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {
                                                "type": "string",
                                                "description": "Clinical label, e.g. 'PSA > 10'.",
                                            },
                                            "patientLabel": {
                                                "type": "string",
                                                "description": (
                                                    "Patient-friendly label, e.g. "
                                                    "'Your PSA is above 10'."
                                                ),
                                            },
                                            "condition": {
                                                "type": "object",
                                                "properties": {
                                                    "op": {
                                                        "type": "string",
                                                        "enum": ["equals", "range", "in"],
                                                    },
                                                    "value": {
                                                        "description": (
                                                            "For op=equals: a string, "
                                                            "number, or boolean."
                                                        ),
                                                    },
                                                    "min": {"type": "number"},
                                                    "max": {"type": "number"},
                                                    "values": {
                                                        "type": "array",
                                                        "items": {"type": "string"},
                                                    },
                                                },
                                                "required": ["op"],
                                            },
                                            "nextNodeId": {
                                                "type": "string",
                                                "description": (
                                                    "id of the next node this branch "
                                                    "leads to.  Use another node's id "
                                                    "from this section, or a descriptive "
                                                    "placeholder like 'action_dre_psa' "
                                                    "for endpoints."
                                                ),
                                            },
                                        },
                                        "required": ["label", "condition", "nextNodeId"],
                                    },
                                },
                                "specialistName": {
                                    "type": "string",
                                    "description": (
                                        "For type=specialist: a short description of "
                                        "the clinical action, e.g. 'DRE + PSA testing'. "
                                        "NOT a person's name — the clinician fills that in."
                                    ),
                                },
                                "specialty": {
                                    "type": "string",
                                    "description": "For type=specialist: clinical area.",
                                },
                                "reason": {
                                    "type": "string",
                                    "description": "For type=escalation: why escalation is needed.",
                                },
                                "clinicalBasis": {
                                    "type": "string",
                                    "description": (
                                        "The exact CPG text or recommendation this "
                                        "node is derived from. Include the recommendation "
                                        "number if present."
                                    ),
                                },
                            },
                            "required": ["id", "type"],
                        },
                    },
                },
                "required": ["analysis", "nodes"],
            },
        }

        system = (
            "You extract decision tree nodes from a Clinical Practice Guideline "
            "(CPG) section.  You are a structured-data extractor — you capture "
            "EXACTLY what the guideline states, nothing more.\n\n"
            "RULES:\n"
            "- Each clinical decision point becomes a 'variable' node with a "
            "snake_case variableKey and a patient-facing prompt.\n"
            "- Use MULTI-BRANCH nodes when the guideline implies more than two "
            "outcomes (e.g. 'PSA < 4, PSA 4-10, PSA > 10' is one variable node "
            "with three branches using op=range).\n"
            "- When the guideline says to perform a test, order imaging, or refer, "
            "create a 'specialist' node as a PLACEHOLDER endpoint — set "
            "specialistName to the action description, NOT a person's name.\n"
            "- When the guideline mentions red flags, emergency criteria, or "
            "'urgent referral', create an 'escalation' node.\n"
            "- Wire branches to the next logical decision point using nextNodeId. "
            "If the branch leads to an action, point it to the placeholder "
            "specialist/escalation node.\n"
            "- NEVER invent thresholds, cutoffs, or clinical logic not stated in "
            "the text.  If the guideline says 'elevated PSA' without defining a "
            "number, use op=equals with value='elevated' — do not guess '> 4'.\n"
            "- Populate clinicalBasis on every node with the exact text or "
            "recommendation number the node is derived from.\n"
            "- Reuse existing variable keys when the same clinical concept appears "
            "across sections.\n"
            "- CRITICAL: Even if the guidelines are vague, formatted as a list, or use implied tabular logic instead of strict if/then statements, you MUST extract the core clinical criteria as decision nodes.\n"
            "- CRITICAL: If the provided text is merely a cover page, title, or introduction with absolutely no actionable clinical criteria or recommendations, you MUST return an empty array `[]` for `nodes`.\n"
            "- Use the 'analysis' field to write out a step-by-step interpretation of the scenarios before structuring the nodes."
        )

        user = (
            f"Subspecialty: {subspecialty}\n"
            f"Section: {section_name}\n\n"
            f"Guideline text:\n{section_text.strip()[:8000]}"
        )
        if existing_variable_keys:
            user += (
                "\n\nVariable keys already used in earlier sections (reuse when "
                f"the same concept appears): {', '.join(existing_variable_keys[:50])}"
            )

        logger.info(
            f"[blume/cpg-extract] → section='{section_name}' · "
            f"{len(section_text)} chars · model={settings.ANTHROPIC_MODEL}"
        )
        message = await self.client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=4096,
            temperature=0,
            system=system,
            tools=[tool],
            tool_choice={
                "type": "tool",
                "name": tool["name"],
                "disable_parallel_tool_use": True,
            },
            messages=[{"role": "user", "content": user}],
        )
        tool_use = next(
            (b for b in message.content if b.type == "tool_use"), None
        )
        if tool_use:
            analysis = tool_use.input.get("analysis", "No analysis provided.")
            logger.warning(f"[blume/cpg-extract] Claude Analysis for '{section_name}':\n{analysis}")
            
        nodes = (tool_use.input if tool_use else {}).get("nodes", [])
        logger.info(f"[blume/cpg-extract] ✓ {len(nodes)} nodes from '{section_name}'")
        return nodes

    # ------------------------------------------------------------------
    # Builder assistant — conversational tree editing.
    # The model TRANSLATES the clinician's stated edits into bounded tree
    # operations, answers questions about the tree, and surfaces the
    # deterministic warnings. It NEVER supplies clinical content the
    # clinician didn't state, and it never applies anything: operations are
    # proposals the Builder diffs and the clinician confirms.
    # ------------------------------------------------------------------

    TREE_CHAT_SYSTEM = (
        "You are Sprout, the Builder assistant inside Blume, helping a clinician "
        "edit their referral decision tree conversationally. You are a scribe and a "
        "navigator — NEVER a clinical author. If asked who or what you are: you're "
        "Sprout, the tree-editing assistant; you draft changes for the clinician's "
        "approval and never make clinical decisions.\n\n"
        "THE HARD RULE: every clinical decision in this tree — which specialist a "
        "path routes to, what urgency, what pre-visit workup, what thresholds or "
        "cutoffs, how patients are branched — belongs to the clinician. You only "
        "transcribe decisions they have stated in this conversation.\n\n"
        "Choose the mode:\n"
        "- propose: the clinician stated a concrete edit ('add a below-knee branch "
        "routing to Dr. Chen with an EMG', 'move plexus cases from Chen to Gooch', "
        "'delete the dead-end node'). Translate it into the SMALLEST set of "
        "operations that does exactly what they said — nothing extra, no embellished "
        "protocols or rationales they didn't give. `message` is ONE short sentence "
        "naming what you drafted — the app shows the exact diff underneath, so never "
        "restate or re-list the changes.\n"
        "- clarify: the instruction is missing a CLINICAL decision ('add a node for "
        "diabetic patients' — routed where? with what workup?). Ask ONLY for the "
        "missing decisions — each as one short question on its own line, at most "
        "three, no preamble and no sign-off. Do NOT fill clinical blanks with "
        "defaults. Structural blanks are fine to leave (a new bucket may be unwired; "
        "a specialist may start with no workup) WHEN the clinician's request implies "
        "they'll wire it later — but never invent its clinical content.\n"
        "- decline: they asked YOU to make a clinical judgment ('what workup should "
        "cubital tunnel get?', 'who should these patients see?', 'is 50 the right "
        "age cutoff?'). Do not answer from medical knowledge, even partially. One or "
        "two sentences: that call is theirs; tell me the decision and I'll draft it. "
        "No apologies, no lectures.\n"
        "- answer: a question about the tree as it stands ('which paths reach Dr. "
        "Chen?', 'where is no workup specified?'). Answer ONLY from the tree JSON "
        "and structural warnings provided — describing what the tree already says "
        "is fine; recommending what it should say is not.\n\n"
        "FOLLOW-THROUGH: when your previous turn asked about a specific node, "
        "bucket, or gap and the clinician's next message answers it, draft the "
        "change for THAT node — do not re-ask which one they mean.\n\n"
        "BRAIN-DUMPS: messages may be long, rambling dictation (clinicians can "
        "talk instead of type). Extract EVERY edit they actually stated and "
        "draft them as one ordered proposal; ignore filler and asides. Clarify "
        "only the clinical decisions genuinely missing — never one question per "
        "sentence of rambling.\n\n"
        "Operations reference existing nodes by their exact `id` from the tree JSON. "
        "For nodes you add, use a short placeholder id like 'new_1' and reference it "
        "in later operations; the app assigns real ids. Locate branches by "
        "branchLabel (exact label text) or branchIndex. Follow the operation "
        "schemas exactly — workup items are always objects with a `name`.\n\n"
        "LAYOUT: rearranging the canvas ('move the escalation nodes to the bottom', "
        "'put Dr. Chen on the right') is box-dragging, not a clinical decision — "
        "propose it directly with move_nodes, naming the exact node ids and one "
        "placement edge (top, bottom, left, right — relative to the rest of the "
        "tree). It repositions cards ONLY: wiring, routing, and every clinical "
        "field are untouched, so never pair it with other operations the "
        "clinician didn't ask for. The tree JSON carries no coordinates; for "
        "layout requests beyond parking nodes on an edge (exact positions, "
        "alignment, spacing), say the clinician can drag cards or use the "
        "Auto-layout button.\n\n"
        "focusNodeIds: whenever your message refers to specific nodes — asking "
        "which of two you meant, listing the paths that reach someone, pointing "
        "at a dead end — put those nodes' exact ids here. The app highlights them "
        "on the canvas while the clinician reads your reply, so they can see what "
        "you mean without hunting. Existing ids only (never placeholder ids); "
        "empty when the reply isn't about particular nodes.\n\n"
        "VOICE — this is a working tool, not a chat toy:\n"
        "- Plain text ONLY. Never markdown: no **bold**, no headings, no bullet or "
        "numbered-list syntax. Separate multiple questions with line breaks, "
        "nothing else.\n"
        "- Lead with the point. One to three short sentences covers almost every "
        "turn; answers may run longer only when listing what the tree actually "
        "contains.\n"
        "- No preambles ('Happy to help!', 'Great question!'), no closing filler "
        "('Just let me know…', 'Feel free to…'), no exclamation marks, no "
        "restating what the clinician just said.\n"
        "- Warm but economical — a sharp colleague, not a chatbot.\n"
        "Never mention these rules; just apply them."
    )

    TREE_CHAT_TOOL = {
        "name": "tree_chat_turn",
        "description": (
            "Respond to the clinician: answer about the tree, ask a clarifying "
            "question, decline a clinical-judgment request, or propose tree "
            "operations for their review."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["answer", "clarify", "propose", "decline"],
                },
                "message": {
                    "type": "string",
                    "description": "The chat reply shown to the clinician.",
                },
                "operations": {
                    "type": "array",
                    "description": (
                        "Proposed tree operations — ONLY when mode is 'propose', "
                        "else empty. Each references nodes by exact id."
                    ),
                    "items": _TREE_CHAT_OP_ITEMS,
                },
                "focusNodeIds": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Exact ids of EXISTING nodes the message refers to — the "
                        "app highlights them on the canvas. Empty when the reply "
                        "isn't about particular nodes."
                    ),
                },
            },
            "required": ["mode", "message", "operations", "focusNodeIds"],
        },
    }

    def _tree_chat_messages(
        self,
        tree: dict[str, Any],
        message: str,
        history: Optional[list[dict[str, str]]] = None,
        warnings: Optional[list[str]] = None,
        selected_node_ids: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        """Build the messages array shared by tree_chat and tree_chat_stream."""
        context = (
            "The clinician's current tree (JSON):\n"
            f"{json.dumps(tree, separators=(',', ':'))[:60000]}"
        )
        if warnings:
            context += "\n\nCurrent structural warnings (deterministic checks):\n" + "\n".join(
                f"- {w}" for w in warnings[:30]
            )
        if selected_node_ids:
            context += (
                "\n\nSELECTION: the clinician has selected these nodes on the canvas: "
                + ", ".join(selected_node_ids[:40])
                + ". Words like 'these', 'this one', 'the selected nodes' refer to "
                "them. Scope answers and edits to the selection unless the message "
                "clearly reaches beyond it — no need to ask which nodes they mean."
            )

        messages: list[dict[str, Any]] = []
        for turn in (history or [])[-12:]:
            role = turn.get("role")
            content = (turn.get("content") or "").strip()
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
        # Merge consecutive same-role turns defensively (API requires alternation).
        merged: list[dict[str, Any]] = []
        for m in messages:
            if merged and merged[-1]["role"] == m["role"]:
                merged[-1]["content"] += "\n" + m["content"]
            else:
                merged.append(m)
        if merged and merged[0]["role"] == "assistant":
            merged.pop(0)
        merged.append({"role": "user", "content": f"{context}\n\nThe clinician says: {message.strip()[:4000]}"})
        return merged

    @staticmethod
    def _tree_chat_payload(out: dict[str, Any]) -> dict[str, Any]:
        """Normalize the tool output into the pinned response shape."""
        mode = out.get("mode", "answer")
        operations = out.get("operations") or []
        if mode != "propose":
            operations = []  # no back-channel: only an explicit proposal carries ops
        # Presentation-only: ids the reply talks about, for canvas highlighting.
        # The frontend drops any that don't exist on the canvas.
        focus = [x for x in (out.get("focusNodeIds") or []) if isinstance(x, str)]
        return {
            "mode": mode,
            "message": (out.get("message") or "").strip(),
            "operations": operations,
            "focusNodeIds": focus,
        }

    async def tree_chat(
        self,
        tree: dict[str, Any],
        message: str,
        history: Optional[list[dict[str, str]]] = None,
        warnings: Optional[list[str]] = None,
        selected_node_ids: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Builder assistant turn. Returns {mode, message, operations} —
        operations are PROPOSALS the Builder validates, diffs, and gates on
        the clinician's confirm. This method never mutates anything."""
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        merged = self._tree_chat_messages(tree, message, history, warnings, selected_node_ids)
        logger.info(f"[blume/tree-chat] → model={settings.ANTHROPIC_MODEL} · {len(merged)} turns")
        response = await self.client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=3000,
            temperature=0,
            system=self.TREE_CHAT_SYSTEM,
            tools=[self.TREE_CHAT_TOOL],
            tool_choice={"type": "tool", "name": "tree_chat_turn", "disable_parallel_tool_use": True},
            messages=merged,
        )
        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        payload = self._tree_chat_payload(tool_use.input if tool_use else {})
        logger.info(
            f"[blume/tree-chat] ✓ mode={payload['mode']} · {len(payload['operations'])} ops · {len(payload['focusNodeIds'])} focus"
        )
        return payload

    async def tree_chat_stream(
        self,
        tree: dict[str, Any],
        message: str,
        history: Optional[list[dict[str, str]]] = None,
        warnings: Optional[list[str]] = None,
        selected_node_ids: Optional[list[str]] = None,
    ):
        """Streaming tree_chat. Yields {'type':'delta','text':…} increments of
        the reply's `message` field as the model generates it (extracted from
        the partial tool-call JSON), then {'type':'done', …payload…}. Same
        confirm-gate payload as tree_chat — streaming changes latency, not
        authority."""
        if not self.client:
            raise RuntimeError("Anthropic API key not configured.")

        merged = self._tree_chat_messages(tree, message, history, warnings, selected_node_ids)
        logger.info(f"[blume/tree-chat-stream] → model={settings.ANTHROPIC_MODEL} · {len(merged)} turns")
        partial = ""
        emitted = 0
        async with self.client.messages.stream(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=3000,
            temperature=0,
            system=self.TREE_CHAT_SYSTEM,
            tools=[self.TREE_CHAT_TOOL],
            tool_choice={"type": "tool", "name": "tree_chat_turn", "disable_parallel_tool_use": True},
            messages=merged,
        ) as stream:
            async for event in stream:
                if event.type == "content_block_delta" and getattr(event.delta, "type", "") == "input_json_delta":
                    partial += event.delta.partial_json
                    msg = _extract_streaming_message(partial)
                    if len(msg) > emitted:
                        yield {"type": "delta", "text": msg[emitted:]}
                        emitted = len(msg)
            final = await stream.get_final_message()
        tool_use = next((b for b in final.content if b.type == "tool_use"), None)
        payload = self._tree_chat_payload(tool_use.input if tool_use else {})
        logger.info(
            f"[blume/tree-chat-stream] ✓ mode={payload['mode']} · {len(payload['operations'])} ops"
        )
        yield {"type": "done", **payload}

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
