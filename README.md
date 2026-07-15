# Faultspan

Failure attribution and automatic recovery for multi-agent commerce, built on GenLayer.

## Current maturity

Weeks 1–11 prototype implementation. The repository contains a lint-valid Intelligent Contract, deterministic domain tests, an evidence API, A2A/x402 evidence adapters, an interactive frontend, an adversarial fixture corpus, design artifacts, deployment preparation, and runbooks.

No Studionet contract deployment is claimed until a funded account submits and verifies the deployment transaction.

## Prerequisites

- Node.js 20+; verified locally with Node 24.16.0.
- npm 7+; verified locally with npm 11.13.0.
- Python 3.12+; the project virtual environment uses Python 3.12.10.
- GenLayer CLI; verified locally with version 0.39.0.

## Install

```powershell
npm.cmd install
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.\services\platform[dev]' genlayer-test genvm-linter
Copy-Item .env.example .env.local
Copy-Item .env.example apps\web\.env.local
```

Read [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) before filling the environment files.

## Run

Terminal 1:

```powershell
.\.venv\Scripts\python.exe -m uvicorn faultspan_platform.main:app --host 127.0.0.1 --port 8000
```

Terminal 2:

```powershell
npm.cmd run dev
```

Open `http://localhost:3000`.

## Verify

```powershell
npm.cmd run typecheck
npm.cmd run test
.\.venv\Scripts\python.exe -m pytest services\platform\tests -q
.\.venv\Scripts\python.exe -m ruff check services\platform
$env:PYTHONUTF8='1'; .\.venv\Scripts\genvm-lint.exe check contracts\faultspan.py
.\.venv\Scripts\python.exe evaluation\validate_fixtures.py
npm.cmd run build
```

## Important artifacts

- [Master plan](FAULTSPAN_MASTER_PLAN.md)
- [Design discovery](design/DISCOVERY.md)
- [Wireframe comparison](design/wireframes.html)
- [Component inventory](design/COMPONENT_INVENTORY.md)
- [Integration contracts](docs/INTEGRATIONS.md)
- [Environment guide](docs/ENVIRONMENT.md)
- [Demo runbook](docs/DEMO_RUNBOOK.md)
- [HTML pitch deck](pitch/faultspan-deck.html)

## Security boundary

The prototype accepts public synthetic evidence only. Never submit private keys, seed phrases, secrets, personal information, or confidential customer material. The contract and settlement code have not received an independent security audit and must not control material value.

