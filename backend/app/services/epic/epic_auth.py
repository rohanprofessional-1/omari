"""
Epic Backend Service authentication using JWT client assertions.

Implements the OAuth 2.0 client_credentials flow with a JWT bearer assertion,
per Epic's Backend Services specification:
https://fhir.epic.com/Documentation?docId=oauth2&section=BackendOAuth2Guide
"""

import time
import uuid
import logging
from typing import Optional

import jwt
from cryptography.hazmat.primitives import serialization

from app.core.config import settings

logger = logging.getLogger(__name__)

# Module-level token cache
_cached_token: Optional[str] = None
_token_expiry: float = 0.0


def _load_private_key() -> bytes:
    """Load the RSA private key from the configured PEM file."""
    key_path = settings.EPIC_PRIVATE_KEY_PATH
    if not key_path:
        raise ValueError(
            "EPIC_PRIVATE_KEY_PATH is not configured. "
            "Set it in your .env file to the path of your RSA private key PEM."
        )
    with open(key_path, "rb") as f:
        key_data = f.read()

    # Validate that it's a usable private key
    serialization.load_pem_private_key(key_data, password=None)
    return key_data


def _build_jwt_assertion() -> str:
    """
    Build a signed JWT assertion for the Epic token endpoint.

    Claims (per Epic spec):
        iss: client_id
        sub: client_id
        aud: token URL
        jti: unique identifier (UUID)
        exp: expiry (current time + 5 minutes, max allowed)
    """
    now = int(time.time())
    claims = {
        "iss": settings.EPIC_CLIENT_ID,
        "sub": settings.EPIC_CLIENT_ID,
        "aud": settings.EPIC_TOKEN_URL,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + 300,  # 5 minutes
    }
    private_key = _load_private_key()
    return jwt.encode(claims, private_key, algorithm="RS384")


async def get_access_token(http_client) -> str:
    """
    Obtain a valid access token, using the cache if the existing token
    has not yet expired (with a 60-second safety buffer).

    Args:
        http_client: An httpx.AsyncClient instance for making the token request.

    Returns:
        A valid Epic access token string.
    """
    global _cached_token, _token_expiry

    if _cached_token and time.time() < _token_expiry:
        return _cached_token

    if not settings.EPIC_TOKEN_URL:
        raise ValueError(
            "EPIC_TOKEN_URL is not configured. "
            "Set it in your .env file."
        )

    assertion = _build_jwt_assertion()

    response = await http_client.post(
        settings.EPIC_TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": assertion,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    response.raise_for_status()
    token_data = response.json()

    _cached_token = token_data["access_token"]
    expires_in = token_data.get("expires_in", 300)
    _token_expiry = time.time() + expires_in - 60  # 60-second buffer

    logger.info("Obtained new Epic access token (expires in %ds)", expires_in)
    return _cached_token


def clear_token_cache() -> None:
    """Clear the cached token (useful for testing or on auth errors)."""
    global _cached_token, _token_expiry
    _cached_token = None
    _token_expiry = 0.0
