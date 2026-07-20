"""Knowledge-base ingestion helpers.

This module extracts text from uploaded documents, scores the content against a
tree's routing context, and optionally asks Anthropic to compress the relevant
sections into a concise clinic knowledge summary.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import tempfile
from dataclasses import dataclass
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any

from ebooklib import ITEM_DOCUMENT, epub
from pypdf import PdfReader

from app.core.config import settings
from app.models.tree import Tree
from app.services.anthropic import anthropic_service

logger = logging.getLogger(__name__)

MAX_CHUNK_CHARS = 3200
MAX_SELECTED_CHARS = 14000
MAX_KEY_POINTS = 6
MAX_QUOTES = 6

STOPWORDS = {
    "about",
    "after",
    "again",
    "also",
    "because",
    "been",
    "before",
    "being",
    "between",
    "could",
    "does",
    "during",
    "each",
    "from",
    "have",
    "into",
    "last",
    "more",
    "most",
    "only",
    "other",
    "over",
    "patient",
    "since",
    "than",
    "that",
    "their",
    "there",
    "these",
    "they",
    "through",
    "time",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
}


class _HTMLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self.parts.append(text)

    def get_text(self) -> str:
        return " ".join(self.parts)


@dataclass(slots=True)
class TreeContext:
    tree_name: str
    tree_description: str
    specialist_lines: list[str]
    diagnosis_lines: list[str]
    workup_lines: list[str]
    focus_terms: list[str]


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _strip_html(html: str) -> str:
    parser = _HTMLStripper()
    parser.feed(html)
    return _normalize(parser.get_text())


def _chunk_text(text: str, *, size: int = MAX_CHUNK_CHARS) -> list[str]:
    text = _normalize(text)
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            boundary = text.rfind("\n\n", start, end)
            if boundary == -1:
                boundary = text.rfind(". ", start, end)
            if boundary > start + size // 2:
                end = boundary + 2
        chunks.append(text[start:end].strip())
        start = end
    return [chunk for chunk in chunks if chunk]


def _tokenize(text: str) -> set[str]:
    tokens = set()
    for token in re.findall(r"[a-z0-9][a-z0-9\-]{2,}", text.lower()):
        if token not in STOPWORDS:
            tokens.add(token)
    return tokens


def _phrase_terms(text: str) -> list[str]:
    terms: list[str] = []
    for piece in re.split(r"[;\n,/]", text):
        cleaned = _normalize(piece)
        if len(cleaned) >= 4:
            terms.append(cleaned)
    return terms


def _is_likely_diagnosis_like(text: str) -> bool:
    lower = text.lower()
    signals = (
        "syndrome",
        "nerve",
        "fracture",
        "disorder",
        "tendon",
        "arthritis",
        "compression",
        "injury",
        "pain",
        "weakness",
        "numbness",
        "tingling",
        "lump",
        "mass",
        "stiffness",
        "contracture",
        "tumor",
        "cyst",
        "trauma",
        "paralysis",
    )
    return any(signal in lower for signal in signals)


def _extract_text_from_pdf(data: bytes) -> str:
    reader = PdfReader(BytesIO(data))
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            continue
    return _normalize("\n".join(pages))


def _extract_text_from_epub(data: bytes) -> str:
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".epub") as temp_file:
            temp_file.write(data)
            temp_path = Path(temp_file.name)

        book = epub.read_epub(str(temp_path))
        sections: list[str] = []
        for item in book.get_items_of_type(ITEM_DOCUMENT):
            raw = item.get_content().decode("utf-8", errors="ignore")
            sections.append(_strip_html(raw))
        return _normalize("\n".join(sections))
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def _extract_text_from_bytes(filename: str, content_type: str | None, data: bytes) -> tuple[str, str]:
    suffix = Path(filename).suffix.lower()
    mime = (content_type or "").lower()

    if suffix == ".pdf" or mime == "application/pdf":
        return "pdf", _extract_text_from_pdf(data)
    if suffix == ".epub" or mime in {"application/epub+zip", "application/octet-stream"}:
        return "epub", _extract_text_from_epub(data)

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1", errors="ignore")
    if suffix in {".html", ".htm"}:
        return "html", _strip_html(text)
    return suffix.lstrip(".") or "text", _normalize(text)


def _collect_tree_context(tree: Tree) -> TreeContext:
    specialist_lines: list[str] = []
    diagnosis_lines: list[str] = []
    workup_lines: list[str] = []
    focus_terms: list[str] = []
    seen_terms: set[str] = set()

    def add_terms(*values: str | None) -> None:
        for value in values:
            if not value:
                continue
            for term in _phrase_terms(value):
                lowered = term.lower()
                if lowered not in seen_terms:
                    seen_terms.add(lowered)
                    focus_terms.append(term)

    for node in tree.nodes:
        if node.node_type == "specialist":
            line = ", ".join(
                part
                for part in [
                    node.specialist_name,
                    node.specialty,
                    node.urgency.value if node.urgency else None,
                    node.clinical_basis,
                ]
                if part
            )
            specialist_lines.append(line)
            add_terms(node.specialist_name, node.specialty, node.reasoning_template, node.clinical_basis)
            for workup in node.workup_items:
                workup_lines.append(
                    f"{node.specialist_name or node.specialty or node.id}: {workup.name}"
                    + (f" — {workup.rationale}" if workup.rationale else "")
                )
                add_terms(workup.name, workup.protocol, workup.rationale)

        if node.node_type == "variable":
            add_terms(node.variable_key, node.prompt)
            for branch in node.branches:
                add_terms(branch.label, branch.patient_label)
                if branch.condition:
                    if branch.condition.condition_type == "equals" and branch.condition.value_string:
                        add_terms(branch.condition.value_string)
                    elif branch.condition.condition_type == "in" and branch.condition.values_list:
                        try:
                            values = json.loads(branch.condition.values_list)
                        except Exception:
                            values = []
                        if isinstance(values, list):
                            for value in values:
                                if isinstance(value, str):
                                    add_terms(value)
                    elif branch.condition.condition_type == "range":
                        diagnosis_lines.append(
                            f"{node.variable_key or node.id}: range {branch.condition.min_value or ''}-{branch.condition.max_value or ''}"
                        )

        if node.node_type == "specialist" and node.specialty and _is_likely_diagnosis_like(node.specialty):
            diagnosis_lines.append(f"{node.specialist_name or node.id}: {node.specialty}")

    focus_terms = focus_terms[:80]
    return TreeContext(
        tree_name=tree.name,
        tree_description=tree.description or "",
        specialist_lines=specialist_lines,
        diagnosis_lines=diagnosis_lines,
        workup_lines=workup_lines,
        focus_terms=focus_terms,
    )


def _score_chunk(chunk: str, focus_terms: list[str]) -> tuple[int, list[str]]:
    lower = chunk.lower()
    matched: list[str] = []
    score = 0
    for term in focus_terms:
        term_lower = term.lower()
        if term_lower and term_lower in lower:
            score += 1
            matched.append(term)
    if score == 0:
        tokens = _tokenize(chunk)
        score = len(tokens.intersection(_tokenize(" ".join(focus_terms))))
    return score, matched[:12]


def _select_relevant_chunks(text: str, focus_terms: list[str]) -> tuple[list[str], list[str]]:
    chunks = _chunk_text(text)
    if not chunks:
        return [], []

    scored: list[tuple[int, int, str, list[str]]] = []
    for index, chunk in enumerate(chunks):
        score, matched = _score_chunk(chunk, focus_terms)
        scored.append((score, index, chunk, matched))

    scored.sort(key=lambda item: (item[0], -len(item[2])), reverse=True)
    selected: list[str] = []
    selected_terms: list[str] = []
    total = 0
    for score, _, chunk, matched in scored:
        if score <= 0 and selected:
            continue
        if total >= MAX_SELECTED_CHARS:
            break
        selected.append(chunk)
        selected_terms.extend(matched)
        total += len(chunk)
        if len(selected) >= 5:
            break

    if not selected:
        selected = chunks[:2]
    return selected, sorted(set(selected_terms), key=str.lower)


def _fallback_summary(context: TreeContext, selected_chunks: list[str]) -> dict[str, Any]:
    summary_parts: list[str] = []
    if context.specialist_lines:
        summary_parts.append("Relevant specialists: " + "; ".join(context.specialist_lines[:4]))
    if context.diagnosis_lines:
        summary_parts.append("Routing cues: " + "; ".join(context.diagnosis_lines[:4]))
    if selected_chunks:
        summary_parts.append("Key excerpts: " + " | ".join(selected_chunks[:2]))

    key_points: list[str] = []
    for chunk in selected_chunks:
        sentence = chunk.split(". ")[0].strip()
        if sentence:
            key_points.append(sentence[:240])
        if len(key_points) >= MAX_KEY_POINTS:
            break

    return {
        "summary": _normalize(" ".join(summary_parts)) or "Relevant material was found in the uploaded document.",
        "key_points": key_points,
        "evidence_quotes": [chunk[:280] for chunk in selected_chunks[:MAX_QUOTES]],
        "relevant_topics": context.focus_terms[:12],
        "matched_specialists": [line.split(",")[0] for line in context.specialist_lines[:8]],
        "matched_diagnoses": context.diagnosis_lines[:8],
        "model_used": None,
    }


def _parse_json_object(text: str) -> dict[str, Any] | None:
    cleaned = text.strip()
    if not cleaned:
        return None
    try:
        return json.loads(cleaned)
    except Exception:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except Exception:
        return None


def _coerce_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
    return out


class KnowledgeBaseService:
    async def analyze_document(
        self,
        *,
        filename: str,
        content_type: str | None,
        data: bytes,
        context: TreeContext,
    ) -> dict[str, Any]:
        file_hash = hashlib.sha256(data).hexdigest()
        file_type, raw_text = _extract_text_from_bytes(filename, content_type, data)
        selected_chunks, selected_terms = _select_relevant_chunks(raw_text, context.focus_terms)
        selected_text = "\n\n".join(selected_chunks)

        fallback = _fallback_summary(context, selected_chunks)
        if not selected_text:
            return {
                "filename": filename,
                "file_hash": file_hash,
                "content_type": content_type,
                "file_type": file_type,
                "text_length": len(raw_text),
                "selected_length": 0,
                "selected_chunk_count": 0,
                **fallback,
            }

        if anthropic_service.is_available and anthropic_service.client:
            prompt = self._build_prompt(context, filename, selected_text)
            try:
                message = await anthropic_service.client.messages.create(
                    model=settings.ANTHROPIC_EXTRACT_MODEL or settings.ANTHROPIC_MODEL,
                    max_tokens=1200,
                    system=self._system_prompt(),
                    messages=[{"role": "user", "content": prompt}],
                )
                text_block = next((block for block in message.content if block.type == "text"), None)
                parsed = _parse_json_object(text_block.text if text_block else "") if text_block else None
                if parsed:
                    return {
                        "filename": filename,
                        "file_hash": file_hash,
                        "content_type": content_type,
                        "file_type": file_type,
                        "text_length": len(raw_text),
                        "selected_length": len(selected_text),
                        "selected_chunk_count": len(selected_chunks),
                        "relevant_topics": _coerce_str_list(parsed.get("relevant_topics")) or selected_terms,
                        "matched_specialists": _coerce_str_list(parsed.get("matched_specialists")),
                        "matched_diagnoses": _coerce_str_list(parsed.get("matched_diagnoses")),
                        "summary": str(parsed.get("summary") or "").strip() or fallback["summary"],
                        "key_points": _coerce_str_list(parsed.get("key_points"))[:MAX_KEY_POINTS],
                        "evidence_quotes": _coerce_str_list(parsed.get("evidence_quotes"))[:MAX_QUOTES],
                        "model_used": getattr(message, "model", None),
                    }
            except Exception as exc:
                logger.warning("Knowledge-base summarization failed, falling back to heuristics: %s", exc)

        return {
            "filename": filename,
            "file_hash": file_hash,
            "content_type": content_type,
            "file_type": file_type,
            "text_length": len(raw_text),
            "selected_length": len(selected_text),
            "selected_chunk_count": len(selected_chunks),
            **fallback,
        }

    def _system_prompt(self) -> str:
        return (
            "You are indexing clinic knowledge-base documents for an intake-routing LLM. "
            "Extract only the information that helps answer patient questions better for the clinic's tree. "
            "Stay focused on the routed specialists, the diagnoses they treat, red flags, symptom patterns, "
            "and workup facts. Ignore unrelated general textbook material. Return ONLY valid JSON with these keys: "
            "summary, relevant_topics, matched_specialists, matched_diagnoses, key_points, evidence_quotes. "
            "Each value should be concise and clinically specific."
        )

    def _build_prompt(self, context: TreeContext, filename: str, selected_text: str) -> str:
        specialist_block = "\n".join(f"- {line}" for line in context.specialist_lines[:12]) or "- None"
        diagnosis_block = "\n".join(f"- {line}" for line in context.diagnosis_lines[:12]) or "- None"
        workup_block = "\n".join(f"- {line}" for line in context.workup_lines[:12]) or "- None"
        focus_block = ", ".join(context.focus_terms[:40]) or "None"
        return (
            f"Tree: {context.tree_name}\n"
            f"Tree description: {context.tree_description or 'N/A'}\n\n"
            f"Specialist routes:\n{specialist_block}\n\n"
            f"Diagnosis / routing cues:\n{diagnosis_block}\n\n"
            f"Workup cues:\n{workup_block}\n\n"
            f"Focus terms: {focus_block}\n\n"
            f"Document: {filename}\n\n"
            f"Selected excerpts:\n{selected_text[:MAX_SELECTED_CHARS]}\n\n"
            "Return the JSON object now."
        )


knowledge_base_service = KnowledgeBaseService()
