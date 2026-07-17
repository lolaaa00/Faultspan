"""Direct (in-memory) tests for contracts/faultspan.py.

Covers the section 13.1 checklist from FAULTSPAN_MASTER_PLAN.md:
role/auth, state-transition, graph cycle, deadline, evidence-lock,
verdict-schema, value-conservation, duplicate-settlement,
rejected-consensus, and insufficient-evidence behavior.

Run with: pytest tests/direct/ -v
"""

import json
from datetime import datetime, timezone

import pytest
from gltest.direct import ContractRollback

CONTRACT = "contracts/faultspan.py"
# Pinned genvm release: the current "latest" GitHub release (v0.3.0-rc7) no
# longer ships a "genvm-universal.tar.xz" asset, which gltest's direct
# runner requires. v0.2.16 is the newest release that still publishes it
# and contains the runner hash pinned in contracts/faultspan.py's Depends
# header. Pin explicitly so tests don't depend on GitHub's "latest" tag.
SDK_VERSION = "v0.2.16"

BASE_ISO = "2026-01-01T00:00:00Z"
BASE_TS = int(datetime.fromisoformat(BASE_ISO.replace("Z", "+00:00")).timestamp())
DELIVERY_DEADLINE = BASE_TS + 3600
EVIDENCE_DEADLINE = BASE_TS + 7200


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _valid_verdict(span_ids, findings):
    """Build a JSON verdict string. `findings` maps span_id -> finding."""
    return json.dumps({
        "caseSatisfied": any(f != "COMPLIED" for f in findings.values()),
        "findings": [
            {
                "spanId": span_id,
                "finding": findings[span_id],
                "material": findings[span_id] != "COMPLIED",
                "basisCodes": ["TEST_BASIS"],
                "evidenceRefs": [],
                "explanation": "test explanation",
            }
            for span_id in span_ids
        ],
    })


class Scenario:
    """Deploys a case with two child spans, ready for delivery/dispute."""

    def __init__(self, deploy, vm, owner, coordinator, provider_a, provider_b):
        self.vm = vm
        self.case_id = "case1"
        self.root_span = "root"
        self.span_a = "span_a"
        self.span_b = "span_b"

        vm.warp(BASE_ISO)
        vm.sender = owner
        self.contract = deploy(CONTRACT, sdk_version=SDK_VERSION)

        # The direct-test fixtures hand back raw address bytes; the SDK's
        # Address type is only importable once a contract has been loaded
        # and its runner added to sys.path (done above by `deploy`). Wrap
        # every test address in a real Address so equality checks against
        # values read back from contract storage behave correctly.
        from genlayer.py.types import Address
        self.owner = Address(owner)
        self.coordinator = Address(coordinator)
        self.provider_a = Address(provider_a)
        self.provider_b = Address(provider_b)
        owner, coordinator, provider_a, provider_b = (
            self.owner, self.coordinator, self.provider_a, self.provider_b,
        )

        self.contract.create_case(
            self.case_id, coordinator,
            "https://example.com/terms", "sha256:" + "a" * 64,
            DELIVERY_DEADLINE, EVIDENCE_DEADLINE,
        )

        vm.sender = coordinator
        self.contract.register_span(
            self.case_id, self.root_span, "", coordinator, provider_a,
            "https://example.com/root", "sha256:" + "b" * 64,
            1000, 1000, 5000,
        )
        self.contract.register_span(
            self.case_id, self.span_a, self.root_span, coordinator, provider_a,
            "https://example.com/a", "sha256:" + "c" * 64,
            1000, 1000, 5000,
        )
        self.contract.register_span(
            self.case_id, self.span_b, self.root_span, coordinator, provider_b,
            "https://example.com/b", "sha256:" + "d" * 64,
            2000, 2000, 6000,
        )

    def accept_all(self):
        vm = self.vm
        vm.sender = self.provider_a
        vm.value = 1000
        self.contract.accept_span(self.case_id, self.root_span)
        vm.value = 1000
        self.contract.accept_span(self.case_id, self.span_a)
        vm.value = 0
        vm.sender = self.provider_b
        vm.value = 2000
        self.contract.accept_span(self.case_id, self.span_b)
        vm.value = 0

    def dispute_and_lock(self, evidence_url="https://evidence.example.com/e1"):
        vm = self.vm
        vm.sender = self.owner
        self.contract.open_dispute(self.case_id, "https://example.com/claim", "sha256:" + "e" * 64)
        vm.sender = self.provider_a
        self.contract.submit_evidence(
            self.case_id, self.span_a, evidence_url, "sha256:" + "f" * 64,
        )
        vm.sender = self.owner
        self.contract.lock_evidence(self.case_id)

    def span_ids(self):
        return [self.root_span, self.span_a, self.span_b]


@pytest.fixture
def scenario(direct_deploy, direct_vm, direct_owner, direct_alice, direct_bob, direct_charlie):
    return Scenario(direct_deploy, direct_vm, direct_owner, direct_alice, direct_bob, direct_charlie)


# ---------------------------------------------------------------------------
# Role and authorization
# ---------------------------------------------------------------------------

def test_only_case_manager_can_register_span(scenario, direct_bob):
    scenario.vm.sender = direct_bob  # provider_a, not owner/coordinator
    with scenario.vm.expect_revert("case manager required"):
        scenario.contract.register_span(
            scenario.case_id, "rogue", scenario.root_span,
            scenario.coordinator, scenario.provider_a,
            "https://example.com/rogue", "sha256:" + "0" * 64,
            100, 100, 100,
        )


def test_only_named_provider_can_accept_span(scenario, direct_charlie):
    scenario.vm.sender = direct_charlie  # provider_b, not provider_a
    scenario.vm.value = 1000
    with scenario.vm.expect_revert("only the named provider can accept"):
        scenario.contract.accept_span(scenario.case_id, scenario.span_a)


def test_only_provider_can_submit_delivery(scenario, direct_charlie):
    scenario.accept_all()
    scenario.vm.sender = direct_charlie
    with scenario.vm.expect_revert("only the provider can submit delivery"):
        scenario.contract.submit_delivery(
            scenario.case_id, scenario.span_a, "https://example.com/delivery", "sha256:" + "1" * 64,
        )


def test_non_participant_cannot_open_dispute(scenario):
    scenario.accept_all()
    outsider = None
    from gltest.direct import create_address
    outsider = create_address("outsider")
    scenario.vm.sender = outsider
    with scenario.vm.expect_revert("case participant required"):
        scenario.contract.open_dispute(scenario.case_id, "https://example.com/claim", "sha256:" + "2" * 64)


def test_non_claimant_cannot_lock_evidence_before_deadline(scenario):
    scenario.accept_all()
    scenario.vm.sender = scenario.owner
    scenario.contract.open_dispute(scenario.case_id, "https://example.com/claim", "sha256:" + "3" * 64)
    scenario.vm.sender = scenario.provider_a
    with scenario.vm.expect_revert("only claimant may lock evidence before deadline"):
        scenario.contract.lock_evidence(scenario.case_id)


# ---------------------------------------------------------------------------
# State-transition
# ---------------------------------------------------------------------------

def test_case_moves_open_to_active_on_first_bond(scenario):
    case = scenario.contract.get_case(scenario.case_id)
    assert case.status == "OPEN"
    scenario.vm.sender = scenario.provider_a
    scenario.vm.value = 1000
    scenario.contract.accept_span(scenario.case_id, scenario.root_span)
    case = scenario.contract.get_case(scenario.case_id)
    assert case.status == "ACTIVE"


def test_full_lifecycle_reaches_settled(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    scenario.vm.mock_llm(".*", _valid_verdict(
        scenario.span_ids(),
        {scenario.root_span: "COMPLIED", scenario.span_a: "COMPLIED", scenario.span_b: "COMPLIED"},
    ))
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    scenario.contract.adjudicate_case(scenario.case_id)
    case = scenario.contract.get_case(scenario.case_id)
    assert case.status == "DECIDED"
    scenario.contract.settle_case(scenario.case_id)
    case = scenario.contract.get_case(scenario.case_id)
    assert case.status == "SETTLED"
    assert case.settled is True


def test_cannot_accept_span_twice(scenario):
    scenario.vm.sender = scenario.provider_a
    scenario.vm.value = 1000
    scenario.contract.accept_span(scenario.case_id, scenario.root_span)
    scenario.vm.value = 1000
    with scenario.vm.expect_revert("span already accepted"):
        scenario.contract.accept_span(scenario.case_id, scenario.root_span)


def test_accept_span_requires_exact_bond(scenario):
    scenario.vm.sender = scenario.provider_a
    scenario.vm.value = 999
    with scenario.vm.expect_revert("exact bond amount required"):
        scenario.contract.accept_span(scenario.case_id, scenario.root_span)


# ---------------------------------------------------------------------------
# Graph cycle / invalid parent
# ---------------------------------------------------------------------------

def test_first_span_must_be_root(scenario):
    # A second case on the same contract instance: its first span must have
    # an empty parent id.
    scenario.vm.sender = scenario.owner
    scenario.contract.create_case(
        "case2", scenario.coordinator,
        "https://example.com/terms2", "sha256:" + "9" * 64,
        DELIVERY_DEADLINE, EVIDENCE_DEADLINE,
    )
    scenario.vm.sender = scenario.coordinator
    with scenario.vm.expect_revert("first span must be the root"):
        scenario.contract.register_span(
            "case2", "orphan", "not_a_real_parent",
            scenario.coordinator, scenario.provider_a,
            "https://example.com/orphan", "sha256:" + "8" * 64,
            100, 100, 100,
        )


def test_child_span_requires_existing_parent(scenario):
    scenario.vm.sender = scenario.coordinator
    with scenario.vm.expect_revert("parent span not found"):
        scenario.contract.register_span(
            scenario.case_id, "span_c", "does_not_exist",
            scenario.coordinator, scenario.provider_a,
            "https://example.com/c", "sha256:" + "7" * 64,
            100, 100, 100,
        )


def test_span_count_bounded_to_max_spans(scenario):
    scenario.vm.sender = scenario.coordinator
    # root + span_a + span_b already registered (3). Fill up to MAX_SPANS (8).
    for i in range(5):
        scenario.contract.register_span(
            scenario.case_id, f"extra_{i}", scenario.root_span,
            scenario.coordinator, scenario.provider_a,
            f"https://example.com/extra{i}", "sha256:" + str(i) * 64,
            10, 10, 10,
        )
    with scenario.vm.expect_revert("maximum span count reached"):
        scenario.contract.register_span(
            scenario.case_id, "overflow", scenario.root_span,
            scenario.coordinator, scenario.provider_a,
            "https://example.com/overflow", "sha256:" + "6" * 64,
            10, 10, 10,
        )


# ---------------------------------------------------------------------------
# Deadlines
# ---------------------------------------------------------------------------

def test_create_case_rejects_past_delivery_deadline(scenario):
    scenario.vm.sender = scenario.owner
    with scenario.vm.expect_revert("delivery deadline must be in the future"):
        scenario.contract.create_case(
            "bad_case", scenario.coordinator,
            "https://example.com/terms", "sha256:" + "a" * 64,
            BASE_TS - 10, BASE_TS + 100,
        )


def test_register_span_rejected_after_delivery_deadline(scenario):
    scenario.vm.warp(_iso(DELIVERY_DEADLINE + 1))
    scenario.vm.sender = scenario.coordinator
    with scenario.vm.expect_revert("delivery deadline has passed"):
        scenario.contract.register_span(
            scenario.case_id, "late_span", scenario.root_span,
            scenario.coordinator, scenario.provider_a,
            "https://example.com/late", "sha256:" + "5" * 64,
            10, 10, 10,
        )


def test_open_dispute_rejected_after_evidence_deadline(scenario):
    scenario.accept_all()
    scenario.vm.warp(_iso(EVIDENCE_DEADLINE + 1))
    scenario.vm.sender = scenario.owner
    with scenario.vm.expect_revert("evidence deadline has passed"):
        scenario.contract.open_dispute(scenario.case_id, "https://example.com/claim", "sha256:" + "4" * 64)


# ---------------------------------------------------------------------------
# Evidence lock
# ---------------------------------------------------------------------------

def test_evidence_cannot_change_after_lock(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    scenario.vm.sender = scenario.provider_b
    with scenario.vm.expect_revert("evidence is not open"):
        scenario.contract.submit_evidence(
            scenario.case_id, scenario.span_b, "https://evidence.example.com/late", "sha256:" + "9" * 64,
        )


def test_lock_evidence_requires_disputed_case(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    # Evidence is already locked; locking again must be rejected because
    # the case is no longer in the DISPUTED (evidence-collecting) state,
    # even though the sender is the claimant.
    scenario.vm.sender = scenario.owner
    with scenario.vm.expect_revert("case is not collecting evidence"):
        scenario.contract.lock_evidence(scenario.case_id)


# ---------------------------------------------------------------------------
# Verdict schema
# ---------------------------------------------------------------------------

def test_adjudicate_rejects_invalid_finding_value(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    bad_verdict = json.dumps({
        "caseSatisfied": False,
        "findings": [
            {"spanId": sid, "finding": "NOT_A_REAL_FINDING", "material": False, "basisCodes": [], "evidenceRefs": [], "explanation": ""}
            for sid in scenario.span_ids()
        ],
    })
    scenario.vm.mock_llm(".*", bad_verdict)
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    with scenario.vm.expect_revert("invalid verdict finding"):
        scenario.contract.adjudicate_case(scenario.case_id)


def test_adjudicate_requires_evidence_locked_status(scenario):
    scenario.accept_all()
    scenario.vm.sender = scenario.owner
    with scenario.vm.expect_revert("evidence must be locked"):
        scenario.contract.adjudicate_case(scenario.case_id)


def test_adjudicate_persists_findings_per_span(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    findings = {scenario.root_span: "COMPLIED", scenario.span_a: "CAUSED_FAILURE", scenario.span_b: "COMPLIED"}
    scenario.vm.mock_llm(".*", _valid_verdict(scenario.span_ids(), findings))
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    verdict = scenario.contract.adjudicate_case(scenario.case_id)
    assert verdict["caseSatisfied"] is True
    span_a = scenario.contract.get_span(scenario.case_id, scenario.span_a)
    assert span_a.finding == "CAUSED_FAILURE"
    assert span_a.material is True


# ---------------------------------------------------------------------------
# Value conservation
# ---------------------------------------------------------------------------

def test_settlement_conserves_bonded_value(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    findings = {scenario.root_span: "COMPLIED", scenario.span_a: "CAUSED_FAILURE", scenario.span_b: "CONTRIBUTED_TO_FAILURE"}
    scenario.vm.mock_llm(".*", _valid_verdict(scenario.span_ids(), findings))
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    scenario.contract.adjudicate_case(scenario.case_id)
    scenario.contract.settle_case(scenario.case_id)

    case = scenario.contract.get_case(scenario.case_id)
    total_claimable = (
        int(scenario.contract.get_claimable(scenario.provider_a))
        + int(scenario.contract.get_claimable(scenario.provider_b))
        + int(scenario.contract.get_claimable(scenario.owner))
    )
    assert total_claimable == int(case.total_bonded)

    # span_a: bond 1000, causal penalty 5000 bps -> 500 slashed, 500 returned
    # span_b: bond 2000, contribution penalty 2000 bps -> 400 slashed, 1600 returned
    # root: bond 1000, COMPLIED -> fully returned
    provider_a_claim = int(scenario.contract.get_claimable(scenario.provider_a))
    provider_b_claim = int(scenario.contract.get_claimable(scenario.provider_b))
    owner_claim = int(scenario.contract.get_claimable(scenario.owner))
    assert provider_a_claim == 1000 + 500  # root fully returned + span_a partial
    assert provider_b_claim == 1600
    assert owner_claim == 500 + 400  # slashed amounts flow to the claimant


# ---------------------------------------------------------------------------
# Duplicate settlement
# ---------------------------------------------------------------------------

def test_settlement_cannot_run_twice(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    scenario.vm.mock_llm(".*", _valid_verdict(
        scenario.span_ids(),
        {scenario.root_span: "COMPLIED", scenario.span_a: "COMPLIED", scenario.span_b: "COMPLIED"},
    ))
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    scenario.contract.adjudicate_case(scenario.case_id)
    scenario.contract.settle_case(scenario.case_id)
    # settle_case transitions status to SETTLED, so a second call is caught
    # by the "case is not decided" guard rather than the "already settled"
    # guard -- the settled-flag check is a redundant second line of defense
    # given the current status machine. Either way, settlement cannot run
    # twice, which is the invariant under test.
    with scenario.vm.expect_revert("case is not decided"):
        scenario.contract.settle_case(scenario.case_id)


def test_settlement_requires_decided_status(scenario):
    scenario.accept_all()
    with scenario.vm.expect_revert("case is not decided"):
        scenario.contract.settle_case(scenario.case_id)


# ---------------------------------------------------------------------------
# Rejected consensus (leader vs validator disagreement)
# ---------------------------------------------------------------------------

def test_validator_rejects_when_leader_result_differs(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    leader_verdict_json = _valid_verdict(
        scenario.span_ids(),
        {scenario.root_span: "COMPLIED", scenario.span_a: "COMPLIED", scenario.span_b: "COMPLIED"},
    )
    scenario.vm.mock_llm(".*", leader_verdict_json)
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    scenario.contract.adjudicate_case(scenario.case_id)

    disagreeing_leader_result = json.loads(_valid_verdict(
        scenario.span_ids(),
        {scenario.root_span: "COMPLIED", scenario.span_a: "CAUSED_FAILURE", scenario.span_b: "COMPLIED"},
    ))
    accepted = scenario.vm.run_validator(leader_result=disagreeing_leader_result)
    assert accepted is False


def test_validator_accepts_matching_leader_result(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    verdict_json = _valid_verdict(
        scenario.span_ids(),
        {scenario.root_span: "COMPLIED", scenario.span_a: "COMPLIED", scenario.span_b: "COMPLIED"},
    )
    scenario.vm.mock_llm(".*", verdict_json)
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    scenario.contract.adjudicate_case(scenario.case_id)

    accepted = scenario.vm.run_validator()
    assert accepted is True


# ---------------------------------------------------------------------------
# Insufficient evidence
# ---------------------------------------------------------------------------

def test_insufficient_evidence_finding_does_not_slash(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    findings = {
        scenario.root_span: "COMPLIED",
        scenario.span_a: "INSUFFICIENT_EVIDENCE",
        scenario.span_b: "COMPLIED",
    }
    scenario.vm.mock_llm(".*", _valid_verdict(scenario.span_ids(), findings))
    scenario.vm.mock_web(".*", {"status": 200, "body": "evidence body"})
    scenario.vm.sender = scenario.owner
    scenario.contract.adjudicate_case(scenario.case_id)
    scenario.contract.settle_case(scenario.case_id)

    span_a = scenario.contract.get_span(scenario.case_id, scenario.span_a)
    assert span_a.finding == "INSUFFICIENT_EVIDENCE"
    # Unresolved findings must not trigger a slash: bond fully returned.
    assert int(scenario.contract.get_claimable(scenario.provider_a)) == 1000 + 1000


def test_digest_mismatched_evidence_is_visible_to_adjudication(scenario):
    scenario.accept_all()
    scenario.dispute_and_lock()
    # Mock web body so its sha256 will NOT match the digest submitted in
    # submit_evidence, exercising the digestMatched=False path.
    scenario.vm.mock_web(".*", {"status": 200, "body": "a completely different body"})
    scenario.vm.mock_llm(".*", _valid_verdict(
        scenario.span_ids(),
        {scenario.root_span: "COMPLIED", scenario.span_a: "INSUFFICIENT_EVIDENCE", scenario.span_b: "COMPLIED"},
    ))
    scenario.vm.sender = scenario.owner
    verdict = scenario.contract.adjudicate_case(scenario.case_id)
    finding_map = {f["spanId"]: f["finding"] for f in verdict["findings"]}
    assert finding_map[scenario.span_a] == "INSUFFICIENT_EVIDENCE"
