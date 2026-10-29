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


## Integration regression: Vercel proxy × Cloudflare-native business routes (30 October 2026)

The `tests/vercel-five-actor-proxy.test.mjs` test exercises the actual `proxyApi` module and native bank `route` together. It creates a **disposable in-memory SQLite bank** with randomly generated fixture passwords and encryption key. No requests reach the deployed Cloudflare Worker or Vercel production backend, no customer records are accessed, and no production state is changed.

Coverage includes:
- Initial unauthenticated denials for `auth/me`, applications, claims, users and audit events.
- Logins through the Vercel HTTP proxy, server session cookie propagation and role identity for Principal, Bank (MPO), Penjamin, Obligee, Broker, Compliance, Audit.
- Role-limited master/catalog and admin users access, broker without mandate, wrong obligee organization, rejected cross-origin POST.
- Invalid CSRF; Principal upload of synthetic NIB; prohibition of self-verification; independent Compliance verification; application submission; logout/session revocation with other actors unaffected.
- Negative public verification for a deliberately fictitious BG token.

The existing `tests/native-backend.test.mjs` covers full multi-role bank guarantee issuance, claim, settlement, document encryption, versioning, maker-checker and audit integrity using isolated test fixtures. Those tests remain required; the proxy integration does not replace them.

### Outstanding go/no-go conditions

- **Live authenticated five-actor UAT is NOT verified**: no real Vercel/Cloudflare login credentials were used. Do not mark business UAT PASS from backend unit/proxy integration or anonymous health checks.
- **Shared Vercel egress identity:** The Cloudflare Durable Object currently keys a per-IP rate limiter from `CF-Connecting-IP`. With the Vercel reverse proxy, this may represent Vercel egress rather than the original browser. Verify load and fair-rate behavior; introduce authenticated, signed client provenance or an approved upstream limiter before broad multi-user rollout. Do not trust arbitrary `X-Forwarded-For`.
- **QR origin:** Cloudflare QR generation currently uses the request host, which may refer to the Cloudflare legacy address. Test the QR deep link and decide on a documented canonical Vercel verification origin without accepting spoofed public-host headers.
- **Secure backend URL:** Production proxy never permits HTTP localhost even if `BG_ALLOW_LOCAL_API=1` is set. Only development may use local HTTP.
- **Operations:** Vercel Hobby and Cloudflare Free are appropriate only for noncommercial experimentation, not financial production resilience, guaranteed uptime or regulatory issuance.

A complete live UAT needs separate synthetic identities, signed-off five-actor results, CSRF/RBAC negative evidence, sample documents, backed-up test fixture, and a reviewer independent of transaction maker.
