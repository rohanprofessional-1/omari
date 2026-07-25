from fastapi import APIRouter, HTTPException
from app.core.config import settings

router = APIRouter()

@router.get("/debug/epic-config", tags=["debug"])
async def get_epic_config():
    """Return Epic FHIR configuration to verify env loading.
    Returns a JSON with the base URL, client ID, token URL, and private key path.
    If any required value is missing, returns 400 with a clear message.
    """
    missing = []
    if not settings.EPIC_FHIR_BASE_URL:
        missing.append("EPIC_FHIR_BASE_URL")
    if not settings.EPIC_CLIENT_ID:
        missing.append("EPIC_CLIENT_ID")
    if not settings.EPIC_TOKEN_URL:
        missing.append("EPIC_TOKEN_URL")
    if not settings.EPIC_PRIVATE_KEY_PATH:
        missing.append("EPIC_PRIVATE_KEY_PATH")
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing env vars: {', '.join(missing)}")
    return {
        "EPIC_FHIR_BASE_URL": settings.EPIC_FHIR_BASE_URL,
        "EPIC_CLIENT_ID": settings.EPIC_CLIENT_ID,
        "EPIC_TOKEN_URL": settings.EPIC_TOKEN_URL,
        "EPIC_PRIVATE_KEY_PATH": settings.EPIC_PRIVATE_KEY_PATH,
    }
