'use client';
import {useState,type FormEvent} from 'react';
type Rule={code:string;source:string|null;applicable:boolean;passed:boolean;message:string};
type Result={policy_id:string;version:number;simulation_only:boolean;passed:boolean;policy_hash:string;results:Rule[]};
type Props={policyId:string;api:(path:string,method?:string,body?:unknown)=>Promise<any>;busy:boolean;work:(callback:()=>Promise<void>)=>Promise<void>};
const initialFacts={
 default_or_justified:true,sp2_valid:true,eligible:true,committee_complete:true,
 slik_current:true,documents_complete:true,format_approved:true,format_hash_matches:true,
 nib_present:true,principal_office_request:true,mkp_interoffice:true,ememo_complete:true,
 split_correct:true,split_timely:true,signer_authorized:true,portfolio_owned:true,
 claim_submitter_authorized:true,claim_report_timely:true,monitoring_assigned:true,litigation_routed:true,
};
export function PolicySimulationPanel({policyId,api,busy,work}:Props){
 const [facts,setFacts]=useState(JSON.stringify(initialFacts,null,2));
 const [result,setResult]=useState<Result|null>(null);
 const [codes,setCodes]=useState('');
 const submit=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();
  void work(async()=>{
   const data=JSON.parse(facts);
   if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Facts harus objek JSON');
   const selected=codes.split(',').map(s=>s.trim()).filter(Boolean);
   const response=await api('/policies/'+policyId+'/simulate','POST',{
    facts:data,...(selected.length?{codes:selected}:{})
   });
   setResult(response);
  });
 };
 return <section className="section-gap">
  <div className="card-title"><h3>Simulasi aturan (dry-run)</h3><span>Tidak mengubah keputusan transaksi</span></div>
  <p className="fine">Uji kebijakan sandbox BR-01 hingga BR-20 menggunakan facts. Hasil serta hash-nya tercatat di audit, bukan persetujuan bank yang sah.</p>
  <form onSubmit={submit}>
   <label>Kode rule (opsional, pisahkan koma)<input value={codes} onChange={e=>setCodes(e.target.value)} placeholder="Contoh: BR-03,BR-05; kosong = seluruh rules"/></label>
   <label>Facts JSON<textarea value={facts} onChange={e=>setFacts(e.target.value)} rows={12} spellCheck={false} required/></label>
   <button className="secondary" disabled={busy||!policyId}>Simulasikan dan simpan audit</button>
  </form>
  {result?<div className="table-scroll">
   <p><strong>Version {result.version}</strong> · {result.passed?'Semua aturan lulus':'Terdapat aturan gagal'} · Simulation only · {result.policy_hash.slice(0,12)}</p>
   <table><thead><tr><th>Rule</th><th>Applicable</th><th>Result</th><th>Penjelasan</th></tr></thead>
    <tbody>{result.results.map(r=><tr key={r.code}>
     <td>{r.code}</td><td>{r.applicable?'Ya':'Tidak'}</td>
     <td>{r.passed?'PASS':'FAIL'}</td><td>{r.message}</td>
    </tr>)}</tbody>
   </table>
  </div>:null}
 </section>;
}
