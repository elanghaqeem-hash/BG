'use client';
import {useEffect,useState,type FormEvent} from 'react';

type Claim={id:string;application_id:string;state:string;version:number;details:Record<string,unknown>};
type Doc={id:string;kind:string;verified:boolean};
type App={id:string;documents:Doc[]};
type Event={id:string;kind:string;action_type?:string;action_id?:string;accepted?:boolean;
  reason?:string;reported_amount?:string|null;actor:string;at:string};
type Case={id:string;kind:string;status:string;revision:number;legally_effective:boolean;accounting_posted:boolean};
type Snapshot={current:Case|null;events:Event[];mode:string;legal_rights_verified:boolean;accounting_posted:boolean};
type Props={claim:Claim;app:App|undefined;role:string;busy:boolean;
  api:(path:string,method?:string,body?:unknown)=>Promise<any>;
  work:(fn:()=>Promise<void>)=>Promise<void>;refresh:()=>Promise<void>};
const readers=new Set(['ANALYST','MPO','SUPPORT','MPO_KPO','KADEP_SUPPORT',
  'FINANCE','LEGAL','LITIGATION','COMPLIANCE','AUDIT','GH_BISNIS','DIREKSI','ADMIN']);
const names:Record<string,string>={
 open_recovery:'Daftarkan / revisi asesmen',review_recovery:'Telaah dasar hukum',
 record_recovery_action:'Catat tindak lanjut',review_recovery_action:'Verifikasi tindak lanjut',
 request_recovery_closure:'Usulkan penutupan monitoring',
 confirm_recovery_closure:'Review penutupan monitoring'};
const docsFor=(app:App|undefined,kind:string)=>app?.documents.filter(d=>d.kind===kind&&d.verified)||[];

export function RecoveryCasePanel({claim,app,role,busy,api,work,refresh}:Props){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [loadError,setLoadError]=useState('');
 const [choice,setChoice]=useState('');
 const [actionType,setActionType]=useState('DEMAND');
 useEffect(()=>{
  let active=true;
  if(!readers.has(role))return;
  api('/claims/'+claim.id+'/recovery').then((result:Snapshot)=>{
   if(active){setSnapshot(result);setLoadError('');}
  }).catch((e:unknown)=>{if(active){setLoadError(e instanceof Error?e.message:'Tidak dapat memuat recovery');}});
  return()=>{active=false;};
 },[claim.id,claim.version,role]);
 if(!readers.has(role))return null;
 const state=snapshot?.current?.status;
 const options:string[]=[];
 if(['LITIGATION','LEGAL'].includes(role) && !!claim.details.bank_paid_at &&
    (!state || state==='RETURNED'))options.push('open_recovery');
 if(['LEGAL','COMPLIANCE'].includes(role)&&state==='PENDING_LEGAL_REVIEW')
  options.push('review_recovery');
 if(role==='LITIGATION'&&state==='TRACKING_ONLY')
  options.push('record_recovery_action','request_recovery_closure');
 if(['LEGAL','COMPLIANCE'].includes(role)&&state==='TRACKING_ONLY')
  options.push('review_recovery_action');
 if(['LEGAL','COMPLIANCE'].includes(role)&&state==='CLOSURE_PENDING')
  options.push('confirm_recovery_closure');
 const pending=(snapshot?.events||[]).filter(e=>e.kind==='ACTION_RECORDED' &&
   !(snapshot?.events||[]).some(r=>r.kind==='ACTION_REVIEWED'&&r.action_id===e.id));
 const filteredOptions=options.filter(o=>o!=='review_recovery_action'||pending.length>0);
 const selected=filteredOptions.includes(choice)?choice:filteredOptions[0]||'';
 const requiredKind=selected==='open_recovery'?'RECOVERY_BASIS':
  selected==='record_recovery_action'?'RECOVERY_ACTION':
  selected==='request_recovery_closure'?'RECOVERY_RESOLUTION':'';
 const documents=docsFor(app,requiredKind);
 function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const f=new FormData(e.currentTarget);
  const payload:Record<string,unknown>={reason:String(f.get('reason')||'')};
  if(requiredKind)payload.document=String(f.get('document')||'');
  if(selected==='open_recovery')payload.kind=String(f.get('kind')||'');
  if(selected==='record_recovery_action'){
   payload.action_type=String(f.get('action_type')||'');
   if(payload.action_type==='PAYMENT_EVIDENCE')payload.reported_amount=String(f.get('reported_amount')||'');
  }
  if(selected==='review_recovery_action')payload.action_id=String(f.get('action_id')||'');
  if(selected==='review_recovery'||selected==='review_recovery_action'||
     selected==='confirm_recovery_closure')payload.accepted=f.get('accepted')==='true';
  work(async()=>{
   await api('/claims/'+claim.id+'/commands/'+selected,'POST',{
    expected_version:claim.version,idempotency_key:crypto.randomUUID(),payload});
   await refresh();
  });
 }
 return <section className="section-gap" aria-label="Pemulihan dan subrogasi">
  <div className="card-title"><h3>Recovery dan Subrogasi</h3><span>Pelacakan bukti · tanpa posting keuangan</span></div>
  <p className="fine">Alur ini hanya mencatat asesmen dan tindakan. Payout simulasi tidak membuktikan penerimaan kas, hak subrogasi, atau pengalihan piutang yang sah.</p>
  {loadError?<p role="alert" className="alert error">{loadError}</p>:null}
  {snapshot?.current?<dl className="detail-list">
   <dt>Status</dt><dd>{state}</dd>
   <dt>Jenis asesmen</dt><dd>{snapshot.current.kind}</dd>
   <dt>Revisi</dt><dd>{snapshot.current.revision}</dd>
   <dt>Hak hukum efektif</dt><dd>Tidak diverifikasi</dd>
   <dt>Posting akuntansi</dt><dd>Tidak ada</dd>
  </dl>:<p className="fine">Belum ada kasus recovery untuk klaim ini.</p>}
  {snapshot?.events?.length?<details><summary>Riwayat audit recovery ({snapshot.events.length})</summary>
   <ol>{snapshot.events.map(ev=><li key={ev.id}><strong>{ev.kind.replaceAll('_',' ')}</strong> · {ev.at.slice(0,16)}
    {ev.action_type?' · '+ev.action_type:''}
    {ev.reported_amount?' · Nominal bukti (belum diakui): Rp '+ev.reported_amount:''}
    {ev.accepted!==undefined?' · '+(ev.accepted?'Diterima':'Ditolak'):''}</li>)}</ol>
  </details>:null}
  {selected?<form className="inline-form" onSubmit={submit}>
   <label>Tindakan<select value={selected} onChange={e=>setChoice(e.target.value)}>
    {filteredOptions.map(o=><option value={o} key={o}>{names[o]}</option>)}</select></label>
   {requiredKind?<label>Dokumen terverifikasi ({requiredKind})<select name="document" required>
    <option value="">Pilih bukti</option>{documents.map(d=><option value={d.id} key={d.id}>{d.id.slice(0,18)}</option>)}
   </select></label>:null}
   {selected==='open_recovery'?<label>Jenis asesmen<select name="kind" required>
    <option value="BANK_RECOURSE_ASSESSMENT">Penilaian hak regres bank</option>
    <option value="SUBROGATION_ASSESSMENT">Penilaian potensi subrogasi (belum sah)</option>
   </select></label>:null}
   {selected==='record_recovery_action'?<>
    <label>Jenis tindak lanjut<select name="action_type" value={actionType} onChange={e=>setActionType(e.target.value)}>
     {['DEMAND','NEGOTIATION','COURT','PAYMENT_EVIDENCE','OTHER'].map(k=><option key={k} value={k}>{k.replaceAll('_',' ')}</option>)}
    </select></label>
    {actionType==='PAYMENT_EVIDENCE'?<label>Nominal pada bukti (bukan penerimaan kas)<input name="reported_amount" inputMode="decimal" required placeholder="Contoh 1000000.00"/></label>:null}
   </>:null}
   {selected==='review_recovery_action'?<label>Tindakan menunggu review<select name="action_id" required>
    {pending.map(e=><option value={e.id} key={e.id}>{e.action_type} · {e.id.slice(0,10)}</option>)}
   </select></label>:null}
   {['review_recovery','review_recovery_action','confirm_recovery_closure'].includes(selected)?
    <label>Keputusan<select name="accepted"><option value="true">Terima untuk monitoring</option>
     <option value="false">Tolak / Kembalikan</option></select></label>:null}
   <label>Alasan dan referensi pemeriksaan<textarea name="reason" minLength={12} maxLength={2500} rows={3} required placeholder="Catat sumber bukti dan hasil pemeriksaan independen"/></label>
   <button className="secondary" disabled={busy||!!requiredKind&&documents.length===0}>{busy?'Menyimpan…':'Simpan ke riwayat recovery'}</button>
  </form>:<p className="fine">Tidak ada tindakan untuk peran ini pada status saat ini.</p>}
 </section>;
}
