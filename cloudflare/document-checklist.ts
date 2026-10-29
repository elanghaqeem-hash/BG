/**
 * Checklist dokumen BG — turunan Lampiran 3 (Checklist Dokumen),
 * Lampiran 2 (Permohonan KBG), dan Pedoman Bank Garansi 2023.
 *
 * Display/readiness advisory. BR-06 tetap bersumber dari policy transaksi,
 * bukan angka kelengkapan tampilan ini, sampai governance menyetujui mapping
 * persyaratan final. Tidak melakukan validasi isi dokumen/OCR.
 */
type Evidence = {id: string; kind?: string; verified?: boolean; created_at?: string; [key: string]: unknown};
type Application = Record<string, unknown>;
type Requirement = {
  kind: string;
  label: string;
  group: string;
  phase: number;
  mandatory?: boolean;
  condition?: (a: Application) => boolean;
  note?: string;
};

const LIBRARY: Requirement[] = [
  {kind:"AKTA_PENDIRIAN",label:"Akta pendirian, seluruh perubahan dan pengesahan",group:"Legalitas Principal",phase:0,mandatory:true},
  {kind:"IDENTITAS_PENGURUS",label:"Identitas pengurus yang masih berlaku",group:"Legalitas Principal",phase:0,mandatory:true},
  {kind:"NPWP",label:"NPWP perusahaan",group:"Legalitas Principal",phase:0,mandatory:true},
  {kind:"NIB",label:"Nomor Induk Berusaha (NIB)",group:"Legalitas Principal",phase:0,mandatory:true},
  {kind:"TDR",label:"Tanda Daftar Rekanan (jika ada)",group:"Legalitas Principal",phase:0,note:"Hanya jika dimiliki/diwajibkan oleh pemilik proyek."},
  {kind:"LAPORAN_KEUANGAN",label:"Neraca dan laporan laba-rugi dua tahun terakhir",group:"Legalitas Principal",phase:0,mandatory:true,note:"Lampirkan kedua tahun dalam satu PDF atau dokumen konsolidasi."},
  {kind:"SIUJK",label:"SIUJK/perizinan jasa konstruksi",group:"Izin sesuai kegiatan usaha",phase:0,note:"Wajib jika usaha termasuk jasa konstruksi/konsultasi sesuai ketentuan yang berlaku."},
  {kind:"ASOSIASI_PROFESI",label:"Bukti keanggotaan asosiasi profesi",group:"Izin sesuai kegiatan usaha",phase:0,note:"Berlaku apabila diwajibkan oleh bidang usaha."},
  {kind:"IZIN_LAINNYA",label:"Izin usaha lainnya yang dipersyaratkan",group:"Izin sesuai kegiatan usaha",phase:0,note:"Jenis izin ditetapkan berdasarkan bidang usaha dan kontrak."},
  {kind:"CONTRACT",label:"Kontrak/SPK/PO atau dokumen pekerjaan setara",group:"Proyek dan permohonan",phase:0,mandatory:true,note:"Masih diwajibkan oleh policy BR-06 sandbox, termasuk untuk jenis Penawaran; perlu review kebijakan untuk pengecualian bid bond."},
  {kind:"UNDANGAN_TENDER",label:"Undangan tender atau bukti LPSE/e-Procurement",group:"Proyek dan permohonan",phase:0,mandatory:true,condition:(a)=>a.bg_type==="PENAWARAN"},
  {kind:"PERMOHONAN_BG",label:"Surat permohonan Bank Garansi dari Principal",group:"Proyek dan permohonan",phase:0,mandatory:true},
  {kind:"KYB",label:"Dokumen KYB/identifikasi badan usaha",group:"Pemeriksaan bank",phase:0,mandatory:true},
  {kind:"SLIK",label:"Hasil pemeriksaan SLIK (iDEB OJK)",group:"Pemeriksaan bank",phase:1,mandatory:true,note:"Bukti harus diverifikasi; keputusan Kol 1 dan bulan berjalan dicek terpisah pada workflow."},
  {kind:"DHN",label:"Hasil pemeriksaan Daftar Hitam Nasional",group:"Pemeriksaan bank",phase:1,mandatory:true},
  {kind:"LEGAL_CHECK",label:"Hasil analisis legal/yuridis",group:"Pemeriksaan bank",phase:1,mandatory:true},
  {kind:"CHECKLIST_RM",label:"Form checklist dokumen yang ditandatangani",group:"Pemeriksaan bank",phase:1,mandatory:true},
  {kind:"LKN",label:"Laporan Kunjungan Nasabah (LKN-BG)",group:"Pemeriksaan bank",phase:1,note:"Apabila dilakukan kunjungan; alternatif verifikasi sesuai pedoman dicatat oleh RM."},
  {kind:"PERMOHONAN_KBG",label:"Surat permohonan Kontra Bank Garansi",group:"Kontra Bank Garansi",phase:2,mandatory:true},
  {kind:"SP2KBG",label:"Surat Persetujuan Prinsip Kontra Bank Garansi",group:"Kontra Bank Garansi",phase:2,mandatory:true},
  {kind:"MAP_BG",label:"Memorandum Analisa Pembiayaan Bank Garansi",group:"Analisa dan persetujuan",phase:3,mandatory:true},
  {kind:"LEMBAR_KOMITE",label:"Lembar persetujuan/keputusan Komite",group:"Analisa dan persetujuan",phase:3,mandatory:true},
  {kind:"FORMAT_APPROVAL",label:"Persetujuan penjamin atas format khusus",group:"Analisa dan persetujuan",phase:3,mandatory:true,condition:(a)=>!!a.custom_format},
  {kind:"SP2BG",label:"Surat Persetujuan Pemberian Bank Garansi",group:"Akad dan penerbitan",phase:4,mandatory:true},
  {kind:"AKAD",label:"Akad Kafalah bil Ujrah",group:"Akad dan penerbitan",phase:4,mandatory:true,note:"Dapat tercatat otomatis setelah penandatanganan kedua pihak."},
  {kind:"BUKTI_BIAYA",label:"Bukti pembayaran administrasi, ujrah dan biaya terkait",group:"Akad dan penerbitan",phase:4,mandatory:true},
  {kind:"SURAT_KUASA_PEMBLOKIRAN",label:"Surat kuasa pemblokiran/agunan sesuai ketentuan",group:"Akad dan penerbitan",phase:4,note:"Wajib sesuai jenis agunan dan keputusan pembiayaan."},
  {kind:"PRINCIPAL_REQUEST",label:"Surat Principal untuk penerbitan antar kantor",group:"Akad dan penerbitan",phase:4,mandatory:true,condition:(a)=>a.processing_office!==a.issuing_office},
  {kind:"MKP",label:"Memorandum penerbitan/otorisasi MKP",group:"Akad dan penerbitan",phase:4,mandatory:true,note:"Dapat tercatat otomatis di workflow."},
  {kind:"BG",label:"Warkat Bank Garansi diterbitkan",group:"Penerbitan dan penyerahan",phase:5,mandatory:true},
  {kind:"CERTIFICATE",label:"Sertifikat Kontra Bank Garansi",group:"Penerbitan dan penyerahan",phase:5,mandatory:true},
  {kind:"DELIVERY",label:"Tanda terima/berita acara penyerahan BG",group:"Penerbitan dan penyerahan",phase:5,mandatory:true},
  {kind:"SP2D_SATKER",label:"Surat keterangan SatKer/kontrak dengan PPK (BG SP2D)",group:"Dokumen khusus SP2D",phase:0,condition:(a)=>a.bg_type==="PEMBAYARAN",note:"Wajib hanya bila transaksi merupakan BG khusus SP2D; jenis SP2D belum menjadi atribut master tersendiri."},
  {kind:"SP2D_PERJANJIAN",label:"Perjanjian pembayaran kontraktor–SatKer (BG SP2D)",group:"Dokumen khusus SP2D",phase:5,condition:(a)=>a.bg_type==="PEMBAYARAN",note:"Diserahkan setelah penerbitan untuk skema BG SP2D."},
  {kind:"SP2D_KPPN",label:"Surat pernyataan kontraktor kepada KPPN (BG SP2D)",group:"Dokumen khusus SP2D",phase:0,condition:(a)=>a.bg_type==="PEMBAYARAN",note:"Wajib hanya bila transaksi merupakan BG khusus SP2D."},
];
const PHASES = [
  "Pengajuan awal",
  "Pemeriksaan SLIK, DHN dan legal",
  "Underwriting penjamin",
  "Analisis dan persetujuan bank",
  "Penandatanganan akad",
  "Penerbitan dan penyerahan",
];
function phaseOf(state: string): number {
  if(state==="DRAFT") return 0;
  if(["KYC_KYB_CHECK","SLIK_CHECK"].includes(state)) return 1;
  if(["PENJAMIN_REQUESTED","PENJAMIN_UNDERWRITING"].includes(state)) return 2;
  if(["SP2KBG_ISSUED","CUSTOM_FORMAT_REVIEW","APPROVAL","APPROVAL_GRANTED"].includes(state)) return 3;
  if(["MKP_SIGNED","AKAD_SIGNED","FEE_COLLECTED","INTER_OFFICE_ISSUANCE"].includes(state)) return 4;
  return 5;
}
export function buildDocumentChecklist(a: Application, docs: Evidence[], role: string) {
  const stage=phaseOf(typeof a.state==='string'?a.state:'DRAFT');
  const allowed = role==="PENJAMIN"
    ? new Set(["SP2KBG","CERTIFICATE","FORMAT_APPROVAL"])
    : null;
  const visible=LIBRARY.filter(r=>(!r.condition||r.condition(a)) && (!allowed||allowed.has(r.kind)));
  const items=visible.map(r=>{
    // Dokumen terbaru harus diverifikasi, walaupun versi sebelumnya sudah lolos.
    const latest=docs.filter(d=>d.kind===r.kind)
      .sort((x,y)=>Number(x.revision||0)-Number(y.revision||0) ||
        String(x.created_at||"").localeCompare(String(y.created_at||""))).at(-1);
    const required=!!r.mandatory;
    const status=latest
      ? (latest.verified?"VERIFIED":"PENDING")
      : !required?"CONDITIONAL"
        : r.phase>stage?"UPCOMING":"MISSING";
    return {kind:r.kind,label:r.label,group:r.group,phase:r.phase,
      phase_label:PHASES[r.phase],required,status,
      note:r.note??"",document_id:latest?.id??null};
  });
  const actionable=items.filter(i=>i.required && i.phase<=stage);
  const counts={
    required:actionable.length,
    verified:actionable.filter(i=>i.status==="VERIFIED").length,
    missing:actionable.filter(i=>i.status==="MISSING").length,
    pending:actionable.filter(i=>i.status==="PENDING").length,
    upcoming:items.filter(i=>i.status==="UPCOMING").length,
  };
  return {
    source:"Lampiran 3 Checklist Dokumen dan Pedoman BG 2023 (baseline internal)",
    note:"Checklist ini menunjukkan kekurangan dokumen. Persetujuan transaksi tetap tunduk pada rules policy, verifikasi kewenangan, dan review manual petugas.",
    stage:PHASES[stage],
    ready:counts.missing===0 && counts.pending===0,
    counts,
    items,
    notification:counts.missing+counts.pending
      ? `Terdapat ${counts.missing} dokumen belum diunggah dan ${counts.pending} dokumen menunggu verifikasi pada tahap ini.`
      : "Dokumen wajib tahap ini lengkap; pastikan ketentuan workflow lain terpenuhi.",
  };
}
export const CHECKLIST_UPLOAD_KINDS = LIBRARY.map(r=>r.kind);
