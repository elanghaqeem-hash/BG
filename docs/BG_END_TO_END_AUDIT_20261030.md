# Audit End-to-End BG Ecosystem — 30 Oktober 2026

**Scope:** repository `elanghaqeem-hash/BG`, Vercel Hobby portal, Cloudflare native Worker/Durable Object SQLite, CI GitHub, sumber pedoman internal dan Lampiran 2–5 yang tersedia pada proyek ini.

**Perbedaan status wajib:** `Vercel READY` berarti deployment web berhasil; **tidak** berarti live banking, integrasi regulator, penerbitan BG sah, atau UAT lima aktor pada backend deployed sudah selesai. Bank Garansi komersial tetap **RELEASE BLOCKED**.

## Audit baseline dan temuan

| Severity | Komponen | Temuan terkonfirmasi | Tindakan pada branch ini | Sisa gate |
|---|---|---|---|---|
| P0 | Data confidentiality | `Service.view` mengembalikan `workflow` penuh ke Principal; `Service.download` tidak memiliki allowlist dokumen untuk Principal; checklist mengandung ID dokumen SLIK/MKP | Hilangkan workflow internal, filter daftar dokumen, periksa scope saat download dan sembunyikan ID dokumen internal pada checklist Principal/Broker | Uji login multi-role deployed dan rebase PR #10 untuk menjaga pembatasan |
| P1 | SoD dan data administration | ADMIN dan CONFIG_CHECKER dapat melihat rincian workflow/dokumen pada `view`; CONFIG_CHECKER tidak diblokir dalam `download` | Hapus rincian transaksi dari peran administratif, larang unduhan untuk CONFIG_CHECKER | Audit RBAC seluruh endpoint lain |
| P1 | QR digital | Cloudflare `/api/public/qr/:token` menggunakan origin Worker sehingga tautan QR dapat mengarah ke domain lama | Tetapkan `BG_PUBLIC_VERIFY_ORIGIN` melalui Wrangler; helper validasi HTTPS origin dan token dengan tests | **Perlu deploy ulang Worker Cloudflare** dan uji QR token sintetis valid; commit Vercel saja tidak mengaktifkan perubahan Worker |
| P1 | Proxy login/public rate-limit | `CF-Connecting-IP` di backend dapat mewakili IP egress Vercel, bukan IP browser asli; 30 login/60 verifikasi per menit berpotensi membatasi banyak pengguna bersama | Pertahankan fail-closed limiter dan pembatasan per username; tidak pernah mempercayai `X-Forwarded-For` tanpa autentikasi | Desain identitas klien bertanda tangan/mTLS/Access dan load test; jangan naikkan limit secara buta |
| P1 | Real UAT | Pengujian proxy + native router memakai SQLite terisolasi; belum menguji lima login nyata melalui Vercel | Pertahankan pengujian integrasi, unit BG, CI SQLite/PostgreSQL dan smoke GET nonmutasi | UAT terpisah untuk Principal, Bank, Penjamin, Obligee, Broker dengan saksi bank, tanpa data riil |
| P1 | Privacy retention | Dokumen terenkripsi memiliki metadata retensi tetapi tidak membuktikan policy lifecycle/backup/restore legal hold production | Tidak menghapus data existing; tidak menjalankan migrasi destruktif | Vault hardening, backup encrypted, restore DR rehearsal, retention & audit akses |
| P2 | Operasional | Hosting Vercel Hobby + Cloudflare Free dan sandbox simulator bukan platform SLA/HA bank | Tidak mengaktifkan instrumen live, payout riil atau bypass MFA | Rencana kapasitas, IAM/MFA, KMS, SOD bank, interaksi regulator/DPS, dokumentasi DR |
| P2 | Parallel UI branch | PR #10 (draft) memperbaiki Principal intake/JPG/PNG/7 tahap, tetapi menyentuh `service.ts` dan `router.ts` yang sensitif | Tidak menggabungkan PR draft tanpa penyelesaian konflik dan pengujian | Rebase/merge terkontrol setelah hak akses dokumen versi final diverifikasi |

## Penelusuran terhadap sumber internal

Sumber internal yang ditinjau: **Pedoman Bank Garansi Final 03/03/2023**, **SK Direksi 134/SK/DIR/XII/2022**, **Lampiran 2 — Surat Permohonan KBG**, **Lampiran 3 — Checklist Dokumen**, **Lampiran 4 — LKN-BG**, **Lampiran 5 — Standar Analisa BG/KBG**, **Lembar Kontrol dan Persetujuan Menengah**.

| Materi sumber | Status pada kode | Gap tanpa asumsi baru |
|---|---|---|
| BG Penawaran, Uang Muka, Pelaksanaan, Pemeliharaan, Pembayaran, Bea Cukai dan skema khusus SP2D | Policy sandbox memiliki pilihan PENAWARAN, UANG_MUKA, PELAKSANAAN, PEMELIHARAAN, PEMBAYARAN, KEPABEANAN dan LAINNYA | `LAINNYA` bukan spesifikasi produk SP2D; pemeriksaan dokumen kondisional masih perlu kebijakan tertulis dan verifikasi per jenis. Penawaran di sandbox masih memerlukan `CONTRACT` menurut BR-06; sumber Lampiran 3 mencantumkan undangan tender/LPSE |
| Jaminan Cash Collateral, Kontra BG, Fixed Asset | Backend utama sekarang berfokus kontra BG/PKS SP2KBG | Tidak mengklaim alur kas terblokir/agunan fixed asset secara live. Perlu legal binding, limit, core transaction dan status blokir |
| Formulir Permohonan KBG dan Checklist Lampiran 3 | Jenis dokumen, dokumen legal/NIB, bukti proyek dan SLIK telah dipetakan sebagai checklist/commands | Formulir digital dan letter signed belum sama dengan tanda tangan sah atau verifikasi sumber regulator |
| LKN-BG Lampiran 4 | Form kunjungan, eviden lokasi/foto dan review independen sudah memiliki tests | Belum ada bukti onsite UAT, GPS tepercaya, OCR atau digital signoff nyata |
| Standar Analisa Lampiran 5 | Struktur analisis, 5C dan review terpisah telah memiliki implementasi sandbox | Threshold, skor dan kewenangan final memerlukan persetujuan Risk/Compliance/DPS; kode tidak otomatis menggantikan analisis bank |
| Kafalah bil ujrah, SP2KBG, persetujuan komite dan klaim | Kontrol akad/ujrah, SP2KBG, maker-checker, transaksi audit dan klaim mempunyai negative/positive tests | Signature, fund blocking, payout core dan klaim penjamin nyata masih MOCK; tidak boleh dinyatakan sah/live |

## Gate rilis lanjutan

1. **P0 privacy:** pengujian Principal/SLIK/MKP, Broker, ADMIN dan CONFIG_CHECKER negatif lulus pada CI, termasuk daftar, checklist dan download langsung.
2. **P1 health:** Node, Wrangler Worker typecheck, API tests SQLite/PostgreSQL, `npm audit` dua lockfile dan Vercel Preview lulus pada commit yang sama.
3. **Backend deployment:** pastikan Worker Cloudflare menggunakan versi kode baru; verifikasi `BG_PUBLIC_VERIFY_ORIGIN` aktif, tanpa mengubah `BG_ENCRYPTION_KEY`, objek Durable Object, atau sesi/data.
4. **UAT five-actor:** login terpisah, pengajuan dokumen, reviu, komisional, penjamin, penerbitan simulasi, delivery, klaim, recovery, logout, isolation dan negative SoD.
5. **Prohibition:** tidak ada perubahan `BG_MODE` dari SANDBOX, tidak ada data nasabah riil, tidak ada warkat BG riil, tidak ada klaim pembayaran nyata sampai governance institusi dan kontrol produksi disetujui.

**Catatan:** Kode yang ada merupakan implementasi sandbox bertahap; kepatuhan hukum/regulasi terbaru dan penyesuaian dengan kebijakan bank tidak dapat dipastikan hanya dari pedoman internal tahun 2022–2023. Tidak ada kesimpulan regulasi eksternal tanpa verifikasi sumber resmi.
