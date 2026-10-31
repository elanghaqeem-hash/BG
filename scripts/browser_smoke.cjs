const fs=require('fs'),path=require('path'),assert=require('assert'),{spawn,spawnSync}=require('child_process'),os=require('os');
const {chromium}=require(process.env.BG_PLAYWRIGHT_MODULE||'../frontend/node_modules/playwright');
const root=path.resolve(__dirname,'..'),qa=process.env.BG_QA_DIR||path.join(root,'runtime','qa');
fs.mkdirSync(qa,{recursive:true});
const apiPort=18500,webPort=18501,base=`http://127.0.0.1:${webPort}`;
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'bg-browser-'));
const native=['native','workers'].includes(process.env.BG_WEB_RUNTIME);
const env={...process.env,BG_ALLOW_LOCAL_API:'1',DATABASE_URL:'sqlite:///'+path.join(isolated,'browser.sqlite'),APP_ENV:'development',BG_ENCRYPTION_KEY:native?'':fs.readFileSync(path.join(root,'runtime/encryption.key'),'utf8').trim(),PYTHONPATH:path.join(root,'backend')+(process.env.PYTHONPATH?':'+process.env.PYTHONPATH:''),BG_API_INTERNAL_URL:`http://127.0.0.1:${apiPort}`};
if(native)delete env.BG_ENCRYPTION_KEY;
const setup=native?{status:0}:spawnSync(process.env.BG_PYTHON||'python3',['-c',"import os,json;from pathlib import Path;from scripts.bootstrap import seed;from bg.db import Store;seed(Store(os.environ['DATABASE_URL']),json.loads(Path('runtime/sandbox-credentials.json').read_text()))"],{cwd:root,env,encoding:'utf8'});
if(setup.status!==0)throw Error('Browser test database initialization failed');
const api=native?null:spawn(process.env.BG_PYTHON||'python3',['-m','uvicorn','bg.main:app','--host','127.0.0.1','--port',String(apiPort)],{cwd:root,env,stdio:'ignore'});
const useWorkers=native||process.env.BG_WEB_RUNTIME==='workers';
const webArgs=useWorkers?[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--config','frontend/wrangler.jsonc','--port',String(webPort),'--ip','127.0.0.1','--local','--inspector-port','18503','--var',`BG_API_INTERNAL_URL:http://127.0.0.1:${apiPort}`,'--var','BG_ALLOW_LOCAL_API:1']:[path.join(root,'frontend/node_modules/next/dist/bin/next'),'start','-p',String(webPort),'--hostname','127.0.0.1'];
if(native){const i=webArgs.indexOf('--var');webArgs.splice(i);webArgs.push('--env-file','runtime/native-test.env','--persist-to',path.join(isolated,'worker-state'));}
const webLog=fs.openSync(path.join(qa,'web.log'),'w');
const web=spawn('node',webArgs,{cwd:useWorkers?root:path.join(root,'frontend'),env,stdio:['ignore',webLog,webLog]});
const credentials=JSON.parse(fs.readFileSync(path.join(root,'runtime/sandbox-credentials.json')));
let browser;
const checks=[];
async function ready(url){for(let i=0;i<300;i++){try{if((await fetch(url)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('Server belum siap: '+url)}
async function login(page,name){await page.goto(base);await page.getByLabel('Username',{exact:true}).fill(name);await page.getByLabel('Password',{exact:true}).fill(credentials[name]);await page.getByRole('button',{name:'Masuk dengan aman'}).click();try{await page.getByRole('heading',{name:'Kendali jaminan, satu pandangan.'}).waitFor({timeout:15000})}catch(e){await page.screenshot({path:path.join(qa,'login-failure.png'),fullPage:true});throw Error(name+' login: '+(await page.locator('body').innerText()).slice(-1200))};}
async function logout(page){await page.getByRole('button',{name:'Keluar',exact:true}).click();await page.getByRole('heading',{name:'Masuk ke ruang kerja'}).waitFor();}
async function main(){
 try{
  if(!native)await ready(`http://127.0.0.1:${apiPort}/health`);await ready(base+'/api/health');
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('heading',{name:'Masuk ke ruang kerja'}).waitFor();await page.screenshot({path:path.join(qa,'login-desktop.png'),fullPage:true});checks.push('desktop_login_render');
  await login(page,'principal');await page.screenshot({path:path.join(qa,'dashboard-desktop.png'),fullPage:true});checks.push('principal_login');
  await page.getByRole('button',{name:'＋ Pengajuan baru'}).click();const projectName='Browser UAT '+Date.now();await page.getByLabel('Nama proyek / pekerjaan',{exact:true}).fill(projectName);await page.getByLabel('Nilai Bank Garansi (IDR)').fill('2000000000');
  const expiry=new Date();expiry.setDate(expiry.getDate()+100);await page.getByLabel('Berakhirnya Bank Garansi').fill(expiry.toISOString().slice(0,10));
  await page.getByRole('button',{name:'Simpan draft pengajuan'}).click();await page.getByRole('heading',{name:'Ringkasan Bank Garansi'}).waitFor();checks.push('create_draft_through_ui');
  await page.getByLabel('Referensi berkas (opsional saat unggah)',{exact:true}).fill('OSS sandbox browser UAT');await page.getByLabel('File PDF, JPG, PNG atau TXT').setInputFiles({name:'nib.txt',mimeType:'text/plain',buffer:Buffer.from('NIB fixture browser 1234567890123')});await page.getByRole('button',{name:'Unggah dokumen',exact:true}).click();await page.getByRole('status').filter({hasText:'Dokumen berhasil diunggah'}).waitFor();checks.push('evidence_upload_through_ui');
  await logout(page);await login(page,'compliance');await page.getByRole('row').filter({hasText:projectName}).getByRole('button',{name:'Buka →'}).click();
  page.once('dialog',dialog=>dialog.accept('Sumber primer sandbox diverifikasi petugas berbeda'));
  await page.getByRole('button',{name:'Verifikasi',exact:true}).first().click();await page.waitForFunction(()=>document.querySelectorAll('.document .badge').length>0&&![...document.querySelectorAll('.document .badge')].some(x=>x.textContent==='Pending'));checks.push('independent_document_verification');
  await logout(page);
  for(const role of ['mpo','penjamin','obligee','broker']){await login(page,role);assert(await page.getByRole('button',{name:'Keluar',exact:true}).isVisible());checks.push(role+'_portal');await logout(page)}
  // Read-only navigation sweep for every seeded identity. Mutating controls are
  // covered by isolated domain tests, not indiscriminately clicked in a live bank.
  const allRoles=['principal','ao','analyst','compliance','mpo','issuer','support','gh','direksi','finance','finance_checker','penjamin','obligee','obligee_private','broker','litigation','legal','audit','admin','config_checker','worker'];
  const roleMenus={};
  for(const role of allRoles){
    await login(page,role);
    const nav=page.locator('aside nav[aria-label="Menu utama"] button');
    const count=await nav.count();assert(count>0,role+' has no navigation');
    const labels=[];
    for(let i=0;i<count;i++){
      const item=nav.nth(i),name=await item.evaluate(el=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim());
      await item.click();
      await page.locator('.topbar strong').filter({hasText:name}).waitFor({timeout:10000});
      labels.push(name);
    }
    roleMenus[role]=labels;
    checks.push('role_navigation_'+role);
    await logout(page);
  }
  fs.writeFileSync(path.join(qa,'role-menus.json'),JSON.stringify(roleMenus,null,2));
  await page.goto(base+'/verify/fake-token');await page.getByRole('heading',{name:'BG tidak ditemukan atau tidak valid'}).waitFor();checks.push('fake_qr_browser');
  const mobileContext=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:2}),mobile=await mobileContext.newPage();
  await login(mobile,'principal');assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=393&&document.querySelector('.main-shell').getBoundingClientRect().width<=393));
  await mobile.getByRole('button',{name:'Buka atau tutup menu'}).click();await mobile.getByRole('button',{name:'Pengajuan',exact:false}).filter({hasText:'Pengajuan'}).first().click();
  await mobile.waitForFunction(()=>{const el=document.querySelector('.sidebar');return !el.classList.contains('open')&&new DOMMatrix(getComputedStyle(el).transform).m41<=-249});
  await mobile.screenshot({path:path.join(qa,'dashboard-mobile.png'),fullPage:true});checks.push('android_viewport_393_no_overflow');
  await mobile.getByRole('button',{name:'＋ Pengajuan baru'}).click();await mobile.getByLabel('Berakhirnya Bank Garansi').scrollIntoViewIfNeeded();assert(await mobile.getByLabel('Berakhirnya Bank Garansi').isVisible());assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=393&&document.querySelector('.main-shell').getBoundingClientRect().width<=393));checks.push('mobile_long_form_usable');
  if(native){
    await login(page,'admin');await page.getByRole('button',{name:/Pengguna$/}).click();
    const username='native_user_'+Date.now(),initialPassword='Native-test-'+crypto.randomUUID();
    await page.getByLabel('Username baru',{exact:true}).fill(username);await page.getByLabel('Nama pengguna',{exact:true}).fill('Pengguna UAT Native');await page.getByLabel('Password awal',{exact:true}).fill(initialPassword);await page.getByLabel('Organisasi',{exact:true}).fill('principal-1');await page.getByLabel('Kantor',{exact:true}).fill('cabang-1');await page.getByRole('button',{name:'Daftarkan pengguna'}).click();await page.getByRole('cell',{name:username,exact:true}).waitFor();checks.push('admin_user_registration_through_ui');
    await logout(page);credentials[username]=initialPassword;await login(page,username);await page.getByRole('button',{name:/Keamanan$/}).click();
    const nextPassword='Changed-test-'+crypto.randomUUID();await page.getByLabel('Password saat ini',{exact:true}).fill(initialPassword);await page.getByLabel('Password baru',{exact:true}).fill(nextPassword);await page.getByRole('button',{name:'Simpan password baru'}).click();await page.getByRole('heading',{name:'Masuk ke ruang kerja'}).waitFor();credentials[username]=nextPassword;await login(page,username);checks.push('password_change_revokes_session_and_allows_relogin');await logout(page);
  }
  assert.deepEqual(errors,[]);checks.push('no_uncaught_browser_errors');
  const metrics=await mobile.evaluate(()=>({innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
  const result={status:'PASS',runtime:native?'cloudflare-native-sqlite':useWorkers?'cloudflare-workerd':'nextjs-node',checks,mobile_layout:metrics,viewport_desktop:'1440x1000',viewport_mobile:'393x852',real_android_device:false};fs.writeFileSync(path.join(root,'evidence/browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(browser)await browser.close();api?.kill('SIGTERM');web.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));fs.rmSync(isolated,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
