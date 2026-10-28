# BG — Phase 0 audit and feature gap matrix (28 October 2026)

**Scope:** `main` baseline commit `4edc9a3603009e03b6f3f005be4710c1b1cee6e1`; proposed Phase 1 in draft PR #6. This matrix documents code evidence, **not** bank acceptance or a production-ready declaration.

## Audit evidence and boundaries

- Cloudflare runtime: `cloudflare/worker.ts` routes the existing Next.js portal and native Durable Object `BankBackend`. `core.ts` originally held 21 JSON-snapshot aggregates, while `target_57_tables_REFERENCE_ONLY.sql` is not an active migration. Phase 1 adds four aggregate tables through additive idempotent initialization; migration/backfill for banking production remains pending.
- Source code: `cloudflare/service.ts`, `router.ts`, `document-checklist.ts`, `core.ts`, `bootstrap.ts`, `config/policy.sandbox.json`; `frontend/components/Portal.tsx`, `Accounts.tsx`, `DocumentChecklist.tsx`.
- Tests: `tests/native-backend.test.mjs`, `tests/api-proxy.test.mjs`, `backend/tests/`, CI `.github/workflows/ci.yml`. Source report `docs/NATIVE_BACKEND_VERIFICATION_20261028.md` records an earlier test result, not confirmation of this PR.
- Configuration is deliberately **SANDBOX**; fixed `bank-uat` namespace, initial pilot identities, verified-source evidence, receipt/signatures explicitly MOCK. It is not institutional multi-tenant IAM, regulator access or live settlement.
- Document sources: SK Direksi **134/SK/DIR/XII/2022**, dated **28 December 2022** (document filename carries a different date); Pedoman Bank Garansi 2023; Lembar Kontrol dan Persetujuan; Lampiran 2 (Permohonan KBG); Lampiran 3 (Checklist); Lampiran 4 (LKN-BG); Lampiran 5 (Formulir Standar Analisa). **Institution-specific validity in 2026 remains unverified**.

## Feature Gap & Implementation Matrix

Status denotes repository implementation scope, not operational readiness. EV = EXISTING & VERIFIED in baseline source tests; EI = EXISTING BUT INCOMPLETE; NI = NOT IMPLEMENTED; ED = EXTERNAL DEPENDENCY; P1 = changes proposed in this PR, still subject to CI/UAT.

| # | Module | Baseline / linked service | Principal gap | Priority | Current classification |
|---|---|---|---|---|---|
| 01 | Executive Dashboard | Portal application, claim and operational counts | Live KPI definitions, effective-date reporting, reconciliation and drilldown | P1 | EI |
| 02 | Customer & Party 360 | `parties`, `partners`, `users`, `mandates` | Canonical legal identifiers, UBO, duplicate detection and institutional onboarding | P0 | EI |
| 03 | Project & Tender | `applications.project_name` | Project/contract entities and multiple BG per project | P1 | NI |
| 04 | Smart Application | Draft/create/submit/version/ID | Multi-product eligibility, autosave and dynamic revisions | P0 | EI |
| 05 | Document Management | AES-GCM documents, checksum, checklist and verification | Rich file formats, expiry/retention/hold, verified replacement race, regulated storage | P0 | EI; replacement guarded in P1 |
| 06 | KYB & Screening | KYB, SLIK record and document evidence | Official adapters, verified UBO/sanctions and expiry | P0 | EI / ED |
| 07 | LKN-BG | Checklist lists LKN | Complete structured visit, photo/geolocation verification and supervisor review | P0 | NI |
| 08 | Digital Underwriting | `bank_underwrite`, committee, SLIK | Five C record, reviewer, ratios, model approval and maker/checker | P0 | EI; 5C record/review in P1 |
| 09 | Guarantee Partner | Partners, SP2KBG, certificate, contra claim | Effective PKS master, CAC/CBC decision, capacity and formal endorsement | P0 | EI; review gate in P1 |
| 10 | Limits & Collateral | Pre-issuance principal/partner exposure | Reservation, full collateral lifecycle, blocked-fund reconciliation and coverage | P0 | EI; register/review/reservation in P1 |
| 11 | Approval & Committee | Committee role and append-only approvals | Approval matrix configuration, delegation, conditional approval | P0 | EI |
| 12 | Pricing/Ujrah/Billing | Sandbox fees, ijp, split, ledger | Effective tariffs, invoice, payment and core-bank reconciliation | P0 | EI / ED |
| 13 | Akad & Legal Documents | Generated sandbox MKP/AKAD | Official templates, signing/authority and legal custody | P0 | EI / ED |
| 14 | Issuance & BG Registry | BG number, warkat sandbox, QR, certificate | Live instrument/signature, custody, conditional issuance checks | P0 | EI / ED |
| 15 | BG Servicing & Amendment | No complete post-issuance workflow | Revised BG/SP2KBG, approvals, fee changes and immutable endorsement chain | P1 | NI; request intake only in P1 |
| 16 | Monitoring | Task/alarms, activation, due dates | Maturity & claim-window monitoring, branch/partner exceptions | P1 | EI |
| 17 | Claims | Obligee claim, bank mock pay, contra claim and litigation | Live payment reconciliation, dispute authority and counterclaim evidence | P0/P1 | EI / ED |
| 18 | Recovery/Subrogation | Litigations and mock receivable journal | Dedicated recovery ledger, subrogation, partial settlement, write-off | P1 | NI |
| 19 | Finance & Accounting | Balanced mock journal and split | Real posting evidence, 3-way reconciliation and accounting mappings | P1/P2 | EI / ED |
| 20 | MIS/Risk/Regulatory Reporting | Portal metrics and audit export capabilities | Reconciled portfolio reports and approved supervisory mappings | P1/P2 | EI / ED |
| 21 | Administration/Governance | Pilot users, policy maker-checker, audit | Institution-scoped master/policy rules, maker/checker per parameter, backup/restore | P0/P2 | EI |

### Five P0/P1 priority workstreams and dependency gates

| Workstream | Proposed implementation files | API/command | Domain entities | Test / remaining exit gate |
|---|---|---|---|---|
| Policy engine | `enterprise-controls.ts`, `router.ts` | `POST /api/policies/:id/simulate` | Existing policies/audit | Rule dry-run/audit test; per-institution conflict governance and effective policy authority **pending** |
| Digital underwriting | `enterprise-controls.ts`, `service.ts`, UI | `record_5c`, `review_5c` | `underwritings`, applications | Verified financial evidence + checker tests; policy-mandatory 5C, calibrated scoring, MAP-BG document generation **pending** |
| Counter guarantee | Same plus partner evidence | `review_counter` | Application counter review, partner, SP2 | Scheme/reference/SP2 snapshot tests; PKS validity/certified partner scope and signed issuance **pending** |
| Collateral & limits | Same, `core.ts` | `register_collateral`, `approve_collateral`, `reserve_limit` | `collaterals`, `limit_reservations`, guarantees | Atomic exposure and maker-checker tests; actual fund block, legal binding, formal release and external reconciliation **pending** |
| Lifecycle | Same, UI | `request_servicing`, `request_bg_closure`, `confirm_bg_closure` | `servicing`, applications, guarantees, journals | Immutable BG, prior claim-window, checked closure tests; executed amendments, reissuance, recovery and subrogation **pending** |

**Safety invariants:** legacy applications can still run baseline sandbox underwriting without a structured 5C; enabling a mandatory 5C rule for bank operations requires approved versioned policy and regression migration. The new 5C route fails closed once an assessment is started. Amendment/extension records are `PENDING_REVIEW`, not endorsed instruments. Counter review status `VERIFIED_SANDBOX` is not equivalent to live PKS validation.

## Source-to-system requirement traceability (first extraction)

References are names/sections as present in the seven attached documents; no unverified clause numbering is invented.

| Source → section | Business requirement | System rule / control | Menu | Entity → API/workflow | Test / implementation |
|---|---|---|---|---|---|
| SK 134/SK/DIR/XII/2022 → decision and superseded circulars | Bank BG activities require approved governing policy | Policy source/version/authority, no silent conflict resolution | Governance | policies → proposed/approved/dry-run | Policy dry-run P1; current legal review **pending** |
| Pedoman BG 2023 → definitions of BG, KBG, cash collateral, SP2KBG, subrogation | Distinct obligations and coverage, valid SP2, return/recovery | Separate identities/validity, no double capacity | Partner, Collateral, Claims | applications / partners / limit reservations / claims | KBG and limit P1; recovery **pending** |
| Lembar Kontrol dan Persetujuan → document preparation/review/approval | Maker/checker and traceable policy authorization | No self-approval and versioned acceptance | Admin, Approver | policies, approvals, audit → policy approval | Existing maker/checker; institutional matrix **pending** |
| Lampiran 2 → Permohonan Kontra Bank Garansi | Principal, Penjamin, proyek, Obligee, nilai/jangka waktu | KBG request must link verified project and SP2 | Application, Partner | applications, sp2, documents → `sp2_issue`, `review_counter` | Baseline SP2 plus P1 review |
| Lampiran 3 → Checklist Dokumen | Documentary eligibility and stage readiness | Latest version verification; uploader cannot independently verify | Documents | documents → upload/verify/checklist | Existing plus latest-document fix P1 |
| Lampiran 4 → LKN-BG | Visit party, branch/RM, location, meeting and evidence | Source metadata, supervisor review and accountable verification | Customer Visit | target `visits`, LKN API not yet implemented | **NOT IMPLEMENTED** |
| Lampiran 5 → Formulir Standar Analisa | Character, Condition, Capacity, Capital, Collateral and layak/tidak layak | Five C completeness, evidence and independent review | Underwriting | `underwritings` → `record_5c`, `review_5c` | P1 tests; official MAP-BG template **pending** |

## Policy Conflict Register — decisions required

| ID | Conflict / open decision | Owner | Blocking impact |
|---|---|---|---|
| PC-01 | 2022–2023 internal policy vs applicable 2026 OJK/BI/DSN-MUI/DPS and institution policy | Legal / Compliance / DPS | Cannot mark policies institutionally active |
| PC-02 | Sandbox `BR-01..BR-20`, fee rates, 365-day tenor, 30-day claim window, committee thresholds | Bank Risk / Product / Finance | Cannot use parameter values for real BG |
| PC-03 | Partner bootstrap `pks` and `CAC/CBC` eligibility vs executed PKS/permit | Penjamin / Legal / Bank | No live KBG acceptance |
| PC-04 | Sandbox `settle()` and `signature()` marked MOCK | Ops / Finance / Legal / IT | No legitimate settlement, signature or issuance |
| PC-05 | Free-plan persistent document/storage and backup/restore obligations | IT / Security / Data Protection | No production readiness claim |
| PC-06 | 5C score/recommendation methodology and cutoff / source of financial statements | Risk / Committee | Advisory 5C only |
| PC-07 | Cash/fixed asset valuation, legal binding, cash block and collateral release | Risk / Legal / Operations | No live collateral-backed issuance |
| PC-08 | Claims, recovery, litigation and subrogation closure rules | Claims / Legal / Finance | No complete liability closure |

## Backlog and dependencies

1. **P0:** migration/version inventory, legal policy conflict sign-off, canonical organization authorization, policy activation guard and mandatory 5C flag; dynamic documentary and LKN verification; official counter/PKS; atomic limit/collateral reservation; bank/KBG approval gates; source-based pricing and document templates.
2. **P1:** executed amendment/endorsement with previous warkat preserved; maturity alarms and claim-window monitoring; counter endorsement; release/limit reinstatement; dedicated counter-claim and recovery/subrogation ledger; reporting/reconciliation.
3. **P2:** approved OIDC/MFA, tenant segmentation and retention infrastructure; production SLIK/OSS/core/partner/PSrE adapters; bank-approved operational runbook and DR/recovery; regulatory report certification and real-user UAT.

## Release gate

**RELEASE BLOCKED for operational production** until critical CI/security/UAT, regulated policy and partner approvals, independently tested backup/restore, live adapter governance, institution sign-off and release evidence exist. A successful build or Worker deployment to sandbox is not acceptance for live BG. This PR is a **draft** and must not be merged automatically.
