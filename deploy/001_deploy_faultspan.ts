import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ExecutionResult, TransactionStatus, type GenLayerClient, type TransactionHash } from "genlayer-js/types";

export default async function deployFaultspan(client: GenLayerClient): Promise<string> {
  const code = new Uint8Array(readFileSync(resolve(process.cwd(), "contracts/faultspan.py")));
  await client.initializeConsensusSmartContract();
  const hash = await client.deployContract({ code, args: [] });
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    retries: 200,
    interval: 5_000
  });

  if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(`Faultspan deployment execution failed: ${JSON.stringify(receipt)}`);
  }

  const address = receipt.data?.contract_address;
  if (!address) throw new Error(`Studionet receipt did not include data.contract_address: ${JSON.stringify(receipt)}`);
  console.log(JSON.stringify({ hash, address, network: "studionet" }, null, 2));
  return address;
}
