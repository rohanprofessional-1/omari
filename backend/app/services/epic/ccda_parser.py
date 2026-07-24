"""
Lightweight C-CDA XML section extractor.

Pulls the clinically relevant sections from a C-CDA document before
sending to the LLM, reducing token usage and focusing extraction on
the most useful content.
"""

import logging
import re
from typing import Dict, Optional

from lxml import etree

logger = logging.getLogger(__name__)

# CDA namespace — all CDA elements live under this
CDA_NS = "urn:hl7-org:v3"
NS = {"cda": CDA_NS}

# Map of human-readable section name → OID templateId
SECTION_TEMPLATES: Dict[str, str] = {
    "reason_for_referral": "2.16.840.1.113883.10.20.22.2.42",
    "problem_list": "2.16.840.1.113883.10.20.22.2.5.1",
    "medications": "2.16.840.1.113883.10.20.22.2.1.1",
    "allergies": "2.16.840.1.113883.10.20.22.2.6.1",
    "results": "2.16.840.1.113883.10.20.22.2.3.1",
    "history_of_present_illness": "2.16.840.1.113883.10.20.22.2.65",
    "plan_of_treatment": "2.16.840.1.113883.10.20.22.2.10",
    "assessment": "2.16.840.1.113883.10.20.22.2.8",
    "procedures": "2.16.840.1.113883.10.20.22.2.7.1",
    "vital_signs": "2.16.840.1.113883.10.20.22.2.4.1",
    "social_history": "2.16.840.1.113883.10.20.22.2.17",
    "family_history": "2.16.840.1.113883.10.20.22.2.15",
}


def _clean_text(text: str) -> str:
    """Normalize whitespace and strip XML artifacts from extracted text."""
    # Collapse multiple whitespace/newlines
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_text_from_element(element) -> str:
    """
    Recursively extract all text content from an XML element,
    including text in child elements.
    """
    return _clean_text(
        " ".join(element.itertext())
    )


def _find_section_by_template(root, template_oid: str):
    """
    Find a CDA section by its templateId OID.

    C-CDA sections are structured as:
        <component><structuredBody><component><section>
            <templateId root="2.16.840.1.113883.10.20.22.2.X"/>
            ...
        </section></component></structuredBody></component>
    """
    # XPath to find sections with a matching templateId
    xpath = (
        f".//cda:component/cda:section"
        f"[cda:templateId[@root='{template_oid}']]"
    )
    sections = root.xpath(xpath, namespaces=NS)
    return sections[0] if sections else None


def _extract_section_content(section_element) -> str:
    """
    Extract the human-readable content from a CDA section.

    Tries in order:
    1. The <text> element (narrative block — HTML-like, intended for display)
    2. The <title> + entries as fallback
    """
    # Primary: the <text> narrative block
    text_el = section_element.find("cda:text", NS)
    if text_el is not None:
        return _extract_text_from_element(text_el)

    # Fallback: concatenate entry display names
    entries = section_element.findall(".//cda:entry", NS)
    parts = []
    for entry in entries:
        # Try to find display names in coded entries
        for code_el in entry.iter(f"{{{CDA_NS}}}code"):
            display = code_el.get("displayName")
            if display:
                parts.append(display)

        # Also grab any text content
        text_content = _extract_text_from_element(entry)
        if text_content and text_content not in parts:
            parts.append(text_content)

    return " | ".join(parts) if parts else ""


def extract_patient_demographics(root) -> Dict[str, Optional[str]]:
    """
    Extract basic patient demographics from the CDA header.

    Returns a dict with keys: name, dob, gender, mrn.
    """
    demographics: Dict[str, Optional[str]] = {
        "name": None,
        "dob": None,
        "gender": None,
        "mrn": None,
    }

    # Patient record
    patient = root.find(".//cda:recordTarget/cda:patientRole", NS)
    if patient is None:
        return demographics

    # MRN — first <id> element
    id_el = patient.find("cda:id", NS)
    if id_el is not None:
        demographics["mrn"] = id_el.get("extension")

    # Name
    name_el = patient.find("cda:patient/cda:name", NS)
    if name_el is not None:
        given = name_el.findtext("cda:given", default="", namespaces=NS)
        family = name_el.findtext("cda:family", default="", namespaces=NS)
        demographics["name"] = f"{given} {family}".strip()

    # DOB
    birth_el = patient.find("cda:patient/cda:birthTime", NS)
    if birth_el is not None:
        demographics["dob"] = birth_el.get("value")

    # Gender
    gender_el = patient.find("cda:patient/cda:administrativeGenderCode", NS)
    if gender_el is not None:
        demographics["gender"] = gender_el.get("displayName") or gender_el.get("code")

    return demographics


def extract_sections(ccda_xml: str) -> Dict[str, str]:
    """
    Parse a C-CDA XML document and extract the text content of all
    clinically relevant sections.

    Args:
        ccda_xml: Raw C-CDA XML string.

    Returns:
        A dict mapping section names (e.g. 'problem_list', 'medications')
        to their cleaned text content. Only sections that exist and have
        content are included.
    """
    try:
        root = etree.fromstring(ccda_xml.encode("utf-8"))
    except etree.XMLSyntaxError as e:
        logger.error("Failed to parse C-CDA XML: %s", e)
        raise ValueError(f"Invalid C-CDA XML: {e}") from e

    sections: Dict[str, str] = {}

    # Extract demographics and include as a section
    demographics = extract_patient_demographics(root)
    demo_parts = [f"{k}: {v}" for k, v in demographics.items() if v]
    if demo_parts:
        sections["demographics"] = " | ".join(demo_parts)

    # Extract each clinical section
    for section_name, template_oid in SECTION_TEMPLATES.items():
        section_el = _find_section_by_template(root, template_oid)
        if section_el is None:
            continue

        content = _extract_section_content(section_el)
        if content:
            sections[section_name] = content
            logger.debug(
                "Extracted section '%s' (%d chars)",
                section_name,
                len(content),
            )

    logger.info(
        "Extracted %d sections from C-CDA (of %d possible)",
        len(sections),
        len(SECTION_TEMPLATES) + 1,  # +1 for demographics
    )
    return sections
