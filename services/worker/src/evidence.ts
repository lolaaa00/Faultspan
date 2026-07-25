import { Hono } from "hono";
import { requireSession } from "./auth";
import type { Env } from "./index";

const PINATA_UPLOAD  = "https://uploads.pinata.cloud/v3/files";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

export const evidenceRoutes = new Hono<{ Bindings: Env }>();

evidenceRoutes.post("/evidence", async (c) => {
  const session = await requireSession(c.env.KV, c.req.header("Authorization"));
  if (session instanceof Response) return session;

  const bundle = await c.req.json<{ submitted_by?: string; [k: string]: unknown }>();
  if (session.address !== (bundle.submitted_by ?? "").toString().toLowerCase())
    return c.json({ error: "session does not own submission" }, 403);

  const raw = JSON.stringify(bundle);
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hexDigest = Array.from(new Uint8Array(hashBuf), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  const digest = `sha256:${hexDigest}`;

  // idempotent — return immediately if already pinned
  const existingCid = await c.env.KV.get(`e:${hexDigest}`);
  if (existingCid)
    return c.json({ digest, public_path: `${PINATA_GATEWAY}/${existingCid}` }, 201);

  const form = new FormData();
  form.append(
    "file",
    new Blob([raw], { type: "application/json" }),
    `${hexDigest}.json`
  );
  form.append("name", hexDigest);

  const pinataRes = await fetch(PINATA_UPLOAD, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.PINATA_JWT}` },
    body: form,
  });
  if (!pinataRes.ok) {
    const detail = await pinataRes.text();
    return c.json({ error: `Pinata upload failed: ${detail}` }, 502);
  }

  const { data } = await pinataRes.json<{ data: { cid: string } }>();
  await c.env.KV.put(`e:${hexDigest}`, data.cid);

  return c.json({ digest, public_path: `${PINATA_GATEWAY}/${data.cid}` }, 201);
});

evidenceRoutes.get("/evidence/:digest", async (c) => {
  const digest = c.req.param("digest");
  const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
  if (!match) return c.json({ error: "invalid digest format" }, 422);

  const cid = await c.env.KV.get(`e:${match[1]}`);
  if (!cid) return c.json({ error: "evidence not found" }, 404);

  const upstream = await fetch(`${PINATA_GATEWAY}/${cid}`);
  if (!upstream.ok) return c.json({ error: "evidence unavailable from gateway" }, 502);

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, immutable, max-age=31536000",
    },
  });
});
