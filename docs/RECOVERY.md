# Faultspan Recovery Runbook

## Studionet reset

1. Confirm the old address is unavailable or state was reset.
2. Deploy `contracts/faultspan.py` again.
3. verify finalization and execution result.
4. Update `NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS`.
5. Rebuild the web artifact.
6. Run the demo seed preparation.
7. Rehearse the complete demo flow.

## Evidence service unavailable

1. Check `/health` and `/ready` on the Cloudflare Worker (`services/worker`) separately — `/ready` reports Pinata connectivity.
2. Verify `PINATA_JWT` is set (`wrangler secret put PINATA_JWT`) and hasn't expired or been revoked in the Pinata dashboard.
3. Verify the D1 database and KV namespace bindings in `services/worker/wrangler.jsonc` still point to the intended resources.
4. Evidence is content-addressed on IPFS — re-fetch by digest from the gateway if a specific object is unreachable; it is not something Faultspan snapshots itself.
5. Do not adjudicate a case whose locked evidence cannot be retrieved.

## Transaction stuck or rejected

1. Keep the transaction hash visible to the user.
2. Query the receipt and execution result.
3. If finalized with execution error, inspect the trace; do not retry blindly.
4. If no transaction was created, allow the user to correct input and resubmit.
5. Never resubmit settlement without reading `case.settled` first.

## Compromised wallet

The prototype contract has no administrative key that can rewrite participant cases. Stop using the affected account, document impacted cases, and deploy a new contract version only if the application boundary itself must change. Do not rotate or expose user keys from Faultspan; it does not custody them.
