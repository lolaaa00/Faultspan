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

export const PLATFORM_API_URL = process.env.NEXT_PUBLIC_PLATFORM_API_URL ?? "http://localhost:8000";

export async function listCaseProjections(query = "") {
  const url = new URL(`${PLATFORM_API_URL}/v1/cases`);
  if (query.trim()) url.searchParams.set("query", query.trim());
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("Case projection search failed");
  return await response.json() as CaseProjection[];
}

export async function saveCaseProjection(input: CaseProjection, sessionToken: string) {
  const response = await fetch(`${PLATFORM_API_URL}/v1/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Case projection save failed");
  }
  return await response.json() as CaseProjection;
}
