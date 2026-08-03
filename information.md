# Response to Review — Adjudication Integrity & Dispute Incentives

This document addresses the review feedback received on Faultspan and records
exactly what was changed, why, and how each fix was verified.

## What the review said

> This is a very lovely project but the main limitation is its adjudication
> input: `obligation_ref` and delivery references are placed in the prompt as
> strings but never fetched or digest-verified against their actual contents.
> Unavailable or mismatched root terms fall back to a generic rubric instead
> of necessarily producing insufficient evidence. In addition, any
> participant may open a dispute, immediately lock the record, and receive
> all slashed value; this combines control over procedure with a direct
> financial incentive.

**Concerns raised:**
1. The contract does not fetch or verify the actual per-span obligations or
   delivery artifacts whose compliance it adjudicates.
2. The dispute opener can immediately close evidence and receives all
   slashed value, with no mandatory counter-evidence window.
3. Generic fallback terms and activation after only one bonded span can
   allow economically consequential adjudication on a weaker record than
   the documented workflow implies.

All four points were verified against the deployed contract and confirmed
accurate before any fix was made.

---

## What was changed

### 1. Obligation and delivery content is now fetched and digest-verified

**Before:** `adjudicate_case` passed `span.obligation_ref`,
`span.obligation_digest`, and the delivery reference into the LLM prompt as
bare strings. The model was never shown the actual fetched content, and
there was no digest check — it could be asked to judge compliance against
material it never saw.

**After:** the contract now fetches every span's obligation reference and
delivery reference via `gl.nondet.web.get`, computes the real SHA-256 digest,
and includes the fetched (and verified-or-not) content in the prompt —
exactly the same treatment root terms and dispute evidence already received.
A span with no matching verified reference cannot be found `COMPLIED`,
`CAUSED_FAILURE`, or `CONTRIBUTED_TO_FAILURE` from that gap alone.

### 2. Unverifiable root terms now force abstention, deterministically

**Before:** if root terms couldn't be fetched or their digest didn't match,
the contract fell back to a generic compliance standard and let the model
adjudicate against it anyway.

**After:** the contract itself (not the model) computes whether the root
terms digest actually matched, and — after consensus — deterministically
overrides every finding to `INSUFFICIENT_EVIDENCE` and `caseSatisfied` to
`false` if it did not verify. This override is enforced on both the
persisted contract state and the value returned to the caller, and it holds
even if the model claims otherwise (tested explicitly: see below). Each
validator computes this independently, so agreement requires genuinely
matching the real fetch outcome, not trusting one validator's report of it.

### 3. Nobody — including the disputant — can lock evidence instantly, and disputing no longer pays

**Before:** the dispute claimant could call `lock_evidence` the instant a
dispute opened, with no window for anyone else to submit counter-evidence.
Slashed bond value was credited entirely to `case.claimant` — the same
account that controlled when the evidence window closed.

**After:**
- `lock_evidence` now requires a minimum window (`MIN_EVIDENCE_WINDOW_SECONDS`,
  set to one hour) to elapse from when the dispute opened, before *anyone*
  — including the claimant — may lock. This is a floor chosen to make
  "instant self-lock" structurally impossible without stalling a case
  indefinitely.
- Slashed value now flows to `case.owner` (the party the root commitment
  was made to), never to `case.claimant`. Opening a dispute no longer
  carries any direct financial upside for the party that opens it.

### 4. Disputes can no longer run on an incomplete graph

**Before:** a case became `ACTIVE` — and therefore disputable — the moment
a single registered span was bonded. Other registered spans could remain
`PROPOSED` (their providers never committed) while a dispute, adjudication,
and real slashing proceeded anyway.

**After:** `open_dispute` now requires every registered span for the case
to be bonded (not `PROPOSED`) before it will proceed.

---

## Verification performed

- **Static analysis:** `genvm-lint` passes clean on the modified contract.
- **Direct tests:** 34 of 34 pass in `tests/direct/test_faultspan.py`,
  including six new tests written specifically to prove these fixes:
  - a test where the mocked model *lies* — claims full compliance and
    claims the root terms verified — and the contract still forces
    abstention on both the returned verdict and persisted state;
  - a test proving a dispute cannot open while any span is still `PROPOSED`;
  - a test proving the claimant cannot lock evidence before the minimum
    window elapses (nor can anyone else);
  - a test proving slashed value is credited to `case.owner`, not to a
    non-owner participant who opened the dispute;
  - a test proving the adjudication prompt genuinely contains fetched,
    digest-verified delivery content (the mock LLM response only matches if
    the prompt contains a marker unique to the fetched body, so the test
    fails if the contract stops actually fetching it).
- **Live network:** the fixed contract was redeployed to GenLayer Studionet
  at `0x161275d7E8b18C58E0C88518c74BD036c96F998C`, reaching 5-of-5 validator
  consensus on deployment. Its schema was confirmed to match every frontend
  call site exactly (`scripts/verify-schema.ts`). A dedicated live-network
  script (`scripts/studionet-fix-smoke.ts`) then drove real transactions
  against the redeployed contract and confirmed, on real consensus:
  - `open_dispute` correctly reverts while a registered span is still
    `PROPOSED`;
  - `open_dispute` succeeds once every span is bonded;
  - `lock_evidence` correctly reverts immediately after a dispute opens,
    before the minimum counter-evidence window has elapsed.
- **End-to-end:** the frontend, backend, and all documentation were updated
  to point at the redeployed contract address, and the full CI pipeline
  (typecheck/lint/unit tests, contract lint + tests, schema alignment,
  Playwright e2e, secret scanning) passes on the final commit.

## Where this is documented in the repo

- [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) — the permanent, detailed
  record of this review and fix, kept alongside the project's other
  documented issues for anyone auditing the contract's history.
- [`docs/LIVE_PROOF.md`](docs/LIVE_PROOF.md) — updated to note the contract
  has been redeployed twice since that proof run, and why.
- [`contracts/faultspan.py`](contracts/faultspan.py) — inline comments at
  each changed section explain the reasoning at the point of the code.

## Net effect

Every specific issue the review raised is fixed at the contract level, not
papered over in the frontend or documentation. The fixes were designed so
that none of them can be silently defeated by the model's own output —
each one is either a fetch the contract performs and verifies itself, or a
deterministic check the contract enforces regardless of what the model
returns.
