import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Store, initializeSchema, passwordHash } from "../cloudflare/core.ts";
import { bootstrap, IDENTITIES } from "../cloudflare/bootstrap.ts";
import { Service } from "../cloudflare/service.ts";
import { PRINCIPAL_VISIBLE_DOCUMENT_KINDS } from "../cloudflare/document-scope.ts";

function bank() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const db = {
    all: (sql, ...values) => sqlite.prepare(sql).all(...values.map((x) =>
      x instanceof ArrayBuffer ? new Uint8Array(x) : x)),
    run: (sql, ...values) => sqlite.prepare(sql).run(...values.map((x) =>
      x instanceof ArrayBuffer ? new Uint8Array(x) : x)),
  };
  initializeSchema(db);
  const key = randomBytes(32).toString("hex");
  const secretHash = passwordHash("Synthetic!" + randomBytes(16).toString("hex"));
  const hashes = Object.fromEntries(IDENTITIES.map(([name]) => [name, secretHash]));
  bootstrap(new Store(db), JSON.stringify(hashes), key);
  const service = new Service(new Store(db), key, Date.parse("2026-10-28T07:00:00Z"));
  const actor = (id, role, org = "bank-org") => ({
    id, role, org, office: "cabang-1", bank: "bank-uat",
  });
  const principal = actor("principal", "PRINCIPAL", "principal-1");
  const analyst = actor("analyst", "ANALYST");
  const penjamin = actor("penjamin", "PENJAMIN", "partner-1");
  const wrongObligee = actor("obligee_private", "OBLIGEE", "obligee-private");
  const created = service.create(principal, {
    principal: "principal-1",
    obligee: "obligee-apbn",
    partner: "partner-1",
    processing_office: "cabang-1",
    issuing_office: "cabang-1",
    project_name: "Isolated confidential-evidence UAT",
    amount: "2000000000",
    issue_on: "2026-10-28",
    expires_on: "2027-04-27",
    bg_type: "PELAKSANAAN",
  });
  const app = service.s.get("applications", created.id);
  return { sqlite, service, app, principal, analyst, penjamin, wrongObligee };
}

test("Principal never receives internal bank workflow, SLIK, MKP or internal evidence references", () => {
  const f = bank();
  try {
    const sensitive = ["SLIK", "DHN", "MKP", "LKN_PHOTOS", "CONTRA_DECISION", "COLLATERAL"];
    const internal = sensitive.map((kind) =>
      f.service.addDocument(f.analyst, f.app, kind, Buffer.from("CONFIDENTIAL BANK " + kind)));
    const nib = f.service.addDocument(f.principal, f.app, "NIB", Buffer.from("Synthetic principal NIB"));
    f.service.flush();

    const principalView = f.service.view(f.principal, f.app);
    assert.equal(principalView.workflow, undefined);
    const visible = principalView.documents.map((d) => d.kind);
    assert.ok(visible.includes("NIB"));
    assert.ok(visible.includes("DRAFT_BG"));
    const checklistKinds = principalView.document_checklist.items.map((x) => x.kind);
    assert.ok(checklistKinds.includes("NIB"));
    assert.ok(!checklistKinds.includes("SLIK"));
    assert.ok(!checklistKinds.includes("MKP"));
    for (const doc of internal) {
      assert.equal(visible.includes(doc.kind), false, doc.kind + " leaked in list");
      assert.equal(JSON.stringify(principalView).includes(doc.id), false, doc.kind + " ID leaked in response");
      assert.throws(() => f.service.download(f.principal, doc.id), (error) =>
        error.status === 403 && error.code === "FORBIDDEN",
        doc.kind + " must be denied even if document ID is known");
      assert.match(f.service.download(f.analyst, doc.id).toString(), /CONFIDENTIAL BANK/);
    }
    assert.equal(f.service.download(f.principal, nib.id).toString(), "Synthetic principal NIB");
    assert.equal(PRINCIPAL_VISIBLE_DOCUMENT_KINDS.includes("MKP"), false);
    assert.equal(PRINCIPAL_VISIBLE_DOCUMENT_KINDS.includes("SLIK"), false);
    assert.throws(() => f.service.view(f.wrongObligee, f.app), (error) => error.status === 404);
  } finally {
    f.sqlite.close();
  }
});

test("Guarantor and internal administrator cannot bypass document download scopes", () => {
  const f = bank();
  try {
    const slik = f.service.addDocument(f.analyst, f.app, "SLIK", Buffer.from("CONFIDENTIAL SLIK"));
    f.service.flush();
    assert.throws(() => f.service.download(f.penjamin, slik.id), (error) => error.status === 403);
    const admin = { id: "admin", role: "ADMIN", org: "bank-org", office: "cabang-1", bank: "bank-uat" };
    const configChecker = { ...admin, id: "config_checker", role: "CONFIG_CHECKER" };
    for (const identity of [admin, configChecker]) {
      const view = f.service.view(identity, f.app);
      assert.equal(view.workflow, undefined);
      assert.deepEqual(view.documents, []);
      assert.equal(view.document_checklist, undefined);
      assert.throws(() => f.service.download(identity, slik.id), (error) => error.status === 403);
    }
  } finally {
    f.sqlite.close();
  }
});
