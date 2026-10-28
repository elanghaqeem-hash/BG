'use client';
import {useEffect,useState,type FormEvent} from 'react';
type Doc={id:string;kind:string;verified:boolean};
type Application={id:string;state:string;version:number;amount:string;documents:Doc[]};
type Data=Record<string,unknown>;
type Props={app:Application;role:string;busy:boolean;
  api:(path:string,method?:string,body?:unknown)=>Promise<any>;
  onCommand:(command:string,payload:Data)=>Promise<void>};
type Snapshot={underwriting?:{id:string;state:string;recommendation:string;ratios?:Data}|null;
  counter_review?:{scheme:string;status:string}|null;
  collateral?:{id:string;type:string;value:string;state:string}[];
  limit_reservation?:{status:string;amount:string}|null;
  servicing?:{id:string;kind:string;status:string;proposed:Data}[];
  closure?:{at:string}|null};
const bankReaders=new Set(['ADMIN','AUDIT','ANALYST','COMPLIANCE','MPO','LEGAL','MPO_KPO','SUPPORT','FINANCE']);
const c=['character','capacity','capital','collateral','condition'];
function DocSelect({docs,kind,name='document'}:{docs:Doc[];kind?:string;name?:string}){
  return <label>Dokumen terverifikasi<select name={name} required><option value="">Pilih dokumen</option>
    {docs.filter(d=>d.verified&&(!kind||d.kind===kind)).map(d=><option key={d.id} value={d.id}>{d.kind} · {d.id.slice(0,12)}</option>)}
  </select></label>;
}
export function EnterpriseControls({app,role,busy,api,onCommand}:Props){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [loadError,setLoadError]=useState('');
  useEffect(()=>{
    if(!bankReaders.has(role)){setSnapshot(null);return;}
    let mounted=true;
    api('/applications/'+app.id+'/enterprise').then(data=>{if(mounted){setSnapshot(data);setLoadError('');}})
      .catch(e=>{if(mounted)setLoadError(e instanceof Error?e.message:'Status tidak tersedia')});
    return ()=>{mounted=false};
  },[app.id,app.version,role]);
  const docs=app.documents||[];
  function submit(command:string,map:(data:FormData)=>Data){
    return (event:FormEvent<HTMLFormElement>)=>{
      event.preventDefault();
      void onCommand(command,map(new FormData(event.currentTarget)));
    };
  }
  const state=app.state;
  const canBank=bankReaders.has(role);
  if(!canBank&&!(role==='PRINCIPAL'&&state==='ACTIVE'))return null;
  return <section className="card section-gap">
    <div className="card-title"><h2>Kontrol Enterprise BG</h2><span>Sandbox · persisted · maker–checker</span></div>
    <p className="fine">Perubahan tersimpan dalam transaksi Durable Object. Bukti wajib diverifikasi; ini bukan persetujuan penerbitan atau settlement bank nyata.</p>
    {loadError?<p className="alert error">{loadError}</p>:null}
    {snapshot?<div className="detail-list">
      <dt>Analisis 5C</dt><dd>{snapshot.underwriting?.state||'Belum ada'}</dd>
      <dt>Review Kontra BG</dt><dd>{snapshot.counter_review?.status||'Belum ada'}</dd>
      <dt>Reservasi limit</dt><dd>{snapshot.limit_reservation?.status||'Belum ada'}</dd>
      <dt>Agunan</dt><dd>{(snapshot.collateral||[]).map(x=>x.type+' · '+x.state).join('; ')||'Belum ada'}</dd>
      <dt>Servicing</dt><dd>{(snapshot.servicing||[]).map(x=>x.kind+' · '+x.status).join('; ')||'Belum ada'}</dd>
    </div>:null}
    {role==='ANALYST'&&state==='SP2KBG_ISSUED'?<details>
      <summary>Catat analisis 5C dan rasio keuangan</summary>
      <form onSubmit={submit('record_5c',f=>({
        financial_document:String(f.get('financial_document')),
        five_c:Object.fromEntries(c.map(k=>[k,{risk:String(f.get(k+'_risk')),finding:String(f.get(k+'_finding')),mitigation:String(f.get(k+'_mitigation'))}])),
        financials:Object.fromEntries(['current_assets','current_liabilities','total_debt','equity'].map(k=>[k,String(f.get(k))])),
        recommendation:String(f.get('recommendation')),narrative:String(f.get('narrative')),
      }))}>
      <DocSelect docs={docs} kind="LAPORAN_KEUANGAN" name="financial_document"/>
      {c.map(k=><fieldset key={k}><legend>{k.toUpperCase()}</legend>
        <label>Risiko<select name={k+'_risk'}><option>LOW</option><option>MODERATE</option><option>HIGH</option></select></label>
        <label>Temuan<textarea name={k+'_finding'} minLength={8} required/></label>
        <label>Mitigasi<textarea name={k+'_mitigation'} minLength={8} required/></label></fieldset>)}
      <div className="form-grid">{['current_assets','current_liabilities','total_debt','equity'].map(k=>
        <label key={k}>{k}<input name={k} type="number" min="0" step="0.01" required/></label>)}</div>
      <label>Rekomendasi<select name="recommendation"><option>LAYAK</option><option>PERLU_PERBAIKAN</option><option>TIDAK_LAYAK</option></select></label>
      <label>Kesimpulan analis<textarea name="narrative" minLength={8} required/></label>
      <button className="secondary" disabled={busy}>Simpan analisis 5C</button>
      </form>
    </details>:null}
    {['MPO','COMPLIANCE'].includes(role)&&state==='SP2KBG_ISSUED'&&snapshot?.underwriting?.state==='PENDING_REVIEW'?<form onSubmit={submit('review_5c',f=>({accepted:f.get('accepted')==='true',reason:String(f.get('reason'))}))}>
      <h3>Review 5C (checker independen)</h3>
      <label>Keputusan<select name="accepted"><option value="true">Terima</option><option value="false">Kembalikan</option></select></label>
      <label>Alasan<textarea name="reason" minLength={8} required/></label>
      <button className="secondary" disabled={busy}>Simpan hasil review</button>
    </form>:null}
    {role==='COMPLIANCE'&&state==='SP2KBG_ISSUED'?<form onSubmit={submit('review_counter',f=>({
      scheme:String(f.get('scheme')),pks_reference:String(f.get('pks_reference')),
      pks_document:String(f.get('pks_document')),
    }))}>
      <h3>Review Kontra BG — CAC / CBC</h3>
      <label>Skema<select name="scheme"><option>CAC</option><option>CBC</option></select></label>
      <label>Referensi PKS aktif<input name="pks_reference" required placeholder="Sesuai master penjamin"/></label>
      <DocSelect docs={docs} kind="PKS" name="pks_document"/>
      <button className="secondary" disabled={busy}>Revalidasi SP2KBG dan PKS</button>
    </form>:null}
    {['ANALYST','MPO'].includes(role)&&['APPROVAL_GRANTED','MKP_SIGNED','AKAD_SIGNED','FEE_COLLECTED','INTER_OFFICE_ISSUANCE'].includes(state)?<form onSubmit={submit('register_collateral',f=>({
      type:String(f.get('type')),value:String(f.get('value')),
      document:String(f.get('document')),binding_reference:String(f.get('binding_reference')),
    }))}>
      <h3>Register agunan</h3>
      <label>Jenis<select name="type"><option value="CASH">Cash Collateral</option><option value="FIXED_ASSET">Fixed Asset</option><option value="COUNTER_BG">Kontra BG</option></select></label>
      <label>Nilai agunan<input name="value" type="number" min="0.01" step="0.01" required/></label>
      <label>Referensi pengikatan<input name="binding_reference" minLength={8} required/></label>
      <DocSelect docs={docs}/>
      <button className="secondary" disabled={busy}>Registrasikan agunan</button>
    </form>:null}
    {['COMPLIANCE','LEGAL'].includes(role)&&snapshot?.collateral?.some(x=>x.state==='PENDING_VERIFICATION')?<form onSubmit={submit('approve_collateral',f=>({
      collateral_id:String(f.get('collateral_id')),accepted:f.get('accepted')==='true',reason:String(f.get('reason')),
    }))}>
      <h3>Verifikasi agunan</h3>
      <label>Agunan<select name="collateral_id">{snapshot.collateral.filter(x=>x.state==='PENDING_VERIFICATION').map(x=><option key={x.id} value={x.id}>{x.type} · {x.id.slice(0,12)}</option>)}</select></label>
      <label>Keputusan<select name="accepted"><option value="true">Terverifikasi</option><option value="false">Tolak</option></select></label>
      <label>Alasan<textarea name="reason" minLength={8} required/></label>
      <button className="secondary" disabled={busy}>Simpan pemeriksaan agunan</button>
    </form>:null}
    {['MPO','MPO_KPO'].includes(role)&&['APPROVAL_GRANTED','MKP_SIGNED','AKAD_SIGNED','FEE_COLLECTED','INTER_OFFICE_ISSUANCE'].includes(state)&&!snapshot?.limit_reservation?
      <button className="secondary" disabled={busy} onClick={()=>void onCommand('reserve_limit',{})}>Reservasi limit atomik</button>:null}
    {['PRINCIPAL','MPO','SUPPORT'].includes(role)&&state==='ACTIVE'?<form onSubmit={submit('request_servicing',f=>({
      kind:String(f.get('kind')),document:String(f.get('document')),
      reason:String(f.get('reason')),
      ...(f.get('proposed_amount')?{proposed_amount:String(f.get('proposed_amount'))}:{}),
      ...(f.get('proposed_expiry')?{proposed_expiry:String(f.get('proposed_expiry'))}:{}),
    }))}>
      <h3>Permintaan amendment / perpanjangan</h3>
      <label>Jenis<select name="kind"><option value="AMENDMENT">Amendment</option><option value="EXTENSION">Extension</option></select></label>
      <DocSelect docs={docs} kind="AMENDMENT_REQUEST"/>
      <label>Nilai baru (opsional)<input name="proposed_amount" type="number" min="0.01" step="0.01"/></label>
      <label>Tanggal akhir baru (opsional)<input name="proposed_expiry" type="date"/></label>
      <label>Alasan<textarea name="reason" minLength={8} required/></label>
      <small>Permohonan tercatat PENDING_REVIEW; tidak mengubah warkat yang berlaku.</small>
      <button className="secondary" disabled={busy}>Ajukan perubahan</button>
    </form>:null}
    {['MPO','SUPPORT'].includes(role)&&state==='ACTIVE'&&!snapshot?.closure?<form onSubmit={submit('request_bg_closure',f=>({document:String(f.get('document'))}))}>
      <h3>Permohonan penutupan BG</h3><DocSelect docs={docs} kind="RELEASE"/>
      <small>Hanya dapat dilakukan setelah periode klaim dan kewajiban diselesaikan.</small>
      <button className="secondary" disabled={busy}>Ajukan penutupan</button>
    </form>:null}
    {['COMPLIANCE','LEGAL'].includes(role)&&state==='ACTIVE'&&snapshot?.closure?
      <button className="secondary" disabled={busy} onClick={()=>void onCommand('confirm_bg_closure',{})}>Konfirmasi penutupan (checker)</button>:null}
  </section>;
}
