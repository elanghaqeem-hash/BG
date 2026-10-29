# BG — transisi portal Next.js ke Vercel (SANDBOX)

Dokumen ini mencakup **tahap pertama migrasi**, bukan pemindahan penuh backend atau persetujuan operasional perbankan.

## Arsitektur yang benar

- **Vercel**: frontend Next.js pada folder `frontend/`, beserta Route Handlers `/api/*` sebagai **proxy server-side**.
- **Cloudflare Worker `bg`**: API sandbox pada `/api/*` dan satu Durable Object `BankBackend` dengan SQLite persisten; data, dokumen terenkripsi, sesi, audit, ledger, dan alarm tetap berada di sini.
- **Browser**: hanya mengakses domain Vercel untuk halaman dan `/api/*`. Cookie `bg_session` diterbitkan melalui proxy pada domain Vercel; browser tidak perlu memanggil Cloudflare secara lintas-origin.
- **Tidak ada perubahan data**: jangan mengganti namespace Durable Object, `BG_INITIAL_USERS`, atau `BG_ENCRYPTION_KEY`. Jangan memigrasikan menggunakan reset/bootstrap ulang. Mode tetap `SANDBOX`.

Vercel Functions bukan pengganti Durable Objects: kode `cloudflare/bank-backend.ts` menggunakan `cloudflare:workers`, `ctx.storage.sql`, transaksi persisten, dan alarm. Langsung mengimpor backend tersebut ke Vercel menyebabkan inkompatibilitas dan risiko integritas.

## Konfigurasi pada layar New Project

| Item | Nilai |
| --- | --- |
| GitHub | `elanghaqeem-hash/BG` |
| Branch produksi | `main` |
| Project | `bg` |
| Root Directory | `frontend` (bukan `./`) |
| Framework Preset | `Next.js` (bukan `Services`) |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Default Next.js — biarkan kosong |
| Node.js | `22.x` |

`frontend/vercel.json` mengunci framework dan perintah build, namun **Root Directory tetap harus diatur dalam project Vercel**. Jangan memakai `npm run build` dari root repository, karena script root menjalankan OpenNext untuk Cloudflare.

## Batas paket Vercel Hobby

Pada layar import terlihat plan **Hobby**. Berdasarkan ketentuan Vercel, Hobby hanya diperbolehkan untuk pemakaian **pribadi/non-komersial**. Lingkungan demo/pengembangan pribadi dapat dievaluasi pada Hobby sesuai ketentuannya, tetapi sistem BG yang dipakai secara komersial atau untuk layanan bank memerlukan plan yang sesuai (Pro/Enterprise) dan pengkajian kepatuhan institusi. **Jangan meningkatkan paket atau memulai biaya tanpa persetujuan pemilik akun.**

## Environment Variables Vercel

Tambahkan pada Project → Settings → Environment Variables untuk **Production** dan **Preview**:

```text
BG_API_INTERNAL_URL=https://bg.elang-haqeem.workers.dev/api
```

Endpoint ini merupakan URL publik backend Cloudflare yang terkonfigurasi; validasi konektivitas masih wajib. Variabel tersebut hanya digunakan server-side, bukan `NEXT_PUBLIC_*`. Jangan memasukkan kredensial bank, kunci enkripsi, token pengguna, atau password ke Git ataupun environment frontend. Secrets native backend **tetap** berada di Cloudflare.

Proxy hanya menerima URL upstream HTTPS, menolak URL yang mengandung kredensial dan redirect, tidak menyebarkan header Authorization, mempertahankan cookie HttpOnly/CSRF, membatasi body permintaan, dan menolak POST cross-site. Backend tetap melakukan otorisasi, pemeriksaan CSRF dan rate limit. Selama hybrid, nilai `CF-Connecting-IP` di backend dapat menjadi alamat egress Vercel, sehingga batas login per IP perlu diuji dengan trafik serentak.

## Tahapan cutover

1. Pertahankan deployment `bg` Cloudflare dan rahasia enkripsi. Catat deployment versi dan lakukan backup/restore rehearsal data Durable Object melalui mekanisme yang tervalidasi.
2. Buat/import proyek Vercel dengan Root Directory `frontend`, framework Next.js, Node 22.x, lalu atur `BG_API_INTERNAL_URL`.
3. Deploy Preview, lalu verifikasi `GET /api/health/deployment` mengembalikan `backend_connectivity: ok` dan `backend: durable-object-sqlite`. Kode 503 berarti **jangan cutover**.
4. Pastikan `GET /api/auth/me` tanpa sesi menghasilkan 401, login menggunakan akun sandbox resmi berhasil, penggantian password dan logout mempertahankan status/cookie; jalankan maker-checker, transaksi sandbox, pengunggahan dan unduh dokumen terenkripsi, QR verifikasi, serta audit.
5. Pastikan URL sertifikat/QR yang dihasilkan backend membuka **domain publik yang dipilih**; QR backend saat ini mengikuti origin Cloudflare sehingga mungkin perlu pengaturan URL publik saat cutover.
6. Uji error handling, akses non-otorisasi, perubahan versi simultan, idempotensi, limit upload, response time, rate limit, dan integritas data. Hanya setelah preview lolos, arahkan domain publik frontend ke Vercel.
7. Periksa monitoring, rollback domain dan Vercel deployment; **jangan menonaktifkan Cloudflare Worker/DO** selama backend masih bergantung pada keduanya.

Jika Vercel menampilkan `503 BACKEND_NOT_CONFIGURED`, berarti environment `BG_API_INTERNAL_URL` belum tersedia. Jika `503 UPSTREAM`, verifikasi akses ke backend Cloudflare dan worker deployment. Jika Vercel gagal build, pastikan Root Directory `frontend`, bukan root dan bukan preset Services.

## Migrasi penuh *off Cloudflare* (fase terpisah)

Memindahkan backend sepenuhnya memerlukan **database persisten dan storage dokumen alternatif** serta porting semantik transaksi ke PostgreSQL / managed SQL (misalnya pilihan database yang kompatibel dengan Vercel), pengganti Durable Object alarm, distribusi kunci enkripsi, dan migrasi snapshot dari SQL DO ke skema baru. Lakukan dengan export terenkripsi dan checksum, verifikasi foreign key/jurnal/audit/dokumen, dual-read/consistency review, test concurrency dan rollback; tanpa melakukan cutover data secara diam-diam.

**Gate**: belum boleh disebut `production-ready` untuk penerbitan BG riil. Mode tetap `SANDBOX` hingga seluruh integrasi dan persetujuan regulasi/operasional tersedia.
