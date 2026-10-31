import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import {
  Store,
  initializeSchema,
  passwordHash,
  money,
  amount,
  committee,
  splitUjrah,
  businessDue,
  predicate,
  hash,
} from "../cloudflare/core.ts";
import { bootstrap, IDENTITIES } from "../cloudflare/bootstrap.ts";
import { Service } from "../cloudflare/service.ts";
import { route } from "../cloudflare/router.ts";
import policy from "../config/policy.sandbox.json" with { type: "json" };

const password = "Test-" + randomBytes(18).toString("base64url");
const hashes = Object.fromEntries(
  IDENTITIES.map(([name]) => [name, passwordHash(password)]),
);
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const db = {
    all: (sql, ...v) =>
      sqlite
        .prepare(sql)
        .all(
          ...v.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x)),
        ),
    run: (sql, ...v) =>
      sqlite
        .prepare(sql)
        .run(
          ...v.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x)),
        ),
  };
  initializeSchema(db);
  const key = randomBytes(32).toString("hex");
  bootstrap(new Store(db), JSON.stringify(hashes), key);
  let now = Date.parse("2026-10-28T07:00:00Z");
  const sessions = {};
  let user = "principal";
  function raw(
    path,
    body,
    method = body === undefined ? "GET" : "POST",
    session = sessions[user],
    csrf = true,
  ) {
    sqlite.exec("BEGIN");
    try {
      const s = new Store(db),
        service = new Service(s, key, now),
        response = route(service, {
          method,
          path: path.split("/").filter(Boolean),
          body: body || {},
          cookie: session ? "bg_session=" + session.token : "",
          csrf: csrf ? session?.csrf || "" : "",
          secure: true,
        });
      service.flush();
      sqlite.exec("COMMIT");
      return response;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      return Response.json(
        { code: e.code || "INTERNAL", detail: e.message },
        { status: e.status || 500 },
      );
    }
  }
  async function call(path, body, want = 200, method) {
    const r = raw(path, body, method);
    const text = await r.text();
    assert.equal(r.status, want, path + ": " + text);
    if (r.headers.get("content-type")?.includes("application/json"))
      return JSON.parse(text);
    return text;
  }
  async function login(name) {
    user = name;
    if (!sessions[name] || now - sessions[name].at >= 7 * 3600000) {
      const r = raw("/auth/login", { username: name, password }, "POST", null);
      const data = await r.json();
      assert.equal(r.status, 200, JSON.stringify(data));
      sessions[name] = {
        csrf: data.csrf,
        token: r.headers.get("set-cookie").split(";")[0].slice(11),
        at: now,
      };
    }
    return sessions[name];
  }
  function tx(fn) {
    sqlite.exec("BEGIN");
    try {
      const s = new Store(db);
      const result = fn(s);
      s.commit();
      sqlite.exec("COMMIT");
      return result;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    db,
    sqlite,
    key,
    call,
    raw,
    login,
    tx,
    sessions,
    get user() {
      return user;
    },
    get now() {
      return now;
    },
    set now(n) {
      now = n;
    },
  };
}
class Journey {
  constructor(f) {
    this.f = f;
  }
  async create(changes = {}) {
    await this.f.login("principal");
    this.a = await this.f.call(
      "/applications",
      {
        principal: "principal-1",
        obligee: "obligee-apbn",
        partner: "partner-1",
        processing_office: "cabang-1",
        issuing_office: "cabang-1",
        project_name: "Native Worker UAT",
        amount: "2000000000",
        issue_on: "2026-10-28",
        expires_on: "2027-04-27",
        bg_type: "PELAKSANAAN",
        ...changes,
      },
      201,
    );
    return this.a;
  }
  async doc(kind, user = "principal", verify = true) {
    await this.f.login(user);
    const d = await this.f.call(
      "/applications/" + this.a.id + "/documents",
      {
        kind,
        content_base64: Buffer.from(
          (kind==="LKN_PHOTOS"?"%PDF-1.7\n":"") +
          "Bukti sandbox " + kind + " " + randomBytes(4).toString("hex"),
        ).toString("base64"),
        source_reference: "Sumber primer UAT",
      },
      201,
    );
    if (verify) {
      await this.f.login(user === "compliance" ? "mpo" : "compliance");
      await this.f.call("/documents/" + d.id + "/verify", {
        source_reference: "Sumber primer diverifikasi",
      });
    }
    return d.id;
  }
  async cmd(name, user, payload = {}, want = 200, extra = {}) {
    await this.f.login(user);
    this.a = await this.f.call("/applications/" + this.a.id);
    const r = await this.f.call(
      "/applications/" + this.a.id + "/commands/" + name,
      {
        expected_version: this.a.version,
        idempotency_key: crypto.randomUUID(),
        payload,
        ...extra,
      },
      want,
    );
    if (want === 200) this.a = r;
    return r;
  }
  async underwriting(changes = {}) {
    await this.create(changes);
    for (const kind of ["NIB", "CONTRACT", "KYB"]) await this.doc(kind);
    await this.cmd("submit", "principal");
    await this.cmd("kyb_pass", "compliance", {
      screening_clear: true,
      ubo_verified: true,
    });
    const slik = await this.doc("SLIK", "analyst");
    await this.cmd("record_slik", "analyst", {
      document: slik,
      collectibility: 1,
      pulled_at: new Date(this.f.now).toISOString(),
    });
    await this.cmd("partner_start", "penjamin");
    const sp2 = await this.doc("SP2KBG", "penjamin");
    await this.cmd("sp2_issue", "penjamin", {
      document: sp2,
      reference: "SP2-UAT",
      issuing_unit: "CABANG-UJI",
      amount: this.a.amount,
      valid_to: "2027-01-01",
    });
    await this.cmd("bank_underwrite", "analyst");
    return this.a;
  }
  async issued(changes = {}, stop = false) {
    await this.underwriting(changes);
    if (this.a.custom_format) {
      const doc = await this.doc("FORMAT_APPROVAL", "penjamin");
      await this.f.login("penjamin");
      this.a = await this.f.call("/applications/" + this.a.id);
      await this.cmd("approve_format", "penjamin", {
        document: doc,
        draft_hash: this.a.documents.find((d) => d.kind === "DRAFT_BG").sha256,
        signed_and_stamped: true,
      });
    }
    await this.cmd("approve", "mpo");
    if (this.a.committee_role)
      await this.cmd(
        "approve",
        this.a.committee_role === "GH_BISNIS" ? "gh" : "direksi",
      );
    await this.cmd("sign_mkp", "mpo");
    await this.cmd("sign_akad", "principal");
    await this.cmd("sign_akad", "mpo");
    await this.cmd("collect_fee", "finance");
    if (this.a.processing_office !== this.a.issuing_office) {
      await this.doc("PRINCIPAL_REQUEST");
      await this.cmd("ememo", "mpo", {
        to: "PEMIMPIN_PENERBIT",
        cc: ["GH_BISNIS", "KADEP_SUPPORT", "MPO_PEMROSES", "MPO_PENERBIT"],
        attachments: ["PRINCIPAL_REQUEST", "MKP", "DRAFT_BG"],
      });
    }
    if (!stop)
      await this.cmd(
        "issue",
        this.a.issuing_office === "kpo-1" ? "issuer" : "mpo",
      );
    return this.a;
  }
  async active(changes = {}) {
    await this.issued(changes);
    await this.cmd("certificate", "penjamin", {
      document: await this.doc("CERTIFICATE", "penjamin"),
      reference: "CERT-UAT",
    });
    await this.cmd("deliver", "mpo", {
      document: await this.doc("DELIVERY", "obligee"),
    });
    return this.a;
  }
  async claim() {
    const document = await this.doc("CLAIM", "obligee");
    await this.f.login("obligee");
    return this.f.call(
      "/applications/" + this.a.id + "/claims",
      { document, amount: "100000000" },
      201,
    );
  }
  async claimcmd(c, cmd, user, payload = {}, want = 200) {
    await this.f.login(user);
    return this.f.call(
      "/claims/" + c.id + "/commands/" + cmd,
      {
        expected_version: c.version,
        idempotency_key: crypto.randomUUID(),
        payload,
      },
      want,
    );
  }
}

/**
 * Enterprise UAT, data-disposable Cloudflare-native domain services.
 * Positive/negative cross-role transitions, counter guarantee, claim,
 * recovery and journal reconciliation. No bank or external funds involved.
 */
const UAT_OUTPUT = "evidence/enterprise-uat-20261031.json";
const uatCases = [];
function uat(name, fn) {
  test(name, async () => {
    try {
      await fn();
      uatCases.push({case:name, result:"PASS"});
    } catch (e) {
      uatCases.push({case:name, result:"FAIL", error:String(e?.stack||e).slice(0,1500)});
      throw e;
    }
  });
}
test.after(() => {
  
  fs.mkdirSync("evidence",{recursive:true});
  fs.writeFileSync(UAT_OUTPUT,JSON.stringify({
    environment:"isolated SQLite Cloudflare-native service fixture",
    mode:"SANDBOX",
    production_bank_integrations:false,
    scenarios:uatCases,
    pass:uatCases.filter(x=>x.result==="PASS").length,
    fail:uatCases.filter(x=>x.result==="FAIL").length,
    scope_limits:[
      "not a live bank-core, insurer, PSrE or regulatory integration test",
      "browser action coverage separately recorded in UI UAT",
      "no real financial posting or bank approval"
    ]
  },null,2)+"\n");
});


uat("UAT-F01: five-actor BG -> counter certificate -> delivery -> paid contra claim; balanced finance and audit",async()=>{
  const f=fixture(),j=new Journey(f);
  try{
    await j.active();
    assert.equal(j.a.state,"ACTIVE");
    const guarantee=new Store(f.db).get("guarantees",j.a.id);
    assert.equal(guarantee.mode,"MOCK");
    assert.ok(j.a.bg_number);
    assert.equal(new Store(f.db).rows("guarantees").length,1);
    const link=await f.call("/applications/"+j.a.id+"/verification-link");
    const qr=await f.call("/public/verify/"+link.token);
    assert.equal(qr.authentic,true);
    assert.equal(qr.valid,true);
    let c=await j.claim();
    await f.login("principal");
    assert.equal((await f.call("/claims/"+c.id+"/recovery",undefined,403)).code,"FORBIDDEN");
    c=await j.claimcmd(c,"report","mpo");
    assert.equal(c.state,"CLAIM_VALIDATION");
    c=await j.claimcmd(c,"approve_claim","mpo",{instrument_conditions_met:true});
    assert.equal(c.state,"CLAIM_APPROVED");
    c=await j.claimcmd(c,"pay_bank","finance");
    assert.equal(c.state,"CLAIM_PAID_BY_BANK");
    assert.equal(c.bank_payment.mode,"MOCK");
    const claimDoc=await j.doc("CONTRA_CLAIM","mpo");
    c=await j.claimcmd(c,"submit_contra","mpo",{document:claimDoc});
    assert.equal(c.state,"KONTRA_CLAIM_SUBMITTED");
    const decisionDoc=await j.doc("CONTRA_DECISION","penjamin");
    c=await j.claimcmd(c,"contra_decision","penjamin",{document:decisionDoc,decision:"PAID",reason:"Kontra BG diterima untuk settlement simulasi"});
    assert.equal(c.state,"KONTRA_SETTLEMENT_PENDING");
    c=await j.claimcmd(c,"confirm_contra_paid","finance",{document:await j.doc("CONTRA_PAYMENT","penjamin")});
    assert.equal(c.state,"KONTRA_CLAIM_PAID");
    const rows=new Store(f.db).rows("journals");
    const claimJournal=rows.find(r=>r.id==="claim:"+c.id);
    const contraJournal=rows.find(r=>r.id==="contra:"+c.id);
    const feeJournal=rows.find(r=>r.id==="fee:"+j.a.id);
    assert.ok(claimJournal&&contraJournal&&feeJournal,"fee, claim and counter-claim journal presence");
    for(const row of rows){
      assert.equal(row.mode,"MOCK");
      assert.equal(row.lines.reduce((n,l)=>n+money(l.debit)-money(l.credit),0n),0n,row.id);
    }
    function posting(id,account){
      return rows.filter(r=>r.id===id).flatMap(r=>r.lines)
        .filter(l=>l.account===account)
        .reduce((n,l)=>n+money(l.debit)-money(l.credit),0n);
    }
    assert.equal(posting("claim:"+c.id,"CLAIM_RECEIVABLE"),money(c.amount));
    assert.equal(posting("contra:"+c.id,"CLAIM_RECEIVABLE"),-money(c.amount));
    assert.equal(posting("claim:"+c.id,"CLAIM_RECEIVABLE")+posting("contra:"+c.id,"CLAIM_RECEIVABLE"),0n);
    await f.login("audit");
    const checked=await f.call("/audit/verify");
    assert.equal(checked.valid,true);
    assert.equal(checked.external_anchor_verified,false);
    assert.throws(()=>f.sqlite.exec("UPDATE journals SET data='{}'"));
    assert.throws(()=>f.sqlite.exec("DELETE FROM audit_log"));
  }finally{f.sqlite.close();}
});

uat("UAT-F02: private obligee >3B requires Direksi and denies wrong-role approval, then issues only after authorized sign-off",async()=>{
  const f=fixture(),j=new Journey(f);
  try{
    await j.underwriting({obligee:"obligee-private",amount:"4000000000"});
    assert.equal(j.a.committee_role,"DIREKSI");
    assert.equal(j.a.state,"APPROVAL");
    for(const [role,expected] of [["principal",403],["analyst",403],["penjamin",403],["admin",403],["audit",403],["finance",403],["gh",403],["config_checker",403]]){
      const r=await j.cmd("approve",role,{},expected);
      assert.equal(r.code,expected===404?"NOT_FOUND":"FORBIDDEN",role);
      assert.equal(new Store(f.db).rows("approvals",{application_id:j.a.id}).length,0);
    }
    await j.cmd("approve","mpo");
    assert.equal(j.a.state,"APPROVAL");
    assert.equal((await j.cmd("sign_mkp","mpo",{},409)).code,"STATE");
    await j.cmd("approve","direksi");
    assert.equal(j.a.state,"APPROVAL_GRANTED");
    await j.cmd("sign_mkp","mpo");
    await j.cmd("sign_akad","principal");
    await j.cmd("sign_akad","mpo");
    await j.cmd("collect_fee","finance");
    assert.equal((await j.cmd("issue","finance",{},403)).code,"FORBIDDEN");
    await j.cmd("issue","mpo");
    assert.equal(j.a.state,"BG_ISSUED");
    const approvals=new Store(f.db).rows("approvals",{application_id:j.a.id});
    assert.deepEqual(approvals.map(x=>x.role).sort(),["DIREKSI","MPO"]);
  }finally{f.sqlite.close();}
});

uat("UAT-F03: inter-office E-Memo + split ujrah finance maker-checker, settlement and ledger",async()=>{
 const f=fixture(),j=new Journey(f);
 try{
  await j.issued({issuing_office:"kpo-1"});
  assert.equal(j.a.state,"BG_ISSUED");
  const before=new Store(f.db).get("distributions",j.a.id);
  assert.equal(before.status,"DUE");
  assert.equal((await j.cmd("distribute","finance",{},403)).code,"SOD");
  await j.cmd("distribute","finance_checker");
  const settled=new Store(f.db).get("distributions",j.a.id);
  assert.equal(settled.status,"SETTLED");
  assert.equal(settled.amount,splitUjrah(policy.pks.admin_fee,policy));
  assert.equal(new Store(f.db).get("tasks","split:"+j.a.id).status,"DONE");
  for(const r of new Store(f.db).rows("journals"))
   assert.equal(r.lines.reduce((n,l)=>n+money(l.debit)-money(l.credit),0n),0n);
  await f.login("audit");assert.equal((await f.call("/audit/verify")).valid,true);
 }finally{f.sqlite.close();}
});

uat("UAT-F04: rejection -> litigation -> independently reviewed recovery -> closure; never posts phantom cash",async()=>{
 const f=fixture(),j=new Journey(f);
 try{
  await j.active();
  let c=await j.claim();
  c=await j.claimcmd(c,"report","mpo");
  c=await j.claimcmd(c,"approve_claim","mpo",{instrument_conditions_met:true});
  c=await j.claimcmd(c,"pay_bank","finance");
  const docs=await j.doc("RECOVERY_BASIS","litigation");
  c=await j.claimcmd(c,"open_recovery","litigation",{
   kind:"BANK_RECOURSE_ASSESSMENT",document:docs,reason:"Penelusuran hak regres atas pembayaran bank sandbox"});
  assert.equal((await j.claimcmd(c,"review_recovery","litigation",{accepted:true,reason:"Maker tak boleh cek sendiri"},403)).code,"FORBIDDEN");
  c=await j.claimcmd(c,"review_recovery","legal",{accepted:true,reason:"Legal menguji kecukupan bukti dan hanya membuka monitoring"});
  const ac=await j.doc("RECOVERY_ACTION","litigation");
  c=await j.claimcmd(c,"record_recovery_action","litigation",{action_type:"PAYMENT_EVIDENCE",document:ac,reported_amount:"50000000",reason:"Perkiraan dari dokumen, belum diverifikasi transaksi keuangan"});
  await f.login("legal");
  const before=await f.call("/claims/"+c.id+"/recovery");
  const action=before.events.find(x=>x.kind==="ACTION_RECORDED");
  assert.equal(action.financial_recognition,false);
  const journalsBefore=new Store(f.db).rows("journals").length;
  c=await j.claimcmd(c,"review_recovery_action","legal",{action_id:action.id,accepted:true,reason:"Review bukti secara independen tanpa pengakuan kas"});
  const closureDoc=await j.doc("RECOVERY_RESOLUTION","litigation");
  c=await j.claimcmd(c,"request_recovery_closure","litigation",{document:closureDoc,reason:"Penyelesaian administrasi recovery diusulkan untuk legal"});
  c=await j.claimcmd(c,"confirm_recovery_closure","legal",{accepted:true,reason:"Legal menyetujui penutupan monitoring tanpa hak hukum atau kas"});
  await f.login("legal");
  const end=await f.call("/claims/"+c.id+"/recovery");
  assert.equal(end.current.status,"CLOSED_TRACKING_ONLY");
  assert.equal(end.accounting_posted,false);
  assert.equal(end.legal_rights_verified,false);
  assert.equal(new Store(f.db).rows("journals").length,journalsBefore);
  // Separate contra rejection/settlement workflow remains independent.
  c=await j.claimcmd(c,"submit_contra","mpo",{document:await j.doc("CONTRA_CLAIM","mpo")});
  c=await j.claimcmd(c,"contra_decision","penjamin",{document:await j.doc("CONTRA_DECISION","penjamin"),decision:"REJECTED",reason:"Dispute simulated"});
  assert.equal(new Store(f.db).get("litigation",c.id).state,"OPEN");
  const resolution=await j.doc("RESOLUTION","legal");
  assert.equal((await j.claimcmd(c,"request_close","litigation",{document:resolution},422)).code,"BR-20");
  c=await j.claimcmd(c,"confirm_contra_paid","finance",{document:await j.doc("CONTRA_PAYMENT","penjamin")});
  c=await j.claimcmd(c,"request_close","litigation",{document:resolution});
  c=await j.claimcmd(c,"confirm_close","legal");
  assert.equal(new Store(f.db).get("litigation",c.id).state,"CLOSED");
  await f.login("audit");assert.equal((await f.call("/audit/verify")).valid,true);
 }finally{f.sqlite.close();}
});

uat("UAT-F05: 21 identity RBAC access, admin-only users and independent audit reader permissions",async()=>{
 const f=fixture(),j=new Journey(f);
 try{
  await j.create();
  const statuses={};
  for(const [name,role] of IDENTITIES){
   await f.login(name);
   const self=await f.call("/auth/me");
   assert.equal(self.role,role);
   assert.equal(self.mode,"SANDBOX");
   const userResult=await f.call("/users",undefined,role==="ADMIN"?200:403);
   if(role!=="ADMIN")assert.equal(userResult.code,"FORBIDDEN",name);
   const auditResult=await f.call("/audit/verify",undefined,["AUDIT","LEGAL"].includes(role)?200:403);
   if(["AUDIT","LEGAL"].includes(role))assert.equal(auditResult.valid,true);
   else assert.equal(auditResult.code,"FORBIDDEN",name);
   const accessAllowed=!["broker","obligee_private","issuer"].includes(name);
   const app=await f.call("/applications/"+j.a.id,undefined,accessAllowed?200:404);
   if(!accessAllowed)assert.equal(app.code,"NOT_FOUND",name);
   statuses[name]={role,admin_user_access:role==="ADMIN",audit_reader:["AUDIT","LEGAL"].includes(role),application_visible:accessAllowed};
  }
  assert.equal(Object.keys(statuses).length,21);
  await f.login("audit");
  assert.equal((await f.call("/audit/verify")).valid,true);
 }finally{f.sqlite.close();}
});

uat("UAT-F06: failed/replayed payment and claim commands leave journal counts unchanged",async()=>{
 const f=fixture(),j=new Journey(f);
 try{
  await j.active();
  let c=await j.claim();
  c=await j.claimcmd(c,"report","mpo");
  c=await j.claimcmd(c,"approve_claim","mpo",{instrument_conditions_met:true});
  let count=new Store(f.db).rows("journals").length;
  assert.equal((await j.claimcmd(c,"pay_bank","principal",{},403)).code,"FORBIDDEN");
  assert.equal(new Store(f.db).rows("journals").length,count);
  c=await j.claimcmd(c,"pay_bank","finance");
  count=new Store(f.db).rows("journals").length;
  const stale=await j.claimcmd({...c,version:c.version-1},"pay_bank","finance",{},409);
  assert.equal(stale.code,"VERSION");
  assert.equal(new Store(f.db).rows("journals").length,count);
  await f.login("audit");assert.equal((await f.call("/audit/verify")).valid,true);
 }finally{f.sqlite.close();}
});


uat("UAT-F07: paid bank claim cannot be withdrawn or removed from aggregate exposure",async()=>{
 const f=fixture(),j=new Journey(f);
 try{
  await j.active();
  let c=await j.claim();
  c=await j.claimcmd(c,"report","mpo");
  c=await j.claimcmd(c,"approve_claim","mpo",{instrument_conditions_met:true});
  c=await j.claimcmd(c,"pay_bank","finance");
  const doc=await j.doc("WITHDRAWAL","obligee");
  const beforeJournals=new Store(f.db).rows("journals").length;
  const result=await j.claimcmd(c,"withdraw","obligee",{document:doc},409);
  assert.equal(result.code,"CLAIM");
  const persisted=new Store(f.db).get("claims",c.id);
  assert.equal(persisted.state,"CLAIM_PAID_BY_BANK");
  assert.ok(persisted.bank_paid_at);
  assert.equal(new Store(f.db).rows("journals").length,beforeJournals);
  const claimDocument=await j.doc("CLAIM","obligee");
  await f.login("obligee");
  const excess=await f.call("/applications/"+j.a.id+"/claims",
    {document:claimDocument,amount:"1950000000"},422);
  assert.equal(excess.code,"CLAIM_LIMIT");
  await f.login("audit");
  assert.equal((await f.call("/audit/verify")).valid,true);
 }finally{f.sqlite.close();}
});

uat("UAT-F08: legitimate pre-payout withdrawal closes pending reporting task",async()=>{
 const f=fixture(),j=new Journey(f);
 try{
  await j.active();
  let c=await j.claim();
  const doc=await j.doc("WITHDRAWAL","obligee");
  c=await j.claimcmd(c,"withdraw","obligee",{document:doc});
  assert.equal(c.state,"WITHDRAWN");
  assert.equal(new Store(f.db).get("tasks","report:"+c.id).status,"DONE");
  assert.equal((await j.claimcmd(c,"withdraw","obligee",{document:doc},409)).code,"STATE");
  assert.equal(new Store(f.db).rows("journals").filter(r=>r.id==="claim:"+c.id).length,0);
  await f.login("audit");assert.equal((await f.call("/audit/verify")).valid,true);
 }finally{f.sqlite.close();}
});


uat("UAT-F09: counter guarantor can read own contra workflow evidence but never bank SLIK/MKP",async()=>{
 const f=fixture(),j=new Journey(f);
 try{
  await j.active();
  let c=await j.claim();
  c=await j.claimcmd(c,"report","mpo");
  c=await j.claimcmd(c,"approve_claim","mpo",{instrument_conditions_met:true});
  c=await j.claimcmd(c,"pay_bank","finance");
  const contra=await j.doc("CONTRA_CLAIM","mpo");
  c=await j.claimcmd(c,"submit_contra","mpo",{document:contra});
  const decision=await j.doc("CONTRA_DECISION","penjamin");
  const paid=await j.doc("CONTRA_PAYMENT","penjamin");
  await f.login("penjamin");
  const app=await f.call("/applications/"+j.a.id);
  const visible=app.documents.map(d=>d.kind);
  for(const kind of ["CONTRA_CLAIM","CONTRA_DECISION","CONTRA_PAYMENT"])
   assert.ok(visible.includes(kind),"Penjamin must see "+kind);
  for(const kind of ["SLIK","MKP","LAPORAN_KEUANGAN"])
   assert.ok(!visible.includes(kind),"Bank-only evidence leaked: "+kind);
  for(const id of [contra,decision,paid])assert.match(await f.call("/documents/"+id+"/download"),/Bukti sandbox/);
  const bankOnly=j.a.documents.find(x=>x.kind==="MKP")?.id;
  assert.ok(bankOnly);
  const refused=await f.call("/documents/"+bankOnly+"/download",undefined,403);
  assert.equal(refused.code,"FORBIDDEN");
  await f.login("audit");assert.equal((await f.call("/audit/verify")).valid,true);
 }finally{f.sqlite.close();}
});
