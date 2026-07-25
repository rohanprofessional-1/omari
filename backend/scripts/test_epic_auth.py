#!/usr/bin/env python3
"""
Test script to verify OAuth 2.0 authentication against Epic using the generated private key.
This tests the full client_credentials flow using JWT assertions signed with RS384.
"""

import asyncio
import sys
from pathlib import Path

# Add backend directory to path so we can import app modules
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

import httpx
from app.core.config import settings
from app.services.epic.epic_auth import get_access_token


async def verify_auth():
    print("--- Epic OAuth 2.0 Verification ---")
    print(f"Client ID         : {settings.EPIC_CLIENT_ID or '(Not configured)'}")
    print(f"Token URL         : {settings.EPIC_TOKEN_URL or '(Not configured)'}")
    print(f"Private Key Path  : {settings.EPIC_PRIVATE_KEY_PATH or '(Not configured)'}")
    print("-----------------------------------")

    if not settings.EPIC_CLIENT_ID or settings.EPIC_CLIENT_ID == "placeholder":
        print("❌ Error: Please set a valid EPIC_CLIENT_ID in your .env file.")
        sys.exit(1)

    if not settings.EPIC_TOKEN_URL:
        print("❌ Error: Please set EPIC_TOKEN_URL in your .env file.")
        sys.exit(1)

    print("\nAttempting to build signed JWT assertion and exchange for access token...")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token = await get_access_token(client)
            print("\n✅ SUCCESS! Authenticated with Epic successfully!")
            print(f"Token (preview): {token[:20]}... (truncated)")
            print("\nYour JWKS setup and private key configuration are working correctly.")
    except httpx.HTTPStatusError as e:
        print(f"\n❌ HTTP Error {e.response.status_code} returned from Epic Token Endpoint:")
        print(e.response.text)
        print("\nTroubleshooting tips:")
        print("  1. Verify the exact content of epic_jwks.json is registered in your Epic Developer app settings.")
        print("  2. Ensure your EPIC_CLIENT_ID matches the app ID in Epic.")
        print("  3. Check that your app is enabled for Backend Services / Client Credentials grant.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error attempting token exchange: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(verify_auth())
