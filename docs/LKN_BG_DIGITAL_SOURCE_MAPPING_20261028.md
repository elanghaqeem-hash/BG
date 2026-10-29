# Source-mapped LKN-BG digital workflow — 28 October 2026

**Scope:** conditional digital report under the existing Cloudflare Free / native SQLite Durable Object SANDBOX, branch `feat/enterprise-controls-phase1-20261028`. No changes to live issuance, banking integrations or customer funds.

## Exact source

**Primary document:** `Lampiran 4 - Laporan Kunjungan Nasabah - Bank Garansi (LKN-BG) (edit Yane) (1).docx`, uploaded project source.

The form contains the following distinct groups; preserved in the digital schema:

| Lampiran 4 group | Digital field or control | Notes |
|---|---|---|
| Nama Nasabah, Jenis Nasabah | Customer name from canonical principal; `customer_type` RM entry | Name is derived, not typed twice |
| Cabang, Jenis Permohonan | `rm_office` from actor identity; `request_type` | Branch acts as record scope |
| Nama RM, Referral | `rm` from authenticated actor; `referral` | No arbitrary maker ID |
| Lokasi Tujuan | `visited_at` and location | Location structured below |
| Pihak yang Ditemui (key person), Telepon | `location.key_person`, `location.phone` | Personal information bank-only |
| Jarak dari kantor PDSB | `location.distance_km` | Captured, **not** GPS verified |
| Jln, Kelurahan, Kota | `location.street`, `village`, `city` | Validated |
| Fasilitas umum dalam radius kurang 1 km (3 slots) | `facilities_within_1km` max 3 | RM-observed; not geolocated |
| Kondisi Lingkungan | `environment` enum | PERUMAHAN_REAL_ESTATE, PERKANTORAN, PERKAMPUNGAN_UMUM, KOMERSIAL_BISNIS |
| Catatan | `notes` | Required narrative |
| Foto: tampak muka, dalam, lingkungan, inventory, mesin, nasabah+RM | `photo_categories` and latest verified `LKN_PHOTOS` PDF | Allows applicable categories; no hidden fake image validation |
| Pernyataan data disajikan sebenarnya | `attested=true`, `attested_at`, authenticated RM | Human attestation, not biometric e-signature |
| Diketahui Branch Manager / Dibuat Relationship Manager | `review_visit` with MPO sandbox reviewer, checked uploaded LKN | Role mapping **requires institutional confirmation**; role approval is not a legally binding e-signature |

**Secondary source:** `Lampiran 5 - Formulir Standar Analisa (Bank Garansi - Kontra Bank Garansi) (edit.docx`, original headings Character, Condition, Capacity, Capital, Collateral. The app links LKN to the structured 5C revision by `visit_id` and `review_digest`. Profit two-year series, project experience/history and project type in Lampiran 5 are **not yet fully structured**; they remain enhancement gaps, not silently inferred or invented.

**Conditionality:** Source `Lampiran 3 Formulir Checklist Dokumen` and existing `cloudflare/document-checklist.ts` treat LKN as conditional (when a physical visit occurs); alternative verification requires institutionally approved proof. This implementation never forces a visit for all applications. Once a visit has been recorded, the latest version must pass independent review before underwriting may continue.

## Data model / controlled commands

- `visits`: additive JSON aggregate with `application_id` index, version/revision history; no destructive migration.
- `POST /api/applications/:id/commands/record_visit`: AO/Relationship Manager, branch-scoped, verified latest LKN_PHOTOS PDF, visit time not future, validated fields and attestation.
- `POST /api/applications/:id/commands/review_visit`: MPO role as sandbox Branch Manager proxy, independent of RM, checked latest `LKN` evidence, reasoned APPROVE/RETURN.
- `GET /api/applications/:id/visit`: bank-only; latest full report, compact revision history, `conditional:true`, `legal_signature_verified:false`.
- Existing `record_5c` records latest reviewed visit link; `review_5c` rejects changed or unreviewed visit; `bank_underwrite` rejects a pending/invalid latest visit and stale linked 5C.
- Evidence follows existing AES-256-GCM encrypted chunks, SHA-256, verify-by-other-role, latest-document revision and audit chain. This implementation does not interpret a document as a trustable real photograph without human checks.
- Counterparties and the public QR route cannot access visit details. Role-based bank access includes branch restrictions for AO/MPO/Analyst.

## UAT / negative scenarios

| ID | Scenario | Expected |
|---|---|---|
| LKN-101 | Principal creates LKN on behalf of AO | Forbidden |
| LKN-102 | AO attempts save without truthfulness attestation | Denied |
| LKN-103 | RM submits complete location/site notes/photo classes | PENDING_BM_REVIEW |
| LKN-104 | RM submits second LKN while previous pending | Denied |
| LKN-105 | RM self-reviews LKN | Forbidden |
| LKN-106 | BM review references unverified LKN PDF | Denied |
| LKN-107 | MPO reviews verified LKN, different authenticated actor | REVIEWED |
| LKN-108 | Bank analyst records 5C | Binds `visit_id` and `review_digest` |
| LKN-109 | New photo version supersedes reviewed bundle | Underwriting fails closed |
| LKN-110 | Revision of LKN after 5C review | Re-record and re-review 5C required |
| LKN-111 | Photo evidence from another application is reused | Denied |
| LKN-112 | Invalid environment or negative site distance | Denied |
| LKN-113 | Plain-text evidence uploaded as LKN_PHOTOS | Denied; PDF wrapper required |
| LKN-114 | Principal attempts GET internal visit report | Forbidden |
| LKN-115 | Audit hash chain after RM/BM review | Must verify |

## Outstanding governance / release blockers

- Obtain official **current** institution LKN and risk policy, visit alternative verification criteria, BM role delegation and signature validity policy.
- Decide whether the six photographs are all mandatory by project/business type, acceptable redaction/retention/consent for RM-nasabah photos, geolocation evidence requirements and source of truth for addresses.
- No mobile GPS, face matching, image analysis, direct photo upload or digital signature integration is implemented. Current evidence accepts max 2 MB PDF containers, without validating every embedded photograph.
- Complete Lampiran 5 transaction/project financial profile and profit-history fields with bank-approved objective risk methodology.
- Independent legal/compliance/DPS signoffs, backup/restore, controlled UAT with actual bank personnel; production stays BLOCKED.
