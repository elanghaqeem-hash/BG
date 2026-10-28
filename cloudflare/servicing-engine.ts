/** 
 * Servicing pre-issuance state machine. Does not change effective warkat/terms.
 * Policy source: Pedoman Bank Garansi 2023, extension and endorsement steps.
 * Until institutional signing and core banking adapters are certified, READY
 * means READY_FOR_FORMAL_ISSUANCE only, NOT an effected BG amendment.
 */
import {
  amount, committee, dateOnly, hash, jakartaDate, money, requireValue as req, timestamp, uid,
  type Data, type Row,
} from "./core.ts";
import type { Service } from "./service.ts";

const UNRESOLVED = ["PENDING_REVIEW","RISK_REVIEWED","PARTNER_ENDORSED","APPROVED_PENDING_ISSUANCE"];
const preApproval = ["PENDING_REVIEW","RISK_REVIEWED","PARTNER_ENDORSED"];
function reason(x: unknown):string {
  req(typeof x==="string" && x.trim().length>=8 && x.length<=2000,"SERVICING","Alasan harus lengkap");
  return x.trim();
}
function item(svc:Service,a:Row,id:unknown):Row {
  req(typeof id==="string" && id.length>0,"PAYLOAD","ID servicing wajib ada");
  const r=svc.s.get("servicing",id);
  req(r.application_id===a.id,"NOT_FOUND","Servicing bukan bagian transaksi ini",404);
  req(r.baseline_fingerprint===svc.fingerprint(a) &&
      r.baseline_bg_number===a.bg_number,"VERSION",
      "Syarat BG berubah sejak permohonan perubahan",409);
  svc.doc(a,r.document,"AMENDMENT_REQUEST");
  svc.state(a,"ACTIVE");
  return r;
}
function targetAmount(r:Row,a:Row) {
  return amount(money(r.proposed.amount??a.amount));
}
function targetExpiry(r:Row,a:Row) {
  return dateOnly(r.proposed.expires_on??a.expires_on);
}
function projectCheck(svc:Service,a:Row,r:Row) {
  const p=svc.policy(a);
  const expiry=targetExpiry(r,a);
  req(expiry>=jakartaDate(svc.now),"SERVICING","Tanggal akhir perubahan telah lewat");
  req(
    (Date.parse(expiry)-Date.parse(jakartaDate(svc.now)))/86400000<=p.pks.max_tenor_days,
    "SERVICING","Tenor perubahan melampaui kebijakan sandbox");
  req(money(targetAmount(r,a))>0n,"SERVICING","Nilai BG harus positif");
  const g=svc.s.get("guarantees",a.id);
  req(g.status!=="CLOSED","SERVICING","BG telah ditutup");
  req(!svc.s.rows("claims",{application_id:a.id}).some(c=>c.state!=="WITHDRAWN"),
    "SERVICING","Perubahan BG diblokir ketika terdapat klaim",409);
}
function latestAfter(svc:Service,a:Row,r:Row,kind:string):Row {
  const d=svc.latest(a,kind);
  req(timestamp(d.created_at)>=timestamp(r.requested_at),"DOCUMENT",
    "Dokumen "+kind+" harus diperbarui setelah permintaan perubahan",409);
  return d;
}
function clean(r:Row) {
  return {id:r.id,application_id:r.application_id,kind:r.kind,status:r.status,
    proposed:r.proposed,requested_at:r.requested_at,
    reviewed_at:r.reviewed_at||null, partner_at:r.partner_at||null,
    approved_at:r.approved_at||null,
    mode:"SANDBOX",effective:false};
}
export function servicingListing(svc:Service,actor:Data,a:Row) {
  svc.access(actor,a);
  req(["PRINCIPAL","PENJAMIN","MPO","MPO_KPO","SUPPORT","ANALYST","COMPLIANCE",
    "LEGAL","GH_BISNIS","DIREKSI","AUDIT","ADMIN"].includes(actor.role),
    "FORBIDDEN","Tidak dapat melihat servicing",403);
  return svc.s.rows("servicing",{application_id:a.id})
    .sort((x,y)=>x.requested_at.localeCompare(y.requested_at))
    .map(clean);
}
export function reviewServicing(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["ANALYST"]);
  const r=item(svc,a,x.servicing_id);
  req(r.status==="PENDING_REVIEW","STATE","Permintaan bukan dalam antrean analisis",409);
  req(r.requested_by!==actor.id && a.maker!==actor.id,"SOD","Analyst harus independen",403);
  projectCheck(svc,a,r);
  for(const k of ["SLIK","DHN","LEGAL_CHECK","MAP_BG"])latestAfter(svc,a,r,k);
  req(x.collectibility===1,"SLIK","Kolektibilitas tidak memenuhi sandbox policy");
  req(timestamp(x.pulled_at)<=svc.now &&
    jakartaDate(timestamp(x.pulled_at)).slice(0,7)===jakartaDate(svc.now).slice(0,7),
    "SLIK","Tanggal pemeriksaan SLIK harus bulan berjalan");
  req(x.screening_clear===true && x.ubo_verified===true,
    "KYB","Screening/UBO review perubahan belum lengkap");
  req(["LAYAK","PERLU_PERBAIKAN","TIDAK_LAYAK"].includes(x.recommendation),
    "UNDERWRITING","Rekomendasi analis tidak sah");
  const accepted=x.recommendation==="LAYAK";
  r.risk_review={actor:actor.id,at:svc.iso,recommendation:x.recommendation,
    narrative:reason(x.narrative),slik_at:x.pulled_at,
    evidence:Object.fromEntries(["SLIK","DHN","LEGAL_CHECK","MAP_BG"].map(k=>{
      const d=svc.latest(a,k);return [k,{id:d.id,digest:d.digest}];
    }))};
  r.status=accepted?"RISK_REVIEWED":"REJECTED";
  r.reviewed_at=svc.iso;
  return clean(r);
}
export function partnerEndorse(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["PENJAMIN"]);
  const r=item(svc,a,x.servicing_id);
  req(r.status==="RISK_REVIEWED","STATE","Analisa bank belum diterima",409);
  projectCheck(svc,a,r);
  const partner=svc.s.get("partners",a.partner);
  req(partner.active && !!partner.pks,"COUNTER","Penjamin atau PKS tidak aktif");
  const doc=svc.doc(a,x.document,"COUNTER_ENDORSEMENT");
  req(doc.uploaded_by===actor.id,"COUNTER","Bukti endorsement harus dari Penjamin",403);
  req(typeof x.reference==="string" && x.reference.length>=8 && x.reference.length<=200,
    "COUNTER","Referensi penjamin harus tersedia");
  req(money(x.cover_amount)>=money(targetAmount(r,a)),
    "COUNTER","Nilai endorsement tidak mencakup nilai usulan");
  req(dateOnly(x.cover_until)>=targetExpiry(r,a),"COUNTER",
    "Endorsement berakhir sebelum BG yang diusulkan");
  r.counter_endorsement={actor:actor.id,document:doc.id,digest:doc.digest,
    reference:x.reference,cover_amount:amount(money(x.cover_amount)),
    cover_until:x.cover_until,pkS:partner.pks,at:svc.iso,
    mode:"SANDBOX_REVIEW_ONLY"};
  r.partner_at=svc.iso;
  r.status="PARTNER_ENDORSED";
  return clean(r);
}
export function approveServicing(svc:Service,actor:Data,a:Row,x:Data) {
  const r=item(svc,a,x.servicing_id);
  req(r.status==="PARTNER_ENDORSED","STATE","Review penjamin belum lengkap",409);
  const p=svc.policy(a), requisite=["MPO",...(committee(a.category,targetAmount(r,a),p)?[
    committee(a.category,targetAmount(r,a),p)!]:[])];
  svc.role(actor,requisite);
  req(![a.maker,r.requested_by,r.risk_review?.actor,r.counter_endorsement?.actor].includes(actor.id),
    "SOD","Pembuat/pemeriksa tidak dapat menyetujui sendiri",403);
  projectCheck(svc,a,r);
  req(svc.latest(a,"SLIK").digest===r.risk_review.evidence.SLIK.digest &&
    svc.latest(a,"DHN").digest===r.risk_review.evidence.DHN.digest &&
    svc.latest(a,"LEGAL_CHECK").digest===r.risk_review.evidence.LEGAL_CHECK.digest &&
    svc.latest(a,"MAP_BG").digest===r.risk_review.evidence.MAP_BG.digest,
    "DOCUMENT","Bukti review perubahan telah diganti",409);
  svc.doc(a,r.counter_endorsement.document,"COUNTER_ENDORSEMENT");
  req(r.counter_endorsement.cover_until>=targetExpiry(r,a) &&
    money(r.counter_endorsement.cover_amount)>=money(targetAmount(r,a)) &&
    svc.s.get("partners",a.partner).pks===r.counter_endorsement.pkS,
    "COUNTER","Endorsement penjamin tidak sesuai");
  const prior=svc.s.rows("approvals",{application_id:a.id})
    .filter(k=>k.servicing_id===r.id);
  req(!prior.some(k=>k.role===actor.role),"APPROVAL","Approval peran sudah diberikan",409);
  svc.s.add("approvals",{id:uid(),application_id:a.id,servicing_id:r.id,
    role:actor.role,actor:actor.id,at:svc.iso,
    fingerprint:hash({baseline:r.baseline_fingerprint,proposed:r.proposed,partner:r.counter_endorsement.digest}),
    mode:"SANDBOX"});
  if(!requisite.every(k=>k===actor.role||prior.some(q=>q.role===k)))return clean(r);
  // Reserve only the incremental amount; the original issued BG already consumes limit.
  const delta=money(targetAmount(r,a))-money(a.amount);
  if(delta>0n){
    const existing=svc.s.rows("guarantees")
      .filter(g=>g.status!=="CLOSED" && g.application_id!==a.id)
      .map(g=>svc.s.get("applications",g.application_id));
    const reserved=svc.s.rows("limit_reservations").filter(q=>q.status==="RESERVED");
    const current=(field:string,value:string)=>existing.filter(q=>q[field]===value)
      .reduce((v,q)=>v+money(q.amount),0n)+
      reserved.filter(q=>q[field]===value).reduce((v,q)=>v+money(q.amount),0n);
    req(current("principal",a.principal)+money(a.amount)+delta<=money(p.pks.principal_limit) &&
      current("partner",a.partner)+money(a.amount)+delta<=money(p.pks.partner_limit),
      "LIMIT","Tidak tersedia limit untuk tambahan nilai",409);
    const reservation=svc.s.add("limit_reservations",{
      id:"servicing:"+r.id,application_id:a.id,
      principal:a.principal,partner:a.partner,amount:amount(delta),
      status:"RESERVED",created_at:svc.iso,maker:actor.id,
      mode:"SANDBOX_PRE_ISSUANCE"});
    r.limit_reservation_id=reservation.id;
  }
  r.approved_at=svc.iso;
  r.status="APPROVED_PENDING_ISSUANCE";
  // The original BG, amount, expiry, QR, claim deadline and number are untouched.
  return clean(r);
}
export function rejectServicing(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["COMPLIANCE","LEGAL"]);
  const r=item(svc,a,x.servicing_id);
  req(["PENDING_REVIEW","RISK_REVIEWED","PARTNER_ENDORSED"].includes(r.status),
    "STATE","Servicing yang sudah disetujui perlu pembatalan resmi",409);
  req(r.requested_by!==actor.id,"SOD","Requester tidak boleh menjadi checker",403);
  r.status="REJECTED";r.rejected_by=actor.id;r.rejected_at=svc.iso;
  r.reject_reason=reason(x.reason);
  return clean(r);
}
export function withdrawServicing(svc:Service,actor:Data,a:Row,x:Data) {
  const r=item(svc,a,x.servicing_id);
  req(r.requested_by===actor.id,"FORBIDDEN","Hanya pemohon yang dapat menarik",403);
  req(r.status==="PENDING_REVIEW","STATE","Permohonan sudah diproses",409);
  r.status="WITHDRAWN";r.withdrawn_at=svc.iso;r.withdraw_reason=reason(x.reason);
  return clean(r);
}
export function cancelApprovedServicing(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["LEGAL"]);
  const r=item(svc,a,x.servicing_id);
  req(r.status==="APPROVED_PENDING_ISSUANCE","STATE","Perubahan belum disetujui",409);
  const doc=svc.doc(a,x.document,"CANCELLATION");
  req(r.requested_by!==actor.id && !svc.s.rows("approvals",{application_id:a.id})
    .some(v=>v.servicing_id===r.id&&v.actor===actor.id),
    "SOD","Pembatalan harus independen",403);
  const reservation=r.limit_reservation_id?
    svc.s.get("limit_reservations",r.limit_reservation_id):null;
  if(reservation){
    req(reservation.status==="RESERVED","LIMIT","Reservasi tidak valid",409);
    reservation.status="RELEASED";reservation.released_at=svc.iso;
  }
  r.status="CANCELLED";r.cancelled_at=svc.iso;r.cancelled_by=actor.id;
  r.cancel_document=doc.id;r.cancel_reason=reason(x.reason);
  return clean(r);
}
export function unresolvedServicing(svc:Service,a:Row){
  return svc.s.rows("servicing",{application_id:a.id}).some(r=>UNRESOLVED.includes(r.status));
}
