# Faultspan Live Studionet Proof

This document records the real GenLayer Studionet case used to prove the end-to-end Faultspan dispute flow with live transactions, live evidence fetch, live adjudication, and deterministic settlement.

## Environment

- Network: GenLayer Studionet
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- SDK: `genlayer-js@1.1.8`
- Contract: `0x23B6F12322d811918c4Ca5De210529d6cB09Df5D`

## Verified case

- Case ID: `produce-a-buyer-ready-market-intelligence--mrlgwkai`
- Evidence digest: `sha256:9499b02263c22e4cc1f5a435787fa94aa8e272faae964e28f8402680cf620383`
- Evidence URL: [faultspan-platform.delealufejoel.workers.dev/v1/evidence/9499b02263c22e4cc1f5a435787fa94aa8e272faae964e28f8402680cf620383](https://faultspan-platform.delealufejoel.workers.dev/v1/evidence/9499b02263c22e4cc1f5a435787fa94aa8e272faae964e28f8402680cf620383)
- Disputed span: `produce-a-buyer-ready-market-intelligence--writing`

## Transaction record

### Dispute and evidence

- `open_dispute`
  - `0x08ab85f57e5a28a0568765c955c816b2ad6aff12b9ad03a1d0379229013a1ce8`
- Duplicate `open_dispute` rollback
  - `0xc835f175a7def712fa44bead0652216f211523613eab3f7ef8639629ed8215ba`
- `submit_evidence`
  - `0x3031aebd9ccf6127c5b224a4a38586d4b696b596e399eb0a5377cbf24009273a`
- `lock_evidence`
  - `0xa303fbafad8f4cac35743f48386b59f10923cddcbf36d61ec4fea131836b9f4e`

### Adjudication and settlement

- `adjudicate_case`
  - `0x6eec19386e885c36ee569e6d9abf4195e552d92b1dc6a18a30c828f9c58b56b1`
- `settle_case`
  - `0x601edf03416d155313f858c5bf03750d21090159150fcf2c75d301086d63a753`
- `withdraw`
  - `0xc492e18fe200d97e3cf42a3d0edf89351a3ca73257441a083ee425cc3440a3cd`

## Final case state

- `status`: `SETTLED`
- `settled`: `true`
- `evidence_locked`: `true`
- `span_count`: `3`
- `total_bonded`: `3000000000000000` wei (`0.003 GEN`)
- `total_slashed`: `0`
- `case_satisfied`: `false`

The final evidence manifest included:

- `https://faultspan-platform.delealufejoel.workers.dev/v1/evidence/9499b02263c22e4cc1f5a435787fa94aa8e272faae964e28f8402680cf620383#sha256:9499b02263c22e4cc1f5a435787fa94aa8e272faae964e28f8402680cf620383`
- `produce-a-buyer-ready-market-intelligence--writing=https://faultspan-platform.delealufejoel.workers.dev/v1/evidence/9499b02263c22e4cc1f5a435787fa94aa8e272faae964e28f8402680cf620383#sha256:9499b02263c22e4cc1f5a435787fa94aa8e272faae964e28f8402680cf620383`

## Final writing span state

- `finding`: `INSUFFICIENT_EVIDENCE`
- `material`: `true`
- `status`: `DELIVERED`
- `bond_required`: `1000000000000000` wei (`0.001 GEN`)
- `bond_posted`: `1000000000000000` wei (`0.001 GEN`)
- `basis_codes`: `["EVIDENCE_WRONG_SPAN", "EVIDENCE_AMBIGUOUS"]`

Validator explanation:

> The fetched evidence associated to the writing span digest-matches, but its body identifies `span_id` as the research span and contains research obligation text, not writing delivery. That makes the writing evidence span-mismatched and insufficient to determine compliance or causal breach.

## What this proves

This run proves the following with live Studionet transactions:

- real case state was read from the deployed contract
- real evidence was stored by the backend and fetched through its public URL
- live validator adjudication inspected evidence content, not only hash equality
- evidence lock, adjudication, settlement, and withdrawal all reached finalized receipts
- the product can record and replay the full transaction chain with real hashes

It also proves that Faultspan can return an honest `INSUFFICIENT_EVIDENCE` result when the submitted evidence is validly stored but attached to the wrong span.

## Current interpretation

This is not the exact “analysis caused failure” happy-path scenario from the original master plan. It is still a valid and valuable live proof because it demonstrates:

- the GenLayer-native evidence fetch path
- semantic evidence evaluation
- end-to-end settlement flow
- honest handling of ambiguous or mismatched evidence

The next live scenario to capture is a contrasting case where the evidence is span-correct and the adjudication produces a stronger causal attribution outcome.
