import { readClient } from "./genlayer";

export type ContractCaseRecord = {
  owner?: string;
  coordinator?: string;
  status?: string;
  evidence_manifest?: string;
  evidenceLocked?: boolean;
  settled?: boolean;
  caseSatisfied?: boolean;
  totalBonded?: bigint;
  totalSlashed?: bigint;
};

export type ContractSpanRecord = {
  case_id?: string;
  parent_id?: string;
  requester?: string;
  provider?: string;
  status?: string;
  bond_required?: bigint;
  bond_posted?: bigint;
  finding?: string;
  material?: boolean;
  evidence_refs?: string;
  explanation?: string;
};

export type LoadedFaultspanCase = {
  caseId: string;
  caseRecord: ContractCaseRecord;
  spanIds: string[];
  spans: { spanId: string; record: ContractSpanRecord }[];
};

function normalizeRecord(value: unknown) {
  if (Array.isArray(value)) return Object.fromEntries(value.map((item, index) => [String(index), item]));
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function recordValue(record: Record<string, unknown>, snake: string, camel: string) {
  return record[snake] ?? record[camel];
}

export async function readFaultspanCase(caseId: string): Promise<LoadedFaultspanCase> {
  const address = process.env.NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!address) throw new Error("NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS is not configured");

  const rawCase = normalizeRecord(await readClient.readContract({
    address,
    functionName: "get_case",
    args: [caseId]
  }));
  const rawSpanIds = await readClient.readContract({
    address,
    functionName: "get_case_span_ids",
    args: [caseId]
  });
  const spanIds = Array.isArray(rawSpanIds) ? rawSpanIds.map(String) : [];
  const spans = await Promise.all(spanIds.map(async (spanId) => ({
    spanId,
    record: normalizeRecord(await readClient.readContract({
      address,
      functionName: "get_span",
      args: [caseId, spanId]
    })) as ContractSpanRecord
  })));

  return {
    caseId,
    caseRecord: {
      owner: String(recordValue(rawCase, "owner", "owner") ?? ""),
      coordinator: String(recordValue(rawCase, "coordinator", "coordinator") ?? ""),
      status: String(recordValue(rawCase, "status", "status") ?? ""),
      evidence_manifest: String(recordValue(rawCase, "evidence_manifest", "evidenceManifest") ?? ""),
      totalBonded: recordValue(rawCase, "total_bonded", "totalBonded") as bigint | undefined,
      totalSlashed: recordValue(rawCase, "total_slashed", "totalSlashed") as bigint | undefined,
      settled: Boolean(recordValue(rawCase, "settled", "settled")),
      caseSatisfied: Boolean(recordValue(rawCase, "case_satisfied", "caseSatisfied"))
    },
    spanIds,
    spans
  };
}
