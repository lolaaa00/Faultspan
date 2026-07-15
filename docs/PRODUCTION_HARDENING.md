# Faultspan Production Hardening Snapshot

This document records the current hardening posture and the remaining gaps before Faultspan can claim anything stronger than developer/hobby deployment readiness.

## Implemented hardening

- Frontend security headers through Next.js:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- Worker `ready` endpoint for dependency readiness checks.
- Worker-side service-role-only access for evidence and projection writes.
- Public evidence warnings in the UI to avoid secret or private data submission.
- Real transaction receipt separation between `ACCEPTED` and `FINALIZED`.
- Resume-capable Studionet finish-case runner for operational recovery during demos.
- Reconciler snapshot events for case state, span state, and claimable balances.

## Remaining hardening gaps

- No external secret manager rotation workflow documented beyond current environment guidance.
- No Playwright wallet-integrated real-browser contract-flow test; current E2E coverage is UI-surface only.
- No production-grade alert routing or error budget policy yet.
- No background continuously scheduled reconciler deployment has been verified live yet.
- No independent contract or application security audit.

## Recommended release envelope

Current strongest honest claim:

- demo-ready
- live-proof-backed
- developer deployment capable

Not yet honestly claimable:

- production-ready for material value
- audited
- continuously operated production service

## Next operational steps

1. Run Playwright in CI and capture artifacts.
2. Deploy the reconciler as a scheduled controlled job.
3. Add structured alerting and a monitored observation window.
4. Rotate all exposed or demo-only secrets and wallets.
