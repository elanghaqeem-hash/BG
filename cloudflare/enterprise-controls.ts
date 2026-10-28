/** Phase 1 enterprise controls: sandbox-only, no external settlement or issuance. */
import {
  amount, dateOnly, hash, jakartaDate, money, predicate, requireValue as req, timestamp, uid,
  type Data, type Row,
} from "./core.ts";
import type { Service } from "./service.ts";
import {unresolvedServicing} from "./servicing-engine.ts";
import {checkedVisit, currentVisit} from "./visit-reports.ts";
import {checkedStandardAnalysis} from "./standard-analysis.ts";

const fiveC = ["character", "capacity", "capital", "collateral", "condition"] as const;

function note(value: unknown, field: string) {
  req(typeof value === "string" && value.trim().length >= 8 && value.length <= 4000,
    "UNDERWRITING", field + " harus berisi uraian yang dapat diverifikasi");
  return value.trim();
}
function ratio(n: bigint, d: bigint): string | null {
  if (d === 0n) return null;
  const scaled = (n * 100n + d / 2n) / d;
  return (scaled / 100n).toString() + "." + (scaled % 100n).toString().padStart(2, "0");
}
export function policySimulation(svc: Service, actor: Data, policyId: string, facts: Data, codes?: string[]) {
  svc.role(actor, ["ADMIN", "CONFIG_CHECKER", "COMPLIANCE", "ANALYST", "AUDIT"]);
  req(facts && typeof facts === "object" && !Array.isArray(facts), "POLICY", "Facts tidak valid");
  req(Object.keys(facts).length <= 80, "POLICY", "Terlalu banyak fakta");
  const row = svc.s.get("policies", policyId), p = row.configuration;
  const keys = codes || Object.keys(p.rules);
  req(Array.isArray(keys) && keys.length <= 50 &&
    keys.every(k => typeof k === "string" && Object.hasOwn(p.rules,k)),
    "POLICY", "Daftar aturan tidak valid");
  const results = keys.map(code => {
    const rule = p.rules[code];
    const applicable = !rule.when || predicate(rule.when, facts);
    return {
      code, source: rule.source || null, applicable,
      passed: applicable ? predicate(rule.assert, facts) : true,
      message: rule.message,
    };
  });
  svc.audit(actor, "PolicyDryRun", policyId, {
    version: row.version, policy_hash: hash(p), facts_hash: hash(facts),
    results_hash: hash(results), financial_effect: false,
  });
  return { policy_id: policyId, version: row.version, status: row.status,
    simulation_only: true, policy_hash: hash(p), passed: results.every(r => r.passed), results };
}
export function recordFiveC(svc: Service, actor: Data, a: Row, x: Data) {
  svc.role(actor, ["ANALYST"]);
  svc.state(a, "SP2KBG_ISSUED");
  const visit=checkedVisit(svc,a);
  const standard=checkedStandardAnalysis(svc,a);
  req(x.five_c && typeof x.five_c === "object" && !Array.isArray(x.five_c),
    "UNDERWRITING", "Kelima aspek 5C wajib diisi");
  req(Object.keys(x.five_c).sort().join(",") === [...fiveC].sort().join(","),
    "UNDERWRITING", "Character, Capacity, Capital, Collateral, Condition wajib lengkap");
  const assessments = Object.fromEntries(fiveC.map(k => {
    const v = x.five_c[k];
    req(v && ["LOW","MODERATE","HIGH"].includes(v.risk),
      "UNDERWRITING", "Rating risiko " + k + " tidak valid");
    return [k, {risk: v.risk, finding: note(v.finding,k), mitigation: note(v.mitigation,k)}];
  }));
  req(["LAYAK","TIDAK_LAYAK","PERLU_PERBAIKAN"].includes(x.recommendation),
    "UNDERWRITING", "Rekomendasi tidak valid");
  const evidence = svc.doc(a, x.financial_document, "LAPORAN_KEUANGAN");
  const metrics = x.financials || {};
  req(Object.keys(metrics).sort().join(",") ===
    ["current_assets","current_liabilities","equity","total_debt"].sort().join(","),
    "UNDERWRITING", "Data finansial tidak lengkap");
  const fin = Object.fromEntries(Object.entries(metrics).map(([k,v]) => [k, amount(money(v))]));
  const ca = money(fin.current_assets), cl = money(fin.current_liabilities);
  const debt = money(fin.total_debt), eq = money(fin.equity);
  const old = a.underwriting_id ? svc.s.get("underwritings",a.underwriting_id) : null;
  const row = svc.s.add("underwritings",{
    id:uid(), application_id:a.id, revision:(old?.revision || 0) + 1,
    state:"PENDING_REVIEW", analyst:actor.id, created_at:svc.iso,
    application_fingerprint:svc.fingerprint(a),
    visit_id:visit?.id||null,
    visit_review_digest:visit?.review_digest||null,
    standard_analysis_id:standard?.id||null,
    standard_analysis_digest:standard?.review_digest||null,
    evidence_document:evidence.id, evidence_hash:evidence.digest,
    five_c:assessments, financials:fin,
    ratios:{current_ratio:ratio(ca,cl),debt_to_equity:ratio(debt,eq),
      net_working_capital:(ca < cl ? "-" : "") + amount(ca < cl ? cl-ca : ca-cl),
      nwc_negative:ca < cl},
    recommendation:x.recommendation,
    narrative:note(x.narrative,"Kesimpulan analis"),
    methodology:"HUMAN_REVIEW_REQUIRED",
  });
  a.underwriting_id = row.id;
  return row;
}
export function reviewFiveC(svc: Service, actor: Data, a: Row, x: Data) {
  svc.role(actor, ["MPO","COMPLIANCE"]);
  svc.state(a, "SP2KBG_ISSUED");
  const r = svc.s.get("underwritings",a.underwriting_id || "");
  req(r.application_id===a.id && r.state==="PENDING_REVIEW", "UNDERWRITING", "Analisa tidak dapat direview");
  req(r.analyst!==actor.id && a.maker!==actor.id, "SOD", "Maker tidak boleh mereview sendiri", 403);
  req(r.application_fingerprint===svc.fingerprint(a), "VERSION", "Data material telah berubah", 409);
  const currentFinancial=svc.doc(a,r.evidence_document,"LAPORAN_KEUANGAN");
  req(currentFinancial.digest===r.evidence_hash,"DOCUMENT",
    "Bukti keuangan 5C telah berubah; analisis ulang diperlukan",409);
  const latestVisit=currentVisit(svc,a);
  req((r.visit_id||null)===(latestVisit?.id||null),"VISIT",
    "LKN berubah; analisis 5C harus diperbarui",409);
  if(latestVisit)req(checkedVisit(svc,a)?.review_digest===r.visit_review_digest,
    "VISIT","Dokumen hasil kunjungan tidak konsisten",409);
  const latestForm=checkedStandardAnalysis(svc,a);
  req((r.standard_analysis_id||null)===(latestForm?.id||null) &&
    (r.standard_analysis_digest||null)===(latestForm?.review_digest||null),
    "STANDARD_ANALYSIS","Formulir analisa berubah; 5C harus disusun ulang",409);
  req(x.accepted===true || x.accepted===false, "UNDERWRITING", "Keputusan review wajib diisi");
  r.state=x.accepted ? "REVIEWED" : "RETURNED";
  r.checker=actor.id;
  r.reviewed_at=svc.iso;
  r.review_note=note(x.reason,"Alasan review");
  return {id:r.id,state:r.state,checker:r.checker};
}
export function counterReview(svc: Service, actor: Data, a: Row, x: Data) {
  svc.role(actor, ["COMPLIANCE"]);
  svc.state(a, "SP2KBG_ISSUED");
  req(["CAC","CBC"].includes(x.scheme), "COUNTER", "Skema harus CAC atau CBC");
  const p = svc.policy(a), partner = svc.s.get("partners",a.partner);
  req(partner.active && !!partner.pks, "COUNTER", "PKS/penjamin tidak aktif");
  req(a.sp2 && a.sp2.fingerprint===svc.fingerprint(a) &&
    money(a.sp2.amount)>=money(a.amount) &&
    dateOnly(a.sp2.valid_to)>=jakartaDate(svc.now),
    "COUNTER","SP2KBG tidak sesuai transaksi atau telah berakhir");
  const document = svc.doc(a,x.pks_document,"PKS");
  req(typeof x.pks_reference==="string" && x.pks_reference===partner.pks,
    "COUNTER", "Referensi PKS tidak sesuai master penjamin");
  req(p.pks.coverage && money(p.pks.coverage)>0n, "COUNTER","Coverage policy tidak valid");
  a.counter_review={scheme:x.scheme,reviewed_by:actor.id,at:svc.iso,
    pks_reference:x.pks_reference,pks_document:document.id,
    document_hash:document.digest,application_fingerprint:svc.fingerprint(a),
    status:"VERIFIED_SANDBOX"};
  return a.counter_review;
}
export function registerCollateral(svc: Service, actor: Data, a: Row, x: Data) {
  svc.role(actor,["ANALYST","MPO"]);
  svc.state(a,"APPROVAL_GRANTED","MKP_SIGNED","AKAD_SIGNED","FEE_COLLECTED","INTER_OFFICE_ISSUANCE");
  req(["CASH","FIXED_ASSET","COUNTER_BG"].includes(x.type),"COLLATERAL","Jenis agunan tidak valid");
  const evidence=svc.doc(a,x.document,"COLLATERAL");
  req(money(x.value)>0n,"COLLATERAL","Nilai agunan harus positif");
  const row=svc.s.add("collaterals",{id:uid(),application_id:a.id,type:x.type,
    value:amount(money(x.value)),currency:"IDR",
    document:evidence.id,document_hash:evidence.digest,
    binding_reference:note(x.binding_reference,"Referensi pengikatan"),
    state:"PENDING_VERIFICATION",maker:actor.id,created_at:svc.iso,
    application_fingerprint:svc.fingerprint(a)});
  return row;
}
export function approveCollateral(svc: Service,actor: Data,a:Row,x:Data) {
  svc.role(actor,["COMPLIANCE","LEGAL"]);
  svc.state(a,"APPROVAL_GRANTED","MKP_SIGNED","AKAD_SIGNED","FEE_COLLECTED","INTER_OFFICE_ISSUANCE");
  const row=svc.s.get("collaterals",x.collateral_id);
  req(row.application_id===a.id,"NOT_FOUND","Agunan tidak ditemukan",404);
  req(row.state==="PENDING_VERIFICATION","COLLATERAL","Agunan bukan menunggu verifikasi",409);
  req(row.maker!==actor.id && a.maker!==actor.id,"SOD","Maker tidak dapat verifikasi agunan",403);
  req(row.application_fingerprint===svc.fingerprint(a),"VERSION","Data transaksi telah berubah",409);
  row.state=x.accepted===true?"VERIFIED":"REJECTED";
  req(typeof x.accepted==="boolean","COLLATERAL","Keputusan harus boolean");
  row.checked_by=actor.id;row.checked_at=svc.iso;
  row.reason=note(x.reason,"Alasan verifikasi");
  return {id:row.id,state:row.state};
}
export function capacity(svc:Service,a:Row) {
  const issued=svc.s.rows("guarantees")
    .filter(g=>g.status!=="CLOSED" && g.application_id!==a.id)
    .map(g=>svc.s.get("applications",g.application_id));
  const reserved=svc.s.rows("limit_reservations")
    .filter(r=>r.status==="RESERVED" && r.application_id!==a.id);
  const sum=(field:string,value:string)=>
    issued.filter(r=>r[field]===value).reduce((acc,r)=>acc+money(r.amount),0n)+
    reserved.filter(r=>r[field]===value).reduce((acc,r)=>acc+money(r.amount),0n);
  return {principal:sum("principal",a.principal),partner:sum("partner",a.partner)};
}
export function reserveCapacity(svc:Service,actor:Data,a:Row) {
  svc.role(actor,["MPO","MPO_KPO"]);
  svc.state(a,"APPROVAL_GRANTED","MKP_SIGNED","AKAD_SIGNED","FEE_COLLECTED","INTER_OFFICE_ISSUANCE");
  req(!svc.s.maybe("guarantees",a.id),"LIMIT","BG sudah diterbitkan",409);
  const previous=svc.s.maybe("limit_reservations",a.id);
  req(!previous,"LIMIT","Reservasi sudah pernah dibuat",409);
  const existing=capacity(svc,a), p=svc.policy(a);
  req(existing.principal+money(a.amount)<=money(p.pks.principal_limit) &&
      existing.partner+money(a.amount)<=money(p.pks.partner_limit),
    "LIMIT","Kapasitas Principal atau Penjamin tidak cukup");
  const row=svc.s.add("limit_reservations",{
    id:a.id,application_id:a.id,principal:a.principal,partner:a.partner,
    amount:a.amount,status:"RESERVED",created_at:svc.iso,
    maker:actor.id,application_fingerprint:svc.fingerprint(a)});
  a.limit_reservation_id=row.id;
  return row;
}
export function requestServicing(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["PRINCIPAL","MPO","SUPPORT"]);
  svc.state(a,"ACTIVE");
  req(["AMENDMENT","EXTENSION"].includes(x.kind),"SERVICING","Jenis perubahan tidak valid");
  const doc=svc.doc(a,x.document,"AMENDMENT_REQUEST");
  req(!unresolvedServicing(svc,a),"SERVICING","Perubahan sebelumnya belum diselesaikan",409);
  const proposed:Data={};
  if(x.proposed_amount!==undefined){
    req(money(x.proposed_amount)>0n,"SERVICING","Nominal harus positif");
    proposed.amount=amount(money(x.proposed_amount));
  }
  if(x.proposed_expiry!==undefined) proposed.expires_on=dateOnly(x.proposed_expiry);
  req(Object.keys(proposed).length>0,"SERVICING","Perubahan harus memiliki detail");
  req((proposed.amount??a.amount)!==a.amount || (proposed.expires_on??a.expires_on)!==a.expires_on,
    "SERVICING","Tidak terdapat perubahan material",409);
  if(proposed.expires_on) req(proposed.expires_on>=a.expires_on,"SERVICING","Perpanjangan tidak boleh memperpendek masa berlaku");
  const item=svc.s.add("servicing",{id:uid(),application_id:a.id,
    kind:x.kind,document:doc.id,document_hash:doc.digest,
    proposed,status:"PENDING_REVIEW",requested_by:actor.id,
    requested_at:svc.iso,reason:note(x.reason,"Alasan perubahan"),
    baseline_fingerprint:svc.fingerprint(a),baseline_bg_number:a.bg_number,
    baseline_document_ids:Object.fromEntries(["SLIK","DHN","LEGAL_CHECK","MAP_BG"].map(k=>{
      const existing=svc.docs(a).filter(d=>d.kind===k)
        .sort((x,y)=>(y.revision||0)-(x.revision||0));
      return [k,existing[0]?.id||null];
    }))});
  return item;
}
export function requestClosure(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["MPO","SUPPORT"]);
  svc.state(a,"ACTIVE");
  const g=svc.s.get("guarantees",a.id);
  req(timestamp(g.claim_deadline)<svc.now,"CLOSURE","Masa pengajuan klaim belum berakhir",409);
  req(!svc.s.rows("claims",{application_id:a.id}).some(c=>c.state!=="WITHDRAWN" || c.bank_paid_at),
    "CLOSURE","Masih terdapat klaim atau kewajiban belum selesai",409);
  req(!unresolvedServicing(svc,a),
    "CLOSURE","Terdapat perubahan BG yang belum diselesaikan",409);
  svc.doc(a,x.document,"RELEASE");
  req(!a.closure_request,"CLOSURE","Penutupan sudah diajukan",409);
  a.closure_request={maker:actor.id,at:svc.iso,document:x.document,baseline:svc.fingerprint(a)};
  return a.closure_request;
}
export function confirmClosure(svc:Service,actor:Data,a:Row) {
  svc.role(actor,["LEGAL","COMPLIANCE"]);
  svc.state(a,"ACTIVE");
  const request=a.closure_request, g=svc.s.get("guarantees",a.id);
  req(request && request.maker!==actor.id,"SOD","Penutupan memerlukan checker berbeda",403);
  req(request.baseline===svc.fingerprint(a),"VERSION","Data material berubah",409);
  svc.doc(a,request.document,"RELEASE");
  req(timestamp(g.claim_deadline)<svc.now,"CLOSURE","Periode klaim masih berjalan",409);
  req(!svc.s.rows("claims",{application_id:a.id}).some(c=>c.state!=="WITHDRAWN" || c.bank_paid_at),
    "CLOSURE","Klaim masih terbuka",409);
  req(!unresolvedServicing(svc,a),
    "CLOSURE","Perubahan BG belum selesai",409);
  g.status="CLOSED";g.closed_at=svc.iso;g.closed_by=actor.id;
  const reservation=svc.s.maybe("limit_reservations",a.id);
  if(reservation) reservation.status="RELEASED";
  a.state="CLOSED";a.closed_at=svc.iso;
  svc.post(actor,a,"closure:"+a.id,a.amount,"OFF_BALANCE_CONTRA","OFF_BALANCE_BG");
  return {state:a.state,closed_at:a.closed_at};
}
export function enterpriseSnapshot(svc:Service,actor:Data,a:Row) {
  svc.access(actor,a);
  req(["ADMIN","AUDIT","ANALYST","COMPLIANCE","MPO","LEGAL","MPO_KPO","SUPPORT","FINANCE"].includes(actor.role),
    "FORBIDDEN","Akses enterprise controls terbatas pada petugas berwenang",403);
  return {application_id:a.id,policy_id:a.policy_id,
    underwriting:a.underwriting_id?svc.s.get("underwritings",a.underwriting_id):null,
    counter_review:a.counter_review||null,
    collateral:svc.s.rows("collaterals",{application_id:a.id}),
    limit_reservation:svc.s.maybe("limit_reservations",a.id)||null,
    servicing:svc.s.rows("servicing",{application_id:a.id}),
    closure:a.closure_request||null};
}
