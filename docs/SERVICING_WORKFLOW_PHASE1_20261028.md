# BG Servicing and Endorsement — implementation increment (28 Oct 2026)

## Source and policy boundaries

Evidence extracted from the attached **Pedoman Bank Garansi Final 2023**:
- **Ketentuan Lain:** perpanjangan memerlukan covering letter dan proses internal setara pengajuan BG baru.
- **Alur Proses Perubahan Kontra Bank Garansi (Endorsemen):** RM/TL memeriksa permohonan/dokumen perubahan, hasil SLIK dan DHN, serta review yuridis; Reviewer DAR melakukan analisis kelayakan dan MAP-BG; penetapan kewenangan Komite mengikuti limit; perubahan atau endorsement Kontra BG memerlukan persetujuan Penjamin.
- The attached document is an institution-specific **2023 baseline**. It does not automatically establish approved, current 2026 bank rules, legal acceptability of digital endorsements or applicable regulator requirements.

## What was implemented in the existing native Worker

- **Existing route and tenancy**: existing authenticated `/api/applications/:id/commands/:name`, cookie/CSRF/RBAC, optimistic transaction version, idempotency key, audit/outbox and SQLite-backed Durable Object atomic commit.
- **Immutable original instrument**: the proposed amendment is a separate `servicing` aggregate linked by `application_id`. The original `guarantees` record, BG number, amount, expiry, certificate/QR and claim deadline remain unchanged.
- **New read endpoint**: `GET /api/applications/:id/servicing`, scoped to authorized Principal, Guarantor and bank operations roles. All responses state `mode=SANDBOX` and `effective=false`.
- **New actions**:

| Command | Authorized role | Required evidence and business guard | Status effect |
|---|---|---|---|
| `request_servicing` (existing, hardened) | Principal/MPO/Support | Verified latest `AMENDMENT_REQUEST`, meaningful proposed terms; no active overlapping change | PENDING_REVIEW |
| `review_servicing` | Analyst | New verified SLIK/DHN/LEGAL_CHECK/MAP_BG document revisions **after request**; SLIK Kol 1 current month; verified UBO/screening and documented recommendation | RISK_REVIEWED if LAYAK; otherwise REJECTED |
| `partner_endorse` | Guarantor/Penjamin of transaction | Verified latest `COUNTER_ENDORSEMENT`, uploader is same Penjamin identity, active partner PKS, proposed amount/expiry covered | PARTNER_ENDORSED |
| `approve_servicing` | MPO, plus GH_BISNIS/DIREKSI where applicable | Risk and partner documents unchanged, no open claim, institution sandbox tenor limit and incremental exposure recheck, no actor self-approval | APPROVED_PENDING_ISSUANCE |
| `reject_servicing` | Legal/Compliance | Independent reasoned rejection prior to approval | REJECTED |
| `withdraw_servicing` | Original requester | Request still unreviewed; reason required | WITHDRAWN |
| `cancel_approved_servicing` | Legal | Verified latest `CANCELLATION` document, independent of requester/approvers, releases extra reserved capacity | CANCELLED |

**APPROVED_PENDING_ISSUANCE is not a legal amendment or endorsement.** No action silently modifies effective BG terms or generates a fictitious updated signed warkat. If a larger proposed BG is approved for *future* formal issuance, an incremental reservation is created atomically; it remains reserved until formal issuance (not yet implemented) or independently authorized cancellation.

**No real money** is blocked, posted, settled, released or transferred by this workflow. The partner's upload and review are only sandbox documentary evidence, not an authorized e-signature.

## Existing files extended

| File | Change |
|---|---|
| `cloudflare/servicing-engine.ts` | Dedicated guarded servicing transitions, bank/partner review and effect separation |
| `cloudflare/enterprise-controls.ts` | Baseline supporting-document snapshot, unresolved-servicing guards, claim-period closure lock |
| `cloudflare/service.ts` | Transactional command integration, closed-BG verification and guarantor evidence view |
| `cloudflare/router.ts` | API routes, command validation and authorized counter evidence uploads |
| `frontend/components/ServicingWorkflow.tsx` | Context-sensitive bank/guarantor/requester forms with persisted statuses |
| `frontend/components/Portal.tsx` | Native role portal integration and evidence kinds |
| `tests/native-backend.test.mjs` | Full workflow, limit and rollback, stale-source evidence, committee escalation, cancellation and public QR cases |

## UAT scenarios added

| Test ID | Given / When | Expected |
|---|---|---|
| SVC-101 | Principal submits a genuine amendment | Request persisted, original BG unchanged |
| SVC-102 | Analyst reviews without refreshed SLIK/DHN/LEGAL_CHECK/MAP_BG | DENIED; no stage advancement |
| SVC-103 | Reviewer supplies Kol 1 current-month evidence and MAP-BG | RISK_REVIEWED |
| SVC-104 | Partner submits invalid denomination, stale date or non-owned endorsement | DENIED |
| SVC-105 | Valid partner endorsement with matching verified evidence | PARTNER_ENDORSED |
| SVC-106 | MPO approval when revised amount breaches principal/guarantor limit | Atomic DENIED; no approval/reservation |
| SVC-107 | Private-category revised amount triggers higher committee authority | MPO then required GH_BISNIS/DIREKSI; role progress persisted |
| SVC-108 | Approved increase without formal issuance | Original BG/QR/exposure intact, incremental capacity reserved |
| SVC-109 | Legal independently cancels approved but uneffected proposal | Supplemental reservation RELEASED |
| SVC-110 | Attempt new request while prior servicing is unresolved | DENIED |
| SVC-111 | Change verified MAP-BG revision after risk review | Approval DENIED |
| SVC-112 | Close original BG while servicing is approved but uneffected | DENIED |
| SVC-113 | Verify a BG already closed | Authentic historical instrument, `AUTHENTIC_CLOSED`, no active validation |
| SVC-114 | Attempt to submit no-op amount/expiry change | DENIED without row/audit state change |

Results must be verified against the latest CI head before marking any UAT PASS. Automated Node integration tests do not replace bank-user signoff or mobile device tests.

## Next dependencies (release blockers)

1. New official legal amendment/warkat templates, bank signatory/e-signature adapter, counter certificate endorsement and contract change verification.
2. Complete 5C re-underwriting calibrated methodology with review, source-scoped KYB and current institution policy, bank underwriting/committee delegation.
3. Effective approved finance/fee adjustment, real limit reservation and collateral coverage/release evidence.
4. Approved reissuance/endorsement event that atomically changes effective terms and reprices insured exposure **only after real partner, Legal, Compliance, Finance and Ops sign-offs**.
5. Backups and restore of the Durable Object before schema upgrade, institutional security and authority matrix, regulatory validation and full role UAT.

**Release gate: BLOCKED for production banking. Sandbox remains explicitly non-operational.**
