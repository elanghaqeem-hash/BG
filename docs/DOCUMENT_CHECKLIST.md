# Checklist persyaratan dokumen BG (baseline 2023)

## Sumber dan cakupan

Katalog dokumen mengambil baseline **Lampiran 3 – Formulir Checklist Dokumen**, **Pedoman Bank Garansi 2023**, dan **Lampiran 2 – Surat Permohonan Kontra Bank Garansi** pada bahan kerja internal. Katalog ini tidak dinyatakan sebagai ketentuan OJK terbaru. Legal/Compliance harus mengecek keberlakuan serta memutakhirkan daftar sesuai kebijakan dan PKS yang disahkan sebelum penggunaan nyata.

Implementasi: `cloudflare/document-checklist.ts` dan `frontend/components/DocumentChecklist.tsx`. Checklist dihitung ulang saat aplikasi dibuka atau dokumen diunggah/diverifikasi; tidak menyimpan flags redundan di database. Pemeriksaan dibuat pada backend dari bukti dalam scope aplikasi, tidak berdasarkan pilihan manual pengguna di browser.

## Makna status

| Status | Arti |
|---|---|
| MISSING | Persyaratan wajib pada tahap yang sedang berlangsung tetapi belum ada unggahan |
| PENDING | Dokumen telah diunggah; masih menunggu petugas berbeda memverifikasi sumber primer |
| VERIFIED | Versi dokumen terakhir telah terverifikasi |
| UPCOMING | Persyaratan wajib untuk tahap transaksi berikutnya |
| CONDITIONAL | Hanya wajib ketika kondisi bisnis tertentu terpenuhi; tidak otomatis dihitung kurang |

Unggahan terbaru yang belum diverifikasi tidak mewarisi status VERIFIED dari versi sebelumnya. Pengunggah tidak boleh memverifikasi berkas sendiri.

Penghitungan ringkasan `counts` hanya memasukkan dokumen wajib hingga tahap saat ini. Dokumen tahap berikutnya tetap ditampilkan pada filter **Seluruh persyaratan**. Tombol unggah hanya tampil kepada peran yang berwenang atas jenis dokumen tersebut. Daftar Penjamin dibatasi pada SP2KBG, persetujuan format dan sertifikat; Obligee tidak memperoleh checklist legal/keuangan Principal.

## Kondisional dan batas implementasi

- Jenis Bank Garansi: **PENAWARAN** menambahkan undangan tender/LPSE, sedangkan jenis lain memakai kontrak/SPK. Saat ini `BR-06` sandbox masih mewajibkan CONTRACT juga untuk PENAWARAN; pengecualian memerlukan review dan approval policy.
- Izin usaha, SIUJK, TDR, asosiasi, LKN, agunan, dan dokumen khusus SP2D tidak dipaksakan secara otomatis karena atribut bidang usaha, kegiatan verifikasi, jenis agunan, serta penanda SP2D yang eksplisit belum tersedia pada form aplikasi. Ini perlu ditentukan oleh RM/Legal.
- Transaksi antar kantor menambahkan surat permintaan Principal. Format khusus menambahkan persetujuan format penjamin.
- MAP-BG, keputusan komite, SP2BG, bukti pembayaran, akad, sertifikat dan penyerahan dipantau sesuai tahapnya. Dokumen AKAD, MKP dan BG dapat terbuat oleh workflow; dokumen lainnya membutuhkan unggah dan verifikasi.
- Format unggahan native pada baseline masih teks UTF-8 atau PDF hingga 2 MB. DOCX/JPG/PNG, pembacaan isi dokumen (OCR), pemeriksaan tanggal kedaluwarsa di dalam file, serta validasi kesesuaian penerbit belum tersedia. Hash SHA-256 dan status verifikasi tidak membuktikan kebenaran substansi tanpa petugas pemeriksa.

## Release gate

Checklist ini **advisory untuk tampilan kelengkapan**, bukan gate approval baru. Gate transaksional yang aktif masih bersumber dari konfigurasi versi policy (terutama BR-05, BR-06 dan BR-09). Untuk menjadi gate penerbitan resmi, langkah wajib berikutnya adalah penetapan dokumen wajib per produk/jenis agunan/jenis usaha/kontra BG oleh pemilik kebijakan, penambahan atribut master yang relevan, pemetaan alternatif sah (misalnya tender vs kontrak), serta penyesuaian test journey dan approval SoD. Jangan mengklaim sistem siap produksi hanya karena angka checklist mencapai 100%.
