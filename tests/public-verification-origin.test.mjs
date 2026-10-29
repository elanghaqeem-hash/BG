import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicVerificationUrl } from "../cloudflare/public-verification-url.ts";

const getConfig = (path) =>
  JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

test("Worker and frontend deploy configs pin the same canonical HTTPS Vercel QR host", () => {
  const worker = getConfig("wrangler.jsonc");
  const frontend = getConfig("frontend/wrangler.jsonc");
  assert.equal(worker.vars.BG_PUBLIC_VERIFY_ORIGIN, "https://bg-collman.vercel.app");
  assert.equal(frontend.vars.BG_PUBLIC_VERIFY_ORIGIN, worker.vars.BG_PUBLIC_VERIFY_ORIGIN);
});

test("QR points to trusted Vercel verification host, never Worker origin", () => {
  const url = publicVerificationUrl(
    "https://bg-collman.vercel.app",
    "https://bg.elang-haqeem.workers.dev",
    "sBX_09-test+token",
  );
  assert.equal(url, "https://bg-collman.vercel.app/verify/sBX_09-test%2Btoken");
});

test("QR fallback preserves Worker endpoint for explicit rollback mode", () => {
  const url = publicVerificationUrl(undefined, "https://bg.elang-haqeem.workers.dev", "token-1");
  assert.equal(url, "https://bg.elang-haqeem.workers.dev/verify/token-1");
});

test("QR rejects insecure, path-based, credential-bearing, or malformed origins", () => {
  for (const invalid of [
    "http://bg-collman.vercel.app",
    "https://admin:secret@bg-collman.vercel.app",
    "https://bg-collman.vercel.app/path",
    "https://bg-collman.vercel.app/?next=https://evil.test",
    "https://bg-collman.vercel.app/#fragment",
    "not-a-valid-URL",
  ]) {
    assert.throws(() =>
      publicVerificationUrl(invalid, "https://bg.elang-haqeem.workers.dev", "token"),
      /BG_VERIFY_ORIGIN_INVALID|Invalid URL/,
    );
  }
  for (const invalidToken of ["", "x".repeat(201)]) {
    assert.throws(() =>
      publicVerificationUrl("https://bg-collman.vercel.app", "https://worker.test", invalidToken),
      /BG_VERIFY_TOKEN_INVALID/,
    );
  }
});
