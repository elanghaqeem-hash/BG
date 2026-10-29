'use client';
import {useEffect,useState,type FormEvent} from 'react';

type Evidence={id:string;kind:string;verified:boolean};
type App={id:string;state:string;version:number;documents:Evidence[]};
type Visit={id:string;revision:number;status:string;rm:string;bm?:string;visited_at:string;
 customer_name:string;customer_type:string;request_type:string;referral:string;
 location:{key_person:string;phone:string;street:string;village:string;city:string;distance_km:number};
 environment:string;facilities_within_1km:string[];photo_categories:string[];
 notes:string;photo_document:string;signed_lkn_document?:string};
type Snapshot={current:Visit|null;history:{id:string;revision:number;status:string}[];
 conditional:boolean;legal_signature_verified:boolean};
type Props={app:App;role:string;busy:boolean;
 api:(path:string,method?:string,body?:unknown)=>Promise<any>;
 onCommand:(command:string,payload:Record<string,unknown>)=>Promise<void>};

const readers=new Set(['AO','ANALYST','MPO','COMPLIANCE','LEGAL','AUDIT','ADMIN','SUPPORT','GH_BISNIS','DIREKSI']);
const stages=new Set(['DRAFT','KYC_KYB_CHECK','SLIK_CHECK','PENJAMIN_REQUESTED','PENJAMIN_UNDERWRITING','SP2KBG_ISSUED']);
const environments=[
 ['PERUMAHAN_REAL_ESTATE','Perumahan / Real Estate'],
 ['PERKANTORAN','Perkantoran'],['PERKAMPUNGAN_UMUM','Perkampungan Umum'],
 ['KOMERSIAL_BISNIS','Lingkungan Komersial / Bisnis'],
];
const photos=[
 ['TAMPAK_MUKA','Tampak muka lokasi proyek'],
 ['TAMPAK_DALAM','Tampak dalam lokasi proyek'],
 ['LINGKUNGAN_SEKITAR','Lingkungan sekitar proyek'],
 ['PERSEDIAAN','Persediaan barang / inventory'],
 ['MESIN_PERALATAN','Mesin / peralatan kerja'],
 ['NASABAH_DAN_RM','Nasabah bersama RM'],
];
export function SiteVisitPanel({app,role,busy,api,onCommand}:Props){
 const [state,setState]=useState<Snapshot|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!readers.has(role)){setState(null);return;}
  let on=true;
  api('/applications/'+app.id+'/visit').then(x=>{if(on){setState(x);setError('')}})
    .catch(e=>{if(on)setError(e instanceof Error?e.message:'Data LKN tidak tersedia')});
  return ()=>{on=false;};
 },[app.id,app.version,role]);
 if(!readers.has(role))return null;
 const report=state?.current, canWrite=stages.has(app.state);
 const docs=app.documents||[];
 const evidence=(kind:string,name:string)=><label>{name}<select name={kind} required>
  <option value="">Pilih dokumen yang sudah diverifikasi</option>
  {docs.filter(d=>d.kind===kind&&d.verified).map(d=><option value={d.id} key={d.id}>{d.id.slice(0,16)}</option>)}
 </select></label>;
 const save=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  const f=new FormData(event.currentTarget);
  const field=(x:string)=>String(f.get(x)||'');
  const data={
   visited_at:new Date(field('visited_at')).toISOString(),
   customer_type:field('customer_type'),request_type:field('request_type'),
   referral:field('referral'),
   location:{key_person:field('key_person'),phone:field('phone'),
    street:field('street'),village:field('village'),city:field('city'),
    distance_km:Number(field('distance_km'))},
   environment:field('environment'),
   facilities_within_1km:['facility1','facility2','facility3']
    .map(field).map(s=>s.trim()).filter(Boolean),
   notes:field('notes'),
   photo_categories:photos.map(([k])=>k).filter(k=>f.get(k)==='on'),
   photo_document:field('LKN_PHOTOS'),attested:f.get('attested')==='on',
  };
  void onCommand('record_visit',data);
 };
 const review=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  const f=new FormData(event.currentTarget);
  void onCommand('review_visit',{
   accepted:f.get('accepted')==='true',
   report_document:String(f.get('LKN')||''),
   reason:String(f.get('reason')||''),
  });
 };
 return <section className="card section-gap">
  <div className="card-title"><h2>Laporan Kunjungan Nasabah (LKN-BG)</h2>
   <span>RM → Branch Manager · Evidence</span></div>
  <p className="fine">Form digital dari Lampiran 4. Kunjungan bersifat kondisional. Bukti foto disimpan sebagai PDF terverifikasi dan bukan verifikasi GPS atau tanda tangan digital yang berkekuatan hukum.</p>
  {error?<p className="alert error">{error}</p>:null}
  {report?<div className="detail-list">
   <dt>Status LKN</dt><dd>{report.status} · Revisi {report.revision}</dd>
   <dt>Nasabah / key person</dt><dd>{report.customer_name} / {report.location.key_person}</dd>
   <dt>Lokasi</dt><dd>{report.location.street}, {report.location.village}, {report.location.city}</dd>
   <dt>Kunjungan oleh RM</dt><dd>{report.rm} · {report.visited_at.slice(0,10)}</dd>
   <dt>Pemeriksa cabang</dt><dd>{report.bm||'Menunggu pemeriksaan'}</dd>
   <dt>Catatan</dt><dd>{report.notes}</dd>
  </div>:<p>Belum ada kunjungan yang dicatat.</p>}
  {state?.history&&state.history.length>1?<details><summary>Riwayat LKN ({state.history.length})</summary>
   <ul>{state.history.map(v=><li key={v.id}>Revisi {v.revision} · {v.status} · {v.id.slice(0,12)}</li>)}</ul>
  </details>:null}
  {role==='AO'&&canWrite&&(!report||['REVIEWED','RETURNED'].includes(report.status))?
   <details><summary>Catat {report?'kunjungan revisi':'hasil kunjungan'} (Relationship Manager)</summary>
    <form onSubmit={save}>
     <div className="form-grid">
      <label>Waktu kunjungan<input name="visited_at" type="datetime-local" required/></label>
      <label>Jenis nasabah<input name="customer_type" minLength={3} maxLength={100} placeholder="Debitur baru / existing" required/></label>
      <label>Jenis permohonan<input name="request_type" minLength={3} maxLength={120} placeholder="Penerbitan / perpanjangan BG" required/></label>
      <label>Referral<input name="referral" maxLength={200}/></label>
      <label>Pihak yang ditemui (key person)<input name="key_person" minLength={3} maxLength={200} required/></label>
      <label>HP / Telepon<input name="phone" minLength={5} maxLength={30} required/></label>
      <label>Alamat jalan lokasi usaha<input name="street" minLength={5} maxLength={400} required/></label>
      <label>Kelurahan<input name="village" minLength={3} maxLength={150} required/></label>
      <label>Kota<input name="city" minLength={3} maxLength={150} required/></label>
      <label>Jarak dari kantor (km)<input name="distance_km" type="number" min="0" max="10000" step="0.1" required/></label>
      <label>Kondisi lingkungan<select name="environment">{environments.map(([value,label])=>
       <option value={value} key={value}>{label}</option>)}</select></label>
     </div>
     <fieldset><legend>Fasilitas umum radius kurang dari 1 km (maksimal tiga)</legend>
      <div className="form-grid">{[1,2,3].map(i=><label key={i}>Fasilitas {i}<input name={'facility'+i} maxLength={120}/></label>)}</div>
     </fieldset>
     <fieldset><legend>Foto yang dicakup dalam PDF bukti</legend>
      <p className="fine">Pilih yang benar-benar ada pada bukti; setiap kategori tidak otomatis diwajibkan karena jenis usaha berbeda.</p>
      <div className="form-grid">{photos.map(([k,v])=><label key={k} className="checkbox">
       <input type="checkbox" name={k}/> {v}</label>)}</div>
     </fieldset>
     {evidence('LKN_PHOTOS','Berkas PDF berisi bukti foto kunjungan')}
     <label>Catatan kondisi usaha/kunjungan<textarea name="notes" minLength={15} maxLength={4000} rows={5} required/></label>
     <label className="checkbox"><input name="attested" type="checkbox" required/>
      Saya menyatakan data dan informasi hasil kunjungan dicatat sesuai kondisi sebenarnya.</label>
     <button className="secondary" disabled={busy}>Simpan dan ajukan review BM</button>
    </form>
   </details>:null}
  {role==='MPO'&&canWrite&&report?.status==='PENDING_BM_REVIEW'?
   <form onSubmit={review}>
    <h3>Review Branch Manager (MPO sandbox)</h3>
    <p className="fine">Unggah dan verifikasi LKN bertanda tangan atau persetujuan formal sesuai kebijakan institusi. Persetujuan sistem tidak menggantikan tanda tangan resmi.</p>
    {evidence('LKN','Berkas laporan LKN terverifikasi')}
    <label>Keputusan<select name="accepted"><option value="true">Diterima</option><option value="false">Dikembalikan</option></select></label>
    <label>Alasan pemeriksaan<textarea name="reason" minLength={8} maxLength={2000} required/></label>
    <button className="secondary" disabled={busy}>Simpan review LKN</button>
   </form>:null}
 </section>;
}
