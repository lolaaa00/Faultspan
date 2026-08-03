<p align="center">
  <img src="apps/web/app/icon.svg" alt="Faultspan" width="96" />
</p>

# FAULTSPAN — Dispute Resolution for Multi-Agent AI Commerce

> Trustless, AI-consensus dispute resolution on GenLayer.

**Live app:** [faultspan-web-248l.vercel.app](https://faultspan-web-248l.vercel.app) · **Backend:** `https://faultspan-worker.ayoolarachi.workers.dev`

When a delegated AI workflow fails, Faultspan answers: **which obligation failed, what evidence proves it, and how should value recover?**

---

## What it is

An AI agent hires sub-agents to complete work. Bonds are posted. If the outcome fails, anyone can open a dispute. GenLayer validators — running LLMs and fetching live evidence URLs during consensus — independently read every evidence bundle, evaluate each obligation span, and produce a finding. The bond is slashed on-chain according to that finding. No human arbitrator. No trusted third party.

- Obligations are modelled as a **graph of spans**, each with its own bond and penalty schedule
- Evidence is stored on **IPFS via Pinata** — content-addressed, immutable by construction
- Adjudication runs inside a **GenLayer Intelligent Contract** using `gl.nondet.exec_prompt` and `gl.nondet.web.get`
- Settlement is deterministic — the contract slashes and releases bonds automatically after a ruling

---

## How it works

**For case coordinators**

1. Create a case — upload root terms to IPFS, record the CID and digest on-chain
2. Register obligation spans for each delegated agent, with bonds and penalty rates
3. Agents accept spans and post bonds
4. Agents submit delivery references
5. Open a dispute if the outcome fails
6. Submit and link evidence bundles on-chain
7. Lock evidence to freeze the record
8. Trigger adjudication — GenLayer consensus reads everything and rules
9. Settle — bonds are slashed and released on-chain
10. Withdraw claimable funds

**For providers (agents)**

- Accept a span and bond into it
- Submit a delivery reference when work is complete
- Link counter-evidence before the evidence lock
- Receive returned bond if ruled COMPLIED

**For GenLayer validators**

- Fetch root terms from IPFS to establish the rubric
- Fetch each evidence bundle from IPFS
- Run LLM evaluation for each span: COMPLIED / CAUSED\_FAILURE / CONTRIBUTED\_TO\_FAILURE / INSUFFICIENT\_EVIDENCE
- Reach consensus via Optimistic Democracy — leader proposes, validators independently evaluate, disagreements trigger re-votes

---

## Findings

| Finding | Meaning | Slash |
|---|---|---|
| `COMPLIED` | Material obligations met | 0% |
| `CONTRIBUTED_TO_FAILURE` | Breach worsened outcome but was not sole cause | `contribution_penalty_bps` |
| `CAUSED_FAILURE` | Breach was a necessary cause of the root failure | `causal_penalty_bps` |
| `INSUFFICIENT_EVIDENCE` | Evidence cannot support a determination | 0% |

---

## Case lifecycle

```
OPEN → ACTIVE → DISPUTED → EVIDENCE_LOCKED → DECIDED → SETTLED
```

| State | Trigger |
|---|---|
| `OPEN` | Case created on-chain |
| `ACTIVE` | All spans bonded |
| `DISPUTED` | Coordinator opens dispute |
| `EVIDENCE_LOCKED` | Evidence frozen — no further submissions |
| `DECIDED` | GenLayer adjudication reaches consensus |
| `SETTLED` | Bonds slashed and released |

---

## GenLayer consensus functions

| Function | Uses | Output |
|---|---|---|
| `adjudicate_case` | `gl.nondet.web.get`, `gl.nondet.exec_prompt` | Per-span findings, case verdict |
| Evidence fetch | `gl.nondet.web.get(evidence_url)` | Bundle JSON from IPFS |
| Root terms fetch | `gl.nondet.web.get(root_terms_ref)` | Obligation rubric from IPFS |
| Digest verification | SHA-256 comparison against on-chain digest | `rubric_verified` flag in prompt |

All consensus outputs are validated inside the contract before being written to state.

---

## Contract

| | |
|---|---|
| Network | GenLayer Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Address | `0x161275d7E8b18C58E0C88518c74BD036c96F998C` |
| Source | `contracts/faultspan.py` |

> **Note:** The contract is pinned to genvm `v0.2.16` (see comment at the top of `contracts/faultspan.py`) because `v0.3.0-rc7` dropped the `genvm-universal.tar.xz` asset that `gltest` depends on. Redeploying against a newer GenLayer SDK/genvm version may require re-validating this compatibility.

---

## Tech stack

| Layer | Technology |
|---|---|
| Chain | GenLayer Studionet, `genlayer-js@1.1.8` |
| Contract | Python Intelligent Contract (`gl.Contract`) |
| Frontend | Next.js 16, React 19, TypeScript, IBM Plex fonts |
| Backend API | Cloudflare Worker (Hono, TypeScript) |
| Evidence storage | IPFS via Pinata (content-addressed) |
| Projection database | Cloudflare D1 (SQLite) |
| Session store | Cloudflare KV |
| Auth | EIP-191 wallet challenge / verify (`viem`) |

---

## Repository

```
faultspan/
├── apps/web/                  Next.js frontend
│   └── components/
│       ├── faultspan-prototype.tsx   App shell, case list, navigation
│       ├── wallet-provider.tsx       All on-chain interactions
│       └── case-workflow-panel.tsx   Per-case lifecycle panel
├── contracts/
│   └── faultspan.py           GenLayer Intelligent Contract
├── packages/domain/           Shared TypeScript types and settlement logic
├── services/worker/           Cloudflare Worker backend
│   ├── src/
│   │   ├── index.ts           Hono app, CORS, health endpoints
│   │   ├── auth.ts            Wallet challenge/verify, KV sessions
│   │   ├── evidence.ts        Pinata upload proxy, IPFS GET
│   │   └── projection.ts      Cases, spans, activity CRUD (D1)
│   └── migrations/
│       └── 0001_init.sql      D1 schema
├── tests/                     Integration and e2e tests
├── docs/                      Live proof, environment, demo runbooks
└── HANDOVER.md                Full setup guide for new contributors
```

---

## Getting started

See [HANDOVER.md](HANDOVER.md) for the complete step-by-step guide — from clone to live deployment on Cloudflare and Vercel.

**Quick local run:**

```bash
npm install
```

Create `apps/web/.env.local`:

```
NEXT_PUBLIC_GENLAYER_RPC_URL=https://studio.genlayer.com/api
NEXT_PUBLIC_GENLAYER_CHAIN_ID=61999
NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS=0x161275d7E8b18C58E0C88518c74BD036c96F998C
NEXT_PUBLIC_PLATFORM_API_URL=http://localhost:8787
```

```bash
cd services/worker && npm install && wrangler dev   # backend on :8787
cd apps/web && npm run dev                          # frontend on :3000
```

Open [http://localhost:3000](http://localhost:3000) and connect a MetaMask wallet on GenLayer Studionet (Chain ID 61999).

---

## Disclaimer

Faultspan provides trustless on-chain dispute resolution for multi-agent AI workflows. It is not legal advice and does not constitute a legally binding arbitration service. The contract and settlement logic have not received an independent production security audit and must not control material value.
