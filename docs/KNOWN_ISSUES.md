# Known Issues

## Resolved: adjudication-integrity and dispute-incentive gaps (external review)

**Status:** Fixed and redeployed. Contract address changed from
`0x6Bd6be8Ab30f4C3F39e038383fe3d2A49b212DDb` to
`0x161275d7E8b18C58E0C88518c74BD036c96F998C`.

An external review of `contracts/faultspan.py` identified four real,
verified gaps in the deployed contract:

1. **`adjudicate_case` never fetched or digest-verified `span.obligation_ref`
   or the delivery reference set by `submit_delivery`.** They were passed
   into the adjudication prompt as bare, unverified strings — the model
   could be asked to judge compliance against content it never actually saw.
   **Fix:** the contract now fetches and digest-verifies each span's
   obligation and delivery reference the same way it already did for root
   terms and dispute evidence, and tells the model a span is unverified
   (must return `INSUFFICIENT_EVIDENCE`) unless the fetched digest matches.

2. **When root terms could not be fetched or digest-verified, the contract
   let the model adjudicate against a generic fallback standard instead of
   forcing abstention.** **Fix:** the contract now computes the digest
   match itself (not the model's self-report) and deterministically
   overrides every finding to `INSUFFICIENT_EVIDENCE` and `caseSatisfied` to
   `false` when it doesn't verify — enforced on both the returned value and
   persisted storage, regardless of what the model claims. Each validator
   computes this independently, so consensus requires genuine agreement on
   the real fetch outcome, not a shared trust in one validator's report.

3. **Any participant could open a dispute, immediately lock the evidence
   record with no counter-evidence window, and receive 100% of any slashed
   value as `case.claimant`.** The same actor controlled dispute procedure
   and had a direct financial incentive from its outcome. **Fix:**
   `lock_evidence` now requires `MIN_EVIDENCE_WINDOW_SECONDS` (1 hour) to
   elapse since the dispute opened before *anyone*, including the claimant,
   may lock — and slashed value now flows to `case.owner`, never to
   `case.claimant`, decoupling who can trigger a dispute from who profits.

4. **`open_dispute` only required the case to be `ACTIVE`**, which happens
   the moment a single span is bonded — a dispute (and real slashing) could
   run while other registered spans were still `PROPOSED`, i.e. their
   providers never committed at all. **Fix:** `open_dispute` now requires
   every registered span to be bonded first.

**Verification performed:**
- `genvm-lint`: clean.
- `tests/direct/test_faultspan.py`: 34/34 pass, including six new tests
  written specifically to prove each fix — notably one where the mocked
  model *lies* (claims full compliance and claims the root terms verified)
  and the contract still forces abstention, proving the override does not
  trust the model's self-report.
- Live Studionet: the redeployed contract's schema matches
  `scripts/verify-schema.ts` exactly. `scripts/studionet-fix-smoke.ts` drove
  real transactions against the live redeployed contract and confirmed, on
  real consensus: `open_dispute` correctly reverts while a span is still
  `PROPOSED`; `open_dispute` succeeds once all spans are bonded;
  `lock_evidence` correctly reverts immediately after a dispute opens,
  before the minimum window elapses.
- The `MIN_EVIDENCE_WINDOW_SECONDS` real-time wait (1 hour) means
  `tests/integration/test_faultspan_studionet.py` now takes roughly an hour
  end to end instead of 1–3 minutes; it remains an on-demand/weekly job,
  not part of per-push CI (see `.github/workflows/studionet-smoke.yml`).

## `get_claimable` fails on real Studionet after `settle_case` writes to the claimable ledger

**Status:** Confirmed, reproducible, unresolved. Blocks the documented
withdraw-balance-check flow (`FAULTSPAN_MASTER_PLAN.md` sections 3, 7.1,
9) on real GenVM execution. `withdraw()` itself is unaffected (see below).

**Symptom:** After `settle_case` runs (its first write into
`self.claimable: TreeMap[Address, u256]`), every subsequent
`get_claimable(account)` view call fails with:

```
genlayer_py.exceptions.GenLayerError: gen_call failed (code=-32000): execution failed
```

This happens for **any** address argument, including addresses the
contract never wrote a claimable entry for. `get_case` and `get_span`
(views over `TreeMap[str, CaseRecord]` / `TreeMap[str, SpanRecord]`)
continue to work correctly against the same contract instance after the
same settlement transaction.

**Reproduction:** `tests/integration/test_faultspan_studionet.py` deploys
a fresh contract, runs a full case through `settle_case` on live
Studionet, and asserts this failure explicitly (`pytest.raises`) so the
test documents current behavior and will fail loudly — in the useful
direction — the day this is fixed upstream. Reproduced on 3 independent
fresh deployments.

**Isolation performed:**
- `get_claimable` on a fresh, unsettled contract returns `0` successfully
  (confirmed both standalone and in the integration test, before any
  write to the `claimable` TreeMap has occurred) — so this is not an
  argument-encoding problem; the exact same call shape succeeds before
  the map is written to and fails after.
- `tests/direct/test_faultspan.py::test_settlement_conserves_bonded_value`
  and `test_insufficient_evidence_finding_does_not_slash` exercise the
  exact same `settle_case` → `get_claimable` sequence against gltest's
  in-memory direct-mode simulator and pass cleanly — the settlement
  arithmetic itself is correct. The divergence is specific to real GenVM
  WASM storage execution on Studionet, not to Faultspan's contract logic.
- **Ruled out "Address keys are the cause":** we tried changing
  `claimable` to `TreeMap[str, u256]` (keyed by `address.as_hex` via a
  `_claim_key` helper) as a workaround. Re-run live on Studionet, the
  identical failure reproduced for the str-keyed map too. This was
  reverted (see `git log` — the workaround added complexity without
  fixing anything, so it was not kept).
- **Ruled out "any `TreeMap[Address, u256]` breaks after its first
  write":** a minimal single-class standalone contract
  (`balances: TreeMap[Address, u256]`, one write method, one view
  method, addresses explicitly normalized) deployed fresh to Studionet,
  wrote a value, and read it back successfully — for both the written
  address and an untouched one. So the bug is **not** reproducible from
  the bare pattern GenLayer's own docs demonstrate for balances; it
  depends on something specific to Faultspan's actual contract (e.g. the
  interaction between `claimable` and its other TreeMaps — `cases`,
  `spans`, `case_span_ids` — the `_Recipient` EVM interface, or the
  length of the transaction history on the contract by the time
  `settle_case` runs). **Root cause remains unidentified.**
- **A separate, unrelated bug we found and discarded along the way:** an
  earlier throwaway minimal contract (`Balances`, not part of this repo)
  with a `set_balance(self, account: Address, amount: u256)` write method
  that did *not* normalize `account` first failed differently —
  `AttributeError: 'str' object has no attribute 'as_bytes'` inside
  `genlayer/py/storage/tree_map.py`'s key-insertion path. That is a real
  but *different* gotcha (write-call `Address`-typed parameters are not
  auto-coerced from the hex string in calldata; the contract must
  normalize them itself, which every Faultspan write method already
  does via `self._normalize_address`) and does not explain the
  `get_claimable` symptom. Do not conflate the two.

**Not yet done:** filing this against `genlayerlabs/genvm` upstream. Three
minimal-repro attempts across one session did not reproduce the bug in
isolation (two hit unrelated failures of their own; the third — the
cleanest, most faithful reduction — worked correctly and did not
reproduce it at all). **Do not file upstream with "TreeMap[Address,u256]
breaks after write" as the claim — that claim is now disproven by the
minimal repro.** The actual trigger condition inside Faultspan's contract
is still unknown and needs more investigation (most likely candidate:
something about the interaction with Faultspan's other TreeMaps or its
longer transaction history) before a credible upstream report can be
written. Until resolved, live demos should avoid calling `get_claimable`
on stage and should stop the narrated flow at `settle_case`, or call
`withdraw()` directly (which works — see below) and narrate the amount
from the known bond math / `get_span(...).finding` instead of a live
balance read.

**What still works despite this bug:** `withdraw()` is a *write*
transaction that reads/mutates `self.claimable` inside its own WASM
execution context, not through the isolated `gen_call` read RPC that
`get_claimable` uses. `docs/LIVE_PROOF.md`'s real proof run shows
`withdraw` succeeding, and `tests/integration/test_faultspan_studionet.py`
verifies this holds on every run: `settle_case` → `withdraw()` succeeds
end to end even though the separate read-only balance check does not.

**Runner pin note:** `contracts/faultspan.py` is pinned to `py-genlayer`
runner hash `1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`, resolved
against genvm release `v0.2.16` — the newest release that still publishes
the `genvm-universal.tar.xz` asset gltest's direct-test runner requires
(the current `v0.3.0-rc7` release dropped that asset name). See
`tests/direct/test_faultspan.py`'s `SDK_VERSION` constant.
