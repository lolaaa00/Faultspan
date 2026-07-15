# Faultspan Deployment Preparation

This repository is prepared for source-based deployment with hosted Supabase Storage. No external deployment has been performed by this document.

## Supabase Storage

1. Create a Supabase project.
2. Create a private Storage bucket named `faultspan-evidence`.
3. Add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_EVIDENCE_BUCKET`, and `FAULTSPAN_STORAGE_BACKEND=supabase` to the FastAPI host.
4. Do not add the secret key to the Next.js host or any `NEXT_PUBLIC_` variable.

## Local services

```powershell
.\.venv\Scripts\python.exe -m uvicorn faultspan_platform.main:app --host 127.0.0.1 --port 8000
npm.cmd run dev
```

Health checks:

```text
GET http://localhost:8000/health
GET http://localhost:8000/ready
GET http://localhost:3000/api/health
```

## Hosted services

- Deploy `services/platform` to any Python 3.12 host using `uvicorn faultspan_platform.main:app --host 0.0.0.0 --port $PORT` and the server variables above.
- Deploy `apps/web` to a Node.js host with the four `NEXT_PUBLIC_*` variables.
- Set `FAULTSPAN_ALLOWED_ORIGINS` to the exact deployed web origin and `NEXT_PUBLIC_PLATFORM_API_URL` to the exact HTTPS API origin.
- Confirm `/health` and `/ready` before enabling the evidence flow.

## Studionet contract

Deployment is a separate on-chain action requiring a funded account:

```powershell
genlayer network set studionet
genlayer deploy --contract contracts/faultspan.py
```

Before using the returned address:

1. Confirm the receipt reached `FINALIZED`.
2. Confirm the execution result is successful.
3. Read a view method from the deployed address.
4. Set `NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS`.
5. Rebuild the web application.

## Rollback

- Web/API: redeploy the previous source revision.
- Evidence: restore the Supabase project or Storage objects from the recovery copy maintained under your retention policy.
- Contract: do not overwrite or pretend to roll back on-chain state. Deploy a new version and point new writes to it; preserve the old address as read-only metadata.
