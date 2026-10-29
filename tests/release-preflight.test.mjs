import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sandboxRuntimePermitted } from "../cloudflare/runtime-mode.ts";
import { validateSandboxConfig } from "../scripts/check-release-preflight.mjs";

const worker = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
);
const copy = () => JSON.parse(JSON.stringify(config));

test("runtime permits only exact SANDBOX, never LIVE or missing mode", () => {
  assert.equal(sandboxRuntimePermitted("SANDBOX"), true);
  for (const mode of ["LIVE", "PRODUCTION", "sandbox", "", undefined, null, true])
    assert.equal(sandboxRuntimePermitted(mode), false);
});

test("configured sandbox retains fail-closed runtime boundary", () => {
  assert.deepEqual(validateSandboxConfig(config, worker), []);
  assert.match(worker, /if \(!sandboxRuntimePermitted\(env\.BG_MODE\)\)/);
});

test("preflight rejects LIVE mode, missing keys and altered database binding", () => {
  const changed = copy();
  changed.vars.BG_MODE = "LIVE";
  changed.secrets.required = [];
  changed.durable_objects.bindings = [];
  const errors = validateSandboxConfig(changed, worker);
  assert.ok(errors.some((e) => e.includes("BG_MODE")));
  assert.ok(errors.some((e) => e.includes("BG_INITIAL_USERS")));
  assert.ok(errors.some((e) => e.includes("BG_ENCRYPTION_KEY")));
  assert.ok(errors.some((e) => e.includes("BG_BANK")));
});

test("preflight rejects removing the runtime guard and persistent migration", () => {
  const changed = copy();
  changed.migrations = [];
  const errors = validateSandboxConfig(changed, "export default {};");
  assert.ok(errors.some((e) => e.includes("runtime release guard")));
  assert.ok(errors.some((e) => e.includes("migration")));
});

test("frontend Wrangler config also remains a sandbox config", () => {
  const frontend = JSON.parse(
    readFileSync(new URL("../frontend/wrangler.jsonc", import.meta.url), "utf8")
  );
  assert.deepEqual(validateSandboxConfig(frontend, worker), []);
});
