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
