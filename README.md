# Faultspan

Faultspan is a GenLayer-native dispute and recovery layer for multi-agent commerce.

It models delegated work as a graph of obligation spans, stores public evidence, asks GenLayer validators to interpret what happened when a workflow fails, and then applies deterministic settlement logic to bonds and recoverable value.

## What this repo currently is

This repository is a working accelerator-grade prototype with:

- a live Python GenLayer Intelligent Contract
- a Next.js frontend for wallet-driven case workflows
- a Cloudflare Worker backend for wallet challenge auth, evidence storage, and searchable projections
- Supabase Storage for evidence objects
- Supabase Postgres-backed projection/search surfaces
- real Studionet proof of dispute, evidence lock, adjudication, settlement, and withdraw

This is not just a mock UI. The current build has already been exercised against a deployed Studionet contract with recorded transaction hashes.

## Product summary

Faultspan answers a specific question:

When a final agent-produced result fails, which exact obligation failed, what evidence supports that conclusion, and how should value recovery happen?

The system is built around:

- obligation spans
- evidence bundles
- GenLayer adjudication
- deterministic settlement

In practice, that means Faultspan can:

- create a real case
- register delegated spans
- accept spans with bonds
- submit delivery references
- open disputes
- store and fetch evidence by digest
- link evidence on-chain
- lock evidence
- adjudicate with GenLayer validators
- settle the case
- withdraw claimable funds

## Live proof status

The current live proof run is documented here:

- [docs/LIVE_PROOF.md](docs/LIVE_PROOF.md)

That proof covers:

- deployed Studionet contract
- real case read/write flow
- real evidence URL fetch
- real dispute open
- real evidence lock
- real adjudication
- real settlement
- real withdraw

## Stack

### Frontend

- Next.js
- React
- TypeScript
- IBM Plex Sans / IBM Plex Mono

### Chain integration

- GenLayer Studionet
- `genlayer-js@1.1.8`
- Python Intelligent Contract

### Backend and storage

- Cloudflare Worker platform API
- Supabase Storage for evidence
- Supabase Postgres projections/search

## Network and contract

- Network: GenLayer Studionet
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- Contract: `0x23B6F12322d811918c4Ca5De210529d6cB09Df5D`

## Repository structure

```text
faultspan/
├── apps/
│   └── web/                        # Next.js app
├── contracts/
│   └── faultspan.py               # GenLayer Intelligent Contract
├── docs/
│   ├── LIVE_PROOF.md              # Recorded real Studionet run
│   ├── ENVIRONMENT.md             # Env variables and setup guidance
│   ├── DEMO_RUNBOOK.md            # Demo flow guidance
│   ├── INTEGRATIONS.md            # A2A/x402 notes
│   └── CLOUDFLARE_WORKER_DEPLOY.md
├── evaluation/                    # Fixtures and validation utilities
├── pitch/                         # HTML deck
├── scripts/                       # Deploy/test/reconcile scripts
├── services/
│   ├── platform/                  # Python/FastAPI platform service
│   └── platform-worker/           # Cloudflare Worker backend
└── FAULTSPAN_MASTER_PLAN.md       # Full plan and status
```

## Features already implemented

### Contract and workflow

- case creation
- span registration
- span acceptance and bonding
- delivery submission
- dispute open
- evidence link
- evidence lock
- adjudication
- settlement
- withdraw

### Frontend UX

- wallet connect and disconnect
- overview, cases, obligations, evidence, integration routes
- guided case lifecycle panel
- real case loading from contract
- searchable projections
- evidence dialog with copyable digest and public path
- verified-case reference flow on the overview page
- GEN-formatted visible bond values instead of raw wei

### Backend/API

- wallet challenge + verification
- evidence object storage by digest
- evidence retrieval endpoint
- projection storage for cases, spans, and activity
- search across cases, spans, activity, and tx hashes

### Proof and tooling

- local finish-case runner with resume support
- second-proof runner aimed at a stronger causal attribution scenario
- Studionet receipt handling for accepted/finalized split
- majority-agree finalized receipt handling
- Playwright browser end-to-end coverage for stable landing/workspace surfaces
- reconciler snapshot indexing for cases, spans, and claimable balances

## What is still left

The repo is strong, but not fully finished against the original master plan.

Main items still left:

- execution of the second live proof run that produces a stronger causal attribution such as `CAUSED_FAILURE`
- extending current Playwright coverage into a safe wallet-integrated contract-flow harness
- fuller hosted production hardening and operational polish

See:

- [FAULTSPAN_MASTER_PLAN.md](FAULTSPAN_MASTER_PLAN.md)

## Local prerequisites

Verified locally in this workspace:

- Node.js `24.16.0`
- npm `11.13.0`
- Python `3.12.10`
- GenLayer CLI `0.39.0`

Recommended minimums:

- Node.js 20+
- npm 7+
- Python 3.12+

## Installation

```powershell
npm.cmd install
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.\services\platform[dev]' genlayer-test genvm-linter
Copy-Item .env.example .env.local
Copy-Item .env.example apps\web\.env.local
```

Before filling values, read:

- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)

## Environment configuration

There are two main runtime surfaces:

### Frontend

Set in `apps/web/.env.local`:

- `NEXT_PUBLIC_GENLAYER_RPC_URL`
- `NEXT_PUBLIC_GENLAYER_CHAIN_ID`
- `NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_PLATFORM_API_URL`

### Backend / Worker / storage

Configured through Cloudflare Worker env/secrets and Supabase:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_EVIDENCE_BUCKET`
- `FAULTSPAN_SESSION_SECRET`

Full reference:

- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)

## Running locally

### Platform API

Terminal 1:

```powershell
.\.venv\Scripts\python.exe -m uvicorn faultspan_platform.main:app --host 127.0.0.1 --port 8000
```

### Frontend

Terminal 2:

```powershell
npm.cmd run dev
```

Then open:

- `http://localhost:3000`

## Verification commands

```powershell
npm.cmd run typecheck
npm.cmd run test
.\.venv\Scripts\python.exe -m pytest services\platform\tests -q
.\.venv\Scripts\python.exe -m ruff check services\platform
$env:PYTHONUTF8='1'; .\.venv\Scripts\genvm-lint.exe check contracts\faultspan.py
.\.venv\Scripts\python.exe evaluation\validate_fixtures.py
npm.cmd run build
```

## Useful scripts

### Reconcile Studionet state

```powershell
npm run reconcile:studionet
```

### Finish a partially completed live case

```powershell
npm run test:studionet:finish
```

The finish-case runner supports resume mode through:

- `FAULTSPAN_START_FROM=open_dispute|submit_evidence|lock_evidence|adjudicate_case|settle_case|withdraw`

### Prepare and run the stronger causal second proof

```powershell
npm run test:studionet:second-proof
```

This script creates a fresh case, registers the three spans, stores span-correct analysis evidence, and runs the remaining dispute lifecycle so you can capture a second live proof.

### Browser end-to-end coverage

```powershell
npm run test:e2e
```

## Demo and proof references

- [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md)
- [docs/LIVE_PROOF.md](docs/LIVE_PROOF.md)
- [docs/SECOND_PROOF_RUNBOOK.md](docs/SECOND_PROOF_RUNBOOK.md)
- [docs/PRODUCTION_HARDENING.md](docs/PRODUCTION_HARDENING.md)
- [FAULTSPAN_MASTER_PLAN.md](FAULTSPAN_MASTER_PLAN.md)

## Design and pitch artifacts

- [design/DISCOVERY.md](design/DISCOVERY.md)
- [design/COMPONENT_INVENTORY.md](design/COMPONENT_INVENTORY.md)
- [design/wireframes.html](design/wireframes.html)
- [pitch/faultspan-deck.html](pitch/faultspan-deck.html)

## Security and usage boundary

This prototype accepts public synthetic evidence only.

Do not submit:

- private keys
- seed phrases
- secrets
- personal information
- confidential customer data

The contract, settlement logic, and surrounding application have not received an independent production security audit and must not control material value.

## Immediate operational note

If any private key has been exposed in chat, logs, or screenshots during testing, rotate it immediately and stop using it.
