import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./auth";
import { evidenceRoutes } from "./evidence";
import { projectionRoutes } from "./projection";

export interface Env {
  KV: KVNamespace;
  DB: D1Database;
  PINATA_JWT: string;
  ALLOWED_ORIGINS: string; // comma-separated
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const origins = (c.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: origins.length ? origins : "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86_400,
  })(c, next);
});

app.get("/health", (c) => c.json({ status: "ok", service: "faultspan-worker" }));

app.get("/ready", async (c) => {
  try {
    const r = await fetch("https://api.pinata.cloud/v3/files?limit=1", {
      headers: { Authorization: `Bearer ${c.env.PINATA_JWT}` },
    });
    if (r.status === 401 || r.status === 403)
      return c.json({ status: "unavailable", detail: "Pinata auth failed" }, 503);
  } catch (e) {
    return c.json({ status: "unavailable", detail: String(e) }, 503);
  }
  return c.json({ status: "ready", storage_backend: "pinata", projection_backend: "d1" });
});

app.route("/v1/auth", authRoutes);
app.route("/v1", evidenceRoutes);
app.route("/v1", projectionRoutes);

export default app;
