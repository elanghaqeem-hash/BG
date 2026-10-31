# BG Ecosystem Enterprise — Integrated UAT evidence and release control
**Tanggal:** 31 Oktober 2026 (WIB)  
**Repository:** https://github.com/elanghaqeem-hash/BG  
**UAT branch:** `test/bg-full-workflow-uat-20261031`  
**Review:** https://github.com/elanghaqeem-hash/BG/pull/15

## Methodology and test isolation

All business transaction tests create new **disposable** SQLite-backed Cloudflare-native state and test-only credentials. No transactions are posted to an actual CBS/GL, insurer, PSrE or bank accounting system. `BG_MODE=SANDBOX` remains mandatory. Tests use both HTTP route/domain interactions and Playwright clicks against a locally built production-compatible Next.js/OpenNext + Wrangler runtime.

**Distinguish coverage**: a navigable menu / visible button is counted as *observed*, **not** functional PASS unless invoked with asserted business result. This document lists what was truly exercised; it is not an enterprise bank production certificate.

## Execution evidence

| Evidence | What is exercised | Reference |
|---|---|---|
| Base 21-user UI sweep, inventory and application-detail navigation | Desktop/mobile, session, upload, independent document verification, Admin registration/password changes, role menus and visible buttons | `scripts/browser_smoke.cjs`; GitHub Action `BG isolated end-to-end browser and persistence UAT` |
| UAT-F01 | Principal → KYB/SLIK → Penjamin/SP2KBG → MPO → Akad → Finance → BG issue → counter certificate → delivery → claim → bank payout → contra paid; journal and audit reconciliation | `tests/uat-enterprise.test.mjs` |
| UAT-F02 | Private obligee >Rp3 billion, MPO + Direksi; unauthorized roles blocked, wrong role may not approve | `tests/uat-enterprise.test.mjs` |
| UAT-F03 | Interoffice E-Memo; fee split subject to approved sandbox policy and **different Finance maker/checker**; journal reconciliation | `tests/uat-enterprise.test.mjs` |
| UAT-F04 | Contra rejection; Litigation opened; independent Legal review of recovery; no fictitious cash posting; closure after evidence and reconciliation | `tests/uat-enterprise.test.mjs` |
| UAT-F05 | 21 sandbox identities, application visibility/office scope, admin-only user management, Audit/Legal hash verification | `tests/uat-enterprise.test.mjs` |
| UAT-F06 | Wrong role, stale version or repeated payment action cannot duplicate mock ledger | `tests/uat-enterprise.test.mjs` |
| UAT-F07 | Post-bank-payment claim withdrawal denied; paid exposure preserved in outstanding claim cap | `tests/uat-enterprise.test.mjs` |
| UAT-F08 | Lawful pre-payment withdrawal ends open report task without a bank payment journal | `tests/uat-enterprise.test.mjs` |
| UAT-F09 | Penjamin can see and read counterpart contra-claim/decision/payment evidence, but not bank-only MKP/SLIK | `tests/uat-enterprise.test.mjs` |
| Real browser business workflow | Direct clicks on Principal, Compliance, Analyst, Penjamin, MPO, Finance, Obligee, Litigation, Legal, Audit forms; state progression checked after each click | `scripts/browser-business-uat.cjs` |
| Native security regression | Durable Object SQLite persists across restart, concurrent updates once, CSRF rejects, auth rate limiter, audit chain integrity | `scripts/native-runtime-check.mjs` |

**Automated evidence**: `evidence/enterprise-uat-20261031.json`, `evidence/button-role-uat.json`, `evidence/browser-business-uat.json` and `evidence/native-runtime.json` uploaded as GitHub Actions build artifacts (artifacts are not production credentials).

## Defects identified and corrective changes proposed

1. **P0: Financial claim exposure bypass** — The source initially let an Obligee withdraw a claim *after* bank payment, marking it `WITHDRAWN` and excluding it from aggregate claim exposure. Fix in `cloudflare/service.ts`: pre-payout states only; post-payout withdrawal gets HTTP 409; complete open report task on lawful pre-payout withdrawal. Hide the unsafe option in `frontend/components/Portal.tsx`. Cases F07/F08 assert behavior.
2. **P1: Counterguarantor cannot finish claim decision via UI** — Penjamin documents were filtered to issuance-only types; its own `CONTRA_DECISION` never populated the required document selector, preventing `contra_decision`. Amend Penjamin list/download scope to only `CONTRA_CLAIM`, `CONTRA_DECISION`, `CONTRA_PAYMENT` in addition to existing permitted evidence, without exposing bank-only files. Case F09 guards privacy.
3. **Test script issue, not production defect** — Repeated logins in one short CI run hit the persisted 30 auth requests/minute guard; avoid duplicate identity login and reuse browser sessions per role, **do not disable rate limits**.
4. **Correct business verification gate** — Obligee may submit unverified claim evidence, but bank claim approval is rejected until independent source verification. The UI UAT now verifies `CLAIM` before `approve_claim`.

## Financial and audit assertions

- Every mock journal contains balanced debit/credit values using integer cents, across receipt, BG contingent, claims, contra reimbursement and office split (as applicable).
- Bank claim receivable posted on simulated bank payout must be reversed by corresponding contra paid receipt; **zero net simulated claim receivable** after settlement.
- Attempted unauthorized, stale or replayed commands must **not** add journal rows.
- Recovery tracking and payment-looking documents must **not** auto-post cash, recognize receivables or assert legal subrogation.
- Audit hash chain is verified by `/audit/verify`, while `external_anchor_verified=false` is disclosed.

## Open gaps / explicit blockers to operational go-live

- The 20 target enterprise modules are **not** all implemented and action-covered. Menu-button inventory is **not** evidence of end-to-end completion for every feature.
- Core banking, CBS/GL postings, SLIK/OJK retrieval, insurer live endorsements/settlements, PSrE, payment rails, banking master policies, real regulatory reporting, and external audit anchor are not connected/approved.
- Multi-institution tenancy/SSO/MFA, signed policy matrix, penetration testing, external backup/restore, model validation, reconciled live GL, bank-owner UAT and bank Risk/Legal/Compliance/DPS approvals remain separate production release gates.
- Keep `BG_MODE=SANDBOX`; a successful Cloudflare deployment is not an authorization to issue or settle real bank guarantees.

## Release decision

**UAT release gate: DO NOT CERTIFY FOR REAL BANK OPERATIONS.**  
Merge bug fixes only after the latest PR #15 checks are PASS and the attached UAT reports are reviewed. Deploying to the public Worker URL remains sandbox-only and must not bypass operational bank gates.
