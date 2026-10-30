'use client';

const STEPS = [
  {title:"Pengajuan & dokumen",description:"Draft dan unggah persyaratan"},
  {title:"Verifikasi administrasi",description:"Legalitas dan pemeriksaan dasar"},
  {title:"Analisis Bank & Penjamin",description:"Underwriting dan persetujuan"},
  {title:"Offering & akad",description:"Penawaran, MKP dan akad"},
  {title:"Pembayaran biaya",description:"Administrasi dan ujrah"},
  {title:"Penerbitan dokumen",description:"BG dan kontra garansi"},
  {title:"Penyerahan dokumen",description:"Penyerahan kepada pihak terkait"},
];
export function principalStage(state:string):number {
  if(["DRAFT"].includes(state))return 0;
  if(["KYC_KYB_CHECK","SLIK_CHECK"].includes(state))return 1;
  if(["PENJAMIN_REQUESTED","PENJAMIN_UNDERWRITING","SP2KBG_ISSUED","CUSTOM_FORMAT_REVIEW","APPROVAL","APPROVAL_GRANTED"].includes(state))return 2;
  if(["MKP_SIGNED","AKAD_SIGNED"].includes(state))return 3;
  if(state==="FEE_COLLECTED")return 4;
  if(["INTER_OFFICE_ISSUANCE","BG_ISSUED","KONTRA_BG_ISSUED"].includes(state))return 5;
  if(["DELIVERED_TO_OBLIGEE","ACTIVE"].includes(state))return 6;
  return 0;
}
export function PrincipalJourney({state}:{state:string}){
  const current=principalStage(state);
  return <section className="card section-gap principal-journey" aria-label="Progres pengajuan Bank Garansi">
    <div className="card-title"><h2>Progres pengajuan Anda</h2><span>Tahap {current+1} dari {STEPS.length}</span></div>
    <ol>{STEPS.map((step,i)=><li key={step.title} className={i<current?'done':i===current?'current':'upcoming'} aria-current={i===current?'step':undefined}>
      <span className="journey-index">{i<current?'✓':i+1}</span>
      <div><strong>{step.title}</strong><small>{step.description}</small></div>
    </li>)}</ol>
    <p className="fine">Status ringkas untuk Principal. Pemeriksaan dan keputusan tetap dilakukan oleh petugas Bank dan Penjamin sesuai kewenangan.</p>
  </section>;
}
