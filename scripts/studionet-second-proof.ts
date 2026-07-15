import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus, type TransactionHash } from "genlayer-js/types";
import { createHash } from "node:crypto";

const contractAddress = envHex("FAULTSPAN_CONTRACT_ADDRESS");
const privateKey = envHex("TEST_PRIVATE_KEY");
const platformApi = envString("PLATFORM_API_URL");
const account = createAccount(privateKey);
const client = createClient({ chain: studionet, account });

const title = process.env.FAULTSPAN_SECOND_PROOF_TITLE?.trim() || "Produce a buyer-ready market intelligence report with validated causal attribution";
const caseId = process.env.FAULTSPAN_CASE_ID?.trim() || `faultspan-causal-${Date.now().toString(36)}`;
const coordinator = (process.env.FAULTSPAN_COORDINATOR_ADDRESS?.trim() || account.address) as `0x${string}`;
const researchSpan = `${caseId}-research`.slice(0, 64);
const analysisSpan = `${caseId}-analysis`.slice(0, 64);
const writingSpan = `${caseId}-writing`.slice(0, 64);

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const report: Record<string, string> = {};
  console.log(JSON.stringify({ contractAddress, account: account.address, platformApi, caseId, researchSpan, analysisSpan, writingSpan }, null, 2));

  const now = Math.floor(Date.now() / 1000);
  report.create_case = await writeAndFinalize("create_case", () => client.writeContract({
    address: contractAddress,
    functionName: "create_case",
    args: [caseId, coordinator, `urn:faultspan:terms:${caseId}`, digest(title), BigInt(now + 7 * 86400), BigInt(now + 10 * 86400)],
    value: 0n
  }) as Promise<TransactionHash>);

  report.register_research = await registerSpan(researchSpan, "", "Gather source material and preserve citations that support downstream analysis.", 1_000_000_000_000_000n, 2500, 7000);
  report.register_analysis = await registerSpan(analysisSpan, researchSpan, "Validate the research, reject unsupported claims, and derive the buyer-critical conclusion.", 1_000_000_000_000_000n, 4000, 9000);
  report.register_writing = await registerSpan(writingSpan, analysisSpan, "Produce the final buyer-ready report strictly from the validated analysis.", 1_000_000_000_000_000n, 2500, 8000);

  report.accept_research = await acceptSpan(researchSpan, 1_000_000_000_000_000n);
  report.accept_analysis = await acceptSpan(analysisSpan, 1_000_000_000_000_000n);
  report.accept_writing = await acceptSpan(writingSpan, 1_000_000_000_000_000n);

  report.deliver_research = await deliverSpan(researchSpan, "https://example.com/faultspan/research-delivery.json");
  report.deliver_analysis = await deliverSpan(analysisSpan, "https://example.com/faultspan/analysis-delivery.json");
  report.deliver_writing = await deliverSpan(writingSpan, "https://example.com/faultspan/writing-delivery.json");

  const evidence = await storeEvidenceBundle();
  console.log("stored_evidence", JSON.stringify(evidence, null, 2));

  report.open_dispute = await writeAndFinalize("open_dispute", () => client.writeContract({
    address: contractAddress,
    functionName: "open_dispute",
    args: [caseId, evidence.url, evidence.digest],
    value: 0n
  }) as Promise<TransactionHash>);
  report.submit_evidence = await writeAndFinalize("submit_evidence", () => client.writeContract({
    address: contractAddress,
    functionName: "submit_evidence",
    args: [caseId, analysisSpan, evidence.url, evidence.digest],
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
  report.withdraw = await writeAndFinalize("withdraw", () => client.writeContract({
    address: contractAddress,
    functionName: "withdraw",
    args: [],
    value: 0n
  }) as Promise<TransactionHash>);

  const finalCase = await client.readContract({ address: contractAddress, functionName: "get_case", args: [caseId], stateStatus: "accepted" });
  const finalAnalysis = await client.readContract({ address: contractAddress, functionName: "get_span", args: [caseId, analysisSpan], stateStatus: "accepted" });
  console.log("FINAL_REPORT");
  console.log(JSON.stringify({ tx_hashes: report, evidence, final_case: finalCase, final_analysis_span: finalAnalysis }, null, 2));
}

async function registerSpan(spanId: string, parentId: string, obligation: string, bondWei: bigint, contributionPenaltyBps: number, causalPenaltyBps: number) {
  return writeAndFinalize(`register_${spanId}`, () => client.writeContract({
    address: contractAddress,
    functionName: "register_span",
    args: [caseId, spanId, parentId, coordinator, account.address, `urn:faultspan:span:${caseId}:${spanId}`, digest(obligation), bondWei, BigInt(contributionPenaltyBps), BigInt(causalPenaltyBps)],
    value: 0n
  }) as Promise<TransactionHash>);
}

async function acceptSpan(spanId: string, bondWei: bigint) {
  return writeAndFinalize(`accept_${spanId}`, () => client.writeContract({
    address: contractAddress,
    functionName: "accept_span",
    args: [caseId, spanId],
    value: bondWei
  }) as Promise<TransactionHash>);
}

async function deliverSpan(spanId: string, ref: string) {
  return writeAndFinalize(`deliver_${spanId}`, () => client.writeContract({
    address: contractAddress,
    functionName: "submit_delivery",
    args: [caseId, spanId, ref, digest(ref)],
    value: 0n
  }) as Promise<TransactionHash>);
}

async function storeEvidenceBundle() {
  const sessionToken = await createPlatformSession();
  const statement = "The analysis span omitted a required validation step, promoted an unsupported conclusion into the downstream chain, and caused the buyer-facing final report to fail even though the writing span followed the supplied analysis.";
  const body = {
    schema_version: "1",
    case_id: caseId,
    span_id: analysisSpan,
    submitted_by: account.address.toLowerCase(),
    created_at: new Date().toISOString(),
    obligation: {
      text: "Validate the research, reject unsupported claims, and derive the buyer-critical conclusion."
    },
    delivery: {
      ref: "https://example.com/faultspan/analysis-delivery.json",
      summary: "The analysis delivery introduced an unsupported conclusion about market readiness."
    },
    task_events: [
      {
        kind: "analysis_review",
        note: "Required validation step was skipped before the conclusion was escalated to the writing span."
      }
    ],
    payment_receipts: [],
    attachments: [
      {
        kind: "finding_memo",
        text: "The analysis span inserted a false conclusion that the downstream writing span relied on."
      }
    ],
    statements: [
      { text: statement },
      { text: "Research inputs were available, but the analysis span failed to validate them before deriving the final conclusion." },
      { text: "The writing span reproduced the supplied analysis; the causal breach occurred in analysis, not writing." }
    ]
  };

  const response = await fetchWithRetry(`${platformApi}/v1/evidence`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  const receipt = await response.json() as { evidence_id: string; digest: string; public_path: string };
  return {
    evidence_id: receipt.evidence_id,
    digest: receipt.digest,
    url: `${platformApi}${receipt.public_path}`
  };
}

async function createPlatformSession() {
  const challengeResponse = await fetchWithRetry(`${platformApi}/v1/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address.toLowerCase() })
  });
  if (!challengeResponse.ok) throw new Error(await challengeResponse.text());
  const challenge = await challengeResponse.json() as { challenge_id: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  const verifyResponse = await fetchWithRetry(`${platformApi}/v1/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge_id: challenge.challenge_id, signature })
  });
  if (!verifyResponse.ok) throw new Error(await verifyResponse.text());
  const session = await verifyResponse.json() as { session_token: string };
  return session.session_token;
}

async function writeAndFinalize(label: string, action: () => Promise<TransactionHash>) {
  console.log(`\n[${label}] submitting`);
  const hash = await action();
  console.log(`[${label}] hash: ${hash}`);
  await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 120, interval: 2_000 });
  console.log(`[${label}] accepted`);
  let receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 240, interval: 3_000 });
  console.log(`[${label}] finalized`);
  if (!isSuccessfulExecution(receipt)) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sleep(2_500);
      receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 1, interval: 1_000 });
      if (isSuccessfulExecution(receipt)) break;
    }
  }
  if (!isSuccessfulExecution(receipt)) throw new Error(`[${label}] finalized without success: ${JSON.stringify(receipt)}`);
  console.log(`[${label}] execution success`);
  return hash;
}

function isSuccessfulExecution(receipt: { txExecutionResultName?: unknown; resultCode?: unknown; status_name?: unknown; result_name?: unknown; consensus_data?: { leader_receipt?: Array<{ execution_result?: unknown }>; validators?: Array<{ execution_result?: unknown }> } }) {
  const execution = String(receipt.txExecutionResultName ?? "");
  const resultCode = String(receipt.resultCode ?? "");
  const statusName = String(receipt.status_name ?? "");
  const resultName = String(receipt.result_name ?? "");
  const leaderExecution = receipt.consensus_data?.leader_receipt?.some((item) => String(item.execution_result ?? "") === "SUCCESS") ?? false;
  const validatorExecution = receipt.consensus_data?.validators?.some((item) => String(item.execution_result ?? "") === "SUCCESS") ?? false;
  return execution === String(ExecutionResult.FINISHED_WITH_RETURN)
    || execution === "SUCCESS"
    || resultCode === "SUCCESS"
    || (statusName === "FINALIZED" && resultName === "MAJORITY_AGREE" && (leaderExecution || validatorExecution));
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

async function fetchWithRetry(input: string, init: RequestInit, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === attempts) break;
      console.log(`[fetch retry ${attempt}/${attempts}] ${input}`);
      await sleep(2_500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Fetch failed for ${input}`);
}
