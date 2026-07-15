import { recoverMessageAddress } from "viem";

type Env = {
  FAULTSPAN_ALLOWED_ORIGINS?: string;
  FAULTSPAN_MAX_EVIDENCE_BYTES?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_EVIDENCE_BUCKET?: string;
  FAULTSPAN_SESSION_SECRET: string;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

type ChallengePayload = {
  kind: "challenge";
  address: string;
  expires_at: number;
  nonce: string;
};

type SessionPayload = {
  kind: "session";
  address: string;
  expires_at: number;
};

type EvidenceBundle = {
  schema_version: "1";
  case_id: string;
  span_id: string;
  submitted_by: string;
  created_at: string;
  obligation: Record<string, unknown>;
  delivery: Record<string, unknown>;
  task_events: Record<string, unknown>[];
  payment_receipts: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  statements: Record<string, unknown>[];
};

type SearchResult = {
  result_type: "case" | "span" | "activity" | "transaction";
  case_id: string;
  span_id: string | null;
  tx_hash: string | null;
  title: string;
  subtitle: string;
};

const SESSION_TTL_SECONDS = 60 * 60;
const CHALLENGE_TTL_SECONDS = 5 * 60;

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ status: "ok", service: "faultspan-platform-worker" }, 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/ready") {
        await assertReady(env);
        return json({
          status: "ready",
          storage_backend: "supabase",
          projection_backend: "supabase",
          max_evidence_bytes: maxEvidenceBytes(env)
        }, 200, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/challenge") {
        const body = await request.json() as { address?: string };
        const address = normalizeAddress(body.address);
        const expires_at = now() + CHALLENGE_TTL_SECONDS;
        const payload: ChallengePayload = {
          kind: "challenge",
          address,
          expires_at,
          nonce: crypto.randomUUID()
        };
        const challenge_id = await signToken(payload, env);
        const message = buildChallengeMessage(payload);
        return json({ challenge_id, message, expires_at }, 200, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/verify") {
        const body = await request.json() as { challenge_id?: string; signature?: string };
        if (!body.challenge_id || !body.signature) {
          return error("challenge_id and signature are required", 422, corsHeaders);
        }
        const payload = await verifyToken<ChallengePayload>(body.challenge_id, env, "challenge");
        const recovered = normalizeAddress(await recoverMessageAddress({
          message: buildChallengeMessage(payload),
          signature: body.signature as `0x${string}`
        }));
        if (recovered !== payload.address) {
          return error("signature does not match challenge address", 401, corsHeaders);
        }
        const session: SessionPayload = {
          kind: "session",
          address: recovered,
          expires_at: now() + SESSION_TTL_SECONDS
        };
        const session_token = await signToken(session, env);
        return json({ session_token, address: recovered, expires_at: session.expires_at }, 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/v1/cases") {
        const query = url.searchParams.get("query")?.trim() ?? "";
        const cases = await listCases(env, query);
        return json(cases, 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname.startsWith("/v1/cases/") && url.pathname.endsWith("/spans")) {
        const caseId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        return json(await listSpans(env, caseId), 200, corsHeaders);
      }

      if (request.method === "GET" && url.pathname.startsWith("/v1/cases/") && url.pathname.endsWith("/activity")) {
        const caseId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        return json(await listActivity(env, caseId), 200, corsHeaders);
      }

      if (request.method === "GET" && /^\/v1\/cases\/[^/]+$/.test(url.pathname)) {
        const caseId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        const found = await getCase(env, caseId);
        if (!found) return error("case not indexed", 404, corsHeaders);
        return json(found, 200, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/cases") {
        const session = await requireSession(request, env);
        const body = await request.json() as Record<string, unknown>;
        const owner = normalizeAddress(body.owner);
        if (session.address !== owner) return error("session does not own case", 403, corsHeaders);
        const payload = {
          case_id: requirePattern(body.case_id, /^[a-zA-Z0-9_-]{3,64}$/u, "invalid case_id"),
          title: requireString(body.title, 3, 500, "invalid title"),
          owner,
          coordinator: normalizeAddress(body.coordinator),
          contract_address: normalizeAddress(body.contract_address),
          tx_hash: optionalString(body.tx_hash, 128),
          status: requireString(body.status ?? "CREATED", 1, 64, "invalid status")
        };
        return json(await upsertCase(env, payload), 201, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/spans") {
        const session = await requireSession(request, env);
        const body = await request.json() as Record<string, unknown>;
        const requester = normalizeAddress(body.requester);
        const provider = normalizeAddress(body.provider);
        if (session.address !== requester && session.address !== provider) return error("session does not own span", 403, corsHeaders);
        const payload = {
          case_id: requirePattern(body.case_id, /^[a-zA-Z0-9_-]{3,64}$/u, "invalid case_id"),
          span_id: requirePattern(body.span_id, /^[a-zA-Z0-9_-]{3,64}$/u, "invalid span_id"),
          parent_id: optionalPattern(body.parent_id, /^[a-zA-Z0-9_-]{1,64}$/u),
          requester,
          provider,
          obligation: requireString(body.obligation, 3, 4000, "invalid obligation"),
          bond_wei: requirePattern(body.bond_wei, /^[0-9]+$/u, "invalid bond_wei"),
          status: requireString(body.status ?? "PROPOSED", 1, 64, "invalid status"),
          tx_hash: optionalString(body.tx_hash, 128)
        };
        return json(await upsertSpan(env, payload), 201, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/activity") {
        const session = await requireSession(request, env);
        const body = await request.json() as Record<string, unknown>;
        const actor = normalizeAddress(body.actor);
        if (session.address !== actor) return error("session does not own activity actor", 403, corsHeaders);
        const payload = {
          activity_id: `${requirePattern(body.case_id, /^[a-zA-Z0-9_-]{3,64}$/u, "invalid case_id")}:${requireString(body.action, 1, 128, "invalid action")}:${Date.now()}`,
          case_id: requirePattern(body.case_id, /^[a-zA-Z0-9_-]{3,64}$/u, "invalid case_id"),
          span_id: optionalPattern(body.span_id, /^[a-zA-Z0-9_-]{1,64}$/u),
          actor,
          action: requireString(body.action, 1, 128, "invalid action"),
          status: requireString(body.status ?? "FINALIZED", 1, 64, "invalid status"),
          tx_hash: optionalString(body.tx_hash, 128),
          summary: requireString(body.summary, 3, 500, "invalid summary")
        };
        return json(await appendActivity(env, payload), 201, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/v1/search") {
        const query = url.searchParams.get("query")?.trim() ?? "";
        return json(await searchProjection(env, query), 200, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/evidence") {
        const session = await requireSession(request, env);
        const bundle = await request.json() as EvidenceBundle;
        validateEvidenceBundle(bundle);
        if (session.address !== normalizeAddress(bundle.submitted_by)) {
          return error("session does not own submission", 403, corsHeaders);
        }
        const payload = canonicalJson(bundle);
        if (payload.byteLength > maxEvidenceBytes(env)) {
          return error(`evidence exceeds ${maxEvidenceBytes(env)} byte limit`, 422, corsHeaders);
        }
        const hexDigest = await sha256Hex(payload);
        const path = `sha256/${hexDigest}.json`;
        const upload = await supabaseStorageUpload(env, path, payload);
        if (!upload.ok) {
          const existing = await supabaseStorageDownload(env, path);
          if (!existing.ok) return error("Supabase evidence upload failed", 503, corsHeaders);
          const existingBytes = new Uint8Array(await existing.arrayBuffer());
          if ((await sha256Hex(existingBytes)) !== hexDigest) return error("content-address collision", 422, corsHeaders);
        }
        return json({
          evidence_id: `ev_${hexDigest.slice(0, 24)}`,
          digest: `sha256:${hexDigest}`,
          public_path: `/v1/evidence/${hexDigest}`,
          byte_length: payload.byteLength
        }, 201, corsHeaders);
      }

      if (request.method === "GET" && url.pathname.startsWith("/v1/evidence/")) {
        const digest = url.pathname.split("/").at(-1) ?? "";
        validateDigest(digest);
        const response = await supabaseStorageDownload(env, `sha256/${digest}.json`);
        if (!response.ok) return error("evidence not found", 404, corsHeaders);
        const payload = new Uint8Array(await response.arrayBuffer());
        if ((await sha256Hex(payload)) !== digest) return error("stored evidence failed integrity check", 422, corsHeaders);
        return new Response(payload, {
          status: 200,
          headers: {
            ...corsHeaders,
            "content-type": "application/json",
            "cache-control": "public, immutable"
          }
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/integrations/x402/verify") {
        const receipt = await request.json() as Record<string, unknown>;
        return json({
          valid: true,
          recovered_signer: typeof receipt.signer === "string" ? receipt.signer.toLowerCase() : null,
          reason: "Prototype verification path"
        }, 200, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/integrations/a2a/normalize") {
        const task = await request.json() as Record<string, unknown>;
        const taskId = requireString(task.task_id, 3, 128, "invalid task_id");
        const requester = requireString(task.requester, 1, 256, "invalid requester");
        const provider = requireString(task.provider, 1, 256, "invalid provider");
        const description = requireString(task.description, 8, 4000, "invalid description");
        const digest = `sha256:${await sha256Hex(new TextEncoder().encode(description))}`;
        return json({
          schema_version: "faultspan-a2a/1",
          external_task_id: taskId,
          case_id: slug(`a2a-${taskId}`),
          span_id: slug(`span-${taskId}`),
          requester,
          provider,
          obligation: description,
          obligation_digest: digest,
          external_status: requireString(task.status ?? "unknown", 1, 64, "invalid status"),
          evidence: { task },
          completeness: "UNVERIFIED"
        }, 200, corsHeaders);
      }

      return error("not found", 404, corsHeaders);
    } catch (err) {
      const message = err instanceof HttpError ? err.message : err instanceof Error ? err.message : "internal error";
      const status = err instanceof HttpError ? err.status : 500;
      return error(message, status, corsHeaders);
    }
  }
};

export default worker;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function buildCorsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  const allowed = (env.FAULTSPAN_ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const accessOrigin = origin && isAllowedOrigin(origin, allowed) ? origin : allowed[0] ?? "*";
  return {
    "access-control-allow-origin": accessOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type",
    "vary": "Origin"
  };
}

function isAllowedOrigin(origin: string, allowed: string[]) {
  if (allowed.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function json(value: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, "content-type": "application/json" }
  });
}

function error(detail: string, status: number, headers: Record<string, string>) {
  return json({ detail }, status, headers);
}

function normalizeAddress(value: unknown) {
  if (typeof value !== "string") throw new HttpError(422, "address must be a string");
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(normalized)) throw new HttpError(422, "address must be a 20-byte 0x-prefixed value");
  return normalized;
}

function requireString(value: unknown, min: number, max: number, message: string) {
  if (typeof value !== "string") throw new HttpError(422, message);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new HttpError(422, message);
  return trimmed;
}

function optionalString(value: unknown, max: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > max) throw new HttpError(422, "invalid optional string");
  return value;
}

function requirePattern(value: unknown, pattern: RegExp, message: string) {
  if (typeof value !== "string" || !pattern.test(value)) throw new HttpError(422, message);
  return value;
}

function optionalPattern(value: unknown, pattern: RegExp) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !pattern.test(value)) throw new HttpError(422, "invalid optional value");
  return value;
}

function validateEvidenceBundle(bundle: EvidenceBundle) {
  if (bundle.schema_version !== "1") throw new HttpError(422, "schema_version must be '1'");
  requirePattern(bundle.case_id, /^[a-zA-Z0-9_-]{3,64}$/u, "invalid case_id");
  requirePattern(bundle.span_id, /^[a-zA-Z0-9_-]{3,64}$/u, "invalid span_id");
  normalizeAddress(bundle.submitted_by);
  if (!Array.isArray(bundle.task_events) || bundle.task_events.length > 100) throw new HttpError(422, "invalid task_events");
  if (!Array.isArray(bundle.payment_receipts) || bundle.payment_receipts.length > 20) throw new HttpError(422, "invalid payment_receipts");
  if (!Array.isArray(bundle.attachments) || bundle.attachments.length > 20) throw new HttpError(422, "invalid attachments");
  if (!Array.isArray(bundle.statements) || bundle.statements.length > 20) throw new HttpError(422, "invalid statements");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(canonicalize(value)));
}

async function sha256Hex(value: Uint8Array) {
  const bytes = Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateDigest(digest: string) {
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new HttpError(422, "invalid evidence digest");
}

function maxEvidenceBytes(env: Env) {
  return Number(env.FAULTSPAN_MAX_EVIDENCE_BYTES ?? "256000");
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes: Uint8Array) {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function signToken(payload: ChallengePayload | SessionPayload, env: Env) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const bodyBase64 = toBase64Url(body);
  const key = await importHmacKey(env.FAULTSPAN_SESSION_SECRET);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyBase64)));
  return `${bodyBase64}.${toBase64Url(sig)}`;
}

async function verifyToken<T extends { kind: string; expires_at: number }>(token: string, env: Env, expectedKind: string): Promise<T> {
  const [bodyBase64, sigBase64] = token.split(".");
  if (!bodyBase64 || !sigBase64) throw new HttpError(401, "invalid token");
  const key = await importHmacKey(env.FAULTSPAN_SESSION_SECRET);
  const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(sigBase64), new TextEncoder().encode(bodyBase64));
  if (!valid) throw new HttpError(401, "invalid token");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(bodyBase64))) as T;
  if (payload.kind !== expectedKind) throw new HttpError(401, "invalid token kind");
  if (payload.expires_at < now()) throw new HttpError(401, `${expectedKind} expired`);
  return payload;
}

function buildChallengeMessage(payload: ChallengePayload) {
  return [
    "Faultspan authentication",
    `Address: ${payload.address}`,
    `Nonce: ${payload.nonce}`,
    `Expires: ${payload.expires_at}`,
    "Purpose: submit public dispute evidence"
  ].join("\n");
}

async function requireSession(request: Request, env: Env) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "bearer session required");
  return verifyToken<SessionPayload>(authorization.slice("Bearer ".length), env, "session");
}

async function assertReady(env: Env) {
  await supabase(env, "/rest/v1/faultspan_cases?select=case_id&limit=1", { method: "GET" });
}

async function supabase(env: Env, path: string, init: RequestInit, expected: number[] = [200, 201]) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...init.headers
    }
  });
  if (!expected.includes(response.status)) {
    const body = await response.text().catch(() => "");
    throw new HttpError(503, body || "Supabase request failed");
  }
  return response;
}

async function listCases(env: Env, query: string) {
  const qs = new URLSearchParams({
    select: "*",
    order: "updated_at.desc",
    limit: "50"
  });
  if (query) qs.set("or", `case_id.ilike.%${query}%,title.ilike.%${query}%,tx_hash.ilike.%${query}%,owner.ilike.%${query}%`);
  const response = await supabase(env, `/rest/v1/faultspan_cases?${qs.toString()}`, { method: "GET" });
  return await response.json();
}

async function getCase(env: Env, caseId: string) {
  const qs = new URLSearchParams({ select: "*", case_id: `eq.${caseId}`, limit: "1" });
  const response = await supabase(env, `/rest/v1/faultspan_cases?${qs.toString()}`, { method: "GET" });
  const rows = await response.json() as unknown[];
  return rows[0] ?? null;
}

async function listSpans(env: Env, caseId: string) {
  const qs = new URLSearchParams({ select: "*", case_id: `eq.${caseId}`, order: "updated_at.desc" });
  const response = await supabase(env, `/rest/v1/faultspan_spans?${qs.toString()}`, { method: "GET" });
  return await response.json();
}

async function listActivity(env: Env, caseId: string) {
  const qs = new URLSearchParams({ select: "*", case_id: `eq.${caseId}`, order: "created_at.desc" });
  const response = await supabase(env, `/rest/v1/faultspan_activity?${qs.toString()}`, { method: "GET" });
  return await response.json();
}

async function upsertCase(env: Env, payload: Record<string, unknown>) {
  const response = await supabase(
    env,
    "/rest/v1/faultspan_cases?on_conflict=case_id&select=*",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "prefer": "return=representation,resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    }
  );
  const rows = await response.json() as unknown[];
  return rows[0];
}

async function upsertSpan(env: Env, payload: Record<string, unknown>) {
  const response = await supabase(
    env,
    "/rest/v1/faultspan_spans?on_conflict=case_id,span_id&select=*",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "prefer": "return=representation,resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    }
  );
  const rows = await response.json() as unknown[];
  return rows[0];
}

async function appendActivity(env: Env, payload: Record<string, unknown>) {
  const response = await supabase(
    env,
    "/rest/v1/faultspan_activity?on_conflict=activity_id&select=*",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "prefer": "return=representation,resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    }
  );
  const rows = await response.json() as unknown[];
  return rows[0];
}

async function searchProjection(env: Env, query: string): Promise<SearchResult[]> {
  const [cases, spans, activity] = await Promise.all([
    listCases(env, query),
    searchRows(env, "faultspan_spans", query, ["case_id", "span_id", "obligation", "provider", "tx_hash"]),
    searchRows(env, "faultspan_activity", query, ["case_id", "span_id", "action", "summary", "actor", "tx_hash"])
  ]);
  const results: SearchResult[] = [];
  for (const row of cases as Record<string, unknown>[]) {
    results.push({
      result_type: "case",
      case_id: String(row.case_id ?? ""),
      span_id: null,
      tx_hash: stringOrNull(row.tx_hash),
      title: String(row.title ?? row.case_id ?? ""),
      subtitle: `${String(row.status ?? "CREATED")} · ${String(row.owner ?? "")}`
    });
  }
  for (const row of spans as Record<string, unknown>[]) {
    results.push({
      result_type: "span",
      case_id: String(row.case_id ?? ""),
      span_id: String(row.span_id ?? ""),
      tx_hash: stringOrNull(row.tx_hash),
      title: String(row.span_id ?? ""),
      subtitle: `${String(row.status ?? "PROPOSED")} · ${String(row.provider ?? "")}`
    });
  }
  for (const row of activity as Record<string, unknown>[]) {
    const txHash = stringOrNull(row.tx_hash);
    results.push({
      result_type: "activity",
      case_id: String(row.case_id ?? ""),
      span_id: stringOrNull(row.span_id),
      tx_hash: txHash,
      title: String(row.action ?? ""),
      subtitle: String(row.summary ?? "")
    });
    if (txHash) {
      results.push({
        result_type: "transaction",
        case_id: String(row.case_id ?? ""),
        span_id: stringOrNull(row.span_id),
        tx_hash: txHash,
        title: txHash,
        subtitle: `${String(row.action ?? "")} · ${String(row.status ?? "")}`
      });
    }
  }
  return results.slice(0, 100);
}

async function searchRows(env: Env, table: string, query: string, columns: string[]) {
  const qs = new URLSearchParams({ select: "*", limit: "50" });
  if (query) qs.set("or", columns.map((column) => `${column}.ilike.%${query}%`).join(","));
  const response = await supabase(env, `/rest/v1/${table}?${qs.toString()}`, { method: "GET" });
  return await response.json();
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

async function supabaseStorageUpload(env: Env, path: string, payload: Uint8Array) {
  const bytes = Uint8Array.from(payload);
  return fetch(`${env.SUPABASE_URL}/storage/v1/object/${env.SUPABASE_EVIDENCE_BUCKET ?? "faultspan-evidence"}/${path}`, {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      "x-upsert": "false"
    },
    body: bytes
  });
}

async function supabaseStorageDownload(env: Env, path: string) {
  return fetch(`${env.SUPABASE_URL}/storage/v1/object/authenticated/${env.SUPABASE_EVIDENCE_BUCKET ?? "faultspan-evidence"}/${path}`, {
    method: "GET",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "faultspan";
}
