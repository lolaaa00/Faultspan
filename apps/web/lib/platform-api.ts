export type CaseProjection = {
  case_id: string;
  title: string;
  owner: string;
  coordinator: string;
  contract_address: string;
  tx_hash?: string | null;
  status: string;
  updated_at?: number | null;
};

export type SpanProjection = {
  case_id: string;
  span_id: string;
  parent_id?: string | null;
  requester: string;
  provider: string;
  obligation: string;
  bond_wei: string;
  status: string;
  tx_hash?: string | null;
  updated_at?: number | null;
};

export type ActivityRecord = {
  activity_id: string;
  case_id: string;
  span_id?: string | null;
  actor: string;
  action: string;
  status: string;
  tx_hash?: string | null;
  summary: string;
  created_at?: number | null;
};

export type SearchResult = {
  result_type: "case" | "span" | "activity" | "transaction";
  case_id: string;
  span_id?: string | null;
  tx_hash?: string | null;
  title: string;
  subtitle: string;
};

export const PLATFORM_API_URL = process.env.NEXT_PUBLIC_PLATFORM_API_URL ?? "http://localhost:8000";

async function parseResponse<T>(response: Response, fallback: string) {
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json().catch(() => null) as { detail?: string } | null
      : null;
    const text = body?.detail ?? await response.text().catch(() => "");
    throw new Error(text || `${fallback} (${response.status})`);
  }
  return await response.json() as T;
}

export async function listCaseProjections(query = "") {
  const url = new URL(`${PLATFORM_API_URL}/v1/cases`);
  if (query.trim()) url.searchParams.set("query", query.trim());
  return parseResponse<CaseProjection[]>(await fetch(url.toString(), { cache: "no-store" }), "Case projection search failed");
}

export async function listSpanProjections(caseId: string) {
  return parseResponse<SpanProjection[]>(await fetch(`${PLATFORM_API_URL}/v1/cases/${caseId}/spans`, { cache: "no-store" }), "Span projection fetch failed");
}

export async function listActivityRecords(caseId: string) {
  return parseResponse<ActivityRecord[]>(await fetch(`${PLATFORM_API_URL}/v1/cases/${caseId}/activity`, { cache: "no-store" }), "Activity projection fetch failed");
}

export async function searchProjection(query = "") {
  const url = new URL(`${PLATFORM_API_URL}/v1/search`);
  if (query.trim()) url.searchParams.set("query", query.trim());
  return parseResponse<SearchResult[]>(await fetch(url.toString(), { cache: "no-store" }), "Projection search failed");
}

export async function saveCaseProjection(input: CaseProjection, sessionToken: string) {
  return parseResponse<CaseProjection>(await fetch(`${PLATFORM_API_URL}/v1/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(input)
  }), "Case projection save failed");
}

export async function saveSpanProjection(input: SpanProjection, sessionToken: string) {
  return parseResponse<SpanProjection>(await fetch(`${PLATFORM_API_URL}/v1/spans`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(input)
  }), "Span projection save failed");
}

export async function appendActivityRecord(input: Omit<ActivityRecord, "activity_id" | "created_at">, sessionToken: string) {
  return parseResponse<ActivityRecord>(await fetch(`${PLATFORM_API_URL}/v1/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(input)
  }), "Activity projection save failed");
}
