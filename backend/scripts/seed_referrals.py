"""Seed the referrals table from the frontend fixture data.

Usage: python -m scripts.seed_referrals

Reads the fixture data from the frontend TypeScript files, converts it to
the API schema, and POSTs it to the running backend. Run this ONCE after
the migration to populate the database with the same referrals that were
previously hardcoded in the frontend.

This script is intentionally kept as a one-shot tool — once referrals come
from Epic/fax intake, seeding is no longer needed.
"""
import json
import sys
import httpx

API_BASE = "http://localhost:8000/api/v1"


# The fixture data, extracted from the TypeScript files and converted to Python dicts.
# This is the SEED_FIXTURES from frontend/src/dashboard/data/fixtures/referrals.ts
# plus referralsClean.ts, referralsEdge.ts, and referralsOutOfScope.ts.
#
# Rather than duplicating all 32 fixtures here, this script reads them from a
# JSON file that can be generated from the frontend's TypeScript exports.
# See: frontend/scripts/export-fixtures.ts

def seed_from_json(filepath: str) -> None:
    """Seed referrals from a JSON file."""
    with open(filepath, "r") as f:
        fixtures = json.load(f)

    print(f"Seeding {len(fixtures)} referrals...")

    # Use bulk endpoint
    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            f"{API_BASE}/referrals/bulk",
            json=fixtures,
        )
        if response.status_code == 201:
            created = response.json()
            print(f"✓ Created {len(created)} referrals")
        else:
            print(f"✗ Failed: {response.status_code} — {response.text}")
            sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.seed_referrals <fixtures.json>")
        print()
        print("Generate fixtures.json first:")
        print("  cd frontend && npx tsx scripts/export-fixtures.ts > ../backend/fixtures.json")
        sys.exit(1)

    seed_from_json(sys.argv[1])
