from datetime import datetime, timezone
from pathlib import Path
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from faultspan_platform.config import Settings
from faultspan_platform.main import create_app
from faultspan_platform.models import X402Receipt
from faultspan_platform.x402 import receipt_signing_message


def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(evidence_dir=tmp_path, allowed_origins=("http://localhost:3000",))))


def authenticate(api: TestClient, account) -> str:
    challenge = api.post("/v1/auth/challenge", json={"address": account.address}).json()
    signature = Account.sign_message(encode_defunct(text=challenge["message"]), account.key).signature.hex()
    verified = api.post(
        "/v1/auth/verify", json={"challenge_id": challenge["challenge_id"], "signature": signature}
    )
    assert verified.status_code == 200
    return verified.json()["session_token"]


def sample_bundle(address: str) -> dict:
    return {
        "schema_version": "1",
        "case_id": "market-report-01",
        "span_id": "analysis-agent",
        "submitted_by": address,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "obligation": {"text": "Validate every source before drawing conclusions"},
        "delivery": {"status": "failed", "artifact": "report.json"},
        "task_events": [],
        "payment_receipts": [],
        "attachments": [],
        "statements": [{"text": "The validation step was omitted"}],
    }


def test_challenge_cannot_be_replayed(tmp_path: Path):
    api = client(tmp_path)
    account = Account.create()
    challenge = api.post("/v1/auth/challenge", json={"address": account.address}).json()
    signature = Account.sign_message(encode_defunct(text=challenge["message"]), account.key).signature.hex()
    payload = {"challenge_id": challenge["challenge_id"], "signature": signature}
    assert api.post("/v1/auth/verify", json=payload).status_code == 200
    assert api.post("/v1/auth/verify", json=payload).status_code == 401


def test_evidence_is_content_addressed_and_immutable(tmp_path: Path):
    api = client(tmp_path)
    account = Account.create()
    token = authenticate(api, account)
    created = api.post(
        "/v1/evidence",
        json=sample_bundle(account.address),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert created.status_code == 201
    receipt = created.json()
    assert receipt["digest"].startswith("sha256:")
    fetched = api.get(receipt["public_path"])
    assert fetched.status_code == 200
    assert fetched.headers["cache-control"] == "public, immutable"


def test_session_cannot_submit_for_another_wallet(tmp_path: Path):
    api = client(tmp_path)
    account = Account.create()
    other = Account.create()
    token = authenticate(api, account)
    response = api.post(
        "/v1/evidence",
        json=sample_bundle(other.address),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403


def test_case_projection_requires_owner_session_and_is_searchable(tmp_path: Path):
    api = client(tmp_path)
    owner = Account.create()
    other = Account.create()
    token = authenticate(api, owner)
    payload = {
        "case_id": "case-001",
        "title": "Weather SLA claim",
        "owner": owner.address,
        "coordinator": owner.address,
        "contract_address": "0x1c3cdE1FdB758971F0F2D06BafBdd194ca9d86eb",
        "tx_hash": "0xabc123",
        "status": "OPEN",
    }

    created = api.post("/v1/cases", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert created.status_code == 201
    assert created.json()["case_id"] == "case-001"

    indexed = api.get("/v1/cases", params={"query": "weather"})
    assert indexed.status_code == 200
    assert indexed.json()[0]["case_id"] == "case-001"

    other_token = authenticate(api, other)
    forbidden = api.post(
        "/v1/cases",
        json={**payload, "case_id": "case-002", "owner": owner.address},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert forbidden.status_code == 403


def test_span_activity_and_search_projections_are_queryable(tmp_path: Path):
    api = client(tmp_path)
    owner = Account.create()
    token = authenticate(api, owner)

    case_payload = {
        "case_id": "case-003",
        "title": "Agent report dispute",
        "owner": owner.address,
        "coordinator": owner.address,
        "contract_address": "0x1c3cdE1FdB758971F0F2D06BafBdd194ca9d86eb",
        "tx_hash": "0xcase003",
        "status": "OPEN",
    }
    assert api.post("/v1/cases", json=case_payload, headers={"Authorization": f"Bearer {token}"}).status_code == 201

    span_payload = {
        "case_id": "case-003",
        "span_id": "analysis-span",
        "parent_id": None,
        "requester": owner.address,
        "provider": owner.address,
        "obligation": "Validate sources before finalizing conclusions.",
        "bond_wei": "1000000000000000",
        "status": "PROPOSED",
        "tx_hash": "0xspan003",
    }
    created_span = api.post("/v1/spans", json=span_payload, headers={"Authorization": f"Bearer {token}"})
    assert created_span.status_code == 201
    assert created_span.json()["span_id"] == "analysis-span"

    activity_payload = {
        "case_id": "case-003",
        "span_id": "analysis-span",
        "actor": owner.address,
        "action": "register_span",
        "status": "FINALIZED",
        "tx_hash": "0xspan003",
        "summary": "Registered the analysis span",
    }
    created_activity = api.post("/v1/activity", json=activity_payload, headers={"Authorization": f"Bearer {token}"})
    assert created_activity.status_code == 201
    assert created_activity.json()["action"] == "register_span"

    spans = api.get("/v1/cases/case-003/spans")
    assert spans.status_code == 200
    assert spans.json()[0]["span_id"] == "analysis-span"

    activity = api.get("/v1/cases/case-003/activity")
    assert activity.status_code == 200
    assert activity.json()[0]["summary"] == "Registered the analysis span"

    search = api.get("/v1/search", params={"query": "0xspan003"})
    assert search.status_code == 200
    result_types = {item["result_type"] for item in search.json()}
    assert "span" in result_types
    assert "transaction" in result_types


def test_x402_boundary_verifies_party_signature(tmp_path: Path):
    api = client(tmp_path)
    payer = Account.create()
    payee = Account.create()
    unsigned = X402Receipt(
        receipt_id="receipt-001",
        payer=payer.address,
        payee=payee.address,
        resource="a2a://analysis-agent/market-report-01",
        amount="2500000",
        asset="USDC",
        timestamp="2026-07-14T12:00:00Z",
        signature="0x00",
        signer=payer.address,
    )
    signature = Account.sign_message(encode_defunct(text=receipt_signing_message(unsigned)), payer.key).signature.hex()
    response = api.post("/v1/integrations/x402/verify", json={**unsigned.model_dump(), "signature": signature})
    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_a2a_task_normalizes_to_bounded_unverified_span(tmp_path: Path):
    api = client(tmp_path)
    response = api.post(
        "/v1/integrations/a2a/normalize",
        json={
            "task_id": "task-analysis-01",
            "context_id": "market-report-01",
            "requester": "agent://orion",
            "provider": "agent://kepler",
            "description": "Cross-check every numeric conclusion against two independent sources.",
            "status": "completed",
            "artifacts": [{"name": "validation.json", "uri": "https://evidence.example/validation.json"}],
            "events": [{"at": "2026-07-14T12:00:00Z", "status": "submitted", "actor": "agent://kepler", "detail": {}}],
        },
    )
    assert response.status_code == 200
    value = response.json()
    assert value["span_id"] == "task-analysis-01"
    assert value["obligation_digest"].startswith("sha256:")
    assert value["completeness"] == "UNVERIFIED"
