# BG Ecosystem Platform MVP

Paket development untuk Bank Garansi syariah yang menghubungkan Principal, Bank, Penjamin, Obligee dan Broker. Implementasi menggunakan FastAPI, Next.js, SQLAlchemy, PostgreSQL melalui Compose, SQLite untuk pengujian lokal, dan Temporal untuk sweep SLA durable. Semua integrasi transaksi pada distribusi ini bertanda MOCK/SANDBOX.

## Cloudflare Free — portal dan backend native

Deployment Cloudflare memakai Next.js/OpenNext dan backend TypeScript dengan
penyimpanan SQLite persisten melalui Durable Objects. Tidak membutuhkan container
Python, VPS, atau `BG_API_INTERNAL_URL`. Login/logout, menu Pengguna (Admin),
penggantian password, dokumen terenkripsi dan alur transaksi sandbox tersimpan
pada backend native. Kode Python tetap tersedia sebagai implementasi referensi.

Gunakan `npm ci`, `npm test`, `npm run cf-typegen`, `npm run typecheck:worker`,
dan `npm run check:deploy` untuk memvalidasi build. Workers Builds memakai root
`/`, build command kosong dan deploy command `npx wrangler deploy`.

Secret identitas awal dan kunci enkripsi harus dipasang secara privat. Panduan:
[Cloudflare deployment](docs/CLOUDFLARE_DEPLOYMENT.md),
[verifikasi backend native](docs/NATIVE_BACKEND_VERIFICATION_20261028.md).

## Vercel — portal Next.js (migrasi tahap pertama)

Repository juga menyediakan `frontend/vercel.json` agar frontend dapat dibangun secara native pada Vercel. Untuk import GitHub gunakan **Root Directory `frontend`**, Framework Preset **Next.js**, Node.js **22.x**, dan variabel server-only `BG_API_INTERNAL_URL` menuju endpoint `https://bg.elang-haqeem.workers.dev/api`.

Tahap ini **hanya memindahkan portal dan proxy HTTP**. Backend Cloudflare Durable Object, dokumen terenkripsi, database, alarm, dan rahasia tetap berada di Cloudflare. Periksa `GET /api/health/deployment` dan jalankan pengujian login, CSRF, dokumen serta workflow sebelum mengalihkan domain. Tidak ada persetujuan aktivasi transaksi BG riil.

Baca [Vercel migration runbook](docs/VERCEL_MIGRATION.md) sebelum deployment.

## Yang dapat dijalankan

- Login/logout identitas berbeda, sesi server-side, CSRF, scope organisasi/kantor, maker-checker dan revokasi kuasa broker.
- Pengajuan, unggah dokumen terenkripsi, verifikasi sumber oleh petugas berbeda, KYB, SLIK Kol 1 bulan berjalan, portal penjamin/SP2KBG, underwriting bank dan Komite GH/Direksi.
- Persetujuan scan format khusus dengan hash draft, outstanding dokumen asli, MKP, akad dua pihak dan receipt pembayaran simulasi.
- Antar kantor dengan surat Principal, MKP dan E-Memo; split 25% dengan cap Rp5 juta, timer H+1, settlement checker berbeda dan jurnal seimbang.
- Penerbitan dengan pemeriksaan ulang guard, nomor unik, dokumen BG sandbox, QR, sertifikat kontra, delivery dan status aktif.
- Klaim Obligee, laporan internal H+1, pembayaran bank simulasi, klaim kontra, penolakan/penundaan, pembukaan Litigasi atomik, serta penutupan maker-checker setelah bukti penyelesaian.
- Dashboard, daftar pengajuan, dokumen, portal lima aktor, daftar klaim, SLA/operasi, Litigasi, konfigurasi versioned dan pemeriksaan rantai audit.

## Batas implementasi yang harus dipahami

Ini MVP development, belum aplikasi operasional bank. `APP_ENV=production` sengaja menolak startup. Password sandbox bukan pengganti OIDC/MFA. Identitas/master pilot dibuat melalui bootstrap, belum onboarding mandiri untuk nasabah produksi.

Store aktif memakai **21 tabel aggregate** dengan evidence/workflow/PKS tersimpan sebagai snapshot JSON terversi. Rancangan normalisasi **57 tabel** disertakan sebagai referensi target dan **belum seluruhnya menjadi migrasi aktif**. Ini membatasi MVP ke alur yang diuji; jangan menjalankan file `target_57_tables_REFERENCE_ONLY.sql` pada database MVP. Tidak ada migrasi otomatis yang mengubah sistem existing.

Belum diaktifkan: adapter live core/SLIK/OSS/AHU/Dukcapil/PSrE/eMeterai/email/WA; PostgreSQL RLS dengan workload roles; S3/KMS/Object Lock dan signed anchor eksternal; malware/CDR produksi; amortisasi/CKPN model regulator; ekspor SLIK/OJK yang disahkan; amendment/perpanjangan/release/pembatalan, recovery/subrogasi penuh; dan bukti HA/DR/RPO/RTO. Rincian dan gate tersedia di `docs/RELEASE_GATE.md`.

## Mulai lokal tanpa Docker

Prasyarat: Python 3.12+, Node.js 22+, akses registry Python/npm. Perintah dari direktori paket:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python scripts/bootstrap.py
npm --prefix frontend ci
```

Bootstrap membuat `runtime/bg.db`, kunci enkripsi, dan password acak setiap identitas pada `runtime/sandbox-credentials.json`. File runtime tidak disertakan dalam paket dan tidak boleh dimasukkan ke repository. Jangan mengganti kunci setelah dokumen diunggah; dokumen lama tidak dapat didekripsi tanpa kunci yang sama.

Terminal pertama:

```bash
bash scripts/run_api.sh
```

Terminal kedua:

```bash
npm --prefix frontend run dev
```

Buka `http://localhost:3000`. API dan Swagger tersedia pada `http://127.0.0.1:8000/docs`; kontrak statis ada di `docs/openapi.json`. Verifikasi publik ada di `/verify` atau QR yang ditampilkan pada detail BG. Semua URL ini lokal, bukan deployment publik.

## Jalankan dengan PostgreSQL dan Temporal

Prasyarat tambahan Docker Engine dan Compose. Jalankan:

```bash
python scripts/configure_compose.py
docker compose build
docker compose up -d postgres temporal
docker compose run --rm api python scripts/bootstrap.py
docker compose up -d api web worker
```

Kredensial tersimpan dalam volume `runtime_data`, dapat dibaca lokal oleh operator melalui container API. Simpan aman; jangan kirim ke log bersama. Volume PostgreSQL dan Temporal persisten. Port API/web hanya di-bind pada loopback host. Temporal pada Compose memakai development server persisten, bukan konfigurasi HA produksi.

Compose dan pengujian PostgreSQL disediakan untuk lingkungan Docker yang mendukungnya, tetapi tidak diklaim telah diuji pada lingkungan penyusunan paket ini. RLS dan pemisahan owner/runtime DB harus dituntaskan sebelum setiap pembukaan akses nyata.

## Pengujian

```bash
python -m pytest backend/tests -q --junitxml=evidence/sqlite-junit.xml
npm --prefix frontend run build
npm --prefix frontend run typecheck
python scripts/export_contracts.py
```

Browser smoke menjalankan API dan frontend sendiri pada port 18500/18501. Pastikan frontend sudah dibangun dan bootstrap sudah dijalankan:

```bash
node frontend/node_modules/playwright/cli.js install chromium --only-shell
node scripts/browser_smoke.cjs
```

Pengujian Temporal mengunduh ephemeral test server saat pertama kali dijalankan:

```bash
python scripts/test_temporal.py
```

Untuk pengujian PostgreSQL, gunakan **database disposable baru**, bukan database pengguna. Fixture sengaja menghapus seluruh tabel pada URL pengujian:

```bash
BG_TEST_DATABASE_URL=postgresql+psycopg://user:password@localhost/bg_disposable_test python -m pytest backend/tests -q
```

Jangan menggunakan URL production/shared UAT pada `BG_TEST_DATABASE_URL`.

## Identitas dan urutan happy path

Password acak setiap akun ada pada file kredensial lokal. Identitas: `principal`, `ao`, `analyst`, `compliance`, `mpo`, `issuer`, `support`, `gh`, `direksi`, `finance`, `finance_checker`, `penjamin`, `obligee`, `obligee_private`, `broker`, `litigation`, `legal`, `audit`, `admin`, `config_checker`, `worker`.

1. Principal membuat draft; unggah NIB, CONTRACT dan KYB. Compliance memverifikasi sumber dokumen, lalu Principal submit.
2. Compliance menyelesaikan KYB, screening dan UBO. Analyst mengunggah SLIK; Compliance memverifikasi; Analyst mencatat hasil Kol 1 dan waktu tarik bulan berjalan.
3. Penjamin memulai underwriting, mengunggah SP2KBG; petugas bank memverifikasi; Penjamin mengisi nomor/unit/nilai/masa berlaku.
4. Analyst menyelesaikan underwriting bank. Bila format khusus, Penjamin mengunggah bukti TTD/stempel yang telah diverifikasi bank dan menyetujui exact hash draft.
5. MPO memberi otorisasi normal. Untuk swasta/JV: GH Bisnis hingga Rp3 miliar atau Direksi di atasnya, sesuai parameter.
6. MPO menandatangani MKP. Principal dan MPO menandatangani akad secara terpisah. Finance mengonfirmasi receipt pembayaran simulasi.
7. Bila antar kantor, unggah/verifikasi surat Principal dan kirim E-Memo. Penerbit KPO memakai akun `issuer`; kantor yang sama memakai `mpo`.
8. Penjamin mencatat sertifikat kontra yang diverifikasi bank. Bukti delivery diverifikasi, lalu MPO mengonfirmasi penyerahan. QR tersedia di detail BG.
9. Finance checker melakukan distribusi ujrah antar kantor sebelum due H+1. Sweep Temporal menandai overdue bila belum selesai.
10. Obligee mengunggah bukti klaim lalu mengajukan klaim. Bukti dapat diverifikasi bank sebelum approval. MPO melaporkan, menyetujui syarat warkat, Finance membayar, MPO mengirim klaim kontra dengan dokumen terverifikasi.
11. Penjamin memberi keputusan. REJECTED/DEFERRED langsung membuka Litigasi. Penutupan membutuhkan pembayaran kontra yang dikonfirmasi Finance atau pencabutan sah tanpa uang bank yang belum diselesaikan, bukti resolusi, Litigasi maker dan Legal checker.

Panduan teknis lanjutan ada di `docs/API_GUIDE.md`, `docs/UI_GUIDE.md`, `docs/RUNBOOK.md`, `docs/RELEASE_GATE.md` dan `docs/TEST_REPORT.md`.
