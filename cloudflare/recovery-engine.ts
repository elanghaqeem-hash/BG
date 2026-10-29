/**
 * Recovery/subrogation evidence workflow for BG sandbox.
 * This is administrative case tracking only. Mock claim/contra payments do NOT
 * establish a bank receivable, assignment of rights, recovered cash, or a legal
 * subrogation. Financial settlement requires a certified external adapter.
 */
import {amount,hash,money,requireValue as req,uid,type Data,type Row} from "./core.ts";
import type {Service} from "./service.ts";

function narrative(value:unknown,label:string){
  req(typeof value==="string" && value.trim().length>=12 && value.length<=2500,
    "RECOVERY",label+" harus berisi alasan atau uraian yang dapat diperiksa");
  return value.trim();
}
function recovery(svc:Service,c:Row){
  req(!!c.recovery_id,"RECOVERY","Kasus pemulihan belum dibuka",409);
  const row=svc.s.get("recovery_cases",c.recovery_id);
  req(row.claim_id===c.id && row.application_id===c.application_id,
    "RECOVERY","Referensi klaim/pemulihan tidak konsisten",409);
  return row;
}
function event(svc:Service,actor:Data,c:Row,kind:string,detail:Data){
  return svc.s.add("recovery_events",{
    id:uid(),application_id:c.application_id,claim_id:c.id,
    recovery_id:c.recovery_id,kind,actor:actor.id,at:svc.iso,
    ...detail,mode:"SANDBOX_EVIDENCE_ONLY",
  });
}
function reviewedActions(svc:Service,c:Row){
  const events=svc.s.rows("recovery_events",{recovery_id:c.recovery_id});
  const actions=events.filter(x=>x.kind==="ACTION_RECORDED");
  const reviews=events.filter(x=>x.kind==="ACTION_REVIEWED");
  return {actions,reviews};
}
export function openRecovery(svc:Service,actor:Data,a:Row,c:Row,x:Data){
  svc.role(actor,["LITIGATION","LEGAL"]);
  req(!!c.bank_paid_at && c.bank_payment?.mode==="MOCK",
    "RECOVERY","Catatan pemulihan hanya dapat dibuat setelah payout simulasi tercatat",409);
  req(["BANK_RECOURSE_ASSESSMENT","SUBROGATION_ASSESSMENT"].includes(x.kind),
    "RECOVERY","Jenis asesmen pemulihan tidak sah");
  if(x.kind==="SUBROGATION_ASSESSMENT")
    req(!!c.contra_payment,"RECOVERY",
      "Penilaian subrogasi mensyaratkan catatan pembayaran kontra; hak hukum belum terbentuk",409);
  const basis=svc.doc(a,x.document,"RECOVERY_BASIS");
  const reason=narrative(x.reason,"Dasar asesmen");
  const current=c.recovery_id?recovery(svc,c):null;
  req(!current||current.status==="RETURNED","RECOVERY",
    "Kasus sudah berjalan dan tidak dapat didaftarkan ulang",409);
  if(current){
    current.revision++;
    current.status="PENDING_LEGAL_REVIEW";
    current.opened_by=actor.id;
    current.opened_at=svc.iso;
    current.kind=x.kind;
    current.basis_document=basis.id;
    current.basis_digest=basis.digest;
    current.reason=reason;
    current.legal_reviewer=null;
    event(svc,actor,c,"CASE_REOPENED",{
      revision:current.revision,basis_document:basis.id,basis_digest:basis.digest,
      assessment_kind:x.kind,reason,
    });
    return current;
  }
  const row=svc.s.add("recovery_cases",{
    id:uid(),application_id:a.id,claim_id:c.id,
    revision:1,status:"PENDING_LEGAL_REVIEW",kind:x.kind,
    claim_amount:c.amount,basis_document:basis.id,basis_digest:basis.digest,
    reason,opened_by:actor.id,opened_at:svc.iso,
    mode:"SANDBOX_EVIDENCE_ONLY",legally_effective:false,
    cash_recovered:"0.00",accounting_posted:false,
  });
  c.recovery_id=row.id;
  event(svc,actor,c,"CASE_OPENED",{
    revision:1,basis_document:basis.id,basis_digest:basis.digest,
    assessment_kind:x.kind,reason,
  });
  return row;
}
export function reviewRecovery(svc:Service,actor:Data,a:Row,c:Row,x:Data){
  svc.role(actor,["LEGAL","COMPLIANCE"]);
  const row=recovery(svc,c);
  req(row.status==="PENDING_LEGAL_REVIEW","RECOVERY","Kasus belum menunggu review",409);
  req(row.opened_by!==actor.id && a.maker!==actor.id,
    "SOD","Pembuat pengajuan tidak dapat memeriksa dirinya sendiri",403);
  const doc=svc.doc(a,row.basis_document,"RECOVERY_BASIS");
  req(doc.digest===row.basis_digest,"DOCUMENT","Dasar pemulihan berubah",409);
  req(typeof x.accepted==="boolean","RECOVERY","Keputusan review wajib boolean");
  const reason=narrative(x.reason,"Catatan pemeriksaan hukum");
  row.status=x.accepted?"TRACKING_ONLY":"RETURNED";
  row.legal_reviewer=actor.id;
  row.legal_reviewed_at=svc.iso;
  row.legal_reason=reason;
  row.review_digest=hash({id:row.id,revision:row.revision,
    basis:row.basis_digest,reviewer:actor.id,accepted:x.accepted,reason});
  event(svc,actor,c,"CASE_REVIEWED",{
    accepted:x.accepted,reason,revision:row.revision,
    review_digest:row.review_digest,
  });
}
export function recordRecoveryAction(svc:Service,actor:Data,a:Row,c:Row,x:Data){
  svc.role(actor,["LITIGATION"]);
  const row=recovery(svc,c);
  req(row.status==="TRACKING_ONLY","RECOVERY","Review hukum belum selesai",409);
  req(["DEMAND","NEGOTIATION","COURT","PAYMENT_EVIDENCE","OTHER"].includes(x.action_type),
    "RECOVERY","Jenis tindak lanjut tidak valid");
  const document=svc.doc(a,x.document,"RECOVERY_ACTION");
  const reason=narrative(x.reason,"Catatan tindak lanjut");
  let reportedAmount:null|string=null;
  if(x.action_type==="PAYMENT_EVIDENCE"){
    req(typeof x.reported_amount==="string" && money(x.reported_amount)>0n &&
      money(x.reported_amount)<=money(c.amount),
      "RECOVERY","Nominal bukti pembayaran harus positif dan tidak melampaui klaim",409);
    reportedAmount=amount(money(x.reported_amount));
  }else req(x.reported_amount===undefined||x.reported_amount===null||
    x.reported_amount==="","RECOVERY","Nominal hanya untuk bukti pembayaran",409);
  event(svc,actor,c,"ACTION_RECORDED",{
    action_type:x.action_type,reason,document:document.id,
    document_digest:document.digest,reported_amount:reportedAmount,
    financial_recognition:false,rights_transferred:false,
  });
}
export function reviewRecoveryAction(svc:Service,actor:Data,a:Row,c:Row,x:Data){
  svc.role(actor,["LEGAL","COMPLIANCE"]);
  const row=recovery(svc,c);
  req(row.status==="TRACKING_ONLY","RECOVERY","Kasus belum dapat diperiksa",409);
  const {actions,reviews}=reviewedActions(svc,c);
  const original=actions.find(action=>action.id===x.action_id);
  req(!!original,"RECOVERY","Tindak lanjut tidak ditemukan",404);
  req(!reviews.some(x=>x.action_id===original.id),"RECOVERY",
    "Tindak lanjut sudah diperiksa",409);
  req(original.actor!==actor.id,"SOD","Pembuat dan reviewer harus berbeda",403);
  const doc=svc.doc(a,original.document,"RECOVERY_ACTION");
  req(doc.digest===original.document_digest,"DOCUMENT",
    "Bukti tindak lanjut sudah berubah",409);
  req(typeof x.accepted==="boolean","RECOVERY","Keputusan wajib boolean");
  event(svc,actor,c,"ACTION_REVIEWED",{
    action_id:original.id,accepted:x.accepted,
    reason:narrative(x.reason,"Hasil pemeriksaan"),
    document_digest:original.document_digest,
    no_cash_posting:true,
  });
}
export function requestRecoveryClosure(svc:Service,actor:Data,a:Row,c:Row,x:Data){
  svc.role(actor,["LITIGATION"]);
  const row=recovery(svc,c);
  req(row.status==="TRACKING_ONLY","RECOVERY","Status kasus belum dapat ditutup",409);
  const {actions,reviews}=reviewedActions(svc,c);
  req(actions.length>0 && actions.every(act=>reviews.some(r=>r.action_id===act.id)) &&
    reviews.some(review=>review.accepted===true),
    "RECOVERY","Seluruh tindak lanjut harus direview dan minimal satu disetujui",409);
  const document=svc.doc(a,x.document,"RECOVERY_RESOLUTION");
  row.closure_document=document.id;
  row.closure_digest=document.digest;
  row.closure_reason=narrative(x.reason,"Rencana penutupan administratif");
  row.closure_maker=actor.id;
  row.status="CLOSURE_PENDING";
  event(svc,actor,c,"CLOSURE_REQUESTED",{
    document:document.id,document_digest:document.digest,
    reason:row.closure_reason,financial_settlement:false,
  });
}
export function confirmRecoveryClosure(svc:Service,actor:Data,a:Row,c:Row,x:Data){
  svc.role(actor,["LEGAL","COMPLIANCE"]);
  const row=recovery(svc,c);
  req(row.status==="CLOSURE_PENDING","RECOVERY","Tidak ada penutupan yang menunggu",409);
  req(row.closure_maker!==actor.id && row.opened_by!==actor.id,
    "SOD","Maker tidak boleh menutup kasus sendiri",403);
  const doc=svc.doc(a,row.closure_document,"RECOVERY_RESOLUTION");
  req(doc.digest===row.closure_digest,"DOCUMENT","Bukti penutupan tidak valid",409);
  req(x.accepted===true||x.accepted===false,"RECOVERY","Keputusan wajib boolean");
  const reason=narrative(x.reason,"Hasil review penutupan");
  row.status=x.accepted?"CLOSED_TRACKING_ONLY":"TRACKING_ONLY";
  row.closed_at=x.accepted?svc.iso:null;
  row.closure_checker=actor.id;
  event(svc,actor,c,"CLOSURE_REVIEWED",{
    accepted:x.accepted,reason,document_digest:doc.digest,
    account_reconciled:false,legally_effective:false,
  });
}
export function recoverySnapshot(svc:Service,actor:Data,a:Row,c:Row){
  svc.role(actor,["ANALYST","MPO","SUPPORT","MPO_KPO","KADEP_SUPPORT",
    "FINANCE","LEGAL","LITIGATION","COMPLIANCE","AUDIT","GH_BISNIS",
    "DIREKSI","ADMIN"]);
  svc.access(actor,a);
  req(c.application_id===a.id,"NOT_FOUND","Klaim berbeda transaksi",404);
  const row=c.recovery_id?recovery(svc,c):null;
  return {application_id:a.id,claim_id:c.id,
    current:row||null,
    events:row?svc.s.rows("recovery_events",{recovery_id:row.id})
      .sort((x,y)=>x.at.localeCompare(y.at)||x.id.localeCompare(y.id)):[],
    mode:"SANDBOX_EVIDENCE_ONLY",
    accounting_posted:false,legal_rights_verified:false,
    mock_payment_is_not_cash:true};
}
