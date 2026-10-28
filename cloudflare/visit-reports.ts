/**
 * Digital LKN-BG, source: Lampiran 4 - Laporan Kunjungan Nasabah BG.
 * Conditional visit report: source checklist allows alternative verification.
 * PDF evidence is a reviewed scan/photo bundle, not a trusted geolocation,
 * face match, e-signature or proof of actual on-site attendance.
 */
import {hash, requireValue as req, timestamp, uid, type Data, type Row} from "./core.ts";
import type {Service} from "./service.ts";

const PRE_UNDERWRITE=["DRAFT","KYC_KYB_CHECK","SLIK_CHECK","PENJAMIN_REQUESTED",
  "PENJAMIN_UNDERWRITING","SP2KBG_ISSUED"];
const ENVIRONMENTS=[
  "PERUMAHAN_REAL_ESTATE","PERKANTORAN","PERKAMPUNGAN_UMUM","KOMERSIAL_BISNIS",
] as const;
const PHOTO_CATEGORIES=[
  "TAMPAK_MUKA","TAMPAK_DALAM","LINGKUNGAN_SEKITAR","PERSEDIAAN",
  "MESIN_PERALATAN","NASABAH_DAN_RM",
] as const;
function label(v:unknown,field:string,min=1,max=300):string {
  req(typeof v==="string" && v.trim().length>=min && v.length<=max,
    "VISIT","Isian "+field+" tidak lengkap");
  return v.trim();
}
function exact(obj:unknown,keys:string[],name:string) {
  req(obj!==null && typeof obj==="object" && !Array.isArray(obj) &&
    Object.keys(obj).every(k=>keys.includes(k)),"VISIT",
    "Struktur "+name+" memuat field yang tidak dikenali");
}
export function recordVisit(svc:Service,actor:Data,a:Row,x:Data) {
  svc.role(actor,["AO"]);
  svc.access(actor,a);
  svc.state(a,...PRE_UNDERWRITE);
  const old=a.visit_id?svc.s.get("visits",a.visit_id):null;
  req(!old || ["REVIEWED","RETURNED"].includes(old.status),"VISIT",
    "LKN sebelumnya masih menunggu pemeriksaan",409);
  exact(x,["visited_at","customer_type","request_type","referral","location",
    "environment","facilities_within_1km","notes","photo_categories",
    "photo_document","attested"],"LKN");
  const at=timestamp(x.visited_at);
  req(at<=svc.now && at>=svc.now-366*86400000,
    "VISIT","Tanggal kunjungan tidak dapat di masa depan/lebih dari 366 hari");
  const locationKeys=["key_person","phone","street","village","city","distance_km"];
  exact(x.location,locationKeys,"lokasi");
  req(locationKeys.every(k=>x.location[k]!==undefined),"VISIT",
    "Data pihak yang ditemui dan alamat harus lengkap");
  const site={
    key_person:label(x.location.key_person,"pihak ditemui",3,200),
    phone:label(x.location.phone,"telepon",5,30),
    street:label(x.location.street,"jalan",5,400),
    village:label(x.location.village,"kelurahan",3,150),
    city:label(x.location.city,"kota",3,150),
    distance_km:x.location.distance_km,
  };
  req(/^[+0-9() \-]{5,30}$/.test(site.phone),"VISIT","Nomor kontak tidak valid");
  const km=Number(site.distance_km);
  req(site.distance_km!=="" && site.distance_km!==null &&
    Number.isFinite(km) && km>=0 && km<=10000,
    "VISIT","Jarak dari cabang harus 0–10000 km");
  site.distance_km=km;
  req(ENVIRONMENTS.includes(x.environment),"VISIT","Kategori lingkungan tidak valid");
  req(Array.isArray(x.facilities_within_1km) &&
    x.facilities_within_1km.length<=3 &&
    x.facilities_within_1km.every((v:unknown)=>typeof v==="string"&&v.trim().length<=120),
    "VISIT","Maksimal tiga fasilitas umum radius 1 km");
  req(Array.isArray(x.photo_categories) &&
    x.photo_categories.length>=1 &&
    x.photo_categories.length<=6 &&
    new Set(x.photo_categories).size===x.photo_categories.length &&
    x.photo_categories.every((v:unknown)=>typeof v==="string" && PHOTO_CATEGORIES.some(k=>k===v)),
    "VISIT","Kategori foto wajib berasal dari enam kategori LKN");
  req(x.attested===true,"VISIT",
    "RM wajib menyatakan hasil kunjungan dicatat sesuai kondisi sebenarnya");
  const doc=svc.doc(a,x.photo_document,"LKN_PHOTOS");
  const customer=svc.s.get("parties",a.principal);
  const row=svc.s.add("visits",{
    id:uid(),application_id:a.id,
    revision:(old?.revision||0)+1,
    previous_visit_id:old?.id||null,
    status:"PENDING_BM_REVIEW",
    rm:actor.id,rm_office:actor.office,
    customer_name:customer.name,customer_type:label(x.customer_type,"jenis nasabah",3,100),
    request_type:label(x.request_type,"jenis permohonan",3,120),
    referral:typeof x.referral==="string"?
      label(x.referral,"referral",0,200):"",
    visited_at:new Date(at).toISOString(),
    location:site,
    environment:x.environment,
    facilities_within_1km:x.facilities_within_1km.map((v:string)=>v.trim()),
    notes:label(x.notes,"catatan kunjungan",15,4000),
    photo_categories:[...x.photo_categories],
    photo_document:doc.id,photo_digest:doc.digest,
    maker_attestation:true,attested_at:svc.iso,
    application_fingerprint:svc.fingerprint(a),
    created_at:svc.iso,
    source:"Lampiran 4 LKN-BG — baseline 2022/2023",
    mode:"SANDBOX_REVIEW_ONLY",
  });
  a.visit_id=row.id;
  return {id:row.id,revision:row.revision,status:row.status};
}
export function reviewVisit(svc:Service,actor:Data,a:Row,x:Data) {
  // MPO acts as Branch Manager control role in sandbox; institution must approve mapping.
  svc.role(actor,["MPO"]);
  svc.access(actor,a);
  svc.state(a,...PRE_UNDERWRITE);
  const row=svc.s.get("visits",a.visit_id||"");
  req(row.application_id===a.id && row.status==="PENDING_BM_REVIEW",
    "VISIT","LKN tidak menunggu review",409);
  req(row.rm!==actor.id && a.maker!==actor.id,
    "SOD","RM/maker tidak dapat memeriksa LKN sendiri",403);
  req(row.application_fingerprint===svc.fingerprint(a),"VERSION",
    "Data material pengajuan berubah setelah kunjungan",409);
  const photos=svc.doc(a,row.photo_document,"LKN_PHOTOS");
  req(photos.digest===row.photo_digest,"DOCUMENT","Bukti foto berubah",409);
  req(typeof x.accepted==="boolean","VISIT","Keputusan BM wajib boolean");
  const decisionNote=label(x.reason,"catatan BM",8,2000);
  const result=svc.doc(a,x.report_document,"LKN");
  req(result.id!==row.photo_document,"DOCUMENT","LKN dan bukti foto harus terpisah");
  row.status=x.accepted?"REVIEWED":"RETURNED";
  row.bm=actor.id;row.reviewed_at=svc.iso;row.review_reason=decisionNote;
  row.signed_lkn_document=result.id;row.signed_lkn_digest=result.digest;
  row.review_digest=hash({visit:row.id,photo:row.photo_digest,lkn:result.digest,
    reviewer:actor.id,accepted:x.accepted});
  return {id:row.id,revision:row.revision,status:row.status,
    report_document:result.id,reviewed_at:row.reviewed_at};
}
export function currentVisit(svc:Service,a:Row):Row|null {
  return a.visit_id?svc.s.get("visits",a.visit_id):null;
}
export function checkedVisit(svc:Service,a:Row):Row|null {
  const visit=currentVisit(svc,a);
  if(!visit)return null;
  req(visit.status==="REVIEWED" && visit.application_fingerprint===svc.fingerprint(a),
    "VISIT","LKN terbaru belum selesai direview oleh BM",409);
  const photos=svc.doc(a,visit.photo_document,"LKN_PHOTOS");
  const report=svc.doc(a,visit.signed_lkn_document,"LKN");
  req(photos.digest===visit.photo_digest && report.digest===visit.signed_lkn_digest,
    "DOCUMENT","Bukti LKN tidak konsisten",409);
  return visit;
}
export function visitSnapshot(svc:Service,actor:Data,a:Row) {
  svc.role(actor,["AO","ANALYST","MPO","COMPLIANCE","LEGAL","AUDIT","ADMIN",
    "SUPPORT","GH_BISNIS","DIREKSI"]);
  svc.access(actor,a);
  const visit=currentVisit(svc,a);
  return {application_id:a.id,
    current:visit||null,
    history:svc.s.rows("visits",{application_id:a.id})
      .sort((x,y)=>y.revision-x.revision)
      .map(x=>({id:x.id,revision:x.revision,status:x.status,
        visited_at:x.visited_at,rm:x.rm,bm:x.bm||null})),
    conditional:true,
    source:"Lampiran 4 — LKN-BG; physical visit not universally mandatory",
    legal_signature_verified:false};
}
