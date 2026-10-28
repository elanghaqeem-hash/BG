'use client';
import {useEffect,useState,type FormEvent} from 'react';
type Item={id:string;kind:string;status:string;proposed:Record<string,string>;mode:string;effective:boolean;approved_roles?:string[]};
type Document={id:string;kind:string;verified:boolean};
type App={id:string;version:number;state:string;documents:Document[]};
type Props={app:App;role:string;busy:boolean;api:(path:string,method?:string,body?:unknown)=>Promise<any>;onCommand:(name:string,payload:Record<string,unknown>)=>Promise<void>};
const viewers=new Set(['PRINCIPAL','PENJAMIN','ANALYST','MPO','MPO_KPO','SUPPORT','GH_BISNIS','DIREKSI','LEGAL','COMPLIANCE','AUDIT','ADMIN']);
function DocSelect({documents,kind}:{documents:Document[],kind:string}){
 return <label>{kind}<select name="document" required><option value="">Pilih bukti terverifikasi</option>
  {documents.filter(d=>d.kind===kind&&d.verified).map(d=><option value={d.id} key={d.id}>{d.id.slice(0,14)}</option>)}
 </select></label>;
}
export function ServicingWorkflow({app,role,busy,api,onCommand}:Props){
 const [items,setItems]=useState<Item[]>([]),[err,setErr]=useState('');
 useEffect(()=>{
  if(!viewers.has(role)){setItems([]);return;}
  let active=true;
  api('/applications/'+app.id+'/servicing').then(v=>{if(active){setItems(v);setErr('')}})
  .catch(e=>{if(active)setErr(e instanceof Error?e.message:'Tidak dapat memuat servicing')});
  return ()=>{active=false};
 },[app.id,app.version,role]);
 if(!viewers.has(role)||!items.length)return null;
 const submit=(name:string,fn:(form:FormData)=>Record<string,unknown>)=>(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  void onCommand(name,fn(new FormData(event.currentTarget)));
 };
 return <section className="card section-gap">
  <div className="card-title"><h2>Perubahan BG dan Endorsement</h2><span>SANDBOX · warkat asli tidak berubah</span></div>
  <p>Perpanjangan dan perubahan wajib melalui review ulang. Persetujuan di halaman ini belum menerbitkan warkat revisi atau mengubah kewajiban nyata.</p>
  {err?<p className="alert error">{err}</p>:null}
  {items.slice().reverse().map(s=><details key={s.id} open={['PENDING_REVIEW','RISK_REVIEWED','PARTNER_ENDORSED'].includes(s.status)}>
   <summary>{s.kind} · {s.status} · {s.id.slice(0,12)}</summary>
   <p>Nilai usulan: {s.proposed.amount||'Tidak berubah'}; Tanggal akhir usulan: {s.proposed.expires_on||'Tidak berubah'}. Efektif: Tidak.</p>
   {s.approved_roles?.length?<p>Persetujuan tercatat: {s.approved_roles.join(', ')}</p>:null}
   {role==='ANALYST'&&s.status==='PENDING_REVIEW'?<form onSubmit={submit('review_servicing',f=>({
    servicing_id:s.id,collectibility:Number(f.get('collectibility')),pulled_at:new Date(String(f.get('pulled_at'))).toISOString(),
    screening_clear:f.get('screening_clear')==='on',ubo_verified:f.get('ubo_verified')==='on',
    recommendation:String(f.get('recommendation')),narrative:String(f.get('narrative')),
   }))}>
    <h3>Review ulang risiko dan MAP-BG</h3>
    <small>Unggah dan verifikasi ulang SLIK, DHN, LEGAL_CHECK, MAP_BG setelah permohonan masuk.</small>
    <label>SLIK kolektibilitas<select name="collectibility"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label>
    <label>Waktu tarik SLIK<input name="pulled_at" type="datetime-local" required/></label>
    <label className="checkbox"><input type="checkbox" name="screening_clear" required/> Screening clear</label>
    <label className="checkbox"><input type="checkbox" name="ubo_verified" required/> UBO telah diverifikasi</label>
    <label>Kesimpulan<select name="recommendation"><option>LAYAK</option><option>PERLU_PERBAIKAN</option><option>TIDAK_LAYAK</option></select></label>
    <label>Narasi analis<textarea name="narrative" minLength={8} required/></label>
    <button className="secondary" disabled={busy}>Simpan review risiko</button>
   </form>:null}
   {role==='PENJAMIN'&&s.status==='RISK_REVIEWED'?<form onSubmit={submit('partner_endorse',f=>({
    servicing_id:s.id,document:String(f.get('document')),reference:String(f.get('reference')),
    cover_amount:String(f.get('cover_amount')),cover_until:String(f.get('cover_until')),
   }))}>
    <h3>Review endorsement Penjamin</h3>
    <DocSelect documents={app.documents} kind="COUNTER_ENDORSEMENT"/>
    <label>Referensi endorsement<input name="reference" minLength={8} required/></label>
    <label>Coverage nilai BG<input name="cover_amount" type="number" min="1" step="0.01" required/></label>
    <label>Coverage sampai<input name="cover_until" type="date" required/></label>
    <button className="secondary" disabled={busy}>Catat hasil review Penjamin</button>
   </form>:null}
   {['MPO','GH_BISNIS','DIREKSI'].includes(role)&&s.status==='PARTNER_ENDORSED'&&!s.approved_roles?.includes(role)?
    <button className="secondary" disabled={busy} onClick={()=>void onCommand('approve_servicing',{servicing_id:s.id})}>Setujui sesuai kewenangan bank</button>:null}
   {['LEGAL','COMPLIANCE'].includes(role)&&['PENDING_REVIEW','RISK_REVIEWED','PARTNER_ENDORSED'].includes(s.status)?
    <form onSubmit={submit('reject_servicing',f=>({servicing_id:s.id,reason:String(f.get('reason'))}))}>
     <h3>Tolak permohonan dengan alasan</h3><label>Alasan<textarea name="reason" minLength={8} required/></label>
     <button className="secondary" disabled={busy}>Tolak perubahan</button>
    </form>:null}
   {role==='PRINCIPAL'&&s.status==='PENDING_REVIEW'?
    <form onSubmit={submit('withdraw_servicing',f=>({servicing_id:s.id,reason:String(f.get('reason'))}))}>
     <h3>Tarik permohonan</h3><label>Alasan<textarea name="reason" minLength={8} required/></label>
     <button className="secondary" disabled={busy}>Batalkan permohonan saya</button>
    </form>:null}
   {role==='LEGAL'&&s.status==='APPROVED_PENDING_ISSUANCE'?
    <form onSubmit={submit('cancel_approved_servicing',f=>({
     servicing_id:s.id,reason:String(f.get('reason')),document:String(f.get('document')),
    }))}>
     <h3>Batalkan approval yang belum diterbitkan</h3>
     <DocSelect documents={app.documents} kind="CANCELLATION"/>
     <label>Alasan<textarea name="reason" minLength={8} required/></label>
     <button className="secondary" disabled={busy}>Batalkan dan lepas reservasi tambahan</button>
    </form>:null}
   {s.status==='APPROVED_PENDING_ISSUANCE'?<p className="fine">Menunggu dokumen/legal issuance resmi. Nomor BG, hak klaim, dan warkat yang ada tetap berlaku tanpa perubahan.</p>:null}
  </details>)}
 </section>;
}
