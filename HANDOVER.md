# Faultspan — Handover Guide

This document tells you everything you need to go from a fresh clone to a fully running, publicly deployed Faultspan. Read it top to bottom before touching anything.

---

## What is Faultspan?

Faultspan is a trustless dispute resolution layer for multi-agent AI commerce, built on **GenLayer**. When two parties (agents or humans) have a service agreement, Faultspan:

1. Holds the bond on-chain in a GenLayer Intelligent Contract.
2. Stores all evidence on IPFS (via Pinata) so it can never be tampered with.
3. When there is a dispute, lets GenLayer validators — who can run LLMs and fetch live URLs during consensus — read the evidence and produce a ruling.
4. Settles the bond on-chain according to that ruling. No human arbitrator. No trusted third party.

**The contract is already deployed.** You do not need to redeploy it. The address is `0x6Bd6be8Ab30f4C3F39e038383fe3d2A49b212DDb` on GenLayer Studionet.

---

## Repo layout

```
faultspan/
├── apps/web/              Next.js frontend
├── contracts/             GenLayer Intelligent Contract (Python, already deployed)
├── packages/domain/       Shared TypeScript types and validation
├── services/worker/       Cloudflare Worker — the backend API
└── tests/                 Integration and e2e tests
```

---

## What you need before starting

| Tool | Minimum version | How to check |
|---|---|---|
| Node.js | 20 or newer | `node --version` |
| npm | comes with Node | `npm --version` |
| Python | 3.12 (only for running tests, not for deployment) | `python --version` |
| Git | any recent | `git --version` |

**Accounts you need to create (all free):**

- **Cloudflare** — cloudflare.com — create a free account; this is where the backend API runs
- **Pinata** — pinata.cloud — create a free account; this is where evidence files are stored on IPFS
- **Vercel** — vercel.com — create a free account; this is where the frontend is hosted
- **MetaMask** — browser extension at metamask.io — needed to interact with the app as a user

---

## Step 1 — Clone and install

```bash
git clone <repo-url> faultspan
cd faultspan
npm install
```

This installs dependencies for all three workspaces at once (`apps/web`, `packages/domain`, `services/worker`). It will take a minute.

---

## Step 2 — Install Wrangler (Cloudflare CLI)

Wrangler is the tool that deploys the backend to Cloudflare. Install it globally so the commands below work from any directory:

```bash
npm install -g wrangler
```

Then log in to your Cloudflare account:

```bash
wrangler login
```

A browser window will open. Authorise it. You should see `Successfully logged in` in the terminal.

---

## Step 3 — Get your Pinata JWT

1. Go to [app.pinata.cloud](https://app.pinata.cloud) and sign in.
2. Click **API Keys** in the left sidebar.
3. Click **New Key**.
4. Toggle on **Admin** (gives upload and list permissions).
5. Give it a name like `faultspan`.
6. Click **Create Key**.
7. Copy the **JWT** (the long string starting with `eyJ`). Save it somewhere safe — you will only see it once.

> **Important:** Do not paste this JWT into any file that is committed to git. You will set it as a secret in Step 6.

---

## Step 4 — Create the Cloudflare KV namespace

KV is Cloudflare's key-value store. The backend uses it for auth sessions and evidence indexing.

```bash
cd services/worker
wrangler kv namespace create KV
```

The output will look like this:

```
✅ Created KV namespace "faultspan-worker-KV" with ID "abc123def456..."
```

Copy that ID. Open `services/worker/wrangler.jsonc` and replace `REPLACE_AFTER_wrangler_kv_namespace_create` with it:

```jsonc
"kv_namespaces": [
  { "binding": "KV", "id": "abc123def456..." }
]
```

---

## Step 5 — Create the Cloudflare D1 database

D1 is Cloudflare's SQL database. The backend uses it to store case, span, and activity records.

```bash
wrangler d1 create faultspan
```

The output will look like this:

```
✅ Successfully created DB "faultspan" with database_id "xyz789..."
```

Copy that `database_id`. Open `services/worker/wrangler.jsonc` and replace `REPLACE_AFTER_wrangler_d1_create` with it:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "faultspan",
    "database_id": "xyz789..."
  }
]
```

---

## Step 6 — Run the database migration

This creates the tables inside your D1 database:

```bash
npm run db:migrate:remote
```

You should see output confirming three tables were created: `cases`, `spans`, `activity`.

---

## Step 7 — Set the Pinata JWT as a secret

Secrets are never stored in files — they are uploaded directly to Cloudflare's encrypted store:

```bash
wrangler secret put PINATA_JWT
```

Paste your Pinata JWT when the prompt asks for the value. Press Enter. You should see `✅ Success! Uploaded secret PINATA_JWT`.

---

## Step 8 — Deploy the Worker

```bash
npm run deploy
```

When it finishes you will see a URL at the bottom like:

```
https://faultspan-worker.<your-cloudflare-subdomain>.workers.dev
```

Copy this URL. It is your backend API URL. Open a browser and visit `<your-url>/health` — you should see `{"status":"ok","service":"faultspan-worker"}`. If you see that, the backend is live.

Also visit `<your-url>/ready` — if Pinata is connected correctly you will see `{"status":"ready","storage_backend":"pinata","projection_backend":"d1"}`.

---

## Step 9 — Set the allowed origins

The Worker needs to know which frontend URL is allowed to call it (CORS). Right now it only allows `http://localhost:3000`. Before deploying the frontend, update this.

Open `services/worker/wrangler.jsonc` and change:

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "http://localhost:3000"
}
```

to:

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "http://localhost:3000,https://your-project.vercel.app"
}
```

You can put a placeholder Vercel URL for now and update it after you know the exact Vercel URL. Each time you change this, redeploy:

```bash
npm run deploy
```

---

## Step 10 — Deploy the frontend to Vercel

### 10a — Push the repo to GitHub

If the repo is not already on GitHub, create a new repository on github.com and push:

```bash
git remote add origin https://github.com/<your-username>/faultspan.git
git push -u origin main
```

### 10b — Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in.
2. Click **Add New → Project**.
3. Import your GitHub repository.
4. When it asks for the **Root Directory**, type `apps/web` and confirm.
5. Leave the framework as **Next.js** (auto-detected).
6. **Do not click Deploy yet** — you need to add environment variables first.

### 10c — Add environment variables in Vercel

In the Vercel project settings, go to **Settings → Environment Variables** and add these four:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` |
| `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61999` |
| `NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS` | `0x6Bd6be8Ab30f4C3F39e038383fe3d2A49b212DDb` |
| `NEXT_PUBLIC_PLATFORM_API_URL` | `https://faultspan-worker.<your-subdomain>.workers.dev` |

Replace `<your-subdomain>` with the actual subdomain from Step 8.

### 10d — Deploy

Click **Deploy**. Vercel will build and deploy the Next.js app. When it finishes, copy your Vercel URL (e.g. `https://faultspan-abc123.vercel.app`).

Go back and complete Step 9 — add this Vercel URL to `ALLOWED_ORIGINS` in `wrangler.jsonc` and run `npm run deploy` once more from `services/worker/`.

---

## Step 11 — Test the full flow

1. Open your Vercel URL in a browser.
2. Open MetaMask. Switch the network to **GenLayer Studionet**:
   - Network name: `GenLayer Studionet`
   - RPC URL: `https://studio.genlayer.com/api`
   - Chain ID: `61999`
   - Currency symbol: `GEN`
3. Click **Connect Wallet** in the app.
4. Try creating a case. You will be asked to sign a message (wallet auth) and then submit a transaction.
5. The case should appear in the case list once the transaction is finalized on Studionet (takes about 30–60 seconds).

---

## Running locally (optional, for development)

If you want to run everything locally before deploying:

**Frontend:**

```bash
cd apps/web
```

Create a file called `.env.local` with:

```
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999
NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS=0x6Bd6be8Ab30f4C3F39e038383fe3d2A49b212DDb
NEXT_PUBLIC_PLATFORM_API_URL=http://localhost:8787
```

Then:

```bash
npm run dev
```

Frontend runs at `http://localhost:3000`.

**Worker (local):**

```bash
cd services/worker
wrangler dev
```

You will need to create a local `.dev.vars` file for the secret:

```
PINATA_JWT=<your-pinata-jwt>
```

> **Never commit `.dev.vars`** — it holds a real secret. It is covered by `.gitignore`.

Worker runs at `http://localhost:8787`.

> Note: `wrangler dev` uses a local in-memory KV and local D1 by default. Run `npm run db:migrate:local` once before using it locally.

---

## Key information for reference

| Item | Value |
|---|---|
| GenLayer network | Studionet |
| Chain ID | 61999 |
| RPC endpoint | `https://studio.genlayer.com/api` |
| Contract address | `0x6Bd6be8Ab30f4C3F39e038383fe3d2A49b212DDb` |
| Contract source | `contracts/faultspan.py` |
| Evidence storage | IPFS via Pinata (content-addressed, immutable) |
| Backend API | Cloudflare Worker (`services/worker/`) |
| Frontend | Next.js (`apps/web/`) |
| Shared types | `packages/domain/src/index.ts` |

---

## What is in each service directory

### `services/worker/` — the backend (what you deploy to Cloudflare)

| File | Purpose |
|---|---|
| `src/index.ts` | Main Hono app, CORS, health endpoints |
| `src/auth.ts` | Ethereum wallet authentication (EIP-191 challenge/verify, sessions in KV) |
| `src/evidence.ts` | Uploads evidence bundles to Pinata, serves them back via IPFS gateway |
| `src/projection.ts` | CRUD for cases, spans, activity records (stored in D1) |
| `migrations/0001_init.sql` | Database schema |
| `wrangler.jsonc` | Cloudflare config (you edited this in Steps 4–5) |

### `apps/web/` — the frontend (what you deploy to Vercel)

| File | Purpose |
|---|---|
| `components/faultspan-prototype.tsx` | Main app shell, case list, navigation |
| `components/wallet-provider.tsx` | All on-chain interactions (create case, register span, dispute, adjudicate, settle) |
| `components/case-workflow-panel.tsx` | Step-by-step panel for managing a single case |

### `contracts/faultspan.py` — the GenLayer contract (already deployed, do not redeploy)

This is a Python file that runs inside GenLayer's virtual machine. It handles:
- Creating and managing dispute cases on-chain
- Holding bonds (deposits) from providers
- Running LLM-based adjudication during the DISPUTED → DECIDED transition
- Settling and releasing funds after a ruling

---

## Known issues

- After a case reaches SETTLED status, the `get_claimable` view call fails on Studionet with a JSON decode error. This is a GenLayer Studionet bug, not a Faultspan bug. The settlement transaction still succeeds — only the subsequent balance read fails. The integration tests document this with `pytest.raises`.
- GenLayer Studionet is a testnet. Transactions have no real monetary value. Occasionally the network is slow (30–90 seconds per transaction).

---

## Who built this

Built by PAPITO for the GenLayer hackathon.  
Contract: `0x6Bd6be8Ab30f4C3F39e038383fe3d2A49b212DDb`  
Network: GenLayer Studionet (Chain ID 61999)
