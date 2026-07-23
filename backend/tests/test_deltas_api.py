"""Delta layer API tests: CRUD + the transactional reconcile.

Runs the real FastAPI app against a private SQLite database (aiosqlite),
overriding the get_db dependency — no Postgres needed. Covers:
- base storage on POST /trees/full and GET /trees/{id}/base
- bulk delta creation with seq auto-assignment
- patch/delete
- /reconcile: draft rows replaced, version bumped, per-delta verdicts
  persisted in the same transaction, unknown ids rejected
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.deps import get_db
from app.main import app
from app.models import Base

BASE_TREE = {
    "rootNodeId": "doc_abc123_cpg_root",
    "nodes": [
        {
            "id": "doc_abc123_cpg_root",
            "type": "variable",
            "variableKey": "psa_level",
            "prompt": "PSA?",
            "dataSource": "record",
            "branches": [
                {"label": "Elevated", "condition": {"op": "equals", "value": "elevated"}, "nextNodeId": "placeholder_1"},
            ],
        },
        {
            "id": "placeholder_1",
            "type": "specialist",
            "specialistName": "[Assign specialist — Urology Referral]",
            "specialty": "Urology Referral",
            "urgency": "routine",
            "reasoningTemplate": "",
            "workup": {"always": [], "conditional": [], "doNotOrderUnless": []},
        },
    ],
}

BASE_META = {"docId": "abc123", "documentName": "AUA Prostate CPG", "sections": ["Recommendation 1"]}

BIND_DELTA = {
    "op": "bind_terminal",
    "payload": {
        "op": "bind_terminal",
        "anchors": [{"kind": "terminal", "specialistName": "[Assign specialist — Urology Referral]"}],
        "target": {"kind": "specialist", "specialistName": "Dr. Osei", "specialty": "Urology"},
    },
    "provenance": {"author": "dr_li", "rationale": "", "deviatesFromCpg": False},
}

URGENCY_DELTA = {
    "op": "set_urgency",
    "payload": {
        "op": "set_urgency",
        "anchors": [{"kind": "terminal", "specialistName": "Dr. Osei"}],
        "urgency": "expedited",
    },
    "provenance": {},
}


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

    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


async def _create_tree(client: AsyncClient) -> str:
    res = await client.post(
        "/api/v1/trees/full",
        json={
            "name": "Prostate (CPG scaffold)",
            "rootNodeId": BASE_TREE["rootNodeId"],
            "nodes": BASE_TREE["nodes"],
            "baseTree": BASE_TREE,
            "baseMeta": BASE_META,
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


@pytest.mark.asyncio
async def test_base_stored_and_readable(client):
    tree_id = await _create_tree(client)
    res = await client.get(f"/api/v1/trees/{tree_id}/base")
    assert res.status_code == 200
    body = res.json()
    assert body["baseTree"]["rootNodeId"] == BASE_TREE["rootNodeId"]
    assert body["baseMeta"] == BASE_META


@pytest.mark.asyncio
async def test_delta_crud_with_seq_assignment(client):
    tree_id = await _create_tree(client)

    # Bulk create: seq auto-assigned in order.
    res = await client.post(f"/api/v1/trees/{tree_id}/deltas", json=[BIND_DELTA, URGENCY_DELTA])
    assert res.status_code == 201, res.text
    created = res.json()
    assert [d["seq"] for d in created] == [0, 1]
    assert created[0]["status"] == "active"

    # A later single create continues the sequence.
    res = await client.post(f"/api/v1/trees/{tree_id}/deltas", json=URGENCY_DELTA)
    assert res.status_code == 201
    assert res.json()[0]["seq"] == 2

    # List is seq-ordered.
    res = await client.get(f"/api/v1/trees/{tree_id}/deltas")
    assert [d["seq"] for d in res.json()] == [0, 1, 2]

    # Patch status.
    delta_id = created[0]["id"]
    res = await client.patch(
        f"/api/v1/trees/{tree_id}/deltas/{delta_id}",
        json={"status": "dismissed"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "dismissed"

    # Delete (per-delta undo).
    res = await client.delete(f"/api/v1/trees/{tree_id}/deltas/{delta_id}")
    assert res.status_code == 204
    res = await client.get(f"/api/v1/trees/{tree_id}/deltas")
    assert len(res.json()) == 2


@pytest.mark.asyncio
async def test_create_rejects_op_mismatch(client):
    tree_id = await _create_tree(client)
    bad = {**BIND_DELTA, "op": "set_urgency"}
    res = await client.post(f"/api/v1/trees/{tree_id}/deltas", json=bad)
    assert res.status_code == 422
    assert "does not match" in res.text


@pytest.mark.asyncio
async def test_reconcile_replaces_draft_and_records_verdicts(client):
    tree_id = await _create_tree(client)
    res = await client.post(f"/api/v1/trees/{tree_id}/deltas", json=[BIND_DELTA, URGENCY_DELTA])
    ids = [d["id"] for d in res.json()]

    # The "compiled" tree: placeholder bound to Dr. Osei, expedited.
    compiled_nodes = [
        BASE_TREE["nodes"][0],
        {
            **BASE_TREE["nodes"][1],
            "specialistName": "Dr. Osei",
            "specialty": "Urology",
            "urgency": "expedited",
            "reasoningTemplate": "Routing to Dr. Osei.",
        },
    ]
    res = await client.post(
        f"/api/v1/trees/{tree_id}/reconcile",
        json={
            "tree": {"rootNodeId": BASE_TREE["rootNodeId"], "nodes": compiled_nodes},
            "base_hash": "deadbeef",
            "delta_results": [
                {"delta_id": ids[0], "status": "active"},
                {"delta_id": ids[1], "status": "stale_conflict", "stale_reason": "CPG changed here"},
            ],
        },
    )
    assert res.status_code == 200, res.text
    statuses = {d["id"]: d for d in res.json()}
    assert statuses[ids[0]]["status"] == "active"
    assert statuses[ids[1]]["status"] == "stale_conflict"
    assert statuses[ids[1]]["stale_reason"] == "CPG changed here"

    # Draft rows replaced and version bumped.
    res = await client.get(f"/api/v1/trees/{tree_id}")
    tree = res.json()
    assert tree["version"] == 2
    bound = next(n for n in tree["nodes"] if n["node_type"] == "specialist")
    assert bound["specialist_name"] == "Dr. Osei"
    assert bound["urgency"] == "expedited"


@pytest.mark.asyncio
async def test_reconcile_rejects_unknown_delta_ids(client):
    tree_id = await _create_tree(client)
    res = await client.post(
        f"/api/v1/trees/{tree_id}/reconcile",
        json={
            "tree": {"rootNodeId": BASE_TREE["rootNodeId"], "nodes": BASE_TREE["nodes"]},
            "delta_results": [{"delta_id": "ghost", "status": "active"}],
        },
    )
    assert res.status_code == 422
    assert "Unknown delta ids" in res.text
