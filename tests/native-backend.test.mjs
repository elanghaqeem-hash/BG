import test from "node:test";
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
for (const [code, r] of Object.entries(policy.rules))
  test("native " + code + " enforces positive and negative predicates", () => {
    assert.equal(predicate(r.assert, { [r.assert.field]: true }), true);
    assert.equal(predicate(r.assert, { [r.assert.field]: false }), false);
  });
for (const value of ["NaN", "Infinity", "-1", "1.001", "1e25", "abc"])
  test("native money rejects " + value, () =>
    assert.throws(() => money(value)),
  );
test("native monetary limits use exact cents and 25% cap", () => {
  assert.equal(committee("SWASTA_NASIONAL", "3000000000", policy), "GH_BISNIS");
  assert.equal(committee("JV", "3000000000.01", policy), "DIREKSI");
  assert.equal(committee("APBN", "4000000000", policy), null);
  assert.equal(splitUjrah("30000000", policy), "5000000.00");
  assert.equal(splitUjrah("12000000", policy), "3000000.00");
  assert.equal(
    amount(money("99999999999999999999.99")),
    "99999999999999999999.99",
  );
});
test("native SLA respects weekend and supplied holidays", () =>
  assert.equal(
    businessDue(Date.parse("2026-10-30T07:00:00Z"), 1, {
      ...policy.calendar,
      holidays: ["2026-11-02"],
    }),
    "2026-11-03T10:00:00.000Z",
  ));
test("native complete issue, delivery, QR registry and immutable balanced ledger", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.active();
  assert.equal(j.a.state, "ACTIVE");
  const link = await f.call("/applications/" + j.a.id + "/verification-link");
  const verified = await f.call("/public/verify/" + link.token);
  assert.equal(verified.authentic, true);
  assert.equal(verified.valid, true);
  assert.equal(verified.amount, "2000000000.00");
  assert.equal((await f.call("/public/verify/fake-token")).authentic, false);
  await f.login("audit");
  assert.equal((await f.call("/audit/verify")).valid, true);
  for (const r of new Store(f.db).rows("journals"))
    assert.equal(
      r.lines.reduce((v, l) => v + money(l.debit) - money(l.credit), 0n),
      0n,
    );
  assert.throws(() => f.sqlite.exec("DELETE FROM audit_log"));
  assert.throws(() => f.sqlite.exec("UPDATE journals SET data='{}'"));
  f.sqlite.close();
});
for (const [value, role] of [
  ["2500000000", "GH_BISNIS"],
  ["4000000000", "DIREKSI"],
])
  test("native private committee " + role, async () => {
    const f = fixture(),
      j = new Journey(f);
    await j.underwriting({ obligee: "obligee-private", amount: value });
    assert.equal(j.a.committee_role, role);
    await j.cmd("approve", "mpo");
    await j.cmd("sign_mkp", "mpo", {}, 409);
    await j.cmd("approve", role === "GH_BISNIS" ? "gh" : "direksi");
    assert.equal(j.a.state, "APPROVAL_GRANTED");
  });
for (const col of [2, 3, 4, 5])
  test("native SLIK collectibility " + col + " rolls back", async () => {
    const f = fixture(),
      j = new Journey(f);
    await j.create();
    for (const k of ["NIB", "KYB"]) await j.doc(k);
    await j.cmd("submit", "principal");
    await j.cmd("kyb_pass", "compliance", {
      screening_clear: true,
      ubo_verified: true,
    });
    const doc = await j.doc("SLIK", "analyst");
    assert.equal(
      (
        await j.cmd(
          "record_slik",
          "analyst",
          {
            document: doc,
            collectibility: col,
            pulled_at: new Date(f.now).toISOString(),
          },
          422,
        )
      ).code,
      "BR-05",
    );
    await f.login("analyst");
    assert.equal((await f.call("/applications/" + j.a.id)).state, "SLIK_CHECK");
  });
test("native TDP cannot substitute NIB and policy alternative cannot bypass contra", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.create();
  await j.doc("TDP", "ao");
  assert.equal((await j.cmd("submit", "principal", {}, 422)).code, "BR-09");
  await j.create({ product: "OTHER", justification: "Alternative" });
  await j.doc("NIB");
  assert.equal((await j.cmd("submit", "principal", {}, 422)).code, "PRODUCT");
});
test("native custom format approval binds exact draft hash and tracks originals", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.underwriting({ custom_format: true });
  await j.cmd("approve", "mpo", {}, 409);
  const doc = await j.doc("FORMAT_APPROVAL", "penjamin");
  assert.equal(
    (
      await j.cmd(
        "approve_format",
        "penjamin",
        { document: doc, draft_hash: "0".repeat(64), signed_and_stamped: true },
        422,
      )
    ).code,
    "BR-08",
  );
  await j.cmd("approve_format", "penjamin", {
    document: doc,
    draft_hash: j.a.documents.find((d) => d.kind === "DRAFT_BG").sha256,
    signed_and_stamped: true,
  });
  await f.login("mpo");
  assert.ok(
    (await f.call("/operations")).tasks.some(
      (t) => t.details.kind === "ORIGINAL" && t.status === "OPEN",
    ),
  );
});
for (const [income, expected] of [
  ["30000000", "5000000.00"],
  ["12000000", "3000000.00"],
])
  test("native interoffice split " + income, async () => {
    const f = fixture(),
      j = new Journey(f);
    f.tx(
      (s) =>
        (s.get("policies", "policy-1").configuration.pks.admin_fee = income),
    );
    await j.issued({ issuing_office: "kpo-1" });
    await j.cmd("distribute", "finance", {}, 403);
    await j.cmd("distribute", "finance_checker");
    const dist = new Store(f.db).get("distributions", j.a.id);
    assert.equal(dist.amount, expected);
    assert.equal(dist.status, "SETTLED");
    assert.equal(new Store(f.db).get("tasks", "split:" + j.a.id).late, false);
  });
for (const decision of ["REJECTED", "DEFERRED"])
  test(
    "native " + decision + " routes litigation and protects closure",
    async () => {
      const f = fixture(),
        j = new Journey(f);
      await j.active();
      let c = await j.claim();
      c = await j.claimcmd(c, "report", "mpo");
      c = await j.claimcmd(c, "approve_claim", "mpo", {
        instrument_conditions_met: true,
      });
      c = await j.claimcmd(c, "pay_bank", "finance");
      c = await j.claimcmd(c, "submit_contra", "mpo", {
        document: await j.doc("CONTRA_CLAIM", "mpo"),
      });
      c = await j.claimcmd(c, "contra_decision", "penjamin", {
        document: await j.doc("CONTRA_DECISION", "penjamin"),
        decision,
        reason: "Perselisihan",
      });
      await j.claimcmd(c, "request_close", "litigation", {}, 422);
      assert.equal(new Store(f.db).get("litigation", c.id).state, "OPEN");
      c = await j.claimcmd(c, "confirm_contra_paid", "finance", {
        document: await j.doc("CONTRA_PAYMENT", "penjamin"),
      });
      c = await j.claimcmd(c, "request_close", "litigation", {
        document: await j.doc("RESOLUTION", "legal"),
      });
      c = await j.claimcmd(c, "confirm_close", "legal");
      assert.equal(new Store(f.db).get("litigation", c.id).state, "CLOSED");
    },
  );
test("native stale version, replay isolation, CSRF and logout session revocation", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.create();
  await j.doc("NIB");
  await f.login("principal");
  assert.equal(
    f.raw("/auth/logout", {}, "POST", f.sessions.principal, false).status,
    403,
  );
  const key = crypto.randomUUID(),
    v = j.a.version;
  const once = await j.cmd("submit", "principal", {}, 200, {
    idempotency_key: key,
    expected_version: v,
  });
  const twice = await j.cmd("submit", "principal", {}, 200, {
    idempotency_key: key,
    expected_version: v,
  });
  assert.deepEqual(once, twice);
  await j.cmd("kyb_pass", "compliance", {}, 409, { expected_version: v });
  await f.login("principal");
  await f.call("/auth/logout", {});
  await f.call("/auth/me", undefined, 401);
});
test("native broker revocation, draft-only edits and principal isolation", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.create();
  const document = await j.doc("MANDATE");
  await f.login("principal");
  const m = await f.call("/mandates", {
    principal: "principal-1",
    broker: "broker-1",
    document,
    application_id: j.a.id,
    expires: "2027-01-01T00:00:00Z",
    commission_disclosed: true,
  });
  await j.create({ mandate: m.id });
  await j.doc("NIB");
  await j.cmd("submit", "broker", { commission_accepted: true });
  await f.login("broker");
  await f.call(
    "/applications/" + j.a.id + "/documents",
    { kind: "NIB", content_base64: "dGVzdA==" },
    404,
  );
  await f.login("principal");
  await f.call("/mandates/" + m.id + "/revoke", {});
  await f.login("broker");
  await f.call("/applications/" + j.a.id, undefined, 404);
  await f.login("obligee_private");
  await f.call("/applications/" + j.a.id, undefined, 404);
});
test("native documents encrypted in chunks, plaintext hash and role scope enforced", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.create();
  const id = await j.doc("NIB");
  const chunk = f.db.all(
    "SELECT bytes FROM document_chunks WHERE document_id=?",
    id,
  )[0];
  assert.equal(
    Buffer.from(chunk.bytes).includes(Buffer.from("Bukti sandbox")),
    false,
  );
  await f.login("principal");
  assert.match(
    await f.call("/documents/" + id + "/download"),
    /Bukti sandbox NIB/,
  );
  await f.login("admin");
  await f.call("/documents/" + id + "/download", undefined, 403);
  f.tx((s) => (s.get("documents", id).digest = "0".repeat(64)));
  await f.login("principal");
  await f.call("/documents/" + id + "/download", undefined, 409);
});
test("native policy maker-checker, administrative roles cannot approve BG", async () => {
  const f = fixture();
  await f.login("admin");
  const p = await f.call("/policies", { configuration: policy }, 201);
  await f.call("/policies/" + p.id + "/approve", {}, 403);
  await f.login("config_checker");
  await f.call("/policies/" + p.id + "/approve", {});
  assert.equal((await f.call("/catalog")).policies[0].version, 2);
});
test("native admin registration, status revocation and user-specific permissions", async () => {
  const f = fixture();
  await f.login("principal");
  await f.call("/users", undefined, 403);
  await f.login("admin");
  const u = await f.call(
    "/users",
    {
      username: "newprincipal",
      password: password,
      name: "New Principal",
      role: "PRINCIPAL",
      org: "principal-1",
      office: "cabang-1",
    },
    201,
  );
  await f.login("newprincipal");
  await f.call("/auth/me");
  await f.login("admin");
  await f.call("/users/" + u.id + "/status", { active: false });
  await f.login("newprincipal");
  await f.call("/auth/me", undefined, 401);
});
test("native issuance rechecks rollover and cumulative capacity atomically", async () => {
  const f = fixture(),
    j = new Journey(f);
  f.tx(
    (s) =>
      (s.get("policies", "policy-1").configuration.pks.principal_limit =
        "3000000000"),
  );
  const first = await j.issued({}, true);
  const second = await j.issued({}, true);
  j.a = first;
  await j.cmd("issue", "mpo");
  j.a = second;
  assert.equal((await j.cmd("issue", "mpo", {}, 422)).code, "LIMIT");
  assert.equal(new Store(f.db).rows("guarantees").length, 1);
  f.now = Date.parse("2026-11-01T07:00:00Z");
  assert.equal((await j.cmd("issue", "mpo", {}, 422)).code, "BR-05");
});
test("native SLA retry preserves overdue notifications exactly once", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.active();
  await j.claim();
  f.now += 2 * 86400000;
  await f.login("worker");
  assert.ok((await f.call("/operations/sweep", {})).escalated >= 1);
  assert.equal((await f.call("/operations/sweep", {})).escalated, 0);
  assert.ok(new Store(f.db).rows("notifications").length);
});
test("native SQLite restarts retain data and refuse changed encryption key", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.create();
  const fresh = new Store(f.db);
  assert.equal(fresh.get("applications", j.a.id).state, "DRAFT");
  assert.throws(
    () =>
      bootstrap(fresh, JSON.stringify(hashes), randomBytes(32).toString("hex")),
    (e) => e.code === "KEY_MISMATCH",
  );
});

test("native issue rejects inactive partner and nonwaivable NIB coverage", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.issued({}, true);
  f.tx((s) => (s.get("partners", "partner-1").active = false));
  assert.equal((await j.cmd("issue", "mpo", {}, 422)).code, "BR-02");
  f.tx((s) => {
    s.get("partners", "partner-1").active = true;
    const a = s.get("applications", j.a.id);
    a.sp2.covered_documents = ["NIB", "CONTRACT"];
    for (const doc of s.rows("documents", { application_id: a.id }))
      if (doc.kind === "NIB") doc.verified = false;
  });
  assert.equal((await j.cmd("issue", "mpo", {}, 422)).code, "BR-06");
});
test("native handoff metadata, signer office and portfolio ownership are rechecked", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.issued({ issuing_office: "kpo-1" }, true);
  await j.cmd("issue", "mpo", {}, 403);
  f.tx((s) => s.get("applications", j.a.id).ememo.cc.pop());
  assert.equal((await j.cmd("issue", "issuer", {}, 422)).code, "BR-12");
  f.tx((s) => {
    const a = s.get("applications", j.a.id);
    a.ememo.cc = policy.rules["BR-12"].cc;
    a.portfolio_owner = "kpo-1";
  });
  assert.equal((await j.cmd("issue", "issuer", {}, 422)).code, "BR-16");
});
test("native maker cannot approve by impersonating a bank decision role", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.underwriting();
  f.tx((s) => (s.get("users", "principal").role = "MPO"));
  await j.cmd("approve", "principal", {}, 403);
});
test("native contra claim submitter, monitoring owner and timely report", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.active();
  let c = await j.claim();
  assert.equal(c.monitor_owner, "UNIT_BISNIS");
  assert.equal(c.cc, "PENGEMBANGAN_BISNIS");
  c = await j.claimcmd(c, "report", "mpo");
  assert.equal(new Store(f.db).get("tasks", "report:" + c.id).late, false);
  c = await j.claimcmd(c, "approve_claim", "mpo", {
    instrument_conditions_met: true,
  });
  c = await j.claimcmd(c, "pay_bank", "finance");
  await j.claimcmd(
    c,
    "submit_contra",
    "support",
    { document: await j.doc("CONTRA_CLAIM", "mpo") },
    403,
  );
});
test("native expired BG remains authentic with separate claim window", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.issued();
  const link = await f.call("/applications/" + j.a.id + "/verification-link");
  f.now = Date.parse("2027-04-28T07:00:00Z");
  const result = await f.call("/public/verify/" + link.token);
  assert.equal(result.authentic, true);
  assert.equal(result.valid, false);
  assert.equal(result.claim_window_open, true);
});
test("native arbitrary actor fields, malformed commands and own-document verification fail closed", async () => {
  const f = fixture(),
    j = new Journey(f);
  await f.login("principal");
  await f.call(
    "/applications",
    { principal: "principal-1", actor_id: "admin" },
    422,
  );
  await j.create();
  await f.login("compliance");
  const d = await f.call(
    "/applications/" + j.a.id + "/documents",
    { kind: "KYB", content_base64: "dGVzdA==" },
    201,
  );
  await f.call(
    "/documents/" + d.id + "/verify",
    { source_reference: "Own upload" },
    403,
  );
  await f.call(
    "/applications/" + j.a.id + "/commands/kyb_pass",
    { expected_version: 0, idempotency_key: crypto.randomUUID(), payload: [] },
    422,
  );
});
test("native maximum document is chunked below row limits and survives readback", async () => {
  const f = fixture(),
    j = new Journey(f);
  await j.create();
  const bytes = Buffer.from("a".repeat(2000000));
  const d = await f.call(
    "/applications/" + j.a.id + "/documents",
    { kind: "CONTRACT", content_base64: bytes.toString("base64") },
    201,
  );
  assert.ok(
    f.db.all("SELECT ordinal FROM document_chunks WHERE document_id=?", d.id)
      .length > 1,
  );
  assert.equal(
    (await f.call("/documents/" + d.id + "/download")).length,
    2000000,
  );
  await f.call(
    "/applications/" + j.a.id + "/documents",
    {
      kind: "CONTRACT",
      content_base64: Buffer.from("b".repeat(2000001)).toString("base64"),
    },
    422,
  );
});


test("native checklist lists missing, pending, optional, and stage-specific documents", async () => {
  const f = fixture(), j = new Journey(f);
  await j.create({bg_type:"PENAWARAN",custom_format:true});
  let checklist=j.a.document_checklist;
  assert.ok(checklist);
  assert.equal(checklist.ready,false);
  assert.equal(checklist.items.find(d=>d.kind==="NIB").status,"MISSING");
  assert.equal(checklist.items.find(d=>d.kind==="UNDANGAN_TENDER").status,"MISSING");
  assert.equal(checklist.items.find(d=>d.kind==="TDR").status,"CONDITIONAL");
  assert.equal(checklist.items.find(d=>d.kind==="SLIK").status,"UPCOMING");
  assert.equal(checklist.items.find(d=>d.kind==="FORMAT_APPROVAL").status,"UPCOMING");
  const act=await j.doc("AKTA_PENDIRIAN","principal",false);
  await f.login("principal");
  checklist=(await f.call("/applications/"+j.a.id)).document_checklist;
  assert.equal(checklist.items.find(d=>d.kind==="AKTA_PENDIRIAN").status,"PENDING");
  assert.match(checklist.notification,/menunggu verifikasi/);
  await f.login("compliance");
  await f.call("/documents/"+act+"/verify",{source_reference:"Akta primer verified"});
  await f.login("principal");
  checklist=(await f.call("/applications/"+j.a.id)).document_checklist;
  assert.equal(checklist.items.find(d=>d.kind==="AKTA_PENDIRIAN").status,"VERIFIED");
  await f.login("penjamin");
  const partnerView=await f.call("/applications/"+j.a.id);
  assert.ok(partnerView.document_checklist.items.every(d=>["SP2KBG","CERTIFICATE","FORMAT_APPROVAL"].includes(d.kind)));
});

test("native checklist reflects pending SLIK without claiming source verification", async () => {
  const f=fixture(),j=new Journey(f);
  await j.create();
  for(const kind of ["NIB","CONTRACT","KYB"])await j.doc(kind);
  await j.cmd("submit","principal");
  const id=await j.doc("SLIK","analyst",false);
  await f.login("principal");
  let c=(await f.call("/applications/"+j.a.id)).document_checklist;
  assert.equal(c.stage,"Pemeriksaan SLIK, DHN dan legal");
  assert.equal(c.items.find(d=>d.kind==="SLIK").status,"PENDING");
  assert.ok(c.counts.pending>0);
  await f.login("compliance");
  await f.call("/documents/"+id+"/verify",{source_reference:"Hasil SLIK resmi"});
  await f.login("principal");
  c=(await f.call("/applications/"+j.a.id)).document_checklist;
  assert.equal(c.items.find(d=>d.kind==="SLIK").status,"VERIFIED");
  assert.ok(c.counts.missing>0); // dokumen lain tetap harus dilengkapi
});


test("enterprise policy dry-run is audited and does not activate policy", async () => {
  const f=fixture();
  await f.login("analyst");
  const result=await f.call("/policies/policy-1/simulate",{
    facts:{slik_current:false,eligible:true},codes:["BR-03","BR-05"]});
  assert.equal(result.simulation_only,true);
  assert.equal(result.passed,false);
  assert.equal(result.results[0].passed,true);
  assert.equal(result.results[1].passed,false);
  await f.login("audit");
  assert.equal((await f.call("/audit/verify")).valid,true);
  assert.equal(new Store(f.db).get("policies","policy-1").status,"ACTIVE");
  f.sqlite.close();
});

test("enterprise 5C requires verified evidence, separate reviewer and review before underwriting",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.create();
  for(const kind of ["NIB","CONTRACT","KYB"]) await j.doc(kind);
  const financial=await j.doc("LAPORAN_KEUANGAN","analyst");
  await j.cmd("submit","principal");
  await j.cmd("kyb_pass","compliance",{screening_clear:true,ubo_verified:true});
  const slik=await j.doc("SLIK","analyst");
  await j.cmd("record_slik","analyst",{document:slik,collectibility:1,pulled_at:new Date(f.now).toISOString()});
  await j.cmd("partner_start","penjamin");
  const sp2=await j.doc("SP2KBG","penjamin");
  await j.cmd("sp2_issue","penjamin",{document:sp2,reference:"SP2-2026",issuing_unit:"CABANG-UJI",amount:j.a.amount,valid_to:"2027-01-01"});
  const five_c=Object.fromEntries(["character","capacity","capital","collateral","condition"].map(k=>
    [k,{risk:"LOW",finding:"Temuan didukung bukti pemeriksaan",mitigation:"Monitoring berkala oleh analis"}]));
  await j.cmd("record_5c","analyst",{
    five_c,financial_document:financial,
    financials:{current_assets:"200",current_liabilities:"100",total_debt:"50",equity:"200"},
    recommendation:"LAYAK",narrative:"Penilaian analis dan sumber evidence diverifikasi"});
  assert.equal((await j.cmd("bank_underwrite","analyst",{},409)).code,"UNDERWRITING");
  assert.equal((await j.cmd("review_5c","analyst",{accepted:true,reason:"Pemeriksaan data telah dilakukan"},403)).code,"FORBIDDEN");
  await j.cmd("review_5c","mpo",{accepted:true,reason:"Bukti dan analisis dinyatakan memadai"});
  const details=await f.call("/applications/"+j.a.id+"/enterprise");
  assert.equal(details.underwriting.state,"REVIEWED");
  assert.equal(details.underwriting.ratios.current_ratio,"2.00");
  await j.cmd("bank_underwrite","analyst");
  assert.equal(j.a.state,"APPROVAL");
  f.sqlite.close();
});

test("enterprise collateral and capacity reserve persist, and concurrent exposure is counted",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.issued({},true);
  const evidence=await j.doc("COLLATERAL","analyst");
  await j.cmd("register_collateral","analyst",{type:"CASH",value:"2000000000",
    document:evidence,binding_reference:"BLOCK-SANDBOX-2026-001"});
  await f.login("mpo");
  let info=await f.call("/applications/"+j.a.id+"/enterprise");
  assert.equal(info.collateral[0].state,"PENDING_VERIFICATION");
  await j.cmd("approve_collateral","compliance",{collateral_id:info.collateral[0].id,
    accepted:true,reason:"Bukti pemblokiran diverifikasi manual"});
  await j.cmd("reserve_limit","mpo");
  info=await f.call("/applications/"+j.a.id+"/enterprise");
  assert.equal(info.limit_reservation.status,"RESERVED");
  const j2=new Journey(f);
  await j2.issued({amount:"9000000000"},true);
  assert.equal((await j2.cmd("reserve_limit","mpo",{},422)).code,"LIMIT");
  assert.equal((await j2.cmd("issue","mpo",{},422)).code,"LIMIT");
  await j.cmd("issue","mpo");
  info=await f.call("/applications/"+j.a.id+"/enterprise");
  assert.equal(info.limit_reservation.status,"CONSUMED");
  f.sqlite.close();
});

test("BG servicing retains original certificate; closure blocked until claim period and independent review",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  const previous=j.a.bg_number;
  const amendmentDoc=await j.doc("AMENDMENT_REQUEST","principal");
  await j.cmd("request_servicing","principal",{kind:"EXTENSION",document:amendmentDoc,
    reason:"Penambahan masa pelaksanaan proyek",
    proposed_expiry:"2027-09-30"});
  await f.login("mpo");
  const detail=await f.call("/applications/"+j.a.id+"/enterprise");
  assert.equal(detail.servicing[0].status,"PENDING_REVIEW");
  assert.equal(j.a.state,"ACTIVE");
  assert.equal(j.a.bg_number,previous);
  const release=await j.doc("RELEASE","mpo");
  assert.equal((await j.cmd("request_bg_closure","mpo",{document:release},409)).code,"CLOSURE");
  f.sqlite.close();
  const g=fixture(),x=new Journey(g);
  await x.active();
  const doc=await x.doc("RELEASE","mpo");
  g.now=Date.parse("2027-07-01T07:00:00Z");
  await x.cmd("request_bg_closure","mpo",{document:doc});
  assert.equal((await x.cmd("confirm_bg_closure","mpo",{},403)).code,"FORBIDDEN");
  await x.cmd("confirm_bg_closure","compliance");
  assert.equal(x.a.state,"CLOSED");
  assert.equal(new Store(g.db).get("guarantees",x.a.id).status,"CLOSED");
  assert.equal((await g.call("/public/verify/no-token")).authentic,false);
  g.sqlite.close();
});


test("replacement evidence invalidates earlier verified version during document gate",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.create();
  await j.doc("NIB");
  const second=await j.doc("NIB","principal",false);
  assert.ok(second);
  const detail=await f.call("/applications/"+j.a.id);
  assert.equal(detail.document_checklist.items.find(x=>x.kind==="NIB").status,"PENDING");
  assert.equal((await j.cmd("submit","principal",{},422)).code,"BR-09");
  f.sqlite.close();
});

test("collateral cannot be registered using a non-collateral document",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.issued({},true);
  const unrelated=await j.doc("NIB","analyst");
  assert.equal((await j.cmd("register_collateral","analyst",{
    type:"CASH",value:"100",document:unrelated,
    binding_reference:"BANK-BLOCK-2026"},422)).code,"DOCUMENT");
  assert.equal(new Store(f.db).rows("collaterals").length,0);
  f.sqlite.close();
});


async function reviewedServicing(j,proposed_amount="3500000000"){
  const f=j.f;
  const requestDocument=await j.doc("AMENDMENT_REQUEST","principal");
  await j.cmd("request_servicing","principal",{
    kind:"AMENDMENT",document:requestDocument,
    proposed_amount,reason:"Perubahan nilai kontrak kerja resmi"});
  await f.login("mpo");
  const before=await f.call("/applications/"+j.a.id+"/servicing");
  assert.equal(before.at(-1).status,"PENDING_REVIEW");
  const id=before.at(-1).id;
  for(const kind of ["SLIK","DHN","LEGAL_CHECK","MAP_BG"])
    await j.doc(kind,"analyst");
  await j.cmd("review_servicing","analyst",{
    servicing_id:id,collectibility:1,pulled_at:new Date(f.now).toISOString(),
    screening_clear:true,ubo_verified:true,recommendation:"LAYAK",
    narrative:"SLIK, DHN, aspek hukum dan MAP-BG diperiksa ulang"});
  const cert=await j.doc("COUNTER_ENDORSEMENT","penjamin");
  await j.cmd("partner_endorse","penjamin",{
    servicing_id:id,document:cert,reference:"END-2026-0001",
    cover_amount:proposed_amount,cover_until:"2027-04-27"});
  return id;
}
test("BG amendment requires risk, guarantor and independent bank approval without changing original",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  const originalNumber=j.a.bg_number, originalAmount=j.a.amount, originalDate=j.a.expires_on;
  const id=await reviewedServicing(j);
  await f.login("mpo");
  let items=await f.call("/applications/"+j.a.id+"/servicing");
  assert.equal(items[0].status,"PARTNER_ENDORSED");
  assert.equal((await j.cmd("partner_endorse","principal",{servicing_id:id,document:"not-owned",reference:"END-2026-0002",cover_amount:"3500000000",cover_until:"2027-04-27"},403)).code,"FORBIDDEN");
  await j.cmd("approve_servicing","mpo",{servicing_id:id});
  items=await f.call("/applications/"+j.a.id+"/servicing");
  assert.equal(items[0].status,"APPROVED_PENDING_ISSUANCE");
  assert.deepEqual(items[0].approved_roles,["MPO"]);
  assert.equal(items[0].effective,false);
  assert.equal(j.a.amount,originalAmount);
  assert.equal(j.a.expires_on,originalDate);
  assert.equal(j.a.bg_number,originalNumber);
  const db=new Store(f.db);
  assert.equal(db.get("limit_reservations","servicing:"+id).amount,"1500000000.00");
  assert.equal(db.get("limit_reservations","servicing:"+id).status,"RESERVED");
  const token=await f.call("/applications/"+j.a.id+"/verification-link");
  const verified=await f.call("/public/verify/"+token.token);
  assert.equal(verified.amount,originalAmount);
  assert.equal(verified.expires_on,originalDate);
  assert.equal((await j.cmd("request_servicing","principal",{
    kind:"AMENDMENT",document:await j.doc("AMENDMENT_REQUEST","principal"),
    proposed_amount:"3600000000",reason:"Perubahan tambahan nominal kerja"},409)).code,"SERVICING");
  f.sqlite.close();
});
test("approved but not effected amendment can be cancelled by Legal and releases delta atomically",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  const id=await reviewedServicing(j);
  await j.cmd("approve_servicing","mpo",{servicing_id:id});
  const cancellation=await j.doc("CANCELLATION","legal");
  assert.equal((await j.cmd("cancel_approved_servicing","mpo",{
    servicing_id:id,document:cancellation,reason:"Batal karena perubahan kontrak"},403)).code,"FORBIDDEN");
  await j.cmd("cancel_approved_servicing","legal",{
    servicing_id:id,document:cancellation,reason:"Persetujuan perubahan dibatalkan oleh bank"});
  const s=new Store(f.db);
  assert.equal(s.get("servicing",id).status,"CANCELLED");
  assert.equal(s.get("limit_reservations","servicing:"+id).status,"RELEASED");
  assert.equal(j.a.state,"ACTIVE");
  f.sqlite.close();
});
test("amendment cannot exceed current principal limit even with valid approvals",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  const id=await reviewedServicing(j,"11000000000");
  assert.equal((await j.cmd("approve_servicing","mpo",{servicing_id:id},409)).code,"LIMIT");
  const s=new Store(f.db);
  assert.equal(s.get("servicing",id).status,"PARTNER_ENDORSED");
  assert.equal(s.maybe("limit_reservations","servicing:"+id),undefined);
  assert.equal(s.rows("approvals").filter(d=>d.servicing_id===id).length,0);
  f.sqlite.close();
});
test("servicing rejects stale pre-request SLIK and missing new control documents",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  for(const kind of ["SLIK","DHN","LEGAL_CHECK","MAP_BG"])await j.doc(kind,"analyst");
  const requestDocument=await j.doc("AMENDMENT_REQUEST","principal");
  await j.cmd("request_servicing","principal",{
    kind:"EXTENSION",document:requestDocument,
    proposed_expiry:"2027-09-30",reason:"Tambahan masa penyelesaian proyek"});
  const ids=await f.call("/applications/"+j.a.id+"/servicing");
  f.now+=60_000;
  assert.equal((await j.cmd("review_servicing","analyst",{
    servicing_id:ids[0].id,collectibility:1,pulled_at:new Date(f.now).toISOString(),
    screening_clear:true,ubo_verified:true,recommendation:"LAYAK",
    narrative:"Informasi risiko terverifikasi"},409)).code,"DOCUMENT");
  assert.equal(new Store(f.db).get("servicing",ids[0].id).status,"PENDING_REVIEW");
  f.sqlite.close();
});
test("public QR reports closed BG as authentic but not active",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  const link=await f.call("/applications/"+j.a.id+"/verification-link");
  const doc=await j.doc("RELEASE","mpo");
  f.now=Date.parse("2027-07-01T07:00:00Z");
  await j.cmd("request_bg_closure","mpo",{document:doc});
  await j.cmd("confirm_bg_closure","compliance");
  const check=await f.call("/public/verify/"+link.token);
  assert.equal(check.authentic,true);
  assert.equal(check.valid,false);
  assert.equal(check.status,"AUTHENTIC_CLOSED");
  assert.equal(check.claim_window_open,false);
  f.sqlite.close();
});


test("servicing raises approval authority when revised private BG exceeds committee threshold",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.issued({obligee:"obligee-private"});
  await j.cmd("certificate","penjamin",{document:await j.doc("CERTIFICATE","penjamin"),reference:"PRIVATE-CERT-2026"});
  await j.cmd("deliver","mpo",{document:await j.doc("DELIVERY","obligee_private")});
  const id=await reviewedServicing(j,"4000000000");
  assert.equal((await j.cmd("approve_servicing","gh",{servicing_id:id},403)).code,"FORBIDDEN");
  await j.cmd("approve_servicing","mpo",{servicing_id:id});
  await f.login("mpo");
  let rows=await f.call("/applications/"+j.a.id+"/servicing");
  assert.equal(rows[0].status,"PARTNER_ENDORSED");
  assert.deepEqual(rows[0].approved_roles,["MPO"]);
  await j.cmd("approve_servicing","direksi",{servicing_id:id});
  rows=await f.call("/applications/"+j.a.id+"/servicing");
  assert.equal(rows[0].status,"APPROVED_PENDING_ISSUANCE");
  assert.deepEqual(rows[0].approved_roles,["MPO","DIREKSI"]);
  f.sqlite.close();
});

test("verified MAP-BG replacement after risk review requires new assessment",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  const id=await reviewedServicing(j);
  await j.doc("MAP_BG","analyst");
  assert.equal((await j.cmd("approve_servicing","mpo",{servicing_id:id},409)).code,"DOCUMENT");
  const s=new Store(f.db);
  assert.equal(s.get("servicing",id).status,"PARTNER_ENDORSED");
  assert.equal(s.rows("approvals").filter(x=>x.servicing_id===id).length,0);
  f.sqlite.close();
});

test("no-op amendment cannot advance even with a verified request",async()=>{
  const f=fixture(),j=new Journey(f);
  await j.active();
  const document=await j.doc("AMENDMENT_REQUEST","principal");
  assert.equal((await j.cmd("request_servicing","principal",{
    kind:"AMENDMENT",document,
    proposed_amount:j.a.amount,reason:"Tidak ada perubahan nominal"},409)).code,"SERVICING");
  assert.equal(new Store(f.db).rows("servicing").length,0);
  f.sqlite.close();
});


function visitData(photo_document,changes={}){
 return {
  visited_at:"2026-10-28T06:00:00Z",
  customer_type:"DEBITUR BARU",request_type:"PENERBITAN BANK GARANSI",
  referral:"INFORMASI TIM CABANG",
  location:{key_person:"DIREKTUR PROYEK",phone:"+6281234567890",
   street:"Jalan Pengujian Nomor 12",village:"Kelurahan Sukamaju",
   city:"Depok",distance_km:12.5},
  environment:"KOMERSIAL_BISNIS",
  facilities_within_1km:["Kantor pelayanan publik","Pusat perdagangan"],
  notes:"Lokasi dan kegiatan proyek telah dijelaskan oleh pengurus saat kunjungan.",
  photo_categories:["TAMPAK_MUKA","LINGKUNGAN_SEKITAR","NASABAH_DAN_RM"],
  photo_document,attested:true,
  ...changes,
 };
}
async function approvedVisit(j){
 const photos=await j.doc("LKN_PHOTOS","ao");
 await j.cmd("record_visit","ao",visitData(photos));
 const current=(await j.f.call("/applications/"+j.a.id+"/visit")).current;
 assert.equal(current.status,"PENDING_BM_REVIEW");
 const signed=await j.doc("LKN","ao");
 await j.cmd("review_visit","mpo",{accepted:true,reason:"Bukti dan keterangan RM ditinjau",report_document:signed});
 return (await j.f.call("/applications/"+j.a.id+"/visit")).current;
}
test("LKN digital form persists field evidence and independent BM review",async()=>{
 const f=fixture(),j=new Journey(f);
 await j.create();
 const photo=await j.doc("LKN_PHOTOS","ao");
 assert.equal((await j.cmd("record_visit","principal",visitData(photo),403)).code,"FORBIDDEN");
 assert.equal((await j.cmd("record_visit","ao",visitData(photo,{attested:false}),422)).code,"VISIT");
 await j.cmd("record_visit","ao",visitData(photo));
 await f.login("ao");
 let snapshot=await f.call("/applications/"+j.a.id+"/visit");
 assert.equal(snapshot.conditional,true);
 assert.equal(snapshot.current.rm,"ao");
 assert.equal(snapshot.current.location.city,"Depok");
 assert.equal(snapshot.current.environment,"KOMERSIAL_BISNIS");
 assert.equal(snapshot.current.status,"PENDING_BM_REVIEW");
 assert.equal((await j.cmd("record_visit","ao",visitData(photo),409)).code,"VISIT");
 const signed=await j.doc("LKN","ao");
 assert.equal((await j.cmd("review_visit","ao",{
  accepted:true,reason:"Review disetujui oleh RM sendiri",report_document:signed},403)).code,"FORBIDDEN");
 await j.cmd("review_visit","mpo",{
  accepted:true,reason:"Dokumen disetujui setelah pemeriksaan lapangan",report_document:signed});
 snapshot=await f.call("/applications/"+j.a.id+"/visit");
 assert.equal(snapshot.current.status,"REVIEWED");
 assert.equal(snapshot.current.bm,"mpo");
 assert.equal(snapshot.legal_signature_verified,false);
 await f.login("principal");
 assert.equal((await f.call("/applications/"+j.a.id+"/visit",undefined,403)).code,"FORBIDDEN");
 await f.login("audit");
 assert.equal((await f.call("/audit/verify")).valid,true);
 f.sqlite.close();
});
test("LKN review is blocked without latest verified signed LKN evidence",async()=>{
 const f=fixture(),j=new Journey(f);
 await j.create();
 const photos=await j.doc("LKN_PHOTOS","ao");
 await j.cmd("record_visit","ao",visitData(photos));
 const unverified=await j.doc("LKN","ao",false);
 assert.equal((await j.cmd("review_visit","mpo",{
  accepted:true,reason:"Review tertahan saat bukti belum diverifikasi",
  report_document:unverified},422)).code,"DOCUMENT");
 await f.login("mpo");
 const snapshot=await f.call("/applications/"+j.a.id+"/visit");
 const s=new Store(f.db);
 assert.equal(s.get("visits",snapshot.current.id).status,"PENDING_BM_REVIEW");
 f.sqlite.close();
});
test("new LKN revision and new photo evidence invalidate earlier 5C review",async()=>{
 const f=fixture(),j=new Journey(f);
 await j.create();
 const original=await approvedVisit(j);
 for(const kind of ["NIB","CONTRACT","KYB"])await j.doc(kind);
 const financial=await j.doc("LAPORAN_KEUANGAN","analyst");
 await j.cmd("submit","principal");
 await j.cmd("kyb_pass","compliance",{screening_clear:true,ubo_verified:true});
 const slik=await j.doc("SLIK","analyst");
 await j.cmd("record_slik","analyst",{document:slik,
  collectibility:1,pulled_at:new Date(f.now).toISOString()});
 await j.cmd("partner_start","penjamin");
 const sp2=await j.doc("SP2KBG","penjamin");
 await j.cmd("sp2_issue","penjamin",{document:sp2,reference:"SP2-LKN-CHECK",
  issuing_unit:"CABANG-UJI",amount:j.a.amount,valid_to:"2027-01-01"});
 const five_c=Object.fromEntries(["character","capacity","capital","collateral","condition"]
  .map(k=>[k,{risk:"LOW",finding:"Temuan kunjungan telah diverifikasi",
    mitigation:"Pengawasan dokumen dan kondisi proyek"}]));
 const form={
  five_c,financial_document:financial,
  financials:{current_assets:"200",current_liabilities:"100",total_debt:"50",equity:"200"},
  recommendation:"LAYAK",narrative:"Analisis dikaitkan dengan LKN dan evidence"};
 await j.cmd("record_5c","analyst",form);
 await f.login("analyst");
 const before=await f.call("/applications/"+j.a.id+"/enterprise");
 assert.equal(before.underwriting.visit_id,original.id);
 await j.cmd("review_5c","mpo",{accepted:true,reason:"Hasil LKN dan 5C konsisten"});
 await j.doc("LKN_PHOTOS","ao"); // replacing current evidence invalidates approved LKN
 assert.equal((await j.cmd("bank_underwrite","analyst",{},409)).code,"DOCUMENT");
 const photo=await j.doc("LKN_PHOTOS","ao");
 await j.cmd("record_visit","ao",visitData(photo,{notes:"Hasil kunjungan revisi dan peninjauan lapangan telah diperbarui."}));
 const signed=await j.doc("LKN","ao");
 await j.cmd("review_visit","mpo",{accepted:true,reason:"Kunjungan ulang disetujui",
   report_document:signed});
 assert.equal((await j.cmd("bank_underwrite","analyst",{},409)).code,"UNDERWRITING");
 await j.cmd("record_5c","analyst",form);
 await j.cmd("review_5c","mpo",{accepted:true,reason:"Analisis ulang LKN dan 5C telah diperiksa"});
 await j.cmd("bank_underwrite","analyst");
 assert.equal(j.a.state,"APPROVAL");
 f.sqlite.close();
});
test("LKN rejects malformed location and external-application photo evidence",async()=>{
 const f=fixture(),j=new Journey(f),other=new Journey(f);
 await j.create();
 const unrelated=await other.create({project_name:"Proyek Lain"});
 const photo=await other.doc("LKN_PHOTOS","ao");
 assert.equal((await j.cmd("record_visit","ao",visitData(photo),422)).code,"DOCUMENT");
 const own=await j.doc("LKN_PHOTOS","ao");
 assert.equal((await j.cmd("record_visit","ao",visitData(own,{
  environment:"ZONA_PENGUJIAN_TIDAK_DISETUJUI"}),422)).code,"VISIT");
 assert.equal((await j.cmd("record_visit","ao",visitData(own,{
  location:{...visitData(own).location,distance_km:-4}}),422)).code,"VISIT");
 assert.equal(new Store(f.db).rows("visits").length,0);
 f.sqlite.close();
});

test("LKN photo bundles reject ordinary text and require a PDF container",async()=>{
 const f=fixture(),j=new Journey(f);
 await j.create();
 await f.login("ao");
 const response=await f.call("/applications/"+j.a.id+"/documents",{
  kind:"LKN_PHOTOS",source_reference:"Kunjungan nasabah RM",
  content_base64:Buffer.from("Foto yang dinyatakan tanpa PDF").toString("base64"),
 },422);
 assert.equal(response.code,"DOCUMENT");
 assert.equal(new Store(f.db).rows("documents",{application_id:j.a.id})
   .filter(d=>d.kind==="LKN_PHOTOS").length,0);
 f.sqlite.close();
});
