# Known Issues

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
