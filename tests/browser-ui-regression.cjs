const { chromium } = require('../frontend/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.BG_UAT_BASE || 'http://127.0.0.1:8787';
const password = process.env.BG_UAT_PASSWORD || fs.readFileSync(path.join(__dirname,'../.uat-password'),'utf8').trim();
const results=[];
async function step(label,fn){try{await fn();results.push({label,status:'PASS'});console.log('PASS',label)}catch(e){results.push({label,status:'FAIL',message:String(e.message).slice(0,400)});console.log('FAIL',label,String(e.message).slice(0,360));throw e}}
async function login(p,id){await p.goto(base,{waitUntil:'domcontentloaded'});await p.locator('input[name=username]').waitFor({timeout:17000});await p.fill('input[name=username]',id);await p.fill('input[name=password]',password);await p.locator('form button').click();await p.locator('nav[aria-label="Menu utama"]').waitFor({timeout:16000});}
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const p=await browser.newPage({viewport:{width:390,height:844}});
  const jsErrors=[],serverErrors=[];
  p.on('pageerror',err=>jsErrors.push(err.message));
  p.on('response',r=>{if(r.status()>=500&&r.url().includes('/api/'))serverErrors.push(r.url()+': '+r.status())});
  try{
    await step('Principal authenticates in isolated sandbox',async()=>{await login(p,'principal');assert.match(await p.locator('.workspace').innerText(),/Principal/i)});
    await step('Mobile sidebar opens and closes using visible close control',async()=>{
      const toggle=p.getByRole('button',{name:'Buka atau tutup menu'});
      await toggle.click();
      assert.equal(await p.locator('.sidebar.open').count(),1);
      const close=p.getByRole('button',{name:'Tutup menu navigasi'});
      await close.click();
      assert.equal(await p.locator('.sidebar.open').count(),0);
    });
    await p.setViewportSize({width:1440,height:900});
    let name='E2E browser regression '+Date.now();
    await step('Principal creates draft with required UI fields',async()=>{
      await p.getByRole('button',{name:/Pengajuan baru/}).click();
      await p.fill('[name=project_name]',name);
      await p.fill('[name=amount]','120000000');
      await p.fill('[name=issue_on]','2026-11-03');
      await p.fill('[name=expires_on]','2027-03-03');
      await p.getByRole('button',{name:'Simpan draft pengajuan'}).click();
      await p.getByText(name,{exact:true}).first().waitFor({timeout:17000});
      assert.match(await p.locator('main.content').innerText(),/Draft/i);
    });
    await step('Submission blocked on missing NIB',async()=>{
      await p.getByRole('button',{name:'Kirim pengajuan →'}).click();
      await p.locator('main.content [role=alert]').waitFor({timeout:13000});
      assert.match(await p.locator('main.content [role=alert]').innerText(),/NIB wajib/i);
    });
    const upload=p.locator('#bg-document-upload');
    await step('Invalid file extension rejected client side',async()=>{
      await upload.locator('select[name=kind]').selectOption('NIB');
      await upload.locator('input[type=file]').setInputFiles({name:'not-allowed.exe',mimeType:'application/octet-stream',buffer:Buffer.from('UAT invalid test file')});
      await upload.getByRole('button',{name:'Unggah dokumen'}).click();
      assert.match(await p.locator('main.content [role=alert]').innerText(),/Format berkas harus/i);
    });
    await step('Valid TXT evidence accepted by upload button',async()=>{
      await upload.locator('select[name=kind]').selectOption('NIB');
      await upload.locator('input[name=source]').fill('UAT-NIB');
      await upload.locator('input[type=file]').setInputFiles({name:'nib-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('UAT MOCK NIB evidence for secure isolated testing only.\n')});
      await upload.getByRole('button',{name:'Unggah dokumen'}).click();
      await p.getByText(/Dokumen berhasil diunggah/).waitFor({timeout:18000});
      await p.getByText('Menunggu verifikasi',{exact:true}).first().waitFor({timeout:16000});
    });
    await step('Principal cannot independently mark evidence verified',async()=>{
      const main=await p.locator('main.content').innerText();
      assert.match(main,/Menunggu verifikasi/);
      assert.equal(await p.getByRole('button',{name:/Verifikasi dokumen/i}).count(),0);
    });
    await step('Principal logout',async()=>{await p.getByRole('button',{name:'Keluar',exact:true}).click();await p.locator('input[name=username]').waitFor({timeout:15000})});
    await step('Compliance role can view created case without client errors',async()=>{
      await login(p,'compliance');
      await p.locator('nav button').filter({hasText:'Pengajuan'}).click();
      await p.getByText(name,{exact:true}).first().waitFor({timeout:14000});
      await p.getByRole('button',{name:'Buka →'}).first().click();
      assert.match(await p.locator('main.content').innerText(),/NIB/i);
    });
    await step('Compliance logout',async()=>{await p.getByRole('button',{name:'Keluar',exact:true}).click();await p.locator('input[name=username]').waitFor({timeout:15000})});
    await step('No uncaught JavaScript errors / HTTP 5xx',async()=>{assert.deepEqual(jsErrors,[]);assert.deepEqual(serverErrors,[])});
  }catch(e){console.error('REGRESSION FAILED',e.message.slice(0,400));process.exitCode=1}
  const report={timestamp:new Date().toISOString(),base,results,jsErrors,serverErrors,passed:results.filter(r=>r.status==='PASS').length,total:results.length};
  fs.mkdirSync(path.join(__dirname,'../evidence'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../evidence/uat-ui-regression-20261031.json'),JSON.stringify(report,null,2));
  console.log('RESULT',JSON.stringify({passed:report.passed,total:report.total,errors:jsErrors,serverErrors}));
  await browser.close();
})().catch(err=>{console.error(err);process.exitCode=1});
