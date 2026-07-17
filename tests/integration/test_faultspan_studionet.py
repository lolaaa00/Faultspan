"""Studionet consensus integration test for contracts/faultspan.py.

Exercises the full case lifecycle -- create, register, bond, deliver,
dispute, evidence lock, real GenLayer adjudication, settlement, withdrawal
-- against live Studionet consensus, satisfying the "Studionet integration
smoke tests" item in FAULTSPAN_MASTER_PLAN.md section 13.1.

Studionet is gasless, so this test generates fresh ephemeral accounts on
every run rather than relying on funded/configured keys. No secrets are
required or read from the environment.

Run with: gltest tests/integration/ -v -s
This test performs real network calls and a real LLM adjudication round,
so it is slow (often 1-3 minutes) and is not part of the fast direct-test
feedback loop (tests/direct/).
"""

import hashlib
import time

import pytest
import requests

from gltest import get_contract_factory
from gltest.accounts import create_accounts
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus

pytestmark = pytest.mark.studionet

CONTRACT_NAME = "Faultspan"

# A stable, already-public file in this repository's GitHub remote. Its
# digest is computed at test time (not hardcoded) so the test tolerates
# future edits to the file without needing a dedicated evidence fixture
# host.
EVIDENCE_URL = (
    "https://raw.githubusercontent.com/ometere123/faultspan/main/"
    "FAULTSPAN_MASTER_PLAN.md"
)

WAIT_INTERVAL_MS = 4000
WAIT_RETRIES = 90  # generous budget for consensus + LLM adjudication rounds


def _fetch_evidence_digest() -> str:
    response = requests.get(EVIDENCE_URL, timeout=30)
    response.raise_for_status()
    return "sha256:" + hashlib.sha256(response.content).hexdigest()


@pytest.fixture(scope="module")
def evidence_digest() -> str:
    return _fetch_evidence_digest()


def test_full_case_lifecycle_on_studionet(evidence_digest):
    owner, coordinator, provider = create_accounts(3)

    factory = get_contract_factory(CONTRACT_NAME)
    owner_contract = factory.deploy(
        account=owner,
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    coordinator_contract = factory.build_contract(
        contract_address=owner_contract.address, account=coordinator
    )
    provider_contract = factory.build_contract(
        contract_address=owner_contract.address, account=provider
    )

    now = _chain_now(owner_contract)
    delivery_deadline = now + 3600
    evidence_deadline = now + 7200

    case_id = "studionet-it-case"
    root_span = "root"

    receipt = owner_contract.create_case(
        args=[
            case_id,
            coordinator.address,
            "https://example.com/terms",
            "sha256:" + "a" * 64,
            delivery_deadline,
            evidence_deadline,
        ]
    ).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    receipt = coordinator_contract.register_span(
        args=[
            case_id, root_span, "", coordinator.address, provider.address,
            "https://example.com/obligation", "sha256:" + "b" * 64,
            1000, 1000, 5000,
        ]
    ).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    receipt = provider_contract.accept_span(args=[case_id, root_span]).transact(
        value=1000,
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    receipt = provider_contract.submit_delivery(
        args=[case_id, root_span, "https://example.com/delivery", "sha256:" + "c" * 64]
    ).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    receipt = owner_contract.open_dispute(
        args=[case_id, "https://example.com/claim", "sha256:" + "d" * 64]
    ).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    receipt = owner_contract.submit_evidence(
        args=[case_id, root_span, EVIDENCE_URL, evidence_digest]
    ).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    receipt = owner_contract.lock_evidence(args=[case_id]).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    # Real GenLayer leader/validator adjudication: fetches EVIDENCE_URL,
    # digest-checks it, and calls the LLM to produce structured findings.
    receipt = owner_contract.adjudicate_case(args=[case_id]).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    case = owner_contract.get_case(args=[case_id]).call()
    assert case["status"] == "DECIDED"

    span = owner_contract.get_span(args=[case_id, root_span]).call()
    assert span["finding"] in (
        "COMPLIED", "CONTRIBUTED_TO_FAILURE", "CAUSED_FAILURE", "INSUFFICIENT_EVIDENCE",
    )

    receipt = owner_contract.settle_case(args=[case_id]).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)

    case = owner_contract.get_case(args=[case_id]).call()
    assert case["status"] == "SETTLED"
    assert case["settled"] is True

    # Duplicate settlement must be rejected -- one-time settlement invariant.
    receipt = owner_contract.settle_case(args=[case_id]).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert not tx_execution_succeeded(receipt)

    # KNOWN ISSUE (see docs/KNOWN_ISSUES.md): on real Studionet execution,
    # get_claimable (a view over the TreeMap[Address, u256] claimable
    # ledger) reliably fails with "gen_call failed: execution failed" for
    # *any* address -- including addresses the contract never wrote to --
    # once settle_case has performed its first write into that TreeMap.
    # get_case / get_span (TreeMap[str, ...]) keep working fine against the
    # same contract after the same settlement, so this is isolated to
    # Address-keyed TreeMap reads post-write under real GenVM, not to
    # Faultspan's settlement logic (direct-mode tests, which use a
    # different in-memory storage backend, do not reproduce it -- see
    # tests/direct/test_faultspan.py::test_settlement_conserves_bonded_value).
    # This assertion pins the current (broken) behavior so a genvm/SDK fix
    # is caught by a change in this test rather than by production surprise.
    with pytest.raises(Exception, match="execution failed"):
        owner_contract.get_claimable(args=[provider.address]).call()

    # withdraw() itself is a *write* transaction that reads/mutates
    # self.claimable inside its own WASM execution context, rather than
    # through the isolated `gen_call` read RPC that get_claimable uses.
    # docs/LIVE_PROOF.md's real proof run shows withdraw succeeding despite
    # get_claimable being broken, so verify that holds here too: the
    # documented demo path (settle -> withdraw) works even though the
    # separate read-only balance check does not.
    receipt = provider_contract.withdraw(args=[]).transact(
        wait_transaction_status=TransactionStatus.ACCEPTED,
        wait_interval=WAIT_INTERVAL_MS,
        wait_retries=WAIT_RETRIES,
    )
    assert tx_execution_succeeded(receipt)


def _chain_now(contract) -> int:
    """Best-effort current chain time; falls back to local wall clock.

    The contract has no dedicated clock getter, so this uses local UTC
    time. Studionet block timestamps track wall-clock time closely enough
    for the generous deadlines used in this test.
    """
    return int(time.time())
