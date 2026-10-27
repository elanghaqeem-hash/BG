# Kontrak API MVP

OpenAPI 3.1 diekspor dari aplikasi pada `openapi.json`. Backend `/docs` menyediakan Swagger interaktif. Batas input HTTP memakai Pydantic `extra=forbid`; payload aksi diperiksa domain service. Semua timestamp hasil server UTC dengan offset; aturan bulan dan hari kerja memakai kalender Asia/Jakarta.

## Autentikasi dan command

`POST /auth/login` menerima `username` dan `password`, menghasilkan cookie HttpOnly SameSite Strict dan CSRF token. `GET /auth/me` membaca identitas server. Semua POST selain login memerlukan `X-CSRF-Token`. Role, bank, org dan office berasal dari session/User, bukan body. Login adalah autentikasi lokal sandbox, bukan MFA/OIDC produksi.

Command application: `POST /applications/{id}/commands/{command}`. Command klaim: `POST /claims/{id}/commands/{command}`. Body bersama:

```json
{"expected_version":0,"idempotency_key":"UUID-per-command","payload":{}}
```

Key sama dan payload/version sama mengembalikan hasil pertama. Key sama dengan payload berbeda menghasilkan 409. expected_version yang tertinggal juga 409. Transaction lock per bank menyerialisasi pemeriksaan kapasitas, audit head dan nomor BG. SQL parameterized melalui ORM.

| Command application | Payload | Peran |
|---|---|---|
| submit | commission_accepted bila ada broker | Principal/AO/Broker berkuasa |
| kyb_pass | screening_clear, ubo_verified boolean | Compliance |
| record_slik | document SLIK, collectibility integer, pulled_at timestamp ber-offset | Analyst |
| partner_start | kosong | Penjamin |
| sp2_issue | document SP2KBG, reference, issuing_unit, amount string, valid_to tanggal | Penjamin |
| bank_underwrite | kosong | Analyst |
| approve_format | document FORMAT_APPROVAL, draft_hash, signed_and_stamped boolean | Penjamin |
| approve | kosong | MPO dan GH/Direksi jika diperlukan |
| sign_mkp | kosong | Operasional sesuai scope |
| sign_akad | kosong; Principal dan Bank memanggil terpisah | Principal/operasional bank |
| collect_fee | kosong; tarif dari policy snapshot | Finance |
| ememo | to, cc array, attachments array sesuai BR-12 | Operasional |
| issue | kosong | Signer kantor sesuai BR-15 |
| certificate | document CERTIFICATE, reference | Penjamin |
| deliver | document DELIVERY | Operasional |
| distribute | kosong | Finance checker berbeda dari pembuku |
| original_received | document ORIGINAL_RECEIPT | Operasional |

| Command klaim | Payload | Peran |
|---|---|---|
| report | kosong | MPO/Support |
| approve_claim | instrument_conditions_met boolean | Operasional |
| pay_bank | kosong | Finance |
| submit_contra | document CONTRA_CLAIM | Sesuai kantor pada BR-17 |
| contra_decision | document CONTRA_DECISION, decision PAID/REJECTED/DEFERRED, reason | Penjamin |
| confirm_contra_paid | document CONTRA_PAYMENT | Finance |
| withdraw | document WITHDRAWAL | Obligee |
| refer_dispute | document DISPUTE | Legal/operasional |
| request_close | document RESOLUTION | Litigasi |
| confirm_close | kosong | Legal checker |

Semua `document` menunjuk ID bukti dalam transaksi/bank yang sama. Dokumen untuk keputusan wajib verified oleh petugas berbeda dari uploader. receipt klaim menerima dokumen yang belum diverifikasi agar timer penerimaan tidak ditunda; approval pembayaran tetap memerlukan verifikasi.

## Endpoint lain

| Endpoint | Kegunaan |
|---|---|
| GET /catalog | Master terbatas bank, policy aktif; konfigurasi lengkap hanya bank |
| GET/POST /applications | Daftar tersaring scope; buat draft |
| GET /applications/{id} | Detail tersaring per aktor |
| POST /applications/{id}/documents | Upload teks/PDF base64 maksimal 2 MB; terenkripsi di DB |
| POST /documents/{id}/verify | source_reference; verifier bank berbeda |
| GET /documents/{id}/download | Otorisasi, audit akses dan pemeriksaan digest setelah dekripsi |
| POST /mandates | Principal, broker, dokumen kuasa terverifikasi, application_id, expires, commission_disclosed |
| POST /mandates/{id}/revoke | Principal pemilik; berlaku pada request berikutnya |
| GET /applications/{id}/verification-link | QR token bagi pihak yang berwenang |
| GET /public/verify/{token} | Hasil minimal authenticity/validity/claim window |
| GET /public/qr/{token} | PNG QR menuju frontend verification |
| POST /applications/{id}/claims | document dan amount; hanya Obligee terkait |
| GET /claims | Daftar klaim tersaring; broker tidak melihat rincian klaim |
| GET /operations | SLA, distribusi dan Litigasi dalam scope kantor |
| POST /operations/sweep | Hanya identitas WORKER; Temporal memakai activity internal |
| POST /policies | Admin membuat draft konfigurasi baru |
| POST /policies/{id}/approve | Checker berbeda; mengaktifkan versi sandbox baru |
| GET /audit/events dan /audit/verify | Audit/Legal; pemeriksaan hash chain, bukan jaminan anchor eksternal |

## Error dan retry

401 sesi tidak sah/berakhir; 403 role/SoD/CSRF; 404 resource tidak ada atau tidak dapat dilihat; 409 state/version/idempotency/integritas; 422 input/guard; 429 rate limit; 503 upstream frontend tidak tersedia. Frontend menampilkan pesan aktual dan tidak mengganti kegagalan dengan status berhasil.

Klien hanya me-retry dengan key sama bila mengulang permintaan identik. Keputusan timeout di integrasi live kelak harus inquiry/reconcile lebih dahulu. Adapter mock deterministik pada referensi transaksi tidak membuktikan settlement eksternal.
