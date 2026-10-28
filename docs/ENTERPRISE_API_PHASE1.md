# Phase 1 enterprise API, permissions and UAT runbook

**Environment:** existing Cloudflare Worker/SQLite Durable Object SANDBOX, `/api` prefix. All requests require an authenticated `bg_session` cookie; all POSTs require `X-CSRF-Token`. Commands use the existing envelope:

```json
{
  "expected_version": 12,
  "idempotency_key": "e9837f5d-50d5-4e91-97fa-3f22a6c7d333",
  "payload": {}
}
```

Replace `:applicationId` with the selected application ID. Version and idempotency checks remain inside the same transaction as the domain changes, audit, journal, and persistence. All values here are *format illustrations*, not bank-approved thresholds or payment evidence.

## Endpoints and maker/checker

| Request | Caller | Preconditions and effect |
|---|---|---|
| `POST /api/policies/:policyId/simulate` | Analyst/Compliance/Admin/Config Checker/Audit | `{facts: {slik_current: false}, codes:["BR-05"]}`; read-only rule evaluation, auditable `simulation_only=true` |
| `POST /api/applications/:id/commands/record_5c` | Analyst | SP2KBG_ISSUED; records complete Character/Capacity/Capital/Collateral/Condition, verified latest financial evidence and human recommendation |
| `POST /api/applications/:id/commands/review_5c` | MPO/Compliance | Independent checker; `{accepted:true,reason:"..."}`; freezes reviewed analysis fingerprint |
| `POST /api/applications/:id/commands/review_counter` | Compliance | SP2 effective, registered partner active, verified PKS doc, matching PKS reference, scheme CAC/CBC |
| `POST /api/applications/:id/commands/register_collateral` | Analyst/MPO | Verified latest COLLATERAL evidence; type CASH/FIXED_ASSET/COUNTER_BG, value and binding reference; PENDING_VERIFICATION |
| `POST /api/applications/:id/commands/approve_collateral` | Compliance/Legal | Distinct checker, material fingerprint unchanged; approved/rejected |
| `POST /api/applications/:id/commands/reserve_limit` | MPO/MPO_KPO | Pre-issuance; atomically checks other outstanding BG and reserved applications |
| `POST /api/applications/:id/commands/request_servicing` | Principal/MPO/Support | ACTIVE; kind AMENDMENT/EXTENSION, verified AMENDMENT_REQUEST, proposed fields and reason; new PENDING_REVIEW event, no warkat change |
| `POST /api/applications/:id/commands/request_bg_closure` | MPO/Support | ACTIVE; latest RELEASE evidence, claim window elapsed, no outstanding claims or servicing |
| `POST /api/applications/:id/commands/confirm_bg_closure` | Legal/Compliance | Independent checker; evidence/revision/claim rechecked, BG CLOSED, remaining reserved capacity released and offsetting sandbox journal |
| `GET /api/applications/:id/enterprise` | Scoped bank enterprise roles | 5C, review, collateral, reservation, servicing, closure. No unrestricted principal/partner exposure. |

## Structured 5C payload

```json
{
  "financial_document": "VERIFIED-LAPORAN-KEUANGAN-DOCUMENT-ID",
  "five_c": {
    "character": {"risk":"LOW","finding":"Fakta pemeriksaan karakter","mitigation":"Pemantauan informasi nasabah"},
    "capacity": {"risk":"MODERATE","finding":"Fakta kapasitas proyek","mitigation":"Monitoring milestone proyek"},
    "capital": {"risk":"LOW","finding":"Fakta posisi permodalan","mitigation":"Verifikasi laporan keuangan"},
    "collateral": {"risk":"LOW","finding":"Fakta agunan dan pengikatan","mitigation":"Revalidasi agunan dan limit"},
    "condition": {"risk":"MODERATE","finding":"Fakta kondisi proyek","mitigation":"Pantau perubahan risiko sektor"}
  },
  "financials": {
    "current_assets":"2000000000",
    "current_liabilities":"1000000000",
    "total_debt":"500000000",
    "equity":"1500000000"
  },
  "recommendation":"LAYAK",
  "narrative":"Narasi analis berdasarkan bukti terverifikasi"
}
```

The returned ratios are explanatory arithmetic only; **not** a bank-sanctioned scoring model. Financial metrics are non-negative precise decimal amounts. Net working capital can be negative and is retained as signed text. Numeric thresholds, 5C weights and MAP-BG formats require Risk/Policy endorsement.

## Minimum UAT and negative cases

| ID | Scenario | Expected |
|---|---|---|
| BG-P1-POL-001 | Simulate BR-03/BR-05 and read audit | PASS/FAIL details and policy version; no approval created |
| BG-P1-UND-001 | Upload financial evidence, complete 5C, reviewer accepts | 5C persisted, `bank_underwrite` allowed |
| BG-P1-UND-002 | Bank underwrite before independent 5C review | DENIED when 5C record is present |
| BG-P1-KBG-001 | CAC/CBC with verified PKS reference and current SP2 | Sandbox verification event; status NOT live certificate |
| BG-P1-KBG-002 | PKS reference mismatch or expired SP2 | DENIED |
| BG-P1-COL-001 | Register agunan and approve by separate checker | PENDING_VERIFICATION → VERIFIED |
| BG-P1-COL-002 | Use NIB instead of COLLATERAL evidence | DENIED |
| BG-P1-LIM-001 | Reserve limit and attempt second issue beyond available exposure | DENIED without double consumption |
| BG-P1-DOC-001 | Replace verified NIB with pending revision, attempt submit | DENIED; checklist PENDING |
| BG-P1-SRV-001 | Amendment/extension request on ACTIVE BG | Servicing PENDING_REVIEW; original BG number intact |
| BG-P1-CLS-001 | Close before claim deadline or with open claim | DENIED |
| BG-P1-CLS-002 | Close after deadline with checker different from maker | CLOSED; audit and reversible off-balance sandbox posting |
| BG-P1-SEC-001 | Principal/partner/broker attempts cross-organization enterprise read | DENIED |
| BG-P1-RES-001 | Restart Durable Object after command, verify persistence | Pending workerd restart/UAT evidence |
| BG-P1-DR-001 | Backup → restore → reconciliation and audit-chain verification | Pending institution-approved DR rehearsal |

UAT must capture actual outcome/evidence, not infer PASS merely from these written cases. Browser UI and API are wired; mobile physical-device UAT and true institutional integration remain outside this sandbox gate.

## Cloudflare Free constraints

Keep the current SQLite-backed Durable Object class and Worker/Next.js deployment. No additional paid database, server or queue is introduced. Cloudflare's October 2026 documentation confirms Free supports SQLite-backed DOs with finite daily row operations and storage quotas; operations beyond Free limits can fail. Monitor requests, rows, storage, alarms and chunked documents. See [official Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [storage API](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/). Do not add OCR/large documents or unbounded reports into the request critical path.

## Operational boundaries

- LIVE financial adapters, official PSrE signatures, blocked funds, KBG certificate validity and regulated reporting are **not** activated by these commands.
- Post-issuance amendment approval, SP2 endorsement and new warkat are **not yet implemented**; servicing requests must stay open.
- Signed original instruments, claims and financial receivables must not be deleted or overwritten.
- Do not merge draft PR #6 or deploy to bank production until independent CI, legal/risk/DPS/partner decisions, DR, real-user UAT and formal release approval are documented.
