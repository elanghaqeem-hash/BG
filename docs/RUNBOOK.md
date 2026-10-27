# Deployment dan operasi sandbox

## Prasyarat dan inventaris

- Python 3.12+, Node 22+, lockfile npm dan `backend/requirements.txt`.
- PostgreSQL 17 melalui Compose bila ingin memakai storage target; SQLite hanya alternatif lokal/testing.
- `DATABASE_URL`, `BG_ENCRYPTION_KEY`, URL internal API, URL publik frontend dan daftar origin yang tepat.
- Identitas pilot terpisah; tidak ada password bawaan bersama. Bootstrap hanya pada environment development/test.
- Kunci enkripsi dokumen harus tersedia saat restore. Backup DB tanpa kunci tidak cukup.

## Deployment baru

1. Verifikasi checksum paket dan baca release gate.
2. Jalankan bootstrap lokal atau configure Compose sesuai README.
3. Periksa `/health`: mode SANDBOX dan production_enabled=false.
4. Login beberapa role, pastikan scope dokumen dan command sesuai peran.
5. Jalankan satu transaksi APBN dan satu swasta. Uji penolakan tanpa Komite/SLIK/NIB yang sesuai.
6. Jalankan worker Temporal untuk sweep SLA. Bila development tanpa Temporal, operator WORKER dapat menjalankan sweep endpoint untuk pengujian; itu bukan bukti SLA unattended.
7. Validasi rekening/jurnal simulasi, role checker distribusi dan trace event.

Upgrade schema MVP belum memakai migrator incremental otomatis. Distribusi 0.1 hanya untuk DB baru. Jangan menambahkan `create_all` ke prosedur migrasi produksi; schema diff, backup, expand/migrate/contract dan rollback harus dirancang sebelum upgrade data yang telah dipakai.

## Uji transaksi antar kantor

Kantor pemroses `cabang-1`; penerbit `kpo-1`. Pastikan surat Principal diverifikasi, MKP mencatat interoffice dan E-Memo memiliki tujuan/tembusan/lampiran BR-12. Akun `issuer` berperan MPO KPO pada kantor penerbit. Akun `mpo` Cabang tidak dapat menggantikannya. Portofolio tetap pemroses.

Pendapatan administrasi ditentukan policy, bukan input Principal. Untuk contoh Rp30 juta/Rp12 juta, buat policy sandbox melalui Admin, ubah admin_fee, lalu checker mengaktifkan versi baru sebelum membuat pengajuan. Split dibuat saat collect_fee; jangan menunggu BG ACTIVE untuk menghitung due H+1. Akun finance_checker harus berbeda dari finance yang membukukan.

## SLA dan worker

SLA disimpan pada tabel tasks dengan due absolut, calendar snapshot pada policy application dan status OPEN/OVERDUE/DONE. Workflow Temporal melakukan sweep setiap 60 detik dan continue-as-new setelah 300 iterasi. Satu workflow ID per bank mencegah scheduler ganda. Worker yang mati tidak menghapus timer/due task.

Periksa `/operations` untuk backlog, due, overdue dan kasus Litigasi. Email/WA live belum tersambung; outbox hanya ditandai MOCK_DISPATCHED. Jangan memakai status itu sebagai bukti pesan eksternal terkirim.

## Kegagalan dan tindakan

| Gejala | Pemeriksaan dan tindakan |
|---|---|
| Frontend 503 | API health, URL internal runtime, proses API dan koneksi DB; jangan mengganti dengan sukses lokal |
| 401/403 | Session expiry, CSRF, role, kantor dan kuasa; login kembali bila perlu; jangan menaikkan role untuk melewati guard |
| 409 VERSION | Muat ulang detail; evaluasi apakah keputusan sebelumnya sudah tercatat; gunakan key sama hanya untuk retry identik |
| 422 BR-05 | Cek Kol, tanggal tarik, tahun/bulan Jakarta dan bukti sumber; tidak boleh backdate issued_at |
| 422 BR-07/08 | Cek approval scan terhadap hash draft; perubahan materi wajib persetujuan baru |
| 422 LIMIT | Exposure terbit lain dan principal limit; jangan menghapus registry untuk membebaskan kapasitas |
| Dokumen tidak dapat didekripsi | Pastikan key asli dan data tidak berubah; pulihkan key dari backup terotorisasi |
| Audit tidak cocok | Tahan aktivitas transaksi, simpan salinan bukti, investigasi; hash chain saja belum memberi trusted external anchor |
| Klaim kontra ditolak/ditunda | Periksa kasus Litigasi otomatis dan owner. Jangan menutup kasus hanya dengan edit state |
| Distribusi lewat due | Lakukan settlement sah, tetap simpan overdue/late=true; tidak menggeser booked_at/due |

## Backup dan pemulihan lokal

Hentikan writer sebelum salinan sederhana. SQLite memakai WAL, sehingga gunakan API backup SQLite, bukan menyalin hanya file utama saat aplikasi aktif. Contoh tersedia pada scripts/backup_sqlite.py. Simpan kunci dokumen pada lokasi aman terpisah dari arsip data. SHA-256 dan audit head dicatat sebelum/selesai restore. Backup dapat mengandung data pribadi bila digunakan di luar fixture; kontrol akses dan enkripsi backup harus disiapkan operator.

PostgreSQL: gunakan backup/PITR dan database terisolasi untuk restore rehearsal. Temporal database/volume dan objek dokumen juga harus dipulihkan konsisten. Setelah restore, rekonsiliasi transaksi ke sistem eksternal sebelum menerima pembayaran/penerbitan baru. Paket ini belum membuktikan target RPO≤15 menit/RTO≤4 jam.

## Rollback

Untuk sandbox tanpa transaksi eksternal: hentikan API/worker, simpan backup, gunakan versi artefak dan DB snapshot yang cocok, pulihkan key, lalu periksa chain/jurnal/registry dan smoke test. Jangan menurunkan versi kode terhadap schema yang tidak kompatibel.

Untuk operasi nyata kelak, rollback DB tidak membatalkan BG yang sudah terbit atau uang yang sudah bergerak. Penerbitan/pembayaran yang statusnya UNKNOWN memerlukan inquiry dan rekonsiliasi, bukan penerbitan ulang. Deaktivasi produk harus menahan transaksi baru sambil tetap melayani kewajiban klaim/registry yang telah ada.
