const {chromium} = require('../frontend/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.BG_UAT_BASE || 'http://127.0.0.1:8787';
const password = process.env.BG_UAT_PASSWORD || fs.readFileSync(path.join(__dirname, '../.uat-password'),'utf8').trim();
const identityBlock = fs.readFileSync(path.join(__dirname,'../cloudflare/bootstrap.ts'),'utf8').split('export const IDENTITIES = [')[1].split('] as const;')[0];
const ids = [...identityBlock.matchAll(/^\s*\["([^"]+)",\s*"([^"]+)",/gm)].map(m=>({username:m[1],role:m[2]}));
const report={timestamp:new Date().toISOString(),base,source:'Browser Chromium Playwright against isolated local Cloudflare Durable Object',identities:ids.length,users:[],errors:[],totals:{login:0,logout:0,menuClicks:0,buttonsObserved:0,inputsObserved:0,pageErrors:0,http5xx:0},result:'UNKNOWN'};
function short(s,n=130){return String(s||'').replace(/\s+/g,' ').trim().slice(0,n);}
async function run(){
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for (const identity of ids) {
    const context=await browser.newContext({viewport:{width:1440,height:900},ignoreHTTPSErrors:false});
    const page=await context.newPage();
    const record={...identity,login:'FAIL',logout:'FAIL',menus:[],errors:[],apiFailures:[],browserErrors:[]};
    page.on('pageerror',err=>{record.browserErrors.push(short(err.message,260));report.totals.pageErrors++});
    page.on('response',response=>{
      if(response.status()>=500 && response.url().includes('/api/')){
        record.apiFailures.push({status:response.status(),url:response.url().replace(base,'')});
        report.totals.http5xx++;
      }
    });
    try {
      await page.goto(base, {waitUntil:'domcontentloaded',timeout:35000});
      await page.locator('input[name="username"]').waitFor({state:'visible',timeout:25000});
      await page.locator('input[name="username"]').fill(identity.username);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('form button').click();
      await page.locator('nav[aria-label="Menu utama"]').waitFor({state:'visible',timeout:18000});
      record.login='PASS';report.totals.login++;
      const nav=page.locator('nav[aria-label="Menu utama"] button');
      const names=await nav.allTextContents();
      record.menuNames=names.map(x=>short(x,75));
      for(let i=0;i<names.length;i++){
        try{
          await nav.nth(i).click({timeout:12000});
          await page.waitForTimeout(180);
          const main=page.locator('main.content');
          const alert=await main.locator('[role="alert"]').allTextContents();
          const btn=await main.locator('button').allTextContents();
          const inputs=await main.locator('input').count();
          const selects=await main.locator('select').count();
          const textareas=await main.locator('textarea').count();
          const links=await main.locator('a').count();
          const disabled=await main.locator('button:disabled').count();
          record.menus.push({name:record.menuNames[i],clicked:true,buttons:btn.map(x=>short(x,90)),inputs,selects,textareas,links,disabled,alerts:alert.map(x=>short(x,230))});
          report.totals.menuClicks++;
          report.totals.buttonsObserved+=btn.length;
          report.totals.inputsObserved+=inputs+selects+textareas;
          if(alert.length)record.errors.push('menu '+record.menuNames[i]+': '+alert.map(x=>short(x)).join(' / '));
        }catch(e){record.menus.push({name:record.menuNames[i],clicked:false,error:short(e.message)});record.errors.push('nav '+record.menuNames[i]+': '+short(e.message));}
      }
      if(['principal','admin','penjamin'].includes(identity.username)){
        try{
          await page.setViewportSize({width:390,height:844});
          await page.getByRole('button',{name:'Buka atau tutup menu'}).click();
          record.mobileMenuOpened=await page.locator('.sidebar.open').count()===1;
          await page.getByRole('button',{name:'Tutup menu navigasi'}).click();
          record.mobileMenuClosed=await page.locator('.sidebar.open').count()===0;
          if(!record.mobileMenuOpened||!record.mobileMenuClosed)record.errors.push('mobile sidebar toggle failed');
        }catch(e){record.errors.push('mobile: '+short(e.message))}
      }
      await page.getByRole('button',{name:'Keluar',exact:true}).click({timeout:13000});
      await page.locator('input[name="username"]').waitFor({state:'visible',timeout:13000});
      record.logout='PASS';report.totals.logout++;
    }catch(e){record.errors.push(short(e.message,300));}
    if(record.browserErrors.length)record.errors.push('browser JS errors: '+record.browserErrors.join('; '));
    if(record.apiFailures.length)record.errors.push('API 5xx: '+JSON.stringify(record.apiFailures));
    report.users.push(record);
    process.stdout.write(identity.username.padEnd(17)+' '+identity.role.padEnd(16)+' '+record.login+' '+record.logout+' menus '+record.menus.filter(m=>m.clicked).length+'/'+record.menuNames?.length+' errors '+record.errors.length+'\n');
    await context.close();
  }
  await browser.close();
  const failures=report.users.filter(x=>x.login!=='PASS'||x.logout!=='PASS'||x.errors.length);
  report.result=failures.length?'FAIL_OR_PARTIAL':'PASS';
  report.failedIdentities=failures.map(x=>({username:x.username,errors:x.errors}));
  fs.mkdirSync(path.join(__dirname,'../evidence'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../evidence/uat-browser-role-20261031.json'),JSON.stringify(report,null,2));
  console.log('RESULT_JSON', JSON.stringify({status:report.result,totals:report.totals,identities:report.identities,failedIdentities:report.failedIdentities}).slice(0,5000));
  if(failures.length)process.exitCode=1;
}
run().catch(e=>{console.error('FATAL',e);process.exitCode=2;});
