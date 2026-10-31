import {spawn} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';

const base='http://127.0.0.1:18521';
const persist='runtime/uat-business-'+randomBytes(5).toString('hex');
const creds=JSON.parse(fs.readFileSync('runtime/sandbox-credentials.json','utf8'));
const roles=Object.keys(creds);
const commands=['submit','kyb_pass','partner_start','bank_underwrite','approve','sign_mkp','sign_akad','collect_fee','issue','reserve_limit','confirm_bg_closure','request_bg_closure','approve_claim','pay_bank','report','open_recovery','confirm_recovery_closure','confirm_close'];
const evidence=[];
const sessions={};
const log=fs.openSync('runtime/uat-business-worker.log','w');
const worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','frontend/wrangler.jsonc','--port','18521','--ip','127.0.0.1','--local','--inspector-port','18522','--env-file','runtime/native-test.env','--persist-to',persist],{stdio:['ignore',log,log]});
async function request(user,path,body,expected){
  const s=sessions[user];
  const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(s?{cookie:s.cookie,'x-csrf-token':s.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();
  let data;try{data=JSON.parse(text)}catch{data=text}
  if(expected!==undefined)assert.equal(response.status,expected,user+' '+path+' '+JSON.stringify(data).slice(0,240));
  return {status:response.status,data};
}
async function login(user){
 const raw=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password:creds[user]})});
 assert.equal(raw.status,200);
 const d=await raw.json();
 sessions[user]={cookie:raw.headers.get('set-cookie').split(';')[0],csrf:d.csrf};
}
async function cmd(user,id,version,command,payload={}){
 return request(user,'/applications/'+id+'/commands/'+command,{expected_version:version,idempotency_key:randomUUID(),payload});
}
const record=(group,name,result,detail='')=>evidence.push({group,name,result,detail});
try{
 let ready=false;
 for(let i=0;i<300;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
 assert(ready,'Worker did not become ready');
 for(const user of roles){await login(user);const me=await request(user,'/auth/me',undefined,200);assert.equal(me.data.username,user);record('identity',user,'PASS')}
 const today=new Date().toISOString().slice(0,10),end=new Date(Date.now()+100*86400000).toISOString().slice(0,10);
 const created=await request('principal','/applications',{principal:'principal-1',obligee:'obligee-apbn',partner:'partner-1',processing_office:'cabang-1',issuing_office:'cabang-1',project_name:'UAT business role matrix '+Date.now(),amount:'2000000000',issue_on:today,expires_on:end},201);
 const id=created.data.id;assert.equal(created.data.state,'DRAFT');record('application','draft_created','PASS');
 // A negative command must never mutate the transaction, regardless of which guard rejects it.
 for(const user of roles){
  const visible=await request(user,'/applications/'+id);
  assert([200,403,404].includes(visible.status),'Unexpected access result '+user+':'+visible.status);
  record('scope',user,visible.status===200?'VISIBLE':'HIDDEN','HTTP '+visible.status);
  for(const command of commands){
   if(user==='principal'&&command==='submit')continue;
   const result=await cmd(user,id,0,command);
   assert(result.status>=400,'Unexpected accepted DRAFT command '+user+'/'+command);
   record('draft_guard',user+':'+command,'REJECTED','HTTP '+result.status+' '+String(result.data?.code||''));
  }
 }
 const unchanged=await request('principal','/applications/'+id,undefined,200);
 assert.equal(unchanged.data.version,0);assert.equal(unchanged.data.state,'DRAFT');
 record('integrity','rejected_draft_commands_leave_state_unchanged','PASS');
 const denied=await cmd('principal',id,10,'submit');assert.equal(denied.status,409);
 record('optimistic_lock','stale_version_rejected','PASS');
 const submitted=await cmd('principal',id,0,'submit');assert.equal(submitted.status,200);assert.equal(submitted.data.state,'KYC_KYB_CHECK');
 record('transition','draft_to_kyc','PASS');
 const replay=await request('principal','/applications/'+id+'/commands/submit',{expected_version:0,idempotency_key:randomUUID(),payload:{}},409);
 record('optimistic_lock','repeat_submit_rejected','PASS');
 const issue=await cmd('issuer',id,1,'issue');assert(issue.status>=400);
 record('issuance','premature_issue_rejected','PASS','HTTP '+issue.status);
 const partner=await cmd('penjamin',id,1,'partner_start');assert(partner.status>=400);
 record('counter_guarantee','partner_cannot_start_before_kyb_slik','PASS','HTTP '+partner.status);
 const fee=await cmd('finance',id,1,'collect_fee');assert(fee.status>=400);
 record('finance','premature_fee_posting_rejected','PASS','HTTP '+fee.status);
 const audit=await request('audit','/audit/verify',undefined,200);assert.equal(audit.data.valid,true);
 record('audit','audit_chain_integrity','PASS','events '+audit.data.events);
 const events=await request('audit','/audit/events',undefined,200);assert(Array.isArray(events.data)&&events.data.length>0);
 record('audit','audit_events_readable','PASS');
 const auditDenied=await request('principal','/audit/events');assert.equal(auditDenied.status,403);
 record('audit','external_actor_cannot_read_internal_audit','PASS');
 const claim=await request('obligee','/claims',undefined,200);assert(Array.isArray(claim.data));
 record('claim','obligee_claim_inbox_readable','PASS','No positive claim created in this test');
 const operations=await request('finance','/operations',undefined,200);assert(operations.data&&typeof operations.data==='object');
 record('reconciliation','operations_inbox_readable','PASS','No full GL/core reconciliation proven');
 const report={status:'PASS',environment:'isolated Cloudflare workerd SQLite',mode:'SANDBOX',identities:roles.length,negative_commands:roles.length*commands.length-1,application_id:'REDACTED',checks:evidence.length,groups:Object.fromEntries([...new Set(evidence.map(x=>x.group))].map(x=>[x,evidence.filter(y=>y.group===x).length])),limitations:['Negative commands on draft prove state guards, not all RBAC rules independently','No positive full issuance, contra guarantee settlement, claim payment, recovery/subrogation or core GL reconciliation','No production mutation; all fixtures disposable','UI action-by-action coverage requires separate browser journey suite'],evidence};
 fs.mkdirSync('evidence',{recursive:true});
 fs.writeFileSync('evidence/business-uat.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,identities:report.identities,negative_commands:report.negative_commands,checks:report.checks,groups:report.groups,limitations:report.limitations}));
}finally{
 worker.kill('SIGTERM');fs.closeSync(log);
}
