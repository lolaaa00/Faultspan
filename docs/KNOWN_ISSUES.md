# Known Issues

## `get_claimable` fails on real Studionet after `settle_case` writes to the claimable ledger

**Status:** Confirmed, reproducible. Blocks the documented withdraw flow
(`FAULTSPAN_MASTER_PLAN.md` sections 3, 7.1, 9) on real GenVM execution.

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
direction — the day this is fixed upstream.

**Isolation performed:**
- `get_claimable` on a fresh, unsettled contract returns `0` successfully
  (confirmed both standalone and in the integration test, before any
  write to the `claimable` TreeMap has occurred).
- `tests/direct/test_faultspan.py::test_settlement_conserves_bonded_value`
  and `test_insufficient_evidence_finding_does_not_slash` exercise the
  exact same `settle_case` → `get_claimable` sequence against gltest's
  in-memory direct-mode simulator and pass cleanly — the settlement
  arithmetic itself is correct. The divergence is specific to real GenVM
  WASM storage execution on Studionet, not to Faultspan's contract logic.
- The failure is keyed to *any* read of the `claimable` TreeMap after its
  first write, not to a specific address or to the amount stored, which
  points at `TreeMap[Address, u256]` handling in the pinned GenVM /
  `py-genlayer-std` runner (`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`,
  see `contracts/faultspan.py`'s `Depends` header) rather than at
  application code.

**Not yet done:** filing this against `genlayerlabs/genvm` upstream, and
testing whether a differently-shaped claimable ledger (e.g. a
`TreeMap[str, u256]` keyed by hex address string instead of `Address`)
works around it. Until resolved, `withdraw()` cannot be safely relied on
in a Studionet demo — the demo path should stop at `settle_case` and
narrate the payout amounts from `get_span(...).finding` / the known bond
math rather than calling `get_claimable` or `withdraw` live.

**Runner pin note:** `contracts/faultspan.py` is pinned to `py-genlayer`
runner hash `1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`, resolved
against genvm release `v0.2.16` — the newest release that still publishes
the `genvm-universal.tar.xz` asset gltest's direct-test runner requires
(the current `v0.3.0-rc7` release dropped that asset name). See
`tests/direct/test_faultspan.py`'s `SDK_VERSION` constant.
