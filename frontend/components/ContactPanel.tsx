'use client';
import {useEffect,useState,type FormEvent} from 'react';

type Message={id:string;from:string;to:string;topic:string;message:string;at:string};
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
const TOPICS=[
 {id:'KLARIFIKASI',label:'Konfirmasi atau klarifikasi data'},
 {id:'KELENGKAPAN_DOKUMEN',label:'Permintaan kelengkapan dokumen'},
 {id:'JADWAL_KUNJUNGAN',label:'Koordinasi survei / kunjungan'},
 {id:'LAINNYA',label:'Informasi lain terkait permohonan'},
];
export function ContactPanel({applicationId,role,api,work,busy}:{applicationId:string;role:string;api:Api;work:(fn:()=>Promise<void>)=>Promise<void>;busy:boolean}){
 const [messages,setMessages]=useState<Message[]>([]);
 const [error,setError]=useState('');
 const group=['PRINCIPAL','PENJAMIN','BROKER'].includes(role)?role:'BANK';
 const targets=group==='BANK'?['PRINCIPAL','PENJAMIN','BROKER']:group==='PRINCIPAL'?['BANK','PENJAMIN']:group==='PENJAMIN'?['BANK','PRINCIPAL']:['BANK','PRINCIPAL'];
 useEffect(()=>{let active=true;setError('');api('/applications/'+applicationId+'/messages').then((r:Message[])=>{if(active)setMessages(r)}).catch((e:Error)=>{if(active)setError(e.message)});return()=>{active=false}},[applicationId]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,values=new FormData(form);
  await work(async()=>{
    await api('/applications/'+applicationId+'/messages','POST',{recipient:values.get('recipient'),topic:values.get('topic'),message:values.get('message')});
    setMessages(await api('/applications/'+applicationId+'/messages'));
    form.reset();
  });
 }
 return <section className="card section-gap bg-contact" aria-label="Komunikasi pengajuan">
   <div className="card-title"><h2>Komunikasi & permintaan klarifikasi</h2><span>Pesan tercatat dalam audit</span></div>
   <p className="fine">Bank, Penjamin dan Principal dapat meminta konfirmasi, kelengkapan dokumen atau koordinasi kunjungan melalui aplikasi. Ini pesan internal; belum ada pengiriman email/WhatsApp otomatis.</p>
   {error?<p className="alert error" role="alert">{error}</p>:null}
   <div className="bg-messages">
     {messages.length?messages.map(m=><article className="bg-message" key={m.id}>
       <div><strong>{m.from} → {m.to}</strong><small>{new Date(m.at).toLocaleString('id-ID')}</small></div>
       <span>{TOPICS.find(t=>t.id===m.topic)?.label||m.topic}</span>
       <p>{m.message}</p>
     </article>):<p className="fine">Belum ada pesan untuk peran Anda pada pengajuan ini.</p>}
   </div>
   <form onSubmit={submit}>
     <div className="form-grid">
       <label>Ditujukan kepada<select name="recipient" required>{targets.map(t=><option key={t} value={t}>{t==='BANK'?'Bank penerbit':t==='PENJAMIN'?'Perusahaan penjamin':t==='PRINCIPAL'?'Principal':'Broker berkuasa'}</option>)}</select></label>
       <label>Keperluan<select name="topic" required>{TOPICS.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
     </div>
     <label>Isi pesan<textarea name="message" minLength={3} maxLength={1000} rows={3} required placeholder="Data yang perlu dikonfirmasi, dokumen kurang, atau usulan kunjungan…"/></label>
     <button className="secondary" disabled={busy}>Kirim melalui portal</button>
   </form>
 </section>;
}
