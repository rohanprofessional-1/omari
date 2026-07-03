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
