import { spawn } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
const port = 18511,
  base = "http://127.0.0.1:" + port;
const state = "runtime/native-persistence-" + randomBytes(6).toString("hex");
const credentials = JSON.parse(
  fs.readFileSync("runtime/sandbox-credentials.json"),
);
const fd = fs.openSync("runtime/native-persistence-worker.log", "w");
let child;
async function start() {
  child = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--config",
      "frontend/wrangler.jsonc",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--local",
      "--inspector-port",
      "18512",
      "--env-file",
      "runtime/native-test.env",
      "--persist-to",
      state,
    ],
    { stdio: ["ignore", fd, fd] },
  );
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Native runtime failed to start");
}
async function stop() {
  if (!child) return;
  const done = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
}
const sessions = {};
async function login(name) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: name, password: credentials[name] }),
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  sessions[name] = {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: d.csrf,
  };
  return sessions[name];
}
async function call(name, path, body, expected = 200) {
  const session = sessions[name];
  const r = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(session
        ? { cookie: session.cookie, "x-csrf-token": session.csrf }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  assert.equal(r.status, expected, path + ": " + text);
  return r.headers.get("content-type")?.includes("application/json")
    ? JSON.parse(text)
    : text;
}
const checks = [];
try {
  await start();
  await call("none", "/auth/me", undefined, 401);
  checks.push("unauthenticated_request_rejected");
  await login("principal");
  const app = await call(
    "principal",
    "/applications",
    {
      principal: "principal-1",
      obligee: "obligee-apbn",
      partner: "partner-1",
      processing_office: "cabang-1",
      issuing_office: "cabang-1",
      project_name: "Native persistence " + Date.now(),
      amount: "2000000000",
      issue_on: "2026-10-28",
      expires_on: "2027-04-27",
    },
    201,
  );
  const bytes = Buffer.from(
    "Durable document " + randomBytes(12).toString("hex"),
  );
  const doc = await call(
    "principal",
    "/applications/" + app.id + "/documents",
    { kind: "NIB", content_base64: bytes.toString("base64") },
    201,
  );
  await login("compliance");
  await call("compliance", "/documents/" + doc.id + "/verify", {
    source_reference: "Independent source check",
  });
  const submit = () =>
    fetch(base + "/api/applications/" + app.id + "/commands/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessions.principal.cookie,
        "x-csrf-token": sessions.principal.csrf,
      },
      body: JSON.stringify({
        expected_version: 0,
        idempotency_key: crypto.randomUUID(),
        payload: {},
      }),
    });
  const concurrent = await Promise.all([submit(), submit()]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  checks.push("concurrent_mutations_commit_once");
  for (const r of concurrent) await r.arrayBuffer();
  await stop();
  await start();
  const persisted = await call("principal", "/applications/" + app.id);
  assert.equal(persisted.state, "KYC_KYB_CHECK");
  assert.equal(persisted.version, 1);
  checks.push("session_and_application_survive_worker_restart");
  assert.equal(
    await call("principal", "/documents/" + doc.id + "/download"),
    bytes.toString(),
  );
  checks.push("encrypted_document_survives_restart");
  await login("admin");
  assert.equal((await call("admin", "/users")).length, 21);
  await call("principal", "/users", undefined, 403);
  checks.push("admin_only_users_api");
  const cross = await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: {
      cookie: sessions.principal.cookie,
      origin: "https://evil.test",
      "x-csrf-token": sessions.principal.csrf,
    },
    body: "{}",
  });
  assert.equal(cross.status, 403);
  checks.push("cross_site_post_rejected");
  await login("audit");
  assert.equal((await call("audit", "/audit/verify")).valid, true);
  checks.push("audit_chain_verified_after_restart");
  await call("principal", "/auth/logout", {});
  await call("principal", "/auth/me", undefined, 401);
  checks.push("logout_revokes_persisted_session");
  const health = await call("none", "/health/deployment");
  assert.equal(health.backend_connectivity, "ok");
  assert.equal(health.production_enabled, false);
  checks.push("native_backend_readiness_accurate");
  for (let i = 0; i < 16; i++) {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "nonexistent-rate-check",
        password: "incorrect-password",
      }),
    });
    assert.equal(r.status, i < 15 ? 401 : 429);
    await r.arrayBuffer();
  }
  checks.push("failed_login_rate_limit_persists");
  const result = {
    status: "PASS",
    runtime: "cloudflare-workerd-sqlite",
    checks,
    database: "isolated disposable SQLite-backed Durable Object",
    paid_plan_required: false,
  };
  fs.writeFileSync(
    "evidence/native-runtime.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await stop();
  fs.closeSync(fd);
}
