# BG Ecosystem — Release Readiness Runbook (29 October 2026)

**Release classification:** NON-OPERATIONAL SANDBOX ONLY. This runbook is a proposed deployment and evidence procedure; it is **not** an approval for issuance of real Bank Guarantees, cash movements, fund blocking, partner assurances or legally effective signatures.

Repository: `elanghaqeem-hash/BG` · Draft PR: #6 · Production-linked Worker: `bg` · Backend: native Worker / SQLite-backed Durable Object. Keep Cloudflare Free and **preserve the existing Durable Object identity, encrypted documents, keys, sessions and audit history**.

## A. Automated evidence that CI can demonstrate

1. `npm test` includes domain negative regression and `tests/release-preflight.test.mjs`.
2. `npm run check:release-preflight` verifies **both** root and frontend Wrangler configurations: `BG_MODE=SANDBOX`, expected Worker/entrypoint, `BG_BANK` / `BankBackend` migration, mandatory secret declarations, and a fail-closed Worker runtime guard.
3. `npm run check:deploy` is **dry-run only**; Node and Worker TypeScript checks must pass.
4. Verify the GitHub Actions result on the **exact latest commit SHA**, not on any earlier passing run.
5. The Worker returns HTTP 503 `RELEASE_BLOCKED` for missing, unexpected or `LIVE` `BG_MODE`. This is a software lock, not regulatory certification.

**Passing A is necessary but not sufficient for a bank-operational release.** No CI job is configured to deploy draft PR #6. Cloudflare Workers Builds remains restricted to `main`.

## B. Required real-world institutional evidence (currently NOT VERIFIED)

| Gate | Evidence required before authorization | Responsible verifier | Current result |
|---|---|---|---|
| G01 — Product/policy | Current authorized bank policy and effective dates, DPS acceptance, BR-01–20 and Form 5/5C standards | Bank Risk, Compliance, DPS | BLOCKED |
| G02 — Legal/authority | Approved PKS, SP2KBG, endorsement, official BG templates, signatory authority and role/delegation matrices | Legal, Penjamin, Secretariat | BLOCKED |
| G03 — Identity/security | Institutional IAM/MFA, customer tenancy/branch isolation, negative RBAC/IDOR and audit access evidence | IAM and Security | BLOCKED |
| G04 — External systems | Certified, tested live core, SLIK, partner, PSrE and legally valid e-signature adapters, fail-closed controls | Integration Owners | BLOCKED |
| G05 — Financial integrity | Actual collateral, fund block/release, ledger, fees, tax, recovery receipts and daily reconciliation | Finance, Operations, Risk | BLOCKED |
| G06 — Continuity | Independent backup, key recovery, restore rehearsal, verified RPO/RTO and rollback of application + data | IT Operations, Security | BLOCKED |
| G07 — Validation | Twelve real-user cross-role UAT journeys, negative paths, desktop/Android, evidence, issue closure | Business Owners and QA | BLOCKED |
| G08 — Change approval | Signed bank release record, legal/Compliance/DPS acceptance, designated deployment and fallback operators | Change Authority | BLOCKED |

No gate may be marked PASS by simply uploading an unsigned file or changing a JSON flag. Record independent signed evidence, scope, version, maker/checker, timestamp and document digest in the bank's approved change-management system.

## C. Proposed twelve real-user journey families (not yet executed)

1. Principal onboarding, contract, legal existence and KYB/UBO evidence.
2. Conditional document checklist and last-version verification by independent checker.
3. SLIK current-month screening, DHN, compliance and adverse results.
4. RM LKN-BG visit, photo bundle, source revision replacement and independent MPO check.
5. Formulir Standar Analisa, profitability periods and version-pinned 5C.
6. Penjamin approval, PKS coverage, KBG/SP2KBG evidence and checker.
7. Collateral valuation, approval, reservation, limit overrun and concurrency.
8. Bank underwriting and independent committee escalation; negative SoD cases.
9. Issuance and official-looking sandbox document/QR, intra-/inter-office approvals, mock fee, delivery.
10. Amendment/extension, partner endorsement, unchanged original BG and cancellation rollback of reserved increase.
11. Claim notification, mock payout, recovery evidence-only events, legal review and litigation.
12. Closure, claim windows, historic QR, permissions, audit and continuity/restart evidence.

These are **proposed acceptance scenarios**, not an assertion that the existing tests cover the full bank acceptance. For each journey retain actual user identity/role, timestamp, documents, observed result, defect ID, and independent sign-off. Include rejection, stale evidence, cross-application access, self-approval and duplicate requests.

## D. Deployment procedure (only after documented go-ahead)

**Pre-deployment**
- Confirm #6 is non-draft only **after** G01–G08 are independently approved and defects are closed. Review all additive SQLite table/index changes.
- Record exact commit SHA, tagged release, responsible operators, and explicit GO/NO-GO decision.
- Independently export and verify Durable Object data and encrypted document readability. Protect and escrow the matching `BG_ENCRYPTION_KEY` separately. Do not rotate the key or reuse `BG_INITIAL_USERS` on a new namespace as a workaround.
- For any experimental testing, provision a **different named sandbox Worker with fresh namespace and independently managed test secrets**; do not point a trial build at `bg` or its existing state.

**Technical publication**
- Merge only according to the approved change procedure; observe successful `main` Cloudflare Workers Build (root `/`, deploy command `npx wrangler deploy`).
- Preserve `BG_MODE=SANDBOX` for this MVP. The new runtime guard intentionally blocks all other modes. A real banking release requires separate institution-approved architecture and software; it cannot be enabled by changing this string.
- Verify deployed Worker version matches the reviewed commit/build identifier.

**Post-publication smoke (read-only first)**
- `GET /api/health/deployment` must report HTTP 200 with `backend_connectivity=ok`, `backend=durable-object-sqlite`, `mode=SANDBOX` and `production_enabled=false`.
- Unauthenticated `GET /api/auth/me` must return HTTP 401.
- With authorized **sandbox** identities, test login, logout, role scopes, maker-checker separation, source revisions, idempotency and a permitted read. Do not use actual customer data or issue a real BG.
- Verify persistence on a controlled restart, audit continuity and record observed operational errors/latency without exposing secrets.

**Rollback / incident**
- If unexpected state, missing secrets, failed health, RBAC regression or data mismatch occurs, stop the rollout and preserve evidence.
- Worker version rollback affects **code only**; it does not roll back the Durable Object SQL data, audit sequence or encryption key. Restore must follow the independently rehearsed data/key plan.
- Do not force a bypass of this guard, fake sign-offs, or mutate the active namespace to speed deployment.

## E. Release decision

`NO-GO` for operational banking production as of 29 Oct 2026. This document, regression tests and CI checks advance technical readiness only. PR #6 remains draft and must not be merged into the public Worker until the approved change-control path specifically permits the deployment scope.
