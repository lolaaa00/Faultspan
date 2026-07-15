# Faultspan Cloudflare Worker deploy

Backend Worker:

- Name: `faultspan-platform`
- Live URL: `https://faultspan-platform.delealufejoel.workers.dev`

What the Worker expects:

- `SUPABASE_URL` secret
- `SUPABASE_SERVICE_ROLE_KEY` secret
- `FAULTSPAN_SESSION_SECRET` secret
- `FAULTSPAN_ALLOWED_ORIGINS` var
- `SUPABASE_EVIDENCE_BUCKET` var
- `FAULTSPAN_MAX_EVIDENCE_BYTES` var

Before using the Worker against Supabase, run `docs/SUPABASE_SCHEMA.sql` in the Supabase SQL editor and make sure the `service_role` grants are applied.

Recommended Worker commands:

- `npx wrangler whoami`
- `npx wrangler secret bulk <json-file>`
- `npx wrangler deploy`
- `npx wrangler tail faultspan-platform`

Recommended Vercel frontend env:

- `NEXT_PUBLIC_PLATFORM_API_URL=https://faultspan-platform.delealufejoel.workers.dev`
- `NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS=0x23B6F12322d811918c4Ca5De210529d6cB09Df5D`
- `NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api`
- `NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999`

If your Vercel project uses a custom domain, add that origin to `FAULTSPAN_ALLOWED_ORIGINS` in `services/platform-worker/wrangler.jsonc` or through a Worker redeploy.

## Hardened deployment checklist

- Run `docs/SUPABASE_SCHEMA.sql` before first live write.
- Confirm `GET /health` returns `ok`.
- Confirm `GET /ready` returns `ready`.
- Set explicit custom-domain origins in `FAULTSPAN_ALLOWED_ORIGINS`.
- Tail the Worker during first live write:
  - `npx wrangler tail faultspan-platform`
- Verify the frontend points to the correct Worker URL.
- Verify the frontend points to the intended Studionet contract address.
- Rotate any demo-only secrets or exposed wallet keys before public demos.
