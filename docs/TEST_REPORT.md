# Laporan verifikasi BG Ecosystem MVP

Tanggal 27 Oktober 2026 WIB. Lingkup development/sandbox; tidak ada deployment publik atau transaksi bank nyata.

## Hasil terukur

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| Unit, semantic guards, API journeys dan backup–restore SQLite | 66 passed, 0 failed, 0 error, 0 skipped; 39.726 detik | evidence/sqlite-junit.xml |
| Browser desktop dan mobile | 13 checks PASS | evidence/browser.json |
| Dimensi mobile | innerWidth/clientWidth/scrollWidth seluruhnya 393 px | evidence/browser.json |
| Temporal durable timer | PASS; activity berjalan 2 kali melewati restart worker | evidence/temporal.json |
| Next.js build | PASS, Next 16.4.3 dan React 19.3.1 | Proses build pada penyusunan paket |
| TypeScript typecheck | PASS | npm run typecheck |
| OpenAPI | 3.1.0, 25 path | docs/openapi.json |
| Struktur store aktif | 21 tabel aggregate; FK scoped bank pada transaksi inti | migrations/0001_mvp_schema.postgresql.sql |
| PostgreSQL Docker dan CI GitHub | NOT RUN di lingkungan penyusunan | Compose dan workflow CI tersedia untuk verifikasi lanjutan |
| Integrasi live, native Android dan enterprise release gate | NOT RUN / BLOCKED | docs/RELEASE_GATE.md |

Satu warning deprecation Starlette TestClient/httpx tercatat; seluruh assertion pengujian tetap lulus. Pengujian Temporal memakai ephemeral test server dan activity uji untuk membuktikan ketahanan timer; logika sweep domain diuji terpisah melalui API. Ini bukan bukti kesiapan cluster Temporal produksi.

## Penerimaan T1 sampai T11

| ID | Bukti perilaku yang diuji | Hasil sandbox |
|---|---|---|
| T1 | APBN Rp2 miliar, SLIK bulan berjalan, SP2KBG; tanpa Komite tambahan, tetap otorisasi bank; sampai certificate/delivery/QR | PASS |
| T2 | Swasta Rp2,5 miliar tertahan tanpa GH | PASS |
| T3 | Swasta Rp4 miliar wajib Direksi | PASS |
| T4 | Kol 2, Kol 1 bulan lalu dan rollover bulan saat issue tertahan | PASS |
| T5 | TDP tidak menggantikan NIB | PASS |
| T6 | Format khusus tanpa approval tertahan; hash salah ditolak; scan sah sampai BG_ISSUED dan original outstanding | PASS |
| T7 | Admin Rp30 juta menjadi Rp5 juta; Rp12 juta menjadi Rp3 juta; checker berbeda dan settlement tepat waktu | PASS |
| T8 | Receipt memulai report clock; lewat 1 hari kerja menghasilkan escalation, sweep ulang tidak menggandakan | PASS |
| T9 | REJECTED dan DEFERRED membuka Litigasi; penutupan tanpa bukti gagal; setelah pembayaran dan Legal checker dapat ditutup | PASS |
| T10 | Kuasa dan disclosure; broker dilarang approve/edit submitted; pencabutan langsung menghilangkan akses | PASS |
| T11 | Token palsu tidak ditemukan; BG expired tetap asli tetapi tidak valid, claim window terpisah | PASS |

## Kontrol tambahan yang diuji

- Predicate positif/negatif untuk BR-01–BR-20, boundary nominal, uang NaN/Infinity/negatif/desimal tidak valid, kalender weekend/libur.
- Penjamin tidak aktif, dokumen covered SP2KBG yang tidak boleh menghapus NIB, E-Memo kurang cc, signer kantor salah, owner portofolio diubah.
- Hak klaim kontra menurut tipe kantor, owner/tembusan monitoring, laporan tepat waktu dan terlambat.
- Sesi/CSRF, cross-tenant, akses broker tanpa kuasa, versi tertinggal, idempotency replay dan konfigurasi maker-checker.
- Dua issue bersamaan pada limit yang sama: satu berhasil, satu ditolak; tidak terjadi oversubscription.
- Dokumen terenkripsi; digest salah menolak download; SQLite trigger menolak perubahan audit; jurnal debit/kredit seimbang.
- Backup dan restore ke DB baru mempertahankan registry, FK, state ACTIVE dan rantai audit.
- Environment production ditolak sejak startup.

## Pemeriksaan browser

- desktop_login_render
- principal_login
- create_draft_through_ui
- evidence_upload_through_ui
- independent_document_verification
- mpo_portal
- penjamin_portal
- obligee_portal
- broker_portal
- fake_qr_browser
- android_viewport_393_no_overflow
- mobile_long_form_usable
- no_uncaught_browser_errors

Screenshot hanya digunakan untuk QA internal, tidak dimasukkan dalam paket. Uji mobile adalah viewport 393×852, bukan perangkat Android/keyboard asli. Hasil lulus tersebut tidak menandakan seluruh model enterprise 57 tabel, adapter live, RLS PostgreSQL, pelaporan regulator atau target RPO/RTO telah selesai.

## Cara reproduksi

Lihat README.md. Jalankan pengujian pada database disposable. SQL desain 57 tabel adalah referensi dan tidak diterapkan sebagai schema MVP. Jangan menjalankan fixture, role sandbox atau adapter MOCK untuk penerbitan BG nyata.
