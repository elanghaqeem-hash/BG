# Lampiran 5 — Standard Analysis digital schema and regulatory boundary

**Project:** BG Ecosystem · **Scope:** Cloudflare Free / native Durable Object SANDBOX · **Document baseline:** `Lampiran 5 - Formulir Standar Analisa (Bank Garansi - Kontra Bank Garansi) (edit.docx`, supplied by project.

## Source field-to-data traceability

| Source heading / printed option | Implementation | Notes |
|---|---|---|
| Data Principal; Checklist Dokumen Lengkap Ya/Tidak | canonical Principal from application; `checklist_complete` | RM can save Tidak; checker cannot approve until Ya; checkbox is RM declaration, not automated completeness proof |
| Pemilik Proyek: Pemerintah Pusat/Daerah/Swasta/lainnya | `project.owner` and `owner_other` | None silently remapped into categories |
| Jenis Proyek: Konstruksi/Pengadaan Barang/lainnya | `project.type`, `type_other` | Explicit alternate |
| Nilai Proyek/Pekerjaan; Sumber Pembiayaan: APBN/APBD or other | `project.value`; `project.funding`, `funding_other` | Amount kept in canonical IDR decimal |
| Nomor dan tanggal dokumen pokok penerbitan | `contract_reference`, `contract_date`, verified latest CONTRACT document | Evidence source/hash locked; date cannot be future |
| Jangka Waktu Penyelesaian | `completion_months` | In months; unit selection is an **implementation decision**, not stated in source |
| Nilai Pengujian Bank Garansi | `guarantee_amount` | Must equal requested BG nominal, as a consistency control; printed name preserved |
| Data Jaminan: Cash/Tunai, Kontra BG, lainnya | `guarantee_type`, `guarantee_other` | KBG/Cash are **descriptive** here; no live funds or legal cover created |
| Character: Principal Baru/Eksis; Pengalaman Usaha less/greater 3 Tahun; Pengurus; Hasil BI Checking | `character.principal`; `business_years`; `management`; `slik_comment` plus latest verified SLIK | Exact 3-year threshold **not defined** by printed choices; retain raw number and require human evaluation |
| Condition: Proyek selesai less/greater 5; Nilai proyek 1 tahun terakhir less/greater Rp5 miliar | `condition.projects_completed`, `last_year_project_value` | Exact 5 and Rp5bn **not defined** by printed choices; no automatic rejection/approval |
| Capacity: Kondisi Usaha; Laba 2 tahun Terakhir | `condition.business_condition`, `capacity.profit_history` | Form title states 2 years while printed table has 3 rows. System accepts 2–3 entries, never makes up a missing year. Negative profit supported |
| Capital: DER; NWC; Dukungan Bank Ada/Tidak | `capital.der_source`, `nwc_source`, `bank_support`, `bank_support_details` | DER & NWC calculated using structured 5C financials; prevents duplicate, inconsistent manual ratios |
| Collateral: Jenis Cash/Kontra BG/Lainnya; Nilai Agunan Tambahan | `collateral.type`, `additional_value` | This document is not the binding/valuation record; Collateral Management remains distinct |
| USULAN Layak/Tidak Layak; Relationship Manager | `recommendation`, `reason`, authenticated `maker` actor | Does not constitute final financing decision |

### Additional data intentionally introduced beyond the source

- `projects_last_year`: optional system-proposed analytics field for portfolio history (currently required in the digital form pending bank approval); **not a distinct printed choice** in Lampiran 5.
- `completion_months`: numeric-month convention chosen for the pilot; the source only says `Jangka Waktu Penyelesaian`.
- `project.amount_exceeds_project`: non-decisional warning only; no policy threshold inferred from the form.
- LKN linking, revision digest, verified document evidence, audit, maker/checker: technical governance enhancements, not verbatim form fields.

## Workflow and API

1. RM/AO records structured analysis after SP2KBG (`record_standard_analysis`) with verified latest CONTRACT, LAPORAN_KEUANGAN and SLIK.
2. Reviewer MPO/COMPLIANCE (`review_standard_analysis`) independently checks and approves/returns. A non-complete declared checklist cannot be approved.
3. A reviewed form is referenced from each new 5C revision by `standard_analysis_id` and digest. The 5C review and underwriting action verify that *the latest form revision is still accepted* and the document evidence has not been superseded.
4. Once structured form data exists, 5C cannot advance until the form and any recorded LKN have independent valid reviews; **legacy sandbox transactions without standard forms remain compatible**, pending institution-approved mandatory policy.
5. `GET /api/applications/:id/standard-analysis` is bank-role and office scoped, exposing current revision and history, not public or Principal-accessible.

Routes inherit existing CSRF, version conflict check, idempotency, audit/outbox, encryption, bank sandbox policy, additive SQLite table `standard_analyses` (with `application_id` index).

## Safety & legal limits

- No invented credit score, rating cutoff, approved collateral haircut, financial risk acceptance, payment or signature.
- Form source is a historic institutional baseline, not proven to be current at an operating bank.
- DER/NWC from 5C are arithmetically reported, with no policy thresholds approved.
- Additional validation required: audited profitability years, firm/project unit semantics, independent committee authority, DPS/regulatory review, role-specific source evidence, real-user UAT, backup and restore of SQLite-backed Durable Object, and mobile testing.

### Automated UAT extension

STD-101 source-linked RM record and independent reviewer; STD-102 reviewed form required for new 5C; STD-103 signed negative profit handling; STD-104 exact 3/5/5bn boundary warning; STD-105 malformed negative experience; STD-106 cross-application source evidence rejected; STD-107 Principal cannot access internal report; STD-108 checker cannot approve incomplete checklist; STD-109 revised standard form invalidates previously approved 5C; STD-110 new financial/contract evidence invalidates reviewed form.

**Release gate: BLOCKED for operational production. This is SANDBOX-only.**
