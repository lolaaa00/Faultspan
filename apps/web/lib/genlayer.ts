import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus, type GenLayerClient, type TransactionHash } from "genlayer-js/types";

export const STUDIONET_RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
export const STUDIONET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID ?? 61999);
export const readClient = createClient({ chain: studionet });

export type ReceiptPhase = "SUBMITTED" | "ACCEPTED" | "FINALIZED" | "FAILED";

/** Consensus rounds a Studionet write moves through. UNDETERMINED/*_TIMEOUT mean
 * nothing was written and the call is safely retryable, per GenLayer's own semantics. */
export const RETRYABLE_STATUSES = new Set<string>([
  TransactionStatus.UNDETERMINED,
  TransactionStatus.VALIDATORS_TIMEOUT,
  TransactionStatus.LEADER_TIMEOUT
]);

export const TERMINAL_STATUSES = new Set<string>([
  TransactionStatus.FINALIZED,
  TransactionStatus.CANCELED,
  ...RETRYABLE_STATUSES
]);

function isSuccessfulExecution(receipt: { txExecutionResultName?: unknown; resultCode?: unknown }) {
  const execution = String(receipt.txExecutionResultName ?? "");
  const resultCode = String(receipt.resultCode ?? "");
  return execution === String(ExecutionResult.FINISHED_WITH_RETURN)
    || execution === "SUCCESS"
    || resultCode === "SUCCESS";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type LifecycleStage = {
  status: string;
  retryable: boolean;
  terminal: boolean;
};

/**
 * Polls a submitted transaction through every real consensus stage —
 * PROPOSING -> COMMITTING -> REVEALING -> ACCEPTED -> FINALIZED — rather than a
 * generic spinner. Stops early and reports retryable:true on UNDETERMINED,
 * VALIDATORS_TIMEOUT or LEADER_TIMEOUT: GenLayer's contract state is untouched
 * in all three cases, so the caller can safely resubmit.
 */
export async function pollTransactionLifecycle(
  client: GenLayerClient<typeof studionet>,
  hash: TransactionHash,
  onStage: (stage: LifecycleStage) => void,
  options: { interval?: number; maxAttempts?: number } = {}
) {
  const interval = options.interval ?? 4_000;
  const maxAttempts = options.maxAttempts ?? 120; // ~8 minutes at 4s — Studionet nondet rounds run 2-5+ min
  let lastStatus = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const transaction = await client.getTransaction({ hash });
    const status = String(transaction.statusName ?? transaction.status ?? "PENDING");
    if (status !== lastStatus) {
      lastStatus = status;
      onStage({ status, retryable: RETRYABLE_STATUSES.has(status), terminal: TERMINAL_STATUSES.has(status) });
    }
    if (TERMINAL_STATUSES.has(status)) return transaction;
    await sleep(interval);
  }
  throw new Error("Timed out waiting for Studionet consensus. The network may be under load — check the transaction hash directly before retrying.");
}

export async function waitForSuccessfulFinalization(hash: TransactionHash) {
  const receipt = await readClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 5_000,
    retries: 90
  });
  if (!isSuccessfulExecution(receipt)) {
    throw new Error("Transaction finalized but contract execution failed");
  }
  return receipt;
}

export { isSuccessfulExecution };
