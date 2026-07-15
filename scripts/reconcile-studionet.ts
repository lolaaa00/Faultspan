import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type ContractCaseRecord = {
  owner?: string;
  coordinator?: string;
  claimant?: string;
  root_terms_ref?: string;
  root_terms_digest?: string;
  evidence_manifest?: string;
  status?: string;
  delivery_deadline?: bigint;
  evidence_deadline?: bigint;
  span_count?: bigint;
  total_bonded?: bigint;
  total_slashed?: bigint;
  evidence_locked?: boolean;
  settled?: boolean;
  case_satisfied?: boolean;
  rubric_version?: string;
};

type ContractSpanRecord = {
  case_id?: string;
  parent_id?: string;
  requester?: string;
  provider?: string;
  obligation_ref?: string;
  obligation_digest?: string;
  status?: string;
  bond_required?: bigint;
  bond_posted?: bigint;
  contribution_penalty_bps?: bigint;
  causal_penalty_bps?: bigint;
  finding?: string;
  material?: boolean;
  basis_codes?: string;
  evidence_refs?: string;
  explanation?: string;
};

type CaseProjection = {
  case_id: string;
  title: string;
  owner: string;
  coordinator: string;
  contract_address: string;
  tx_hash?: string | null;
  status: string;
};

type SpanProjection = {
  case_id: string;
  span_id: string;
  parent_id?: string | null;
  requester: string;
  provider: string;
  obligation: string;
  bond_wei: string;
  status: string;
  tx_hash?: string | null;
};

type ActivityRecord = {
  activity_id: string;
  case_id: string;
  span_id?: string | null;
  actor: string;
  action: string;
  status: string;
  tx_hash?: string | null;
  summary: string;
};

loadLocalEnv();

const contractAddress = (process.env.FAULTSPAN_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS) as `0x${string}` | undefined;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!contractAddress) throw new Error("Set FAULTSPAN_CONTRACT_ADDRESS before running reconciliation");
if (!supabaseUrl || !supabaseKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running reconciliation");

const client = createClient({ chain: studionet });

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeRecord<T extends Record<string, unknown>>(value: unknown) {
  if (Array.isArray(value)) return Object.fromEntries(value.map((item, index) => [String(index), item])) as T;
  if (value && typeof value === "object") return value as T;
  return {} as T;
}

function recordValue(record: Record<string, unknown>, snake: string, camel: string) {
  return record[snake] ?? record[camel];
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function boolValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function bigintishToString(value: unknown, fallback = "0") {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value) return value;
  return fallback;
}

async function supabase(path: string, init: RequestInit, expected: number[] = [200, 201]) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: supabaseKey!,
      authorization: `Bearer ${supabaseKey!}`,
      ...init.headers
    }
  });
  if (!expected.includes(response.status)) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase request failed ${response.status}: ${body}`);
  }
  return response;
}

async function listKnownCaseIds() {
  const qs = new URLSearchParams({ select: "case_id", limit: "500" });
  const response = await supabase(`/rest/v1/faultspan_cases?${qs.toString()}`, { method: "GET" });
  const rows = await response.json() as Array<{ case_id: string }>;
  return rows.map((row) => row.case_id).filter(Boolean);
}

async function upsertCaseProjection(payload: CaseProjection) {
  const response = await supabase(
    "/rest/v1/faultspan_cases?on_conflict=case_id&select=*",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "return=representation,resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    }
  );
  return (await response.json())[0];
}

async function upsertSpanProjection(payload: SpanProjection) {
  const response = await supabase(
    "/rest/v1/faultspan_spans?on_conflict=case_id,span_id&select=*",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "return=representation,resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    }
  );
  return (await response.json())[0];
}

async function appendActivity(payload: ActivityRecord) {
  const response = await supabase(
    "/rest/v1/faultspan_activity?on_conflict=activity_id&select=*",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "return=representation,resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    }
  );
  return (await response.json())[0];
}

async function loadCase(caseId: string) {
  const rawCase = normalizeRecord<ContractCaseRecord>(await client.readContract({
    address: contractAddress!,
    functionName: "get_case",
    args: [caseId],
    stateStatus: "latest"
  } as never));
  const rawSpanIds = await client.readContract({
    address: contractAddress!,
    functionName: "get_case_span_ids",
    args: [caseId],
    stateStatus: "latest"
  } as never);
  const spanIds = Array.isArray(rawSpanIds) ? rawSpanIds.map(String) : [];
  const spans = await Promise.all(spanIds.map(async (spanId) => ({
    spanId,
    record: normalizeRecord<ContractSpanRecord>(await client.readContract({
      address: contractAddress!,
      functionName: "get_span",
      args: [caseId, spanId],
      stateStatus: "latest"
    } as never))
  })));
  return { rawCase, spanIds, spans };
}

function obligationSummary(record: Record<string, unknown>) {
  return stringValue(recordValue(record, "obligation_ref", "obligationRef"))
    || stringValue(recordValue(record, "obligation_digest", "obligationDigest"))
    || "On-chain obligation";
}

async function reconcileCase(caseId: string) {
  const { rawCase, spans } = await loadCase(caseId);
  const caseProjection: CaseProjection = {
    case_id: caseId,
    title: caseId,
    owner: stringValue(recordValue(rawCase, "owner", "owner")),
    coordinator: stringValue(recordValue(rawCase, "coordinator", "coordinator")),
    contract_address: contractAddress!,
    status: stringValue(recordValue(rawCase, "status", "status"), "OPEN")
  };
  await upsertCaseProjection(caseProjection);

  for (const item of spans) {
    const spanProjection: SpanProjection = {
      case_id: caseId,
      span_id: item.spanId,
      parent_id: stringValue(recordValue(item.record, "parent_id", "parentId")) || null,
      requester: stringValue(recordValue(item.record, "requester", "requester")),
      provider: stringValue(recordValue(item.record, "provider", "provider")),
      obligation: obligationSummary(item.record),
      bond_wei: bigintishToString(recordValue(item.record, "bond_posted", "bondPosted")),
      status: stringValue(recordValue(item.record, "status", "status"), "PROPOSED")
    };
    await upsertSpanProjection(spanProjection);
  }

  const status = stringValue(recordValue(rawCase, "status", "status"), "OPEN");
  const claimant = stringValue(recordValue(rawCase, "claimant", "claimant")) || stringValue(recordValue(rawCase, "owner", "owner"));
  await appendActivity({
    activity_id: `reconcile:${caseId}:${Date.now()}`,
    case_id: caseId,
    span_id: null,
    actor: claimant,
    action: "reconcile_snapshot",
    status: "FINALIZED",
    tx_hash: null,
    summary: `Reconciled on-chain snapshot for ${caseId} (${status})`
  });

  return {
    caseId,
    status,
    settled: boolValue(recordValue(rawCase, "settled", "settled")),
    evidenceLocked: boolValue(recordValue(rawCase, "evidence_locked", "evidenceLocked")),
    totalBonded: bigintishToString(recordValue(rawCase, "total_bonded", "totalBonded")),
    totalSlashed: bigintishToString(recordValue(rawCase, "total_slashed", "totalSlashed")),
    spanCount: spans.length
  };
}

async function main() {
  const requestedCaseIds = (process.env.FAULTSPAN_CASE_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const caseIds = requestedCaseIds.length > 0 ? requestedCaseIds : await listKnownCaseIds();
  if (caseIds.length === 0) {
    console.log("No case IDs found to reconcile.");
    return;
  }

  console.log(`Reconciling ${caseIds.length} case(s) from ${contractAddress}`);
  for (const caseId of caseIds) {
    try {
      const result = await reconcileCase(caseId);
      console.log("reconciled", result);
    } catch (error) {
      console.error("failed", caseId, error instanceof Error ? error.message : error);
    }
  }
}

void main();
