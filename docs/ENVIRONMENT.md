# Faultspan Environment Variables

## Where to put them

For local development, copy the root example:

```powershell
Copy-Item .env.example .env.local
```

Next.js automatically reads `apps/web/.env.local`, not the root file. Copy the four `NEXT_PUBLIC_*` values into `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999
NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS=
NEXT_PUBLIC_PLATFORM_API_URL=http://localhost:8000
```

For the Python API, set the server variables in the shell before starting it or use a local process manager that loads the root `.env.local`. Do not commit either local environment file.

## Variable inventory

### `NEXT_PUBLIC_GENLAYER_RPC_URL`

- Classification: public.
- Local value: `https://studio.genlayer.com/api`.
- Where it comes from: GenLayer's published Studionet network configuration.
- What you do: copy the value exactly.

### `NEXT_PUBLIC_GENLAYER_CHAIN_ID`

- Classification: public.
- Value: `61999`.
- Where it comes from: GenLayer Studionet configuration.
- What you do: copy the value exactly.

### `NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS`

- Classification: public, but deployment-specific.
- Value: blank until Faultspan is deployed.
- How to get it:
  1. Open `https://studio.genlayer.com` and select or create an account.
  2. Use the Studionet faucet button to fund that account with test GEN.
  3. In this repository run `genlayer network set studionet`.
  4. Run `genlayer deploy --contract contracts/faultspan.py`.
  5. Wait for successful execution, not merely finalization.
  6. Copy the printed contract address or `receipt.data.contract_address` into this variable.
- Never use a transaction hash as the contract address.

### `NEXT_PUBLIC_PLATFORM_API_URL`

- Classification: public.
- Local value: `http://localhost:8000`.
- Hosted value: the public HTTPS origin of the deployed FastAPI service, without a trailing slash.
- What you do: replace only after hosting the API.

### `GENLAYER_RPC_URL`

- Classification: public server configuration.
- Value: `https://studio.genlayer.com/api`.
- Used by: scripts and future server-side reconciliation; not exposed as a secret.

### `FAULTSPAN_STORAGE_BACKEND`

- Classification: server configuration.
- Recommended value: `supabase`.
- Local test fallback: `filesystem`.

### `FAULTSPAN_PROJECTION_BACKEND`

- Classification: server configuration.
- Recommended value: `supabase`.
- Local test fallback: `memory`.
- Meaning: chooses where the API stores the searchable case index used by the frontend.
- Setup: run [SUPABASE_SCHEMA.sql](SUPABASE_SCHEMA.sql) once in the Supabase SQL Editor before using `supabase`.

### `SUPABASE_URL`

- Classification: public project identifier, but kept server-side in this architecture.
- How to get it: create/open your project at `https://supabase.com/dashboard`, open **Connect** (or **Project Settings → API**), then copy the Project URL.
- Put it only in the FastAPI service environment.

### `SUPABASE_SECRET_KEY`

- Classification: highly privileged server secret.
- How to get it: in Supabase open **Project Settings → API Keys**, create/copy a secret key beginning `sb_secret_`.
- Older project fallback: copy the legacy `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`; the API accepts it, but the new secret key is preferred.
- Never prefix this variable with `NEXT_PUBLIC_`, paste it into the browser, log it, or commit it.

### `SUPABASE_EVIDENCE_BUCKET`

- Classification: server configuration.
- Value: `faultspan-evidence`.
- How to create it: in Supabase open **Storage → New bucket**, name it `faultspan-evidence`, and leave it private. The FastAPI evidence endpoint is the controlled public read path used by GenLayer validators.

### `FAULTSPAN_EVIDENCE_DIR`

- Classification: local fallback configuration.
- Value: `services/platform/data/evidence`.
- Used only when `FAULTSPAN_STORAGE_BACKEND=filesystem`, primarily for isolated tests.

### `FAULTSPAN_ALLOWED_ORIGINS`

- Classification: server security configuration.
- Local value: `http://localhost:3000`.
- Hosted value: the exact HTTPS web origin, for example `https://faultspan.example`.
- Multiple values: comma-separated exact origins.
- Do not use `*` with wallet-authenticated requests.

### `FAULTSPAN_MAX_EVIDENCE_BYTES`

- Classification: public operational limit.
- Default: `256000`.
- Meaning: maximum canonical evidence-bundle size accepted by the API.
- Increase only after evaluating validator context, storage, denial-of-service, and cost impact.

### `FAULTSPAN_CHALLENGE_TTL_SECONDS`

- Classification: server authentication policy.
- Default: `300`.
- Meaning: wallet challenge validity window.
- Keep short; the nonce is single-use even within this period.

## Values you do not need to paste

- Browser wallet private key: never. The wallet signs in the browser.
- Seed phrase: never.
- GenLayer validator/model keys: Studionet provides validators.
- x402 facilitator secret: the Week 8 adapter verifies signed evidence and does not operate a facilitator.
- Direct database URL: not required for this build. Faultspan uses Supabase Storage for evidence and Supabase Postgres through the API client for searchable case projection. Wallet challenges/sessions remain an explicitly prototype-grade in-memory subsystem.

## Secret-handling rule

Anything prefixed with `NEXT_PUBLIC_` is compiled into the browser bundle and is not secret. Never place private keys, seed phrases, API secrets, database credentials, or signing secrets in those variables.
