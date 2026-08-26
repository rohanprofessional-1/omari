import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.deps import get_db
from app.main import app
from app.models import Base
from app.models.clinic import Clinic

@pytest_asyncio.fixture
async def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/test.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    # Seed the clinic required by foreign keys
    async with factory() as session:
        session.add(Clinic(id="duke-nerve-center", name="Duke Nerve Center", type="Neurology"))
        await session.commit()

    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()

@pytest.mark.asyncio
async def test_referral_lifecycle(client: AsyncClient):
    # 1. Create a referral (simulate patient intake)
    referral_payload = {
        "clinic_id": "duke-nerve-center",
        "payload": {
            "referralId": "REF-TEST-123",
            "receivedAt": "2026-08-25T12:00:00Z",
            "channel": "epic",
            "patient": {
                "name": "Sarah Blankslate",
                "mrn": "MRN-1111111",
                "dob": "1990-01-01",
                "sex": "F",
                "phone": "555-1234"
            },
            "referredBy": {
                "provider": "Self",
                "npi": "",
                "practice": "AI",
                "phone": "",
                "fax": ""
            },
            "referredToDepartment": "Neurology",
            "priority": "routine",
            "reasonForReferral": "Test",
            "clinicalNote": "",
            "diagnoses": [],
            "attachments": [],
            "structured": {"vitals": None, "meds": None, "problems": None}
        },
        "extraction": {
            "variables": {},
            "sources": {}
        }
    }
    
    res = await client.post("/api/v1/referrals", json=referral_payload)
    assert res.status_code == 201
    created = res.json()
    ref_id = created["payload"]["referralId"]
    assert created["payload"]["patient"]["name"] == "Sarah Blankslate"

    # 2. Surgeon requests more info
    review_info_req = {
        "status": "info_requested",
        "actor": "Dr. Surgeon",
        "role": "surgeon",
        "note": "Need more details on duration."
    }
    res = await client.post(f"/api/v1/referrals/{ref_id}/review", json=review_info_req)
    assert res.status_code == 201
    review = res.json()
    assert review["status"] == "info_requested"
    assert review["reviewer"] == "Dr. Surgeon"

    # 3. Patient provides info (moves back to pending)
    review_patient_resp = {
        "status": "pending",
        "actor": "Sarah Blankslate",
        "role": "patient",
        "note": "It has been 3 weeks."
    }
    res = await client.post(f"/api/v1/referrals/{ref_id}/review", json=review_patient_resp)
    assert res.status_code == 201
    review = res.json()
    assert review["status"] == "pending"

    # 4. Admin/Surgeon approves
    review_approve = {
        "status": "approved",
        "actor": "Admin",
        "role": "admin",
        "note": ""
    }
    res = await client.post(f"/api/v1/referrals/{ref_id}/review", json=review_approve)
    assert res.status_code == 201
    review = res.json()
    assert review["status"] == "approved"

    # 5. Check the audit trail for this referral
    res = await client.get(f"/api/v1/referrals/{ref_id}/audit")
    assert res.status_code == 200
    audit_events = res.json()
    
    assert len(audit_events) == 3
    assert audit_events[0]["action"] == "info_requested"
    assert audit_events[0]["actor"] == "Dr. Surgeon"
    assert audit_events[0]["note"] == "Need more details on duration."
    
    assert audit_events[1]["action"] == "pending"
    assert audit_events[1]["actor"] == "Sarah Blankslate"
    assert audit_events[1]["note"] == "It has been 3 weeks."
    
    assert audit_events[2]["action"] == "approved"
    assert audit_events[2]["actor"] == "Admin"
