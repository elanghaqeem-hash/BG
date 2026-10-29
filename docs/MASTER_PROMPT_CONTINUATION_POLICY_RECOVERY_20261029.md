# BG Ecosystem — Continued Master Prompt: Policy Gates and Recovery (29 Oct 2026)

**Scope:** draft PR #6, branch `feat/enterprise-controls-phase1-20261028`. Cloudflare Free, native Worker + SQLite-backed Durable Object + Next.js. This file records implementation evidence, not approval of production banking functionality.

## What is complete in this increment

### 1. Versioned underwriting requirements under a maker–checker policy

- `cloudflare/core.ts` validates optional `configuration.analysis_controls`:
  - `require_standard_analysis: boolean`
  - `require_five_c: boolean` (requires `require_standard_analysis: true`)
  - `require_counter_review: boolean`
  - `max_profit_age_years: integer 1–10 | null`
- `POST /api/policies` (ADMIN) and `POST /api/policies/:id/approve` (CONFIG_CHECKER) are existing independent maker–checker actions, and an application pins its policy ID when created.
- `bank_underwrite` **and** `issue` now run the same source-evidence gate. Started but stale review is rejected even for a legacy application where the mandatory flag was not enabled.
- A newly approved policy can explicitly require approved Lampiran 5, independently approved structured 5C, and verified manual partner PKS / KBG review. All current validation remains **sandbox only**.
- Removed the prior invented hard-coded three-year financial recency cutoff. Financial-year continuity remains a data-quality check. The last-year recency limit is only applied when configured in the application's policy snapshot.
- The original `policy.sandbox.json` does **not** enable these new mandatory flags, preserving legacy sandbox journeys. This is *not* a waiver for a bank release.

**Invariants:** evidence revision, digest, application fingerprint and explicit independent checker; no automatic 5C score; no automated approval, no external policy authority.

### 2. Claim recovery / subrogation evidence case (previous Phase 0 module #18: not implemented)

- New `recovery_cases` and `recovery_events` persisted in the existing SQLite Durable Object, with application/claim indexes. `recovery_events` has SQL DELETE/UPDATE deny triggers.
- After a **MOCK** recorded bank claim payout, authorized Litigation/Legal can open a `BANK_RECOURSE_ASSESSMENT` with latest verified `RECOVERY_BASIS` document. `SUBROGATION_ASSESSMENT` additionally requires a recorded contra-payment *simulation*, but never confers legal subrogation.
- Independent Legal/Compliance reviewer confirms or returns basis. Case status: `PENDING_LEGAL_REVIEW` → `TRACKING_ONLY` or `RETURNED`. A returned case can be resubmitted with a new verified evidence revision.
- Litigation records `DEMAND`, `NEGOTIATION`, `COURT`, `PAYMENT_EVIDENCE`, or `OTHER` events backed by verified `RECOVERY_ACTION` documents. Legal/Compliance independently accepts/rejects each immutable action. A reported payment amount is **not recognized cash**, does not post to journal and cannot exceed claim amount.
- An administrative closure requires all actions reviewed and at least one independently accepted action, latest `RECOVERY_RESOLUTION` document, a Litigation maker and a distinct Legal/Compliance checker. The result is `CLOSED_TRACKING_ONLY`; it is **not** release of legal obligations, successful debt recovery, or a core-bank settlement.
- New bank-only `GET /api/claims/:id/recovery`; existing versioned, idempotent claim command route exposes:
  `open_recovery`, `review_recovery`, `record_recovery_action`, `review_recovery_action`,
  `request_recovery_closure`, `confirm_recovery_closure`.
- Frontend adds a Recovery/Subrogation panel to claims cards for authorized bank users, with source-document selections, verification status, and event history.
- Automated new regression scenarios: prevent premature recovery / unearned subrogation, independent legal review and scoped access, zero-cash action/closure, superseded/cross-application evidence. Latest CI outcome must be checked at the last commit.

**Important interpretation:** The 2022–2023 BG institutional source material covers claims and recourse/subrogation concepts, but the exact digital statuses, fields, legal evidence threshold, and authorities above are **software design proposals**, not approved clause-level regulatory obligations. They need Legal, Risk, Compliance, DPS, and bank policy approval.

## Risk register and production restrictions

| Area | Status | Outstanding requirement |
| --- | --- | --- |
| 20 BR rules | Sandbox baseline | Verify actual 2026 institution/DPS/OJK/BI/DSN policy sources and effective periods |
| Mandatory 5C / Form 5 / KBG | Implemented as opt-in policy controls | Approved policy activation, role matrix, mandatory migration and complete UAT |
| LKN / signed source evidence | Structured conditional report | Verified photo content, geolocation, BM authority, valid signatures |
| Approval / committee | Existing role guards | Delegation and bank-authorized decision matrix |
| Collateral / limits | Provisional reservation | Real cash block, valuation, legal perfection, reconciliation and releases |
| Recovery/subrogation | **Evidence tracking only** | Legal enforceability, insurer's subrogation rights, validated recovery balances, financial posting, settlement and reconciliation |
| New BG / servicing | Non-effective sandbox documents | Legal endorsement, signed instrument, linked SP2 and new claims window |
| Core/payments/SLIK/PSrE/partner | Mock/manual | Live certified APIs, evidence of reconciliation and fail-closed switching |
| Security/governance | Fixed UAT tenant | Institutional IAM, privacy, retention, DR/backup and tested restoration |
| Release | **BLOCKED** | Bank sign-off, real-user 12-journey UAT, independent backups/restores, legal/IT/Finance/DPS acceptance |

## Next recommended execution order (not represented as complete)

1. **P0**: institution-scoped policy/tenant and role governance with approval-effective date guard; require reviewed underwriting in operational profile without sandbox bypass.
2. **P0**: formal instrument and counter guarantee evidence chain, legal signatures, core and fund-blocking adapters (mock cannot pass LIVE).
3. **P0**: cash/fixed-asset collateral valuation, enforceable security documents, reservation/limit reconciliation.
4. **P1**: recovery/subrogation actual obligation recognition, allocations, partial payments, verified statements, legal case outcomes, report and accounting reconciliation **after** bank-validated policy and external adapters.
5. **P1**: project 360/multi-BG entity, monitoring/MIS/regulatory mapping and deterministic due-date alarms.
6. **P2**: bank-grade backup/restore rehearsal, immutable offsite anchors, scaled tenancy, protection against high-volume uploads, live 12-journey UAT.

No operational production deployment or merge is authorized by this source mapping; this PR remains draft.
