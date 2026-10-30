'use client';
import {useState} from 'react';

export type ChecklistStatus='MISSING'|'PENDING'|'VERIFIED'|'UPCOMING'|'CONDITIONAL';
export type ChecklistItem={
  kind:string;label:string;group:string;phase:number;phase_label:string;
  required:boolean;status:ChecklistStatus;note:string;document_id:string|null;
};
export type DocumentChecklistData={
  source:string;note:string;stage:string;ready:boolean;
  notification:string;
  counts:{required:number;verified:number;missing:number;pending:number;upcoming:number};
  items:ChecklistItem[];
};
const STATUS:Record<ChecklistStatus,string>={
  MISSING:'Belum diunggah',
  PENDING:'Menunggu verifikasi',
  VERIFIED:'Terverifikasi',
  UPCOMING:'Tahap berikutnya',
  CONDITIONAL:'Jika dipersyaratkan',
};
export function DocumentChecklist({
  checklist,uploadable,onUpload,
}:{
  checklist:DocumentChecklistData;
  uploadable:string[];
  onUpload:(kind:string)=>void;
}){
  const [filter,setFilter]=useState<'ATTENTION'|'ALL'>('ALL');
  const selected=filter==='ATTENTION'
    ? checklist.items.filter(x=>x.status==='MISSING'||x.status==='PENDING')
    : checklist.items;
  const groups=[...new Set(selected.map(x=>x.group))];
  return <section className="card section-gap bg-checklist" aria-label="Checklist persyaratan dokumen">
    <div className="card-title">
      <h2>Checklist kelengkapan dokumen</h2>
      <span>Pedoman BG · Sesuai jenis dan tahapan</span>
    </div>
    <p className="bg-checklist-stage">Tahap transaksi: <strong>{checklist.stage}</strong></p>
    <div className="bg-checklist-metrics" aria-label="Ringkasan status dokumen">
      <div><b>{checklist.counts.verified}/{checklist.counts.required}</b><span>Wajib terverifikasi</span></div>
      <div><b>{checklist.counts.missing}</b><span>Belum diunggah</span></div>
      <div><b>{checklist.counts.pending}</b><span>Perlu verifikasi</span></div>
      <div><b>{checklist.counts.upcoming}</b><span>Tahap berikutnya</span></div>
    </div>
    <div className={'bg-checklist-notice '+(checklist.ready?'complete':'incomplete')} role="status">
      <strong>{checklist.ready?'✓ Dokumen tahap ini telah lengkap':'Perhatian: persyaratan dokumen belum lengkap'}</strong>
      <p>{checklist.notification}</p>
    </div>
    <div className="bg-checklist-filters" role="group" aria-label="Filter checklist">
      <button type="button" className={filter==='ATTENTION'?'selected':''} aria-pressed={filter==='ATTENTION'} onClick={()=>setFilter('ATTENTION')}>Perlu tindakan ({checklist.counts.missing+checklist.counts.pending})</button>
      <button type="button" className={filter==='ALL'?'selected':''} aria-pressed={filter==='ALL'} onClick={()=>setFilter('ALL')}>Seluruh persyaratan ({checklist.items.length})</button>
    </div>
    {groups.length?groups.map(group=><div className="bg-checklist-group" key={group}>
      <h3>{group}</h3>
      {selected.filter(i=>i.group===group).map(i=><div className="bg-checklist-item" key={i.kind}>
        <div className="bg-checklist-info">
          <strong>{i.label}</strong>
          <small>{i.required?'Wajib':'Kondisional'} · {i.phase_label}</small>
          {i.note?<p>{i.note}</p>:null}
        </div>
        <div className="bg-checklist-actions">
          <span className={'bg-checklist-status '+i.status.toLowerCase()}>{STATUS[i.status]}</span>
          {['MISSING','UPCOMING','CONDITIONAL'].includes(i.status)&&uploadable.includes(i.kind)?<button type="button" className="text-button" onClick={()=>onUpload(i.kind)}>Unggah</button>:null}
          {i.status==='PENDING'?<small>Menunggu petugas pemeriksa</small>:null}
          {i.status==='MISSING'&&!uploadable.includes(i.kind)?<small>Hubungi petugas terkait</small>:null}
        </div>
      </div>)}
    </div>):<p className="bg-checklist-empty">Tidak ada dokumen yang memerlukan tindak lanjut pada tahap ini. Buka seluruh persyaratan untuk melihat dokumen kondisional dan tahap berikutnya.</p>}
    <p className="bg-checklist-footnote">{checklist.source}. {checklist.note}</p>
  </section>;
}
