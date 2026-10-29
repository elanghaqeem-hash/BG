'use client';
import {useEffect,useState,type FormEvent} from 'react';
type Doc={id:string;kind:string;verified:boolean};
type App={id:string;state:string;version:number;amount:string;documents:Doc[]};
type FormRecord={id:string;status:string;revision:number;
  project?:{owner:string;type:string;value:string;funding:string;completion_months:number;contract_reference:string};
  character?:{principal:string;business_years:number};
  condition?:{projects_completed:number;last_year_project_value:string};
  capacity?:{profit_history:{year:number;profit:string}[]};
  recommendation?:string;reviewer?:string};
type Data={current:FormRecord|null;history:{id:string;status:string;revision:number}[];risk_score_automated:false};
type Props={app:App;role:string;busy:boolean;
  api:(path:string,method?:string,body?:unknown)=>Promise<any>;
  onCommand:(command:string,payload:Record<string,unknown>)=>Promise<void>};
const readers=new Set(['AO','ANALYST','MPO','COMPLIANCE','LEGAL','AUDIT','ADMIN',
  'SUPPORT','FINANCE','GH_BISNIS','DIREKSI']);
const owners=[['PEMERINTAH_PUSAT','Pemerintah Pusat'],['PEMERINTAH_DAERAH','Pemerintah Daerah'],
 ['SWASTA','Swasta'],['LAINNYA','Lainnya']];
const projectTypes=[['KONSTRUKSI','Konstruksi'],['PENGADAAN_BARANG','Pengadaan Barang'],['LAINNYA','Lainnya']];
const guaranteeTypes=[['CASH_TUNAI','Cash / Tunai (agunan tambahan)'],
 ['KONTRA_BANK_GARANSI','Kontra Bank Garansi'],['LAINNYA','Lainnya']];
const currentYear=new Date().getFullYear();
export function StandardAnalysisPanel({app,role,busy,api,onCommand}:Props){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!readers.has(role)){setData(null);return;}
  let alive=true;api('/applications/'+app.id+'/standard-analysis')
   .then(d=>{if(alive){setData(d);setError('')}})
   .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Formulir tidak tersedia')});
  return()=>{alive=false};
 },[app.id,app.version,role]);
 if(!readers.has(role))return null;
 const record=data?.current,docs=app.documents||[];
 const evidence=(kind:string,name:string)=><label>{name}<select name={kind} required>
  <option value="">Pilih bukti terverifikasi</option>
  {docs.filter(d=>d.kind===kind&&d.verified).map(d=>
    <option key={d.id} value={d.id}>{d.id.slice(0,16)}</option>)}
 </select></label>;
 const field=(f:FormData,k:string)=>String(f.get(k)||'').trim();
 const submit=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();const f=new FormData(event.currentTarget);
  const year1=Number(field(f,'year1')),year2=Number(field(f,'year2')),
    year3=field(f,'year3');
  const history=[{year:year1,profit:field(f,'profit1')},{year:year2,profit:field(f,'profit2')}];
  if(year3)history.push({year:Number(year3),profit:field(f,'profit3')});
  const packet={
   checklist_complete:f.get('checklist_complete')==='on',
   owner:field(f,'owner'),owner_other:field(f,'owner_other'),
   project_type:field(f,'project_type'),project_type_other:field(f,'project_type_other'),
   project_value:field(f,'project_value'),
   funding_source:field(f,'funding_source'),funding_other:field(f,'funding_other'),
   project_document:field(f,'CONTRACT'),contract_reference:field(f,'contract_reference'),
   contract_date:field(f,'contract_date'),completion_months:field(f,'completion_months'),
   guarantee_amount:app.amount,guarantee_type:field(f,'guarantee_type'),
   guarantee_other:field(f,'guarantee_other'),
   customer_relationship:field(f,'customer_relationship'),
   business_years:field(f,'business_years'),management:field(f,'management'),
   slik_document:field(f,'SLIK'),slik_comment:field(f,'slik_comment'),
   projects_completed:field(f,'projects_completed'),
   projects_last_year:field(f,'projects_last_year'),
   last_year_project_value:field(f,'last_year_project_value'),
   business_condition:field(f,'business_condition'),profit_history:history,
   financial_document:field(f,'LAPORAN_KEUANGAN'),
   bank_support:field(f,'bank_support'),bank_support_details:field(f,'bank_support_details'),
   additional_collateral:field(f,'additional_collateral'),
   collateral_type_other:field(f,'guarantee_other'),
   recommendation:field(f,'recommendation'),reason:field(f,'reason'),
  };
  void onCommand('record_standard_analysis',packet);
 };
 const review=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();const f=new FormData(event.currentTarget);
  void onCommand('review_standard_analysis',{
   accepted:f.get('accepted')==='true',reason:String(f.get('reason')||'')
  });
 };
 return <section className="card section-gap">
  <div className="card-title"><h2>Formulir Standar Analisa (Lampiran 5)</h2>
   <span>RM → Reviewer · 5C evidence</span></div>
  <p className="fine">Fakta proyek dan usaha ditinjau secara manual; ambang 3 tahun, 5 proyek dan Rp5 miliar pada Lampiran 5 tidak digunakan sebagai keputusan otomatis. DER dan NWC dihitung di analisis 5C.</p>
  {error?<p className="alert error">{error}</p>:null}
  {record?<div className="detail-list">
    <dt>Revisi / status</dt><dd>{record.revision} · {record.status}</dd>
    <dt>Proyek</dt><dd>{record.project?.owner} · {record.project?.type}</dd>
    <dt>Nilai proyek</dt><dd>Rp {record.project?.value}</dd>
    <dt>Usulan RM</dt><dd>{record.recommendation||'—'} (bukan keputusan otomatis)</dd>
    <dt>Pemeriksa</dt><dd>{record.reviewer||'Belum ada'}</dd>
   </div>:<p>Belum ada Formulir Standar Analisa tercatat.</p>}
  {data?.history&&data.history.length>1?<details><summary>Riwayat revisi ({data.history.length})</summary>
   <ul>{data.history.map(item=><li key={item.id}>Revisi {item.revision} · {item.status}</li>)}</ul>
  </details>:null}
  {role==='AO'&&app.state==='SP2KBG_ISSUED'&&(!record||['REVIEWED','RETURNED'].includes(record.status))?
   <details><summary>{record?'Revisi Formulir Analisa':'Isi Formulir Analisa'}</summary>
    <form onSubmit={submit}>
     <label className="checkbox"><input type="checkbox" name="checklist_complete" required/>
      Formulir checklist dokumen sudah ditinjau dan dinyatakan lengkap</label>
     <fieldset><legend>Data Proyek / Pekerjaan</legend>
      <div className="form-grid">
       <label>Pemilik proyek<select name="owner">{owners.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
       <label>Pemilik lainnya (jika dipilih)<input name="owner_other" maxLength={300}/></label>
       <label>Jenis proyek<select name="project_type">{projectTypes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
       <label>Jenis lain (jika dipilih)<input name="project_type_other" maxLength={300}/></label>
       <label>Nilai proyek / pekerjaan (IDR)<input name="project_value" type="number" min="1" step=".01" required/></label>
       <label>Sumber pembiayaan<select name="funding_source"><option value="APBN_APBD">APBN/APBD</option><option value="LAINNYA">Lainnya</option></select></label>
       <label>Sumber lainnya (jika dipilih)<input name="funding_other" maxLength={300}/></label>
       {evidence('CONTRACT','Dokumen pokok / kontrak terverifikasi')}
       <label>Nomor dokumen pokok<input name="contract_reference" minLength={5} required/></label>
       <label>Tanggal dokumen pokok<input name="contract_date" type="date" required/></label>
       <label>Jangka waktu penyelesaian (bulan)<input name="completion_months" type="number" min="0" step="1" required/></label>
       <label>Nilai pengujian BG (dari permohonan)<input value={app.amount} readOnly/></label>
       <label>Jenis jaminan<select name="guarantee_type">{guaranteeTypes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
       <label>Jenis jaminan lainnya<input name="guarantee_other" maxLength={200}/></label>
      </div>
     </fieldset>
     <fieldset><legend>A. Character</legend><div className="form-grid">
      <label>Principal<select name="customer_relationship"><option value="DEBITUR_BARU">Debitur Baru</option><option value="DEBITUR_EKSIS">Debitur Eksis</option></select></label>
      <label>Pengalaman usaha (tahun)<input name="business_years" type="number" step="1" min="0" required/></label>
      <label>Susunan pengurus / manajemen<textarea name="management" minLength={8} required/></label>
      {evidence('SLIK','Hasil BI Checking / SLIK terverifikasi')}
      <label>Uraian pemeriksaan SLIK<textarea name="slik_comment" minLength={8} required/></label>
     </div></fieldset>
     <fieldset><legend>B. Condition</legend><div className="form-grid">
      <label>Proyek selesai (seluruh periode)<input name="projects_completed" type="number" min="0" step="1" required/></label>
      <label>Jumlah proyek selesai tahun terakhir<input name="projects_last_year" type="number" min="0" step="1" required/></label>
      <label>Nilai proyek 1 tahun terakhir (IDR)<input name="last_year_project_value" type="number" min="0" step=".01" required/></label>
      <label>Kondisi usaha<textarea name="business_condition" minLength={8} required/></label>
     </div></fieldset>
     <fieldset><legend>C. Capacity — Laba (rugi negatif) 2 tahun; baris ketiga opsional sesuai formulir</legend>
      {evidence('LAPORAN_KEUANGAN','Laporan keuangan terverifikasi')}
      <div className="form-grid">
       {[1,2,3].map((n)=><div key={n}>
        <label>Tahun {n}<input name={'year'+n} type="number" min="1900" max={currentYear}
          defaultValue={n<=2?currentYear-n:undefined} required={n<3}/></label>
        <label>Laba/rugi {n} (IDR)<input name={'profit'+n} type="number" step=".01" required={n<3}/></label>
       </div>)}
      </div>
     </fieldset>
     <fieldset><legend>D. Capital</legend>
      <p className="fine">DER dan NWC dihitung berdasarkan data keuangan 5C; angka tidak diinput dua kali.</p>
      <label>Dukungan bank<select name="bank_support"><option value="TIDAK_ADA">Tidak ada</option><option value="ADA">Ada</option></select></label>
      <label>Uraian dukungan (jika ada)<textarea name="bank_support_details"/></label>
     </fieldset>
     <fieldset><legend>E. Collateral</legend>
      <label>Nilai agunan tambahan (IDR, nol jika tidak ada)<input name="additional_collateral" type="number" min="0" step=".01" defaultValue="0" required/></label>
     </fieldset>
     <fieldset><legend>Usulan Relationship Manager</legend>
      <label>Usulan<select name="recommendation"><option value="LAYAK">Layak</option><option value="TIDAK_LAYAK">Tidak Layak</option></select></label>
      <label>Alasan usulan<textarea name="reason" minLength={15} maxLength={4000} required/></label>
     </fieldset>
     <button className="secondary" disabled={busy}>Simpan dan kirim ke reviewer</button>
    </form>
   </details>:null}
  {['MPO','COMPLIANCE'].includes(role)&&app.state==='SP2KBG_ISSUED'&&record?.status==='PENDING_REVIEW'?
   <form onSubmit={review}>
    <h3>Review independen Formulir Standar Analisa</h3>
    <label>Keputusan<select name="accepted"><option value="true">Disetujui untuk analisa 5C</option><option value="false">Kembalikan ke RM</option></select></label>
    <label>Alasan reviewer<textarea name="reason" minLength={8} required/></label>
    <button className="secondary" disabled={busy}>Simpan review standar analisa</button>
   </form>:null}
 </section>;
}
