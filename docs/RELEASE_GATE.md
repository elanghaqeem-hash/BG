# Batas rilis MVP dan gate produksi

Status distribusi: DEVELOPMENT MVP. Bukan persetujuan produk bank, penerbitan BG hukum, sertifikasi syariah atau pernyataan kepatuhan regulator.

| Gate | Status distribusi | Bukti atau pekerjaan tersisa |
|---|---|---|
| BR-01–20 versi sandbox | Implemented pada konfigurasi dan domain guard | Uji predicate dan semantic/API journeys; BR-01 pemasaran adalah kebijakan manusia yang belum dapat dibuktikan hanya dari aplikasi |
| T1–T11 | Tested pada sandbox | Lihat JUnit dan TEST_REPORT; bukan UAT identitas bank/provider nyata |
| API dan UI lima aktor | Implemented MVP | OpenAPI 3.1, build, browser desktop/mobile viewport |
| Timer durable | Tested pada Temporal test server | Restart worker dengan timer tetap tersimpan; bukan uji HA cluster produksi |
| Data store PostgreSQL | Schema dan konfigurasi tersedia | Belum diuji Docker/PostgreSQL pada lingkungan penyusunan ini |
| Model enterprise 57 tabel | Reference design | Store MVP aktif 21 aggregate; normalisasi detail PKS/SP2KBG/MKP/akad/finance masih perlu migrasi incremental |
| SE dan PKS nyata | BLOCKED | Dokumen asli, versi berlaku, sumber pasal dan keputusan bank/penjamin |
| Tarif dan DPS | BLOCKED | Tarif/akad, persetujuan DPS, disclosure/komisi, basis/pajak split |
| IAM OIDC/MFA dan SoD organisasi | BLOCKED | Integrasi identity provider, identitas resmi dan UAT semua role/office |
| RBAC/ABAC PostgreSQL defense in depth | BLOCKED | RLS/force policies, non-owner runtime role dan negative DB tests; scope service-level sudah ada |
| Adapter live dan settlement | BLOCKED | Core, SLIK resmi, OSS/AHU/eKYC, penjamin, PSrE/eMeterai dan receipt/inquiry nyata |
| Dokumen enterprise | BLOCKED | Object storage/KMS/CDR/PSrE, retention/legal hold, template warkat hukum dan original custody |
| Audit trusted anchor | BLOCKED | Signed anchor eksternal/Object Lock dan verifikasi independen; chain lokal bukan immutable archive lengkap |
| Accounting regulator | BLOCKED | Mapping akun yang disahkan, amortisasi, CKPN, pajak dan rekonsiliasi core |
| Limit enterprise | PARTIAL | Final issue limit atomik diuji; reservasi penjamin/Principal lintas agreement/grup, endorsement dan release kapasitas penuh belum dibuat |
| Lifecycle setelah aktif | PARTIAL | Klaim/litigasi MVP tersedia; amendment, extension, cancel/release dan recovery/subrogasi penuh belum diimplementasikan |
| Pelaporan OJK/SLIK | BLOCKED | Mapping/dictionary/format dan UAT pelaporan yang berlaku; tidak ada ekspor yang diklaim regulator-ready |
| Notifikasi eksternal | MOCK | In-app task/escalation dan outbox; email/WA delivery nyata belum diuji |
| HA DR RPO RTO | BLOCKED | Restore rehearsal PostgreSQL/Temporal/object/key, failover dan bukti pengukuran |
| Android native dan operasional | PENDING USER UAT | Viewport browser diuji; keyboard nyata, akun asli dan prosedur bank perlu percobaan langsung |

## Pembukaan produksi

Distribusi ini menolak `APP_ENV=production` agar fixture dan adapter MOCK tidak dapat digunakan untuk penerbitan nyata. Jangan mengubah string environment menjadi development untuk melewati gate. Pembukaan produk operasional memerlukan implementasi kemampuan yang masih diblokir dan bukti penerimaan pihak bank/penjamin, bukan sekadar mengubah konfigurasi.

Semua nilai default pada config/policy.sandbox.json adalah asumsi uji. Data penjamin/broker fiktif tidak menyatakan perizinan OJK. Verifikasi QR menampilkan SANDBOX dan hanya mengacu registry uji.

## Acuan teknis dan regulasi

Dasar regulasi dan ketentuan internal ada pada DESIGN_APPROVED.md; pengecekan lanjutan tetap diperlukan saat implementasi live. Dokumentasi teknis yang digunakan: FastAPI testing lifespan dan OpenAPI, Next.js App Router, SQLAlchemy transaksi, serta Temporal Python workflows/activities. Tidak ada endpoint penyedia resmi yang ditebak atau credential eksternal yang disisipkan dalam kode.

- https://fastapi.tiangolo.com/advanced/testing-events/
- https://fastapi.tiangolo.com/how-to/extending-openapi/
- https://nextjs.org/docs/app/getting-started/installation
- https://docs.sqlalchemy.org/en/20/orm/session_api.html
- https://docs.temporal.io/develop/python
