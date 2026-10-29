#!/usr/bin/env node
/**
 * CI guard for the existing, non-operational BG sandbox deployment.
 *
 * Passing this check is NOT approval to issue bank guarantees, enable LIVE
 * integrations, merge a draft PR or deploy to operational banking production.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateSandboxConfig(config, workerSource) {
  const errors = [];
  if (config?.name !== "bg") errors.push("Unexpected Worker name");
  if (!["cloudflare/worker.ts", "../cloudflare/worker.ts"].includes(config?.main))
    errors.push("Unexpected Worker entrypoint");
  if (config?.vars?.BG_MODE !== "SANDBOX")
    errors.push("BG_MODE must be exactly SANDBOX");
  if (config?.keep_vars !== true) errors.push("keep_vars must remain true");
  if (!config?.durable_objects?.bindings?.some(
    (b) => b.name === "BG_BANK" && b.class_name === "BankBackend"
  )) errors.push("Missing BG_BANK / BankBackend binding");
  if (!config?.migrations?.some(
    (m) => m.tag === "bg-native-v1" &&
      m.new_sqlite_classes?.includes("BankBackend")
  )) errors.push("Missing persistent BankBackend class migration");
  const secrets = config?.secrets?.required ?? [];
  for (const key of ["BG_INITIAL_USERS", "BG_ENCRYPTION_KEY"])
    if (!secrets.includes(key)) errors.push("Missing required secret declaration: " + key);
  if (!workerSource.includes("sandboxRuntimePermitted(env.BG_MODE)") ||
      !workerSource.includes('code: "RELEASE_BLOCKED"'))
    errors.push("Fail-closed runtime release guard missing");
  return errors;
}

const thisPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisPath) {
  const root = resolve(dirname(thisPath), "..");
  const worker = readFileSync(resolve(root, "cloudflare/worker.ts"), "utf8");
  const configs = ["wrangler.jsonc", "frontend/wrangler.jsonc"];
  let failures = 0;
  for (const path of configs) {
    const file = resolve(root, path);
    let errors;
    try {
      errors = validateSandboxConfig(JSON.parse(readFileSync(file, "utf8")), worker);
    } catch (error) {
      errors = ["Could not parse config: " + error.message];
    }
    for (const error of errors) console.error("BLOCKED " + path + ": " + error);
    failures += errors.length;
  }
  if (failures) {
    console.error("BG sandbox release preflight FAILED. No deployment is authorized.");
    process.exitCode = 1;
  } else {
    console.log("BG sandbox configuration preflight PASS (NOT operational production approval).");
  }
}
