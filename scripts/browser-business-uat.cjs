// Browser journey UAT against disposable Cloudflare Workerd/SQLite, never production.
// Action-button clicks exercise the same public UI as a bank user.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('../frontend/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bg-ui-uat-'));
const port=18541,base='http://127.0.0.1:'+port;
const credentials=JSON.parse(fs.readFileSync(path.join(root,'runtime/sandbox-credentials.json')));
const log=fs.openSync(path.join(tmp,'workerd.log'),'w');
const worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','frontend/wrangler.jsonc','--ip','127.0.0.1','--port',String(port),'--local','--inspector-port','18542','--env-file','runtime/native-test.env','--persist-to',path.join(tmp,'sqlite')],{cwd:root,stdio:['ignore',log,log]});
let browser,page,appId,projectName,claimId;
const steps=[],observed=[],errors=[];
const rolePages=new Map();
async function readiness(){for(let i=0;i<300;i++){try{let r=await fetch(base+'/api/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,120))}throw Error('Isolated native Worker failed to start');}
async function login(role){await page.goto(base);await page.getByLabel('Username',{exact:true}).fill(role);await page.getByLabel('Password',{exact:true}).fill(credentials[role]);await page.getByRole('button',{name:/Masuk dengan aman/}).click();await page.getByRole('heading',{name:'Kendali jaminan, satu pandangan.'}).waitFor({timeout:15000});}
async function logout(){await page.getByRole('button',{name:'Keluar',exact:true}).click();await page.getByRole('heading',{name:'Masuk ke ruang kerja'}).waitFor({timeout:15000});}
async function as(role,fn){
  // Persist a dedicated browser context per role. The production-like per-IP
  // authentication rate limiter rejects >30 repeated logins per minute.
  if(!rolePages.has(role)){
    const ctx=await browser.newContext({viewport:{width:1440,height:900}});
    const p=await ctx.newPage();
    p.on('pageerror',e=>errors.push(role+': '+e.message));
    page=p;await login(role);
    rolePages.set(role,{ctx,page:p});
  }else{
    page=rolePages.get(role).page;
    await page.goto(base);
    await page.getByRole('heading',{name:'Kendali jaminan, satu pandangan.'}).waitFor({timeout:15000});
  }
  return fn();
}
async function getJson(path){return page.evaluate(async p=>{const r=await fetch('/api'+p);return r.json()},path)}
async function openApp(){
 await page.locator('aside nav button').filter({hasText:'Pengajuan'}).click();
 const row=page.getByRole('row').filter({hasText:projectName});
 await row.getByRole('button',{name:'Buka →'}).click();
 await page.getByRole('heading',{name:'Ringkasan Bank Garansi'}).waitFor({timeout:10000});
}
function fillText(form,field,value){return form.locator('[name="'+field+'"]').fill(String(value))}
async function create(){
 await as('principal',async()=>{
  projectName='Full Browser UAT '+Date.now();
  await page.getByRole('button',{name:'＋ Pengajuan baru'}).click();
  await page.getByLabel('Nama proyek / pekerjaan',{exact:true}).fill(projectName);
  await page.getByLabel('Nilai Bank Garansi (IDR)').fill('2000000000');
  const exp=new Date();exp.setDate(exp.getDate()+140);
  await page.getByLabel('Berakhirnya Bank Garansi').fill(exp.toISOString().slice(0,10));
  await page.getByRole('button',{name:'Simpan draft pengajuan'}).click();
  await page.getByRole('heading',{name:'Ringkasan Bank Garansi'}).waitFor({timeout:15000});
  const apps=await getJson('/applications'),a=apps.find(x=>x.project_name===projectName);
  assert.ok(a,'UI created application not visible');appId=a.id;
  steps.push({role:'principal',button:'Simpan draft pengajuan',state:a.state});
 });
}
async function upload(role,kind){
 await as(role,async()=>{
  await openApp();
  const form=page.locator('#bg-document-upload');
  await form.locator('select[name=kind]').selectOption(kind);
  await form.locator('input[name=source]').fill('Sumber primer UI UAT: '+kind);
  await form.locator('input[name=file]').setInputFiles({name:kind.toLowerCase()+'.txt',mimeType:'text/plain',buffer:Buffer.from('TEST ONLY '+kind+' '+Math.random())});
  await form.getByRole('button',{name:'Unggah dokumen'}).click();
  await page.getByRole('status').filter({hasText:'Dokumen berhasil diunggah'}).waitFor({timeout:12000});
  steps.push({role,button:'Unggah dokumen',kind});
 });
}
async function verifyPending(){
 await as('compliance',async()=>{
  await openApp();
  const buttons=page.getByRole('button',{name:'Verifikasi',exact:true});
  let verified=0;
  for(let i=0;i<20;i++){
   const n=await buttons.count();if(n===0)break;
   page.once('dialog',d=>d.accept('Bukti primer sudah diperiksa independen dalam sandbox'));
   await buttons.first().click();
   await page.waitForFunction(count=>[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Verifikasi').length<count,n,{timeout:10000});
   verified++;
  }
  assert.equal(await buttons.count(),0,'Pending document validation remains');
  steps.push({role:'compliance',button:'Verifikasi',verified});
 });
}
async function appAction(role,action,opts={}){
 await as(role,async()=>{
  await openApp();
  const form=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Langkah berikutnya'})}).locator('form');
  await form.waitFor({timeout:10000});
  const actions=await form.locator('select').first().locator('option').evaluateAll(els=>els.map(x=>x.value));
  assert.ok(actions.includes(action),role+' missing action button '+action+' options '+actions);
  await form.locator('select').first().selectOption(action);
  if(opts.document)await form.locator('select[name=document]').selectOption({index:1});
  if(action==='kyb_pass'){
   await form.locator('input[name=screening]').check();
   await form.locator('input[name=ubo]').check();
  }
  if(action==='record_slik'){
   await form.locator('select[name=document]').selectOption({index:1});
   await form.locator('select[name=collectibility]').selectOption('1');
   await form.locator('input[name=pulled_at]').fill(new Date().toISOString().slice(0,16));
  }
  if(action==='sp2_issue'){
   await form.locator('select[name=document]').selectOption({index:1});
   await fillText(form,'reference','SP2-UI-UAT');
   const a=await getJson('/applications/'+appId);
   await form.locator('input[name=valid_to]').fill(a.expires_on);
  }
  if(action==='certificate')await fillText(form,'reference','CONTRA-CERT-UAT');
  const old=(await getJson('/applications/'+appId)).version;
  await form.locator('button').last().click();
  await page.waitForFunction(async({id,v})=>{
   const r=await fetch('/api/applications/'+id);const x=await r.json();
   return x.version>v||!!document.querySelector('.alert.error');
  },{id:appId,v:old},{timeout:15000});
  const latest=await getJson('/applications/'+appId);
  assert.ok(latest.version>old,role+' '+action+' not saved: '+(await page.locator('.alert.error').allInnerTexts()).join(' | '));
  steps.push({role,button:action,state:latest.state});
 });
}
async function submitClaim(){
 await as('obligee',async()=>{
  await openApp();
  const form=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Pengajuan klaim'})}).locator('form');
  await form.locator('select[name=document]').selectOption({index:1});
  await form.locator('input[name=amount]').fill('100000000');
  await form.getByRole('button',{name:'Ajukan klaim'}).click();
  await page.waitForFunction(async()=>{const r=await fetch('/api/claims');const d=await r.json();return Array.isArray(d)&&d.length===1},{timeout:12000});
  const claims=await getJson('/claims');claimId=claims[0].id;
  steps.push({role:'obligee',button:'Ajukan klaim'});
 });
}
async function claimAction(role,action,opts={}){
 await as(role,async()=>{
  await page.locator('aside nav button').filter({hasText:'Klaim'}).click();
  const card=page.locator('article.card').filter({has:page.getByRole('button',{name:'Simpan keputusan'})});
  await card.waitFor({timeout:12000});
  const form=card.locator('form').filter({has:page.getByRole('button',{name:'Simpan keputusan'})});
  const options=await form.locator('select').first().locator('option').evaluateAll(els=>els.map(x=>x.value));
  assert.ok(options.includes(action),role+' missing claim action '+action+' options '+options);
  await form.locator('select').first().selectOption(action);
  if(opts.document)await form.locator('select[name=document]').selectOption({index:1});
  if(action==='approve_claim')await form.locator('input[name=validated]').check();
  if(action==='contra_decision'){
   await form.locator('select[name=decision]').selectOption(opts.decision||'PAID');
   await fillText(form,'reason','UAT klaim kontra test only');
  }
  const old=(await getJson('/claims')).find(x=>x.id===claimId).version;
  await form.getByRole('button',{name:'Simpan keputusan'}).click();
  await page.waitForFunction(async({id,v})=>{
   const r=await fetch('/api/claims');const d=await r.json();
   return d.find(x=>x.id===id)?.version>v||!!document.querySelector('.alert.error');
  },{id:claimId,v:old},{timeout:15000});
  const final=(await getJson('/claims')).find(x=>x.id===claimId);
  assert.ok(final.version>old,role+' '+action+' not saved: '+(await page.locator('.alert.error').allInnerTexts()).join(' | '));
  steps.push({role,button:action,state:final.state});
 });
}
async function recoveryAction(role,action,opts={}){
 await as(role,async()=>{
  await page.locator('aside nav button').filter({hasText:'Klaim'}).click();
  const panel=page.locator('section[aria-label="Pemulihan dan subrogasi"]');
  await panel.waitFor({timeout:12000});
  const form=panel.locator('form');
  await form.waitFor({timeout:12000});
  await form.locator('select').first().selectOption(action);
  if(opts.document)await form.locator('select[name=document]').selectOption({index:1});
  if(action==='record_recovery_action')await form.locator('select[name=action_type]').selectOption('DEMAND');
  if(opts.accepted!==undefined)await form.locator('select[name=accepted]').selectOption(String(opts.accepted));
  await fillText(form,'reason','Pemeriksaan bukti primer lintas role dalam simulasi UAT');
  const before=(await getJson('/claims')).find(x=>x.id===claimId).version;
  await form.getByRole('button',{name:'Simpan ke riwayat recovery'}).click();
  await page.waitForFunction(async({id,v})=>{
   const r=await fetch('/api/claims');const d=await r.json();
   return d.find(x=>x.id===id)?.version>v||!!document.querySelector('.alert.error');
  },{id:claimId,v:before},{timeout:15000});
  const after=(await getJson('/claims')).find(x=>x.id===claimId);
  assert.ok(after.version>before,role+' '+action+' not saved: '+(await page.locator('.alert.error').allInnerTexts()).join(' | '));
  steps.push({role,button:action,claimState:after.state});
 });
}
async function main(){
 try{
  await readiness();
  browser=await chromium.launch({headless:true});
  // Pages are created lazily, one isolated session per identity.
  await create();
  for(const kind of ['NIB','CONTRACT','KYB'])await upload('principal',kind);
  await verifyPending();
  await appAction('principal','submit');
  await appAction('compliance','kyb_pass');
  await upload('analyst','SLIK');await verifyPending();
  await appAction('analyst','record_slik',{document:true});
  await appAction('penjamin','partner_start');
  await upload('penjamin','SP2KBG');await verifyPending();
  await appAction('penjamin','sp2_issue',{document:true});
  await appAction('analyst','bank_underwrite');
  await appAction('mpo','approve');
  await appAction('mpo','sign_mkp');
  await appAction('principal','sign_akad');
  await appAction('mpo','sign_akad');
  await appAction('finance','collect_fee');
  await appAction('mpo','issue');
  await upload('penjamin','CERTIFICATE');await verifyPending();
  await appAction('penjamin','certificate',{document:true});
  await upload('obligee','DELIVERY');await verifyPending();
  await appAction('mpo','deliver',{document:true});
  assert.equal((await as('principal',async()=>getJson('/applications/'+appId))).state,'ACTIVE');
  await upload('obligee','CLAIM');await submitClaim();
  await claimAction('mpo','report');
  await claimAction('mpo','approve_claim');
  await claimAction('finance','pay_bank');
  await upload('litigation','RECOVERY_BASIS');await verifyPending();
  await recoveryAction('litigation','open_recovery',{document:true});
  await recoveryAction('legal','review_recovery',{accepted:true});
  await upload('litigation','RECOVERY_ACTION');await verifyPending();
  await recoveryAction('litigation','record_recovery_action',{document:true});
  await recoveryAction('legal','review_recovery_action',{accepted:true});
  await upload('litigation','RECOVERY_RESOLUTION');await verifyPending();
  await recoveryAction('litigation','request_recovery_closure',{document:true});
  await recoveryAction('legal','confirm_recovery_closure',{accepted:true});
  await upload('mpo','CONTRA_CLAIM');await verifyPending();
  await claimAction('mpo','submit_contra',{document:true});
  await upload('penjamin','CONTRA_DECISION');await verifyPending();
  await claimAction('penjamin','contra_decision',{document:true,decision:'PAID'});
  await upload('penjamin','CONTRA_PAYMENT');await verifyPending();
  await claimAction('finance','confirm_contra_paid',{document:true});
  await as('audit',async()=>{
    await page.locator('aside nav button').filter({hasText:'Audit'}).click();
    await page.getByRole('button',{name:'Periksa rantai hash'}).click();
    await page.getByRole('status').filter({hasText:'Rantai audit valid'}).waitFor({timeout:12000});
    const checked=await getJson('/audit/verify');
    assert.equal(checked.valid,true);
    assert.equal(checked.external_anchor_verified,false);
    steps.push({role:'audit',button:'Periksa rantai hash',events:checked.events});
  });
  assert.deepEqual(errors,[],'Uncaught browser errors');
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
  const result={status:'PASS',runtime:'Cloudflare Workerd native SQLite disposable',path:'UI buttons exercised end-to-end',application_id:'redacted',claim_id:'redacted',steps,button_actions:steps.filter(x=>x.button).length,external_integrations:'MOCK',real_money:false};
  fs.writeFileSync(path.join(root,'evidence/browser-business-uat.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:'PASS',button_actions:result.button_actions,steps:steps.map(x=>x.button)}));
 }finally{
  if(browser)await browser.close();
  worker.kill('SIGTERM');fs.closeSync(log);
  fs.rmSync(tmp,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
