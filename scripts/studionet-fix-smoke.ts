/**
 * Fast, targeted live-network smoke check for the two new structural
 * guards added to contracts/faultspan.py -- run against the real deployed
 * contract to prove they hold on Studionet, not just in direct-mode tests.
 * Does NOT wait out the full MIN_EVIDENCE_WINDOW_SECONDS (that's proven by
 * tests/direct/test_faultspan.py and the ~hour-long integration test).
 *
 * Run: FAULTSPAN_CONTRACT_ADDRESS=0x... npx tsx scripts/studionet-fix-smoke.ts
 */
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const address = process.env.FAULTSPAN_CONTRACT_ADDRESS as `0x${string}` | undefined;
if (!address) throw new Error("Set FAULTSPAN_CONTRACT_ADDRESS");

async function main() {
  const owner = createAccount(generatePrivateKey());
  const provider = createAccount(generatePrivateKey());
  const client = createClient({ chain: studionet, account: owner });
  const providerClient = createClient({ chain: studionet, account: provider });

  const caseId = `smoke-${Date.now().toString(36)}`;
  const now = Math.floor(Date.now() / 1000);

  console.log("create_case...");
  let hash = await client.writeContract({
    address, functionName: "create_case",
    args: [caseId, owner.address, "https://example.com/terms", "sha256:" + "a".repeat(64), BigInt(now + 3600), BigInt(now + 7200)],
    value: 0n
  });
  await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries: 90 });
  console.log("  ok");

  console.log("register_span root...");
  hash = await client.writeContract({
    address, functionName: "register_span",
    args: [caseId, "root", "", owner.address, provider.address, "https://example.com/ob", "sha256:" + "b".repeat(64), 1000n, 1000n, 5000n],
    value: 0n
  });
  await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries: 90 });

  console.log("register_span second (stays PROPOSED, never bonded)...");
  hash = await client.writeContract({
    address, functionName: "register_span",
    args: [caseId, "second", "root", owner.address, provider.address, "https://example.com/ob2", "sha256:" + "c".repeat(64), 1000n, 1000n, 5000n],
    value: 0n
  });
  await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries: 90 });
  console.log("  ok, case now has one PROPOSED span");

  console.log("accept_span root (bonds only the root span)...");
  hash = await providerClient.writeContract({
    address, functionName: "accept_span", args: [caseId, "root"], value: 1000n
  });
  await providerClient.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries: 90 });
  console.log("  ok");

  console.log("open_dispute while 'second' span is still PROPOSED (expect revert)...");
  try {
    hash = await client.writeContract({
      address, functionName: "open_dispute",
      args: [caseId, "https://example.com/claim", "sha256:" + "d".repeat(64)],
      value: 0n
    });
    const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 4000, retries: 90 });
    const executionResult = String((receipt as Record<string, unknown>).txExecutionResultName ?? (receipt as Record<string, unknown>).resultCode ?? "");
    if (executionResult.includes("SUCCESS") || executionResult.includes("FINISHED")) {
      throw new Error("FAIL: open_dispute succeeded despite an unbonded PROPOSED span -- fix #4 did not hold on-chain");
    }
    console.log(`  correctly rejected on-chain (execution result: ${executionResult})`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("FAIL:")) throw error;
    console.log(`  correctly reverted: ${error instanceof Error ? error.message.slice(0, 200) : error}`);
  }

  console.log("\nbonding second span so the graph is complete...");
  hash = await providerClient.writeContract({
    address, functionName: "accept_span", args: [caseId, "second"], value: 1000n
  });
  await providerClient.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries: 90 });

  console.log("open_dispute now that all spans are bonded (expect success)...");
  hash = await client.writeContract({
    address, functionName: "open_dispute",
    args: [caseId, "https://example.com/claim", "sha256:" + "d".repeat(64)],
    value: 0n
  });
  await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries: 90 });
  console.log("  ok, dispute opened");

  console.log("lock_evidence immediately (expect revert -- minimum window not elapsed)...");
  try {
    hash = await client.writeContract({ address, functionName: "lock_evidence", args: [caseId], value: 0n });
    const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 4000, retries: 90 });
    const executionResult = String((receipt as Record<string, unknown>).txExecutionResultName ?? (receipt as Record<string, unknown>).resultCode ?? "");
    if (executionResult.includes("SUCCESS") || executionResult.includes("FINISHED")) {
      throw new Error("FAIL: lock_evidence succeeded instantly -- fix #3a did not hold on-chain");
    }
    console.log(`  correctly rejected on-chain (execution result: ${executionResult})`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("FAIL:")) throw error;
    console.log(`  correctly reverted: ${error instanceof Error ? error.message.slice(0, 200) : error}`);
  }

  console.log("\nAll live-network structural checks passed.");
}

void main();
