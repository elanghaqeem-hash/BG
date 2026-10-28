/**
 * Lampiran 5 — Formulir Standar Analisa (Bank Garansi - Kontra Bank Garansi).
 * Source headings and values are preserved; categorical thresholds in source
 * are descriptive only, not approved credit score or automatic underwriting.
 */
import {amount,dateOnly,hash,jakartaDate,money,requireValue as req,uid,type Data,type Row} from "./core.ts";
import type {Service} from "./service.ts";
import {checkedVisit} from "./visit-reports.ts";
const owners=["PEMERINTAH_PUSAT","PEMERINTAH_DAERAH","SWASTA","LAINNYA"];
const types=["KONSTRUKSI","PENGADAAN_BARANG","LAINNYA"];
const guarantees=["CASH_TUNAI","KONTRA_BANK_GARANSI","LAINNYA"];
function str(v:unknown,name:string,min=2,max=500):string {
  req(typeof v==="string" && v.trim().length>=min && v.length<=max,
    "STANDARD_ANALYSIS",name+" wajib diisi sesuai formulir Lampiran 5");
  return v.trim();
}
function obj(v:unknown,name:string,keys:string[]) {
  req(v!==null && typeof v==="object" && !Array.isArray(v) &&
    Object.keys(v).every(k=>keys.includes(k)) &&
    keys.every(k=>Object.hasOwn(v,k)),"STANDARD_ANALYSIS",
    "Struktur "+name+" tidak lengkap atau berisi field asing");
}
function num(v:unknown,name:string,max=1000000) {
  req((typeof v==="number"||typeof v==="string")&&String(v).trim()!=="" &&
    /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) &&
    Number(v)<=max,"STANDARD_ANALYSIS",name+" harus bilangan bulat nonnegatif");
  return Number(v);
}
function signed(value:unknown){
  req(typeof value==="string" && /^-?(0|[1-9]\d{0,19})(\.\d{1,2})?$/.test(value),
    "STANDARD_ANALYSIS","Laba/rugi harus nominal IDR; boleh negatif");
  const negative=value.startsWith("-");
  const absolute=amount(money(negative?value.slice(1):value));
  return negative && absolute!=="0.00"?"-"+absolute:absolute;
}
export function checkedStandardAnalysis(svc:Service,a:Row):Row|null {
  if(!a.standard_analysis_id)return null; // legacy sandbox compatibility
  const row=svc.s.get("standard_analyses",a.standard_analysis_id);
  req(row.application_id===a.id && row.status==="REVIEWED" &&
    row.application_fingerprint===svc.fingerprint(a),
    "STANDARD_ANALYSIS","Formulir Standar Analisa terbaru belum disetujui",409);
  const fin=svc.doc(a,row.financial_document,"LAPORAN_KEUANGAN");
  const project=svc.doc(a,row.project_document,"CONTRACT");
  const slik=svc.doc(a,row.slik_document,"SLIK");
  req(fin.digest===row.financial_digest &&
    project.digest===row.project_digest &&
    slik.digest===row.slik_digest,"DOCUMENT","Dokumen analisa telah diganti",409);
  req((checkedVisit(svc,a)?.id||null)===(row.visit_id||null),
    "VISIT","LKN berubah setelah analisis standar disetujui",409);
  return row;
}
export function recordStandardAnalysis(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["AO"]);
  svc.access(actor,a);
  svc.state(a,"SP2KBG_ISSUED");
  const current=a.standard_analysis_id?svc.s.get("standard_analyses",a.standard_analysis_id):null;
  req(!current||["REVIEWED","RETURNED"].includes(current.status),
    "STANDARD_ANALYSIS","Formulir sebelumnya masih menunggu review",409);
  obj(x,"formulir",["checklist_complete","owner","owner_other","project_type",
    "project_type_other","project_value","funding_source","funding_other",
    "project_document","contract_reference","contract_date","completion_months",
    "guarantee_amount","guarantee_type","guarantee_other",
    "customer_relationship","business_years","management","slik_document",
    "slik_comment","projects_completed","projects_last_year",
    "last_year_project_value","business_condition","profit_history",
    "financial_document","bank_support","bank_support_details",
    "additional_collateral","collateral_type_other","recommendation","reason"]);
  const visit=checkedVisit(svc,a);
  req(typeof x.checklist_complete==="boolean","STANDARD_ANALYSIS",
    "Status kelengkapan checklist harus dinyatakan, bukan diasumsikan");
  req(owners.includes(x.owner)&&types.includes(x.project_type)&&
    guarantees.includes(x.guarantee_type),
    "STANDARD_ANALYSIS","Kategori proyek/jenis jaminan tidak sesuai sumber");
  req(["APBN_APBD","LAINNYA"].includes(x.funding_source),
    "STANDARD_ANALYSIS","Sumber pembiayaan tidak sah");
  req(["DEBITUR_BARU","DEBITUR_EKSIS"].includes(x.customer_relationship),
    "STANDARD_ANALYSIS","Klasifikasi Principal tidak sah");
  req(["ADA","TIDAK_ADA"].includes(x.bank_support),
    "STANDARD_ANALYSIS","Dukungan bank wajib dipilih");
  req(["LAYAK","TIDAK_LAYAK"].includes(x.recommendation),
    "STANDARD_ANALYSIS","Usulan harus Layak atau Tidak Layak");
  const project=svc.doc(a,x.project_document,"CONTRACT");
  const financial=svc.doc(a,x.financial_document,"LAPORAN_KEUANGAN");
  const slik=svc.doc(a,x.slik_document,"SLIK");
  const proposed=amount(money(x.guarantee_amount));
  req(proposed===a.amount,"STANDARD_ANALYSIS",
    "Nilai Pengujian Bank Garansi harus konsisten dengan permohonan",409);
  const sourceDate=dateOnly(x.contract_date);
  req(sourceDate<=jakartaDate(svc.now),"STANDARD_ANALYSIS",
    "Tanggal dokumen pokok di masa depan");
  req(Array.isArray(x.profit_history) &&
    x.profit_history.length>=2 && x.profit_history.length<=3,
    "STANDARD_ANALYSIS",
    "Formulir menyebut 2 tahun laba namun memuat 3 baris; terima 2 atau 3 periode");
  const profits=x.profit_history.map((p:Data)=>{
    obj(p,"laba periodik",["year","profit"]);
    const year=num(p.year,"Tahun",2100);
    req(year>=1900 && year<=Number(jakartaDate(svc.now).slice(0,4)),
      "STANDARD_ANALYSIS","Tahun laba tidak valid");
    return {year,profit:signed(p.profit)};
  });
  req(new Set(profits.map(p=>p.year)).size===profits.length,
    "STANDARD_ANALYSIS","Tahun laba harus berbeda");
  const orderedYears=profits.map(p=>p.year).sort((a,b)=>b-a);
  req(orderedYears.every((year,i)=>i===0||orderedYears[i-1]-year===1),
    "STANDARD_ANALYSIS","Riwayat laba harus berupa tahun berurutan",409);
  req(orderedYears[0]>=Number(jakartaDate(svc.now).slice(0,4))-3,
    "STANDARD_ANALYSIS","Periode laba terakhir terlalu lama untuk analisis berjalan",409);
  req(typeof x.additional_collateral==="string","STANDARD_ANALYSIS",
    "Nilai agunan tambahan wajib dinyatakan (nol jika tidak ada)");
  const extraCollateral=amount(money(x.additional_collateral));
  const businessYears=num(x.business_years,"Pengalaman usaha",300);
  const completed=num(x.projects_completed,"Proyek selesai",1000000);
  const lastYearCount=num(x.projects_last_year,"Proyek tahun terakhir",1000000);
  req(lastYearCount<=completed,"STANDARD_ANALYSIS",
    "Jumlah proyek tahun lalu tidak boleh melebihi total proyek selesai");
  const knownCurrency=amount(money(x.project_value));
  const valueYear=amount(money(x.last_year_project_value));
  const support=x.bank_support==="ADA"?str(x.bank_support_details,"Bentuk dukungan bank",8,500):"";
  const result=svc.s.add("standard_analyses",{
    id:uid(),application_id:a.id,revision:(current?.revision||0)+1,
    previous_id:current?.id||null,
    maker:actor.id,created_at:svc.iso,status:"PENDING_REVIEW",
    application_fingerprint:svc.fingerprint(a),visit_id:visit?.id||null,
    checklist_complete:x.checklist_complete,
    project:{owner:x.owner,owner_other:x.owner==="LAINNYA"?str(x.owner_other,"Pemilik lainnya"):null,
      type:x.project_type,type_other:x.project_type==="LAINNYA"?str(x.project_type_other,"Jenis lain"):null,
      value:knownCurrency,
      funding:x.funding_source,funding_other:x.funding_source==="LAINNYA"?str(x.funding_other,"Sumber lain"):null,
      contract_reference:str(x.contract_reference,"Nomor dokumen",5,200),contract_date:sourceDate,
      completion_months:num(x.completion_months,"Lama pekerjaan (bulan)",1200),
      guarantee_amount:proposed,amount_exceeds_project:money(proposed)>money(knownCurrency),
      guarantee_type:x.guarantee_type,
      guarantee_other:x.guarantee_type==="LAINNYA"?str(x.guarantee_other,"Jenis jaminan lainnya"):null},
    character:{principal:x.customer_relationship,business_years:businessYears,
      management:str(x.management,"Susunan pengurus/manajemen",8,2000),
      slik_comment:str(x.slik_comment,"Hasil BI Checking / SLIK",8,2000)},
    condition:{projects_completed:completed,projects_last_year:lastYearCount,
      last_year_project_value:valueYear,
      business_condition:str(x.business_condition,"Kondisi usaha",8,2000)},
    capacity:{profit_history:profits},
    capital:{bank_support:x.bank_support,bank_support_details:support,
      der_source:"CALCULATED_IN_FIVE_C",nwc_source:"CALCULATED_IN_FIVE_C"},
    collateral:{type:x.guarantee_type,other:x.guarantee_type==="LAINNYA"?
      str(x.collateral_type_other||x.guarantee_other,"Jenis agunan lain"):null,
      additional_value:extraCollateral},
    recommendation:x.recommendation,
    reason:str(x.reason,"Kesimpulan RM",15,4000),
    financial_document:financial.id,financial_digest:financial.digest,
    project_document:project.id,project_digest:project.digest,
    slik_document:slik.id,slik_digest:slik.digest,
    source:"Lampiran 5 Formulir Standar Analisa (BG-KBG) — pilihan sumber, bukan risk score",
    source_boundary:{experience_exactly_3:"UNDEFINED_IN_FORM",
      completed_exactly_5:"UNDEFINED_IN_FORM",value_exactly_5b:"UNDEFINED_IN_FORM",
      profit_years:"HEADING_2_ROWS_3",der_nwc:"COMPUTED_FROM_5C_FINANCIALS"},
    mode:"SANDBOX_ONLY",
  });
  a.standard_analysis_id=result.id;
  return {id:result.id,status:result.status,revision:result.revision};
}
export function reviewStandardAnalysis(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["MPO","COMPLIANCE"]);
  svc.access(actor,a);
  svc.state(a,"SP2KBG_ISSUED");
  const row=svc.s.get("standard_analyses",a.standard_analysis_id||"");
  req(row.application_id===a.id&&row.status==="PENDING_REVIEW",
    "STANDARD_ANALYSIS","Formulir bukan dalam antrean review",409);
  req(row.maker!==actor.id&&a.maker!==actor.id,
    "SOD","Pemeriksa tidak boleh maker transaksi/formulir",403);
  req(row.application_fingerprint===svc.fingerprint(a),
    "VERSION","Data material telah berubah",409);
  for(const [kind,id,digest] of [
    ["CONTRACT",row.project_document,row.project_digest],
    ["LAPORAN_KEUANGAN",row.financial_document,row.financial_digest],
    ["SLIK",row.slik_document,row.slik_digest],
  ]){
    const verified=svc.doc(a,id,kind);
    req(verified.digest===digest,"DOCUMENT","Bukti analisa tidak konsisten",409);
  }
  req((checkedVisit(svc,a)?.id||null)===(row.visit_id||null),
    "VISIT","LKN telah berubah",409);
  req(typeof x.accepted==="boolean","STANDARD_ANALYSIS","Keputusan wajib boolean");
  if(x.accepted)req(row.checklist_complete===true,"STANDARD_ANALYSIS",
    "Checker tidak dapat menyetujui formulir dengan checklist tidak lengkap");
  const reviewNote=str(x.reason,"Alasan review",8,2000);
  row.status=x.accepted?"REVIEWED":"RETURNED";
  row.reviewer=actor.id;row.reviewed_at=svc.iso;row.review_reason=reviewNote;
  row.review_digest=hash({id:row.id,financial:row.financial_digest,
    contract:row.project_digest,slik:row.slik_digest,visit:row.visit_id,
    checker:actor.id,accepted:x.accepted,reason:reviewNote});
  return {id:row.id,status:row.status,revision:row.revision};
}
export function standardAnalysisSnapshot(svc:Service,actor:Data,a:Row){
  svc.role(actor,["AO","ANALYST","MPO","COMPLIANCE","LEGAL","AUDIT","ADMIN",
    "SUPPORT","FINANCE","GH_BISNIS","DIREKSI"]);
  svc.access(actor,a);
  const row=a.standard_analysis_id?svc.s.get("standard_analyses",a.standard_analysis_id):null;
  return {current:row||null,application_id:a.id,
    history:svc.s.rows("standard_analyses",{application_id:a.id})
      .sort((x,y)=>y.revision-x.revision)
      .map(r=>({id:r.id,status:r.status,revision:r.revision,created_at:r.created_at})),
    risk_score_automated:false,
    source:"Lampiran 5 Formulir Standar Analisa Bank Garansi - Kontra Bank Garansi"};
}
