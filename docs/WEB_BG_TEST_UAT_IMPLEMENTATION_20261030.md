# Perbaikan BG berdasarkan Web BG Test.docx — 30 Oktober 2026

## Sumber dan batasan

Temuan berasal dari komentar uji peran Principal dan Broker dalam **Web BG Test.docx**. Implementasi ini memakai backend native Cloudflare Free (Durable Objects SQLite) dan portal Next.js, bukan integrasi produk ke bank atau lembaga pemerintahan resmi. Tidak ada perubahan terhadap aturan persetujuan, pengesahan akad, atau status penerbitan riil.

## Pemetaan temuan UAT → tindakan

| Temuan | Implementasi pada branch | Catatan / batas |
| --- | --- | --- |
| Data proyek perlu dikelompokkan dan bisa mengambil sumber obligee pemerintah | Form baru dipecah menjadi kelompok proyek, jaminan, penerbit/penjamin. Ada referensi proyek, nilai proyek, periode proyek dan penanda sumber input manual | **Belum** ada pengambilan otomatis LPSE/obligee; perlu API resmi, consent, perjanjian akses dan validasi referensi |
| Pilihan BG/Surety, setoran jaminan/kontra, bank/penjamin, format khusus | Jenis BG dan mitra penjamin tetap dipilih; skema Kontra BG aktif, opsi cash collateral dan surety-only ditandai tidak tersedia. Template khusus dapat diunggah setelah draft | Produk/scheme lain baru boleh aktif setelah risk policy, perjanjian, pricing dan workflow selesai |
| Halaman detail muncul dari posisi gulir bawah | Ketika detail pengajuan dibuka, viewport kembali ke atas | Perlu UAT mobile Android |
| Screening Principal dari Dukcapil, Privy/PSrE, asosiasi, AHU, OSS, rating | Kebutuhan masuk backlog integrasi; policy KYB/SLIK dan pemeriksaan manual tetap berlaku | **Tidak ada hasil verifikasi otomatis**. Integrasi memerlukan sumber resmi, otorisasi, consent, dan kebijakan data pribadi |
| Checklist dokumen tidak eksplisit | Checklist default memperlihatkan seluruh persyaratan menurut kategori, tahap dan status; dokumen kondisional/tahap berikutnya dapat diajukan lebih awal bila perannya berwenang | Checklist advisory, bukan override gate BR; dokumen sah tetap butuh pemeriksaan sumber |
| Surat permohonan harus ditandatangani? | Di form dan checklist disampaikan bahwa submit portal sandbox bukan pengganti tanda tangan basah/PSrE | Penggantian dokumen fisik memerlukan penerimaan bank, penguatan identitas/kuasa, serta PSrE atau dasar hukum sesuai kebijakan |
| Upload harus bisa JPG/PNG, ada gangguan upload, verifikasi saat upload tidak tepat | Backend mendeteksi PDF/JPG/PNG/TXT berdasarkan signature, gambar maksimum 4096 px/sisi, dokumen maks 2 MB. Frontend menerima ekstensi yang sama dan menghilangkan kewajiban referensi saat unggah. Upload langsung tersimpan dengan status PENDING | Petugas berbeda tetap memverifikasi **keaslian untuk keputusan**. Tidak ada OCR, scanning malware atau audit dokumen eksternal |
| Principal cukup melihat progress tujuh tahap | Komponen PrincipalJourney menampilkan tujuh langkah bisnis; panel analisis internal Bank disembunyikan | Tahap dipetakan dari state yang sudah ada; workflow internal dan bank-only attachments tidak lagi dikembalikan kepada Principal |
| Bagaimana Bank/Penjamin menghubungi Principal? | Kotak pesan per pengajuan: klarifikasi, dokumen kurang, jadwal kunjungan. Akses scoped, pesan hanya dari/ke peran terkait; event tercatat audit | Tidak ada email/WA/SMS, push notification atau SLA balasan |
| Broker: fungsi dashboard/pipeline/monitoring/komisi/klaim dan akses PIC | Broker yang memiliki kuasa sah tetap bisa melihat aplikasi sesuai mandate, progres, pipeline dan klaim yang memang dalam scope; input kuasa diwajibkan saat mengajukan. Jalur pesan internal tersedia | Komisi realisasi, klaim broker teragregasi dan direktori kontak PIC lintas pihak memerlukan data/consent serta role policy tambahan |

## Uji wajib sebelum promosi

1. Jalankan `npm test`, `npm run typecheck:worker`, `npm run typecheck`, `npm run check:release-preflight`, `npm run check:deploy`.
2. Uji unggah PDF/JPG/PNG/TXT, ekstensi palsu, file kosong, >2 MB, gambar >4096, penggantian dokumen yang sebelumnya telah diverifikasi, dan unduh dengan ekstensi yang benar.
3. Uji user Principal versus petugas Bank untuk SLIK/DHN/analisis rahasia; broker tanpa kuasa dan setelah pencabutan kuasa harus tertolak.
4. Uji pesan Bank→Principal, Penjamin→Principal, Principal→Bank, serta pesan internal Bank→Penjamin yang **tidak** terlihat Principal. Audit hash-chain tetap valid.
5. Uji peran Principal pada desktop/Android: daftar→detail selalu mulai di bagian atas; tujuh tahap, checklist penuh, upload dan form proyek dapat dipakai tanpa overflow.
6. Tidak boleh mengaktifkan screening eksternal, tanda tangan sah, atau skema produk baru berdasarkan data sandbox.

## Release gate

Branch ini **belum** mengaktifkan penerbitan BG riil. Merge hanya setelah CI hijau, review security/privacy, UAT lima peran dan verifikasi deployment environment. Verifikasi produksi riil tidak dapat disimpulkan dari commit/PR saja.
