# BG Ecosystem Enterprise — Laporan UAT End-to-End Bertahap
**Tanggal:** 31 Oktober 2026 (WIB)  
**Lingkungan:** produksi Cloudflare read-only + Vercel Sandbox terisolasi menjalankan native Cloudflare Worker/Durable Objects SQLite + Chromium Playwright  
**Kode produksi yang diuji:** `e9e3a2144e277ed379db42d94e7dc68b47143bad`  
**Branch perbaikan:** `fix/bg-uat-upload-mobile-20261031` (draft PR #13)  
**Mode operasi:** SANDBOX; penerbitan Bank Garansi riil tidak aktif.

## 1. Ringkasan eksekusi yang benar-benar dilakukan
| Pengujian | Hasil | Evidensi |
| --- | --- | --- |
| Cloudflare live homepage dan halaman verifikasi | 2/2 HTTP 200 | GET `/`, `/verify` |
| Kesehatan portal + Durable Object live | HTTP 200, backend_connectivity=ok, mode=SANDBOX | GET `/api/health/deployment` |
| Akses API live tanpa login | HTTP 401 untuk /auth/me, /applications, /catalog, /claims, /users, /audit/events | 6 pengujian GET |
| Login cross-origin live | HTTP 403 | POST login dengan Origin asing |
| Tes otomatis Node.js (backend + validasi + keamanan) | **126 PASS / 0 FAIL** | `npm test` |
| Login 21 identitas di browser sandbox | **21/21 PASS** | Playwright `tests/browser-role-uat.cjs` |
| Logout 21 identitas di browser sandbox | **21/21 PASS** | Playwright |
| Klik seluruh menu yang tersedia menurut masing-masing role | **121/121 PASS** | 21 identitas, menu dinamis |
| Tombol UI teramati pada halaman-halaman menu | **172 kemunculan** | Diinventarisasi, **BUKAN seluruhnya diklik** |
| Input UI teramati pada halaman-halaman menu | **96 kemunculan** | Diinventarisasi, **BUKAN seluruhnya disubmit** |
| Browser uncaught page errors / HTTP API 5xx sepanjang navigasi | **0 / 0** | Playwright |
| UAT regresi UI, unggah, kontrol dokumen dan segregasi Principal–Compliance | **11/11 PASS** setelah perbaikan | `tests/browser-ui-regression.cjs` |
| OpenNext build dan typecheck Worker lokal | PASS | `npm run build` dan `npm run typecheck:worker` setelah build |

## 2. Identitas dan navigasi yang diuji
**21 akun sandbox**: Principal; AO; Analyst; Compliance; MPO; Issuer (MPO_KPO); Support; GH Bisnis; Direksi; Finance; Finance Checker; Penjamin; Obligee APBN; Obligee swasta; Broker; Litigation; Legal; Audit; Admin; Config Checker; Worker.

**Menu aktual dalam aplikasi**: Ringkasan, Pengajuan, Klaim, SLA & Operasi, Litigasi, Konfigurasi, Audit, Pengguna, Keamanan. Jumlah menu yang diizinkan untuk setiap akun berbeda berdasarkan role (4–8 menu), dan seluruh 121 kemunculan menu di matriks akun berhasil dibuka.

**Catatan penting:** inventarisasi tombol bukan pengujian fungsi klik, validasi, penyimpanan, atau hasil backend untuk setiap tombol. Beberapa tombol hanya muncul pada status transaksi tertentu.

## 3. Simulasi transaksi nyata di database UAT terisolasi
1. Principal login, membuka halaman **Pengajuan baru**, mengisi proyek, nominal BG, tanggal terbit, dan masa berlaku, lalu menekan **Simpan draft pengajuan**; draft tersimpan dalam SQLite sandbox.
2. Tombol **Kirim pengajuan** terhadap draft dengan dokumen tidak lengkap ditolak oleh backend, termasuk pesan **"NIB wajib; TDP tidak menggantikan NIB"** — hasil yang benar.
3. Upload berkas ekstensi terlarang ditolak.
4. Setelah bug UI diperbaiki, upload TXT berisi bukti **MOCK** melalui tombol **Unggah dokumen** berhasil tersimpan dan menghasilkan `NIB.verified=false` serta checklist `status=PENDING`, tampilan **Menunggu verifikasi**.
5. Principal tidak dapat melakukan verifikasi mandiri; Compliance login menggunakan akun terpisah dan dapat membuka pengajuan yang dibuat Principal.
6. Logout kedua peran dan pengujian mobile sidebar berjalan normal setelah patch.

Semua dokumen yang diunggah pada simulasi adalah **fiktif/MOCK** dan tidak boleh ditafsirkan sebagai dokumen nasabah riil.

## 4. Defect yang terkonfirmasi dan diperbaiki (PR #13, belum ke produksi)
| ID | Severity | Reproduksi sebelum patch | Root cause | Verifikasi pasca patch |
| --- | --- | --- | --- | --- |
| BG-UAT-001 | P0 | Unggah `.txt` valid gagal dengan "Format berkas harus..." | Regex frontend `/\\\\.(...)/` mencari backslash, bukan titik ekstensi | Unggah TXT valid PASS, ekstensi terlarang tetap ditolak, `verified=false` |
| BG-UAT-002 | P1 | Sidebar mobile terbuka menutupi tombol hamburger dan tidak bisa ditutup melalui tombol itu | Tidak ada kontrol close di dalam sidebar | Tombol **Tutup menu navigasi** di dalam sidebar PASS |

Patch berada di `frontend/components/Portal.tsx` dan `frontend/app/globals.css`. **Versi Cloudflare produksi masih memakai commit baseline; perbaikan belum dinyatakan live.**

## 5. Batas cakupan / gate yang belum terpenuhi
- **Belum FULL UI E2E** untuk seluruh tombol kontekstual: verifikasi setiap kategori dokumen, KYB, iDEB/SLIK, analisis 5C, penjamin/SP2KBG, approval berjenjang, komite, akad, simulasi biaya/ujrah, jurnal, penerbitan, penyerahan, klaim, litigation, recovery, reversal, sampai penutupan.
- Alur domain tertentu memang tercakup **tes otomatis backend** yang sudah ada, tetapi **bukan berarti seluruh tombol dan journey di browser sudah diuji**.
- **Belum melakukan login lintas-role pada database Cloudflare produksi** karena kredensial/identitas live tidak diambil dari secret; hanya tes GET publik/tidak terauthentikasi dilakukan di sana.
- Target arsitektur **20 modul/menu enterprise** pada roadmap **belum identik dengan menu yang benar-benar telah diimplementasikan**; modul yang tidak tersedia tidak dapat dinyatakan PASS.
- UAT perangkat mobile dilakukan pada viewport Chromium terpilih, belum lintas browser, Android nyata, aksesibilitas WCAG penuh, beban tinggi, DR, ataupun integrasi pihak ketiga live.
- Jangan menonaktifkan `BG_MODE=SANDBOX` atau mengaktifkan penerbitan BG riil hanya berdasarkan hasil tes ini.

## 6. Reproduksi dan evidence
- Skrip: `tests/browser-role-uat.cjs`, `tests/browser-ui-regression.cjs` (Playwright di `frontend/node_modules`).
- Prasyarat: jalankan build & `wrangler dev --local` dengan **identitas uji yang dibuat secara aman**, `BG_INITIAL_USERS` berisi hash sesuai `cloudflare/bootstrap.ts`, `BG_ENCRYPTION_KEY` acak 64 hex, `BG_MODE=SANDBOX`; gunakan **Durable Object lokal terisolasi** dan bukan tenant live.
- Set `BG_UAT_PASSWORD` secara privat atau gunakan file lokal `.uat-password` (gitignored); jangan commit kredensial.
- Jalankan browser: `node tests/browser-role-uat.cjs` dan `node tests/browser-ui-regression.cjs` (Chrome/Playwright dependencies diperlukan).
- JSON evidence otomatis disimpan lokal pada `evidence/uat-browser-role-20261031.json` dan `evidence/uat-ui-regression-20261031.json`, dikecualikan dari Git.
- Kontrol CI dan pemeriksaan keamanan ulang wajib PASS sebelum merge atau rollout.

## 7. Kesimpulan dan keputusan release
**PASS TERBATAS** untuk health production, dasar auth, 21 identitas dan navigasi, validasi draft/upload, serta regression 11 langkah. **BELUM FULL ENTERPRISE UAT / BELUM RELEASE APPROVAL**: 121 menu klik tidak sama dengan semua tombol bisnis, seluruh workflow tidak diuji lewat browser, dan patch PR #13 belum di-merge/deploy. Lanjutkan UAT transaksional stateful lintas role pada lingkungan terisolasi sampai semua gate dibuktikan.
