# Portal dan komponen UI

Portal Next.js memakai satu codebase dengan menu, data, dokumen dan aksi sesuai identitas login. Backend tetap menegakkan otorisasi meskipun tombol tersembunyi. Palet navy, teal dan aksen gold; tabel dapat digulir dalam container, sidebar dapat dibuka/tutup pada layar kecil, form memakai label eksplisit.

| Aktor | Halaman dan komponen |
|---|---|
| Principal | Ringkasan, Pengajuan Baru, Detail BG, unggah bukti, akad, biaya/disclosure, Kuasa Broker dan revokasi, QR |
| Bank | Dashboard pipeline, task per role pada detail pengajuan, verifikasi dokumen, underwriting, Komite, MKP/akad, fee, E-Memo, issue, delivery, klaim/litigasi, SLA dan audit |
| Penjamin | Pipeline transaksi yang menunjuk organisasinya, SP2KBG, format khusus exact hash, sertifikat dan keputusan klaim kontra |
| Obligee | Pengajuan/BG untuk organisasinya, QR, upload klaim, submit/withdraw klaim; dokumen sensitif bank/Principal tidak ditampilkan |
| Broker | Pipeline yang memiliki kuasa aktif, pembuatan/submission sesuai kuasa, disclosure komisi; tidak ada aksi approval; akses hilang saat kuasa dicabut |

## Struktur layar

| Layar | Hierarki informasi |
|---|---|
| Login | Identitas produk → username/password → hasil validasi → akses verifikasi publik |
| Ringkasan | Header identitas → empat metrik data aktual → tahap pipeline → daftar pengajuan |
| Pengajuan Baru | Proyek dan pihak → jenis/nominal → tanggal → kantor → broker/format → simpan draft |
| Detail | Status/versi → nilai dan kantor → aksi sesuai role → dokumen/hash/verifikasi → kuasa atau klaim bila relevan |
| Klaim | Proyek → state/nominal → pilihan aksi → bukti terverifikasi → simpan keputusan |
| SLA | Jenis task → due time → status OPEN/OVERDUE/DONE → transaksi terkait |
| Litigasi | Alasan referral → owner → status → penutupan dari kartu klaim dengan checker |
| Konfigurasi | Versi aktif → salin ke draft → JSON terstruktur → submit maker → approve checker |
| Audit | Event/actor/time/hash → pemeriksaan chain |
| Verifikasi Publik | Token QR → authenticity/validity → nomor/pihak/nominal/tanggal → claim window |

Konfigurasi berbasis JSON adalah antarmuka teknis untuk administrator pada MVP; form parameter bisnis yang sepenuhnya dipandu merupakan pengembangan berikutnya. Template BG/MKP/akad pada sandbox menghasilkan dokumen teks/JSON bertanda simulasi; belum template warkat hukum/PDF resmi.

## Pemeriksaan UI yang dilakukan

Browser desktop 1440×1000 dan viewport mobile 393×852: login, pembuatan draft, unggah dokumen, verifier berbeda, akses Bank/Penjamin/Obligee/Broker, QR palsu, menu mobile, form panjang dan horizontal overflow. Build TypeScript diperiksa. Viewport mobile bukan pengujian perangkat Android asli/keyboard virtual; hasil tersebut harus diuji lagi pada UAT pengguna.

File implementasi utama: `frontend/components/Portal.tsx`, `frontend/components/Verification.tsx`, `frontend/app/globals.css`. Tidak memakai gambar AI atau aset eksternal yang diperlukan untuk tampilan.
