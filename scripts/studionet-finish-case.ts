import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus, type TransactionHash } from "genlayer-js/types";

const contractAddress = envHex("FAULTSPAN_CONTRACT_ADDRESS");
const privateKey = envHex("TEST_PRIVATE_KEY");
const caseId = envString("FAULTSPAN_CASE_ID");
const spanId = process.env.FAULTSPAN_DISPUTE_SPAN_ID?.trim() || "produce-a-buyer-ready-market-intelligence--writing";
const evidenceDigest = process.env.FAULTSPAN_EVIDENCE_DIGEST?.trim();
const evidencePath = buildEvidencePath();
const skipWithdraw = process.env.FAULTSPAN_SKIP_WITHDRAW === "1";

if (!evidenceDigest) {
  throw new Error("Set FAULTSPAN_EVIDENCE_DIGEST to the stored evidence digest before running this script");
}

const account = createAccount(privateKey);
const client = createClient({ chain: studionet, account });

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  console.log(JSON.stringify({
    network: "studionet",
    contractAddress,
    account: account.address,
    caseId,
    spanId,
    evidenceDigest,
    evidencePath,
    skipWithdraw
  }, null, 2));

  const report: Record<string, string> = {};

  report.open_dispute = await writeAndFinalize("open_dispute", () => client.writeContract({
    address: contractAddress,
    functionName: "open_dispute",
    args: [caseId, evidencePath, evidenceDigest],
    value: 0n
  }) as Promise<TransactionHash>);

  report.submit_evidence = await writeAndFinalize("submit_evidence", () => client.writeContract({
    address: contractAddress,
    functionName: "submit_evidence",
    args: [caseId, spanId, evidencePath, evidenceDigest],
    value: 0n
  }) as Promise<TransactionHash>);

  report.lock_evidence = await writeAndFinalize("lock_evidence", () => client.writeContract({
    address: contractAddress,
    functionName: "lock_evidence",
    args: [caseId],
    value: 0n
  }) as Promise<TransactionHash>);

  report.adjudicate_case = await writeAndFinalize("adjudicate_case", () => client.writeContract({
    address: contractAddress,
    functionName: "adjudicate_case",
    args: [caseId],
    value: 0n
  }) as Promise<TransactionHash>);

  report.settle_case = await writeAndFinalize("settle_case", () => client.writeContract({
    address: contractAddress,
    functionName: "settle_case",
    args: [caseId],
    value: 0n
  }) as Promise<TransactionHash>);

  if (!skipWithdraw) {
    report.withdraw = await writeAndFinalize("withdraw", () => client.writeContract({
      address: contractAddress,
      functionName: "withdraw",
      args: [],
      value: 0n
    }) as Promise<TransactionHash>);
  }

  const finalCase = await client.readContract({
    address: contractAddress,
    functionName: "get_case",
    args: [caseId],
    stateStatus: "accepted"
  });

  const finalSpan = await client.readContract({
    address: contractAddress,
    functionName: "get_span",
    args: [caseId, spanId],
    stateStatus: "accepted"
  });

  console.log("FINAL_REPORT");
  console.log(JSON.stringify({
    tx_hashes: report,
    final_case: finalCase,
    final_span: finalSpan
  }, null, 2));
}

async function writeAndFinalize(label: string, action: () => Promise<TransactionHash>) {
  console.log(`\n[${label}] submitting`);
  const hash = await action();
  console.log(`[${label}] hash: ${hash}`);

  await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 120,
    interval: 2_000
  });
  console.log(`[${label}] accepted`);

  let receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 240,
    interval: 3_000
  });
  console.log(`[${label}] finalized`);

  if (!isSuccessfulExecution(receipt)) {
    console.log(`[${label}] finalized without clear success result yet; rechecking receipt`);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sleep(2_500);
      receipt = await client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.FINALIZED,
        retries: 1,
        interval: 1_000
      });
      if (isSuccessfulExecution(receipt)) break;
    }
  }

  if (!isSuccessfulExecution(receipt)) {
    throw new Error(`[${label}] finalized but execution did not report success: ${JSON.stringify(receipt)}`);
  }

  console.log(`[${label}] execution success`);
  return hash;
}

function isSuccessfulExecution(receipt: { txExecutionResultName?: unknown; resultCode?: unknown }) {
  const receiptRecord = receipt as {
    txExecutionResultName?: unknown;
    resultCode?: unknown;
    status_name?: unknown;
    result_name?: unknown;
    consensus_data?: {
      leader_receipt?: Array<{ execution_result?: unknown }>;
      validators?: Array<{ execution_result?: unknown }>;
    };
  };

  const execution = String(receiptRecord.txExecutionResultName ?? "");
  const resultCode = String(receiptRecord.resultCode ?? "");
  const statusName = String(receiptRecord.status_name ?? "");
  const resultName = String(receiptRecord.result_name ?? "");
  const leaderExecution = receiptRecord.consensus_data?.leader_receipt?.some((item) => String(item.execution_result ?? "") === "SUCCESS") ?? false;
  const validatorExecution = receiptRecord.consensus_data?.validators?.some((item) => String(item.execution_result ?? "") === "SUCCESS") ?? false;

  return execution === String(ExecutionResult.FINISHED_WITH_RETURN)
    || execution === "SUCCESS"
    || resultCode === "SUCCESS"
    || (statusName === "FINALIZED" && resultName === "MAJORITY_AGREE" && (leaderExecution || validatorExecution));
}

function buildEvidencePath() {
  const explicit = process.env.FAULTSPAN_EVIDENCE_URL?.trim();
  if (explicit) return explicit;

  const publicPath = process.env.FAULTSPAN_EVIDENCE_PUBLIC_PATH?.trim();
  if (!publicPath) {
    throw new Error("Set FAULTSPAN_EVIDENCE_URL or FAULTSPAN_EVIDENCE_PUBLIC_PATH before running this script");
  }
  if (/^https?:\/\//u.test(publicPath)) return publicPath;

  const platformApi = process.env.PLATFORM_API_URL?.trim()
    || process.env.NEXT_PUBLIC_PLATFORM_API_URL?.trim()
    || "http://localhost:8000";
  return `${platformApi}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
}

function envString(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before running this script`);
  return value;
}

function envHex(name: string) {
  const value = envString(name);
  if (!/^0x[0-9a-fA-F]+$/u.test(value)) throw new Error(`${name} must be a 0x-prefixed hex string`);
  return value as `0x${string}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
