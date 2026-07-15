# Faultspan Second Live Proof Runbook

This runbook is for the stronger contrast case: span-correct evidence intended to produce a causal attribution outcome instead of `INSUFFICIENT_EVIDENCE`.

## Goal

Produce a second live Studionet case where:

- the evidence object digest matches
- the evidence body names the correct disputed span
- the evidence narrative ties the failed final outcome to the analysis span
- adjudication is more likely to return `CAUSED_FAILURE` or `CONTRIBUTED_TO_FAILURE`

## Script

Use:

```powershell
npm run test:studionet:second-proof
```

## Required environment variables

- `FAULTSPAN_CONTRACT_ADDRESS`
- `TEST_PRIVATE_KEY`
- `PLATFORM_API_URL`

Optional:

- `FAULTSPAN_SECOND_PROOF_TITLE`
- `FAULTSPAN_CASE_ID`
- `FAULTSPAN_COORDINATOR_ADDRESS`

## What the script does

1. creates a fresh case
2. registers research, analysis, and writing spans
3. accepts all spans with bonds
4. submits delivery for all spans
5. stores a span-correct evidence bundle for the analysis span
6. opens a dispute
7. links evidence to the analysis span
8. locks evidence
9. adjudicates
10. settles
11. withdraws

## Important note

The script is designed to improve the chance of a stronger causal attribution, but the final GenLayer finding still depends on validator interpretation of the evidence bundle and adjudication prompt.

Do not claim `CAUSED_FAILURE` until the actual finalized result shows it.
