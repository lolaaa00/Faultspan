import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus, type TransactionHash } from "genlayer-js/types";

export const STUDIONET_RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
export const STUDIONET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID ?? 61999);
export const readClient = createClient({ chain: studionet });

export type ReceiptPhase = "SUBMITTED" | "ACCEPTED" | "FINALIZED" | "FAILED";

export async function waitForSuccessfulFinalization(hash: TransactionHash) {
  const receipt = await readClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED
  });
  if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error("Transaction finalized but contract execution failed");
  }
  return receipt;
}
