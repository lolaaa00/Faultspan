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

1. Check `/health` and `/ready` separately.
2. Verify the evidence directory exists and is writable.
3. Verify `SUPABASE_URL`, the backend secret, and `SUPABASE_EVIDENCE_BUCKET` point to the intended project and private bucket.
4. Restore content-addressed objects from a snapshot if required.
5. Do not adjudicate a case whose locked evidence cannot be retrieved.

## Transaction stuck or rejected

1. Keep the transaction hash visible to the user.
2. Query the receipt and execution result.
3. If finalized with execution error, inspect the trace; do not retry blindly.
4. If no transaction was created, allow the user to correct input and resubmit.
5. Never resubmit settlement without reading `case.settled` first.

## Compromised wallet

The prototype contract has no administrative key that can rewrite participant cases. Stop using the affected account, document impacted cases, and deploy a new contract version only if the application boundary itself must change. Do not rotate or expose user keys from Faultspan; it does not custody them.
