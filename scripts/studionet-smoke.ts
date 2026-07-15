import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";

const address = process.env.FAULTSPAN_CONTRACT_ADDRESS as `0x${string}` | undefined;
if (!address) throw new Error("Set FAULTSPAN_CONTRACT_ADDRESS before running the smoke check");

const client = createClient({ chain: studionet });
const caseId = process.env.FAULTSPAN_CASE_ID ?? "faultspan-smoke";

function isSuccessfulExecution(receipt: { txExecutionResultName?: unknown; resultCode?: unknown }) {
  const execution = String(receipt.txExecutionResultName ?? "");
  const resultCode = String(receipt.resultCode ?? "");
  return execution === String(ExecutionResult.FINISHED_WITH_RETURN)
    || execution === "SUCCESS"
    || resultCode === "SUCCESS";
}

const value = await client.readContract({
  address,
  functionName: "get_case",
  args: [caseId],
  stateStatus: "accepted"
});
console.log("case", value);

if (process.env.FAULTSPAN_TX_HASH) {
  const receipt = await client.waitForTransactionReceipt({
    hash: process.env.FAULTSPAN_TX_HASH as `0x${string}`,
    status: TransactionStatus.FINALIZED
  });
  if (!isSuccessfulExecution(receipt)) {
    throw new Error(`Transaction finalized without successful execution: ${JSON.stringify(receipt)}`);
  }
  console.log("receipt", receipt);
}
