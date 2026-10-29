/**
 * Documents a Principal may access in the BG sandbox.
 *
 * Keep this explicit and fail closed. Bank decision papers, credit screening,
 * underwriting, SLIK/DHN, internal visit and audit evidence are NOT customer
 * documents. Use this same allowlist for both listing and direct downloads.
 */
export const PRINCIPAL_VISIBLE_DOCUMENT_KINDS: readonly string[] = Object.freeze([
  "AMENDMENT_REQUEST",
  "NIB",
  "CONTRACT",
  "KYB",
  "PRINCIPAL_REQUEST",
  "MANDATE",
  "AKTA_PENDIRIAN",
  "IDENTITAS_PENGURUS",
  "NPWP",
  "TDR",
  "LAPORAN_KEUANGAN",
  "SIUJK",
  "ASOSIASI_PROFESI",
  "IZIN_LAINNYA",
  "UNDANGAN_TENDER",
  "PERMOHONAN_BG",
  "PERMOHONAN_KBG",
  "FORMAT_TEMPLATE",
  "SP2D_SATKER",
  "SP2D_PERJANJIAN",
  "SP2D_KPPN",
  "BUKTI_BIAYA",
  "SURAT_KUASA_PEMBLOKIRAN",
  "DRAFT_BG",
  "AKAD",
  "BG",
  "CERTIFICATE",
  "DELIVERY",
]);

/** A Broker may only read these principal-provided source documents. */
export const BROKER_VISIBLE_DOCUMENT_KINDS: readonly string[] = Object.freeze([
  "NIB",
  "CONTRACT",
  "PRINCIPAL_REQUEST",
]);
