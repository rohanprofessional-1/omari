"""
Async FHIR R4 client for Epic.

Handles patient lookup, DocumentReference queries, and C-CDA content retrieval.
All calls use the access token from epic_auth.
"""

import base64
import logging
from typing import Optional

import httpx

from app.core.config import settings
from app.services.epic.epic_auth import get_access_token, clear_token_cache

logger = logging.getLogger(__name__)

# LOINC code for C-CDA (Summarization of Episode Note)
CCDA_LOINC = "34133-9"


class EpicFHIRError(Exception):
    """Raised when an Epic FHIR API call fails."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class EpicFHIRClient:
    """
    Async client for interacting with Epic's FHIR R4 API.

    Usage:
        async with EpicFHIRClient() as client:
            patient = await client.get_patient_by_mrn("E1234")
            docs = await client.get_document_references(patient["id"])
            ccda_xml = await client.get_document_content(docs[0])
    """

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        self._http = httpx.AsyncClient(timeout=30.0)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._http:
            await self._http.aclose()

    @property
    def base_url(self) -> str:
        url = settings.EPIC_FHIR_BASE_URL.rstrip("/")
        if not url:
            raise ValueError(
                "EPIC_FHIR_BASE_URL is not configured. Set it in your .env file."
            )
        return url

    async def _get_headers(self) -> dict:
        """Build authorization headers with a valid access token."""
        token = await get_access_token(self._http)
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/fhir+json",
        }

    async def _request(self, method: str, url: str, **kwargs) -> dict:
        """
        Make an authenticated FHIR request with one retry on 401 (token expired).
        """
        headers = await self._get_headers()
        response = await self._http.request(method, url, headers=headers, **kwargs)

        if response.status_code == 401:
            # Token may have expired; clear cache and retry once
            logger.warning("Got 401 from Epic; clearing token cache and retrying")
            clear_token_cache()
            headers = await self._get_headers()
            response = await self._http.request(method, url, headers=headers, **kwargs)

        if response.status_code >= 400:
            raise EpicFHIRError(
                f"FHIR request failed: {response.status_code} — {response.text}",
                status_code=response.status_code,
            )

        return response.json()

    # ── Patient Lookup ───────────────────────────────────────────────

    async def get_patient_by_mrn(self, mrn: str) -> dict:
        """
        Search for a patient by MRN (Medical Record Number).

        Returns the first matching FHIR Patient resource, or raises if not found.
        """
        url = f"{self.base_url}/Patient"
        result = await self._request("GET", url, params={"identifier": mrn})

        entries = result.get("entry", [])
        if not entries:
            raise EpicFHIRError(f"No patient found with MRN '{mrn}'")

        patient = entries[0].get("resource", {})
        logger.info(
            "Found patient: %s (FHIR ID: %s)",
            patient.get("name", [{}])[0].get("text", "Unknown"),
            patient.get("id"),
        )
        return patient

    async def get_patient_by_fhir_id(self, fhir_id: str) -> dict:
        """Retrieve a patient by their FHIR resource ID."""
        url = f"{self.base_url}/Patient/{fhir_id}"
        return await self._request("GET", url)

    # ── DocumentReference ────────────────────────────────────────────

    async def get_document_references(
        self,
        patient_fhir_id: str,
        loinc_code: str = CCDA_LOINC,
    ) -> list[dict]:
        """
        Query DocumentReference resources for a patient, filtered by LOINC type.

        Default LOINC code 34133-9 = "Summarization of Episode Note" (C-CDA).
        Returns a list of DocumentReference resources.
        """
        url = f"{self.base_url}/DocumentReference"
        params = {
            "patient": patient_fhir_id,
            "type": f"http://loinc.org|{loinc_code}",
            "_sort": "-date",
            "_count": "10",
        }
        result = await self._request("GET", url, params=params)

        entries = result.get("entry", [])
        docs = [e.get("resource", {}) for e in entries]
        logger.info(
            "Found %d DocumentReference(s) for patient %s",
            len(docs),
            patient_fhir_id,
        )
        return docs

    # ── C-CDA Content Retrieval ──────────────────────────────────────

    async def get_document_content(self, doc_ref: dict) -> str:
        """
        Retrieve the C-CDA XML content from a DocumentReference resource.

        Handles two patterns:
        1. Inline base64-encoded data in attachment.data
        2. URL reference in attachment.url (requires separate GET)
        """
        content_list = doc_ref.get("content", [])
        if not content_list:
            raise EpicFHIRError(
                f"DocumentReference {doc_ref.get('id')} has no content attachments"
            )

        attachment = content_list[0].get("attachment", {})

        # Pattern 1: Inline base64 data
        if "data" in attachment:
            raw_bytes = base64.b64decode(attachment["data"])
            return raw_bytes.decode("utf-8")

        # Pattern 2: URL reference
        url = attachment.get("url")
        if not url:
            raise EpicFHIRError(
                f"DocumentReference {doc_ref.get('id')} attachment has no data or url"
            )

        # Fetch the document binary
        headers = await self._get_headers()
        # Override Accept for raw XML
        headers["Accept"] = "application/xml"
        response = await self._http.get(url, headers=headers)

        if response.status_code >= 400:
            raise EpicFHIRError(
                f"Failed to fetch document content from {url}: {response.status_code}",
                status_code=response.status_code,
            )

        return response.text
