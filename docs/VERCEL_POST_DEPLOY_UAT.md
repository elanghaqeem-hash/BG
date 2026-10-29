# BG — Vercel Hobby SANDBOX post-deployment acceptance

## Scope and confirmed architecture

- Deployment target: Vercel project `bg`, Next.js portal under `frontend/`.
- Stable portal: https://bg-collman.vercel.app
- Backend: existing Cloudflare Worker / Durable Object SQLite; no database migration and **no deletion of old Worker**.
- Mode: SANDBOX only; no live financial undertaking and no customer data in UAT.
- Vercel server-only `BG_API_INTERNAL_URL` points to existing Cloudflare `/api`. Never expose an initial-user password or encryption key through Vercel client environments.
- Automated read-only smoke: `node scripts/check-vercel-sandbox.mjs https://bg-collman.vercel.app/`.
- Smoke checks API connectivity, backend mode/persistence and invalid public BG token; it cannot prove authenticated user journeys or real customer data integrity.

## Live evidence and restrictions (30 October 2026, Asia/Jakarta)

| Case | Evidence | Status |
| --- | --- | --- |
| Production build | Vercel deployment `dpl_HC3YarBabpQobX347vnAyz7anLXH`, GitHub `5fe6256` | READY |
| Portal root | GET / returned 200 HTML | PASS |
| Deployment health | GET /api/health/deployment returned 200, backend_connectivity=ok | PASS |
| Backend health | GET /api/health returned 200, mode=SANDBOX, persistent=true | PASS |
| Invalid BG verification | GET /api/public/verify/test-invalid-token returned 200, authentic=false | PASS |
| Protected data unauthenticated | /api/applications, /api/claims, /api/users, /api/audit/events returned access-related 401 in protected fetch | INCONCLUSIVE: source of 401 (app vs Vercel protection) not distinguished |
| Five-actor login and transactions | No production sandbox credentials used | NOT TESTED |
| Dependency audit | root and frontend lockfiles scanned on hardening branch; high and critical findings must be zero | RELEASE GATE |

## Required authenticated UAT — sandbox identities only

Execute these cases with independently provisioned test accounts through the portal. All UAT must avoid real bank guarantees and real personal/customer information.

| Actor | Required positive journey | Required negative control |
| --- | --- | --- |
| Principal/contractor | Login, create draft, upload NIB/contract/KYB, submit, sign akad | Cannot see or alter another principal's application |
| Bank (separate compliance/analyst/approver/issuer/finance accounts) | KYB, SLIK, credit review, limit/committee approval, fee, issue, immutable audit | Maker cannot self-approve; no unauthorized issue; stale version and CSRF denied |
| Guarantor/counter-guarantor | Partner review, SP2KBG, certificate, contra claim | Cannot decide cases of unrelated guarantor; cannot bypass bank approval |
| Obligee/bouwheer | Delivery acknowledgment, verify QR, submit claim | Cannot submit claim for another obligee |
| Broker (optional) | Access with principal mandate, disclose commission, submit within authorized scope | Revoked/expired mandate and cross-principal access blocked |

Additional critical journeys: document hash and encrypted download authorization, LKN independent review, Standard Analysis maker-checker, amendments, claim time limits, bank payout, legal recovery, audit integrity and rollback. Backend unit/integration tests exercise these paths with synthetic fixtures; **they do not replace UAT against this Vercel deployment**.

## Release gates and rollback

1. GitHub CI (frontend/backend) and both npm lockfile audits PASS with zero HIGH/CRITICAL.
2. Vercel preview/production new commit is READY; live read-only smoke PASS.
3. Independent UAT across bank roles plus five external actors verified and documented; no open P0 defect.
4. Inspect Vercel Function quotas, upstream egress/IP-aware login rate limiting, and QR links after split hosting.
5. Retain Cloudflare Worker, Durable Object identity, encrypted document storage and original `BG_ENCRYPTION_KEY`. Never rotate the key as a migration shortcut.
6. Roll back portal traffic to prior Vercel/Cloudflare release if any security or business invariant fails.

Vercel Hobby is for personal/noncommercial sandbox use; actual commercial bank guarantee operations require an appropriate plan, regulatory approvals, stronger backend architecture, security assurance and operational controls.
