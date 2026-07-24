"""API endpoints for Epic FHIR referral ingestion."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.referral import (
    ReferralIngestRequest,
    ReferralIngestResponse,
    ReferralRead,
)
from app.services.epic.referral_service import ingest_referral
from app.services.epic.epic_client import EpicFHIRError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/referrals")


@router.post("/ingest", response_model=ReferralIngestResponse)
async def ingest_referral_endpoint(
    request: ReferralIngestRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    Ingest a referral via Epic FHIR C-CDA document.

    Fetches the patient's C-CDA referral document from Epic, extracts
    clinical variables using an LLM, runs the decision tree engine,
    and returns an advisory routing result.

    Requires either `patient_mrn` or `epic_patient_id` to identify the patient.
    """
    if not request.patient_mrn and not request.epic_patient_id:
        raise HTTPException(
            status_code=400,
            detail="Either patient_mrn or epic_patient_id must be provided",
        )

    try:
        result = await ingest_referral(
            db=db,
            tree_id=request.tree_id,
            patient_mrn=request.patient_mrn,
            epic_patient_id=request.epic_patient_id,
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    except EpicFHIRError as e:
        logger.error("Epic FHIR error during referral ingestion: %s", e)
        raise HTTPException(
            status_code=502,
            detail=f"Epic FHIR API error: {str(e)}",
        )

    except Exception as e:
        logger.exception("Unexpected error during referral ingestion")
        raise HTTPException(
            status_code=500,
            detail=f"Referral ingestion failed: {str(e)}",
        )
