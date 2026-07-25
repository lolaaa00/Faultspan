import { Hono } from "hono";
import { recoverMessageAddress } from "viem";
import type { Env } from "./index";

export const authRoutes = new Hono<{ Bindings: Env }>();

const CHALLENGE_TTL = 300;  // 5 min
const SESSION_TTL   = 3_600; // 1 hour

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

authRoutes.post("/challenge", async (c) => {
  const { address } = await c.req.json<{ address: string }>();
  if (!address) return c.json({ error: "address required" }, 400);
  const addr = address.toLowerCase();
  const challengeId = randomHex(18);
  const nonce = randomHex(18);
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_TTL;
  const message = [
    "Faultspan authentication",
    `Address: ${addr}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`,
    "Purpose: submit public dispute evidence",
  ].join("\n");
  await c.env.KV.put(
    `c:${challengeId}`,
    JSON.stringify({ address: addr, message, expiresAt }),
    { expirationTtl: CHALLENGE_TTL }
  );
  return c.json({ challenge_id: challengeId, message, expires_at: expiresAt });
});

authRoutes.post("/verify", async (c) => {
  const { challenge_id, signature } = await c.req.json<{
    challenge_id: string;
    signature: string;
  }>();
  const raw = await c.env.KV.get(`c:${challenge_id}`);
  if (!raw) return c.json({ error: "challenge not found or expired" }, 401);

  const challenge = JSON.parse(raw) as {
    address: string;
    message: string;
    expiresAt: number;
    used?: boolean;
  };
  if (challenge.used) return c.json({ error: "challenge already used" }, 401);
  if (challenge.expiresAt < Math.floor(Date.now() / 1000))
    return c.json({ error: "challenge expired" }, 401);

  let recovered: string;
  try {
    recovered = (
      await recoverMessageAddress({
        message: challenge.message,
        signature: signature as `0x${string}`,
      })
    ).toLowerCase();
  } catch {
    return c.json({ error: "invalid signature" }, 401);
  }

  if (recovered !== challenge.address)
    return c.json({ error: "signature does not match address" }, 401);

  // mark used so the nonce can't be replayed
  await c.env.KV.put(
    `c:${challenge_id}`,
    JSON.stringify({ ...challenge, used: true }),
    { expirationTtl: 60 }
  );

  const token = randomHex(32);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL;
  await c.env.KV.put(
    `s:${token}`,
    JSON.stringify({ address: recovered, expiresAt }),
    { expirationTtl: SESSION_TTL }
  );
  return c.json({ session_token: token, address: recovered, expires_at: expiresAt });
});

export type Session = { address: string; expiresAt: number };

export async function requireSession(
  kv: KVNamespace,
  authorization: string | null | undefined
): Promise<Session | Response> {
  if (!authorization?.startsWith("Bearer "))
    return Response.json({ error: "bearer session required" }, { status: 401 });
  const raw = await kv.get(`s:${authorization.slice(7)}`);
  if (!raw) return Response.json({ error: "session missing or expired" }, { status: 401 });
  const session = JSON.parse(raw) as Session;
  if (session.expiresAt < Math.floor(Date.now() / 1000))
    return Response.json({ error: "session expired" }, { status: 401 });
  return session;
}
