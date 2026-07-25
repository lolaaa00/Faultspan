import { Hono } from "hono";
import { requireSession } from "./auth";
import type { Env } from "./index";

export const projectionRoutes = new Hono<{ Bindings: Env }>();

// ── Cases ──────────────────────────────────────────────────────────────────

projectionRoutes.get("/cases", async (c) => {
  const q = c.req.query("query") ?? "";
  const needle = `%${q}%`;
  const stmt = q
    ? c.env.DB.prepare(
        "SELECT * FROM cases WHERE case_id LIKE ? OR title LIKE ? OR tx_hash LIKE ? OR owner LIKE ? ORDER BY updated_at DESC LIMIT 50"
      ).bind(needle, needle, needle, needle)
    : c.env.DB.prepare("SELECT * FROM cases ORDER BY updated_at DESC LIMIT 50");
  const { results } = await stmt.all();
  return c.json(results);
});

projectionRoutes.get("/cases/:caseId", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM cases WHERE case_id = ?")
    .bind(c.req.param("caseId"))
    .first();
  if (!row) return c.json({ error: "case not indexed" }, 404);
  return c.json(row);
});

projectionRoutes.post("/cases", async (c) => {
  const session = await requireSession(c.env.KV, c.req.header("Authorization"));
  if (session instanceof Response) return session;

  const body = await c.req.json<{
    case_id: string;
    owner: string;
    coordinator?: string;
    title?: string;
    contract_address?: string;
    tx_hash?: string | null;
    status?: string;
  }>();

  if (session.address !== body.owner?.toLowerCase())
    return c.json({ error: "session does not own case" }, 403);

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO cases (case_id, title, owner, coordinator, contract_address, tx_hash, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(case_id) DO UPDATE SET
       title=excluded.title, coordinator=excluded.coordinator,
       tx_hash=excluded.tx_hash, status=excluded.status,
       updated_at=excluded.updated_at`
  )
    .bind(
      body.case_id,
      body.title ?? body.case_id,
      body.owner.toLowerCase(),
      (body.coordinator ?? "").toLowerCase(),
      body.contract_address ?? "",
      body.tx_hash ?? null,
      body.status ?? "CREATED",
      now
    )
    .run();

  const row = await c.env.DB.prepare("SELECT * FROM cases WHERE case_id = ?")
    .bind(body.case_id)
    .first();
  return c.json(row, 201);
});

// ── Spans ──────────────────────────────────────────────────────────────────

projectionRoutes.get("/cases/:caseId/spans", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM spans WHERE case_id = ? ORDER BY updated_at DESC"
  )
    .bind(c.req.param("caseId"))
    .all();
  return c.json(results);
});

projectionRoutes.post("/spans", async (c) => {
  const session = await requireSession(c.env.KV, c.req.header("Authorization"));
  if (session instanceof Response) return session;

  const body = await c.req.json<{
    case_id: string;
    span_id: string;
    parent_id?: string | null;
    requester: string;
    provider: string;
    obligation: string;
    bond_wei: string;
    status?: string;
    tx_hash?: string | null;
  }>();

  const addr = session.address;
  if (addr !== body.requester?.toLowerCase() && addr !== body.provider?.toLowerCase())
    return c.json({ error: "session does not own span" }, 403);

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO spans (case_id, span_id, parent_id, requester, provider, obligation, bond_wei, status, tx_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(case_id, span_id) DO UPDATE SET
       parent_id=excluded.parent_id, requester=excluded.requester,
       provider=excluded.provider, obligation=excluded.obligation,
       bond_wei=excluded.bond_wei, status=excluded.status,
       tx_hash=excluded.tx_hash, updated_at=excluded.updated_at`
  )
    .bind(
      body.case_id,
      body.span_id,
      body.parent_id ?? null,
      body.requester.toLowerCase(),
      body.provider.toLowerCase(),
      body.obligation,
      body.bond_wei,
      body.status ?? "PROPOSED",
      body.tx_hash ?? null,
      now
    )
    .run();

  const row = await c.env.DB.prepare(
    "SELECT * FROM spans WHERE case_id = ? AND span_id = ?"
  )
    .bind(body.case_id, body.span_id)
    .first();
  return c.json(row, 201);
});

// ── Activity ───────────────────────────────────────────────────────────────

projectionRoutes.get("/cases/:caseId/activity", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM activity WHERE case_id = ? ORDER BY created_at DESC"
  )
    .bind(c.req.param("caseId"))
    .all();
  return c.json(results);
});

projectionRoutes.post("/activity", async (c) => {
  const session = await requireSession(c.env.KV, c.req.header("Authorization"));
  if (session instanceof Response) return session;

  const body = await c.req.json<{
    case_id: string;
    span_id?: string | null;
    actor: string;
    action: string;
    status: string;
    tx_hash?: string | null;
    summary: string;
  }>();

  if (session.address !== body.actor?.toLowerCase())
    return c.json({ error: "session does not own activity actor" }, 403);

  const activityId = `${body.case_id}:${body.action}:${Date.now()}`;
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO activity (activity_id, case_id, span_id, actor, action, status, tx_hash, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      activityId,
      body.case_id,
      body.span_id ?? null,
      body.actor.toLowerCase(),
      body.action,
      body.status,
      body.tx_hash ?? null,
      body.summary,
      now
    )
    .run();

  const row = await c.env.DB.prepare(
    "SELECT * FROM activity WHERE activity_id = ?"
  )
    .bind(activityId)
    .first();
  return c.json(row, 201);
});

// ── Search ─────────────────────────────────────────────────────────────────

projectionRoutes.get("/search", async (c) => {
  const q = c.req.query("query") ?? "";
  const needle = `%${q}%`;
  const rows: unknown[] = [];

  const { results: cases } = await (q
    ? c.env.DB.prepare(
        "SELECT * FROM cases WHERE case_id LIKE ? OR title LIKE ? OR owner LIKE ? LIMIT 50"
      ).bind(needle, needle, needle)
    : c.env.DB.prepare("SELECT * FROM cases LIMIT 50")
  ).all();

  for (const r of cases as Array<{
    case_id: string; title: string; status: string; owner: string; tx_hash: string | null;
  }>) {
    rows.push({ result_type: "case", case_id: r.case_id, span_id: null, tx_hash: r.tx_hash, title: r.title, subtitle: `${r.status} · ${r.owner}` });
  }

  const { results: spans } = await (q
    ? c.env.DB.prepare(
        "SELECT * FROM spans WHERE case_id LIKE ? OR span_id LIKE ? OR obligation LIKE ? OR provider LIKE ? LIMIT 50"
      ).bind(needle, needle, needle, needle)
    : c.env.DB.prepare("SELECT * FROM spans LIMIT 50")
  ).all();

  for (const r of spans as Array<{
    case_id: string; span_id: string; status: string; provider: string; tx_hash: string | null;
  }>) {
    rows.push({ result_type: "span", case_id: r.case_id, span_id: r.span_id, tx_hash: r.tx_hash, title: r.span_id, subtitle: `${r.status} · ${r.provider}` });
  }

  return c.json(rows.slice(0, 100));
});
