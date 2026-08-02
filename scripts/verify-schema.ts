/**
 * Verifies every frontend contract call against the deployed contract's real
 * schema via client.getContractSchema(). Catches the exact "frontend appears
 * misaligned with the contract" class of bug before it reaches a reviewer.
 *
 * Run: npx tsx scripts/verify-schema.ts
 */
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const address = (process.env.FAULTSPAN_CONTRACT_ADDRESS
  ?? process.env.NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS) as `0x${string}` | undefined;
if (!address) throw new Error("Set FAULTSPAN_CONTRACT_ADDRESS (or NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS) before running this check");

// Kept in sync manually with every `functionName`/`args` call site in apps/web —
// this script's job is to catch drift between this list and the live contract,
// not to re-derive the list from source (that would just move the risk).
const EXPECTED_CALLS: { method: string; argCount: number; readonly: boolean; payable?: boolean }[] = [
  { method: "create_case", argCount: 6, readonly: false },
  { method: "register_span", argCount: 10, readonly: false },
  { method: "accept_span", argCount: 2, readonly: false, payable: true },
  { method: "submit_delivery", argCount: 4, readonly: false },
  { method: "open_dispute", argCount: 3, readonly: false },
  { method: "submit_evidence", argCount: 4, readonly: false },
  { method: "lock_evidence", argCount: 1, readonly: false },
  { method: "adjudicate_case", argCount: 1, readonly: false },
  { method: "settle_case", argCount: 1, readonly: false },
  { method: "withdraw", argCount: 0, readonly: false },
  { method: "get_case", argCount: 1, readonly: true },
  { method: "get_case_span_ids", argCount: 1, readonly: true },
  { method: "get_span", argCount: 2, readonly: true }
];

async function main() {
  // NOTE: `endpoint` must be passed explicitly here. Under Node, createClient({chain})
  // without it returns an HTML error page from studio.genlayer.com instead of JSON —
  // this reproduces even on the deployed contract. The browser app is unaffected
  // (apps/web/lib/genlayer.ts's readClient works fine bare), so this looks like a
  // Node/fetch-environment quirk in genlayer-js@1.1.8 rather than an RPC outage.
  const client = createClient({ chain: studionet, endpoint: studionet.rpcUrls.default.http[0] });
  const schema = await client.getContractSchema(address!);

  let failures = 0;
  for (const expected of EXPECTED_CALLS) {
    const live = schema.methods[expected.method];
    if (!live) {
      console.error(`✘ ${expected.method}: not found on deployed contract at ${address}`);
      failures += 1;
      continue;
    }
    if (live.params.length !== expected.argCount) {
      console.error(`✘ ${expected.method}: frontend passes ${expected.argCount} args, contract expects ${live.params.length}`);
      failures += 1;
      continue;
    }
    if (Boolean(live.readonly) !== expected.readonly) {
      console.error(`✘ ${expected.method}: readonly mismatch (frontend assumes ${expected.readonly ? "view" : "write"}, contract is ${live.readonly ? "view" : "write"})`);
      failures += 1;
      continue;
    }
    if (expected.payable && !live.payable) {
      console.error(`✘ ${expected.method}: frontend sends value, but contract method is not payable`);
      failures += 1;
      continue;
    }
    console.log(`✓ ${expected.method}: arity ${live.params.length}, ${live.readonly ? "view" : "write"}${live.payable ? ", payable" : ""}`);
  }

  const liveOnly = Object.keys(schema.methods).filter((name) => !EXPECTED_CALLS.some((c) => c.method === name));
  if (liveOnly.length > 0) {
    console.log(`\nContract methods not called from the frontend: ${liveOnly.join(", ")}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} mismatch(es) found against ${address}.`);
    process.exit(1);
  }
  console.log(`\nAll ${EXPECTED_CALLS.length} frontend call sites match the deployed contract at ${address}.`);
}

void main();
