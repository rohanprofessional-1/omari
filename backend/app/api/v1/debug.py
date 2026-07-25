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


@router.get("/debug/epic-auth", tags=["debug"])
async def test_epic_auth():
    """Attempt to fetch an OAuth 2.0 access token from Epic using our signed JWT assertion."""
    import httpx
    from app.services.epic.epic_auth import get_access_token

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token = await get_access_token(client)
            return {
                "status": "success",
                "message": "Successfully retrieved access token from Epic via JWT client assertion!",
                "token_preview": f"{token[:15]}... (truncated)" if token else None,
            }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Epic token exchange failed: {str(e)}")
