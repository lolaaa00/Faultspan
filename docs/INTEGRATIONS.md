# Faultspan Integration Contracts

## Boundary rule

A2A histories and x402 receipts are external evidence. Faultspan verifies what it can, preserves provenance, and labels completeness honestly. Neither adapter turns an external record into unquestionable truth.

## A2A normalization

Endpoint: `POST /v1/integrations/a2a/normalize`

Input:

```json
{
  "task_id": "task-analysis-01",
  "context_id": "market-report-01",
  "requester": "agent://orion",
  "provider": "agent://kepler",
  "description": "Cross-check every conclusion against two sources.",
  "status": "completed",
  "artifacts": [],
  "events": []
}
```

Output includes a bounded Faultspan span ID, a canonical obligation digest, the original evidence, and `completeness: "UNVERIFIED"`.

Faultspan does not fetch arbitrary artifact URLs during normalization. Any later retrieval requires an explicit allowlist and evidence-ingestion policy.

## x402 receipt verification

Endpoint: `POST /v1/integrations/x402/verify`

The Week 8 adapter uses an EIP-191 signature over the canonical receipt fields:

```text
Faultspan x402 receipt v1
<canonical JSON excluding signature>
```

The signer must recover to the declared signer and must be either the payer or payee. A valid signature proves that party signed the fields; it does not independently prove service quality or complete payment settlement.

## Later production work

- Map the adapter to the final x402 offer/receipt extension schema used by the selected facilitator.
- Verify chain, asset contract, decimals, timestamp freshness, and replay state.
- Add durable receipt IDs and uniqueness constraints.
- Add provider-specific A2A authentication and signed-history checks.
- Publish ERC-8004 reputation events only after finalized Faultspan outcomes.

