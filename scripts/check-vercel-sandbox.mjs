#!/usr/bin/env node
/**
 * Read-only Vercel smoke test: no login, POST, real verification token,
 * customer data, cookies, or document downloads.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkSandbox(baseUrl, fetcher = fetch) {
  const base = new URL(baseUrl);
  assert.equal(base.protocol, 'https:', 'Sandbox smoke requires HTTPS');
  assert.equal(base.username, '', 'Credentials must not be embedded in the URL');
  assert.equal(base.password, '', 'Credentials must not be embedded in the URL');
  assert.equal(base.pathname, '/', 'Use the Vercel origin, not an API path');
  assert.equal(base.search, '', 'Base URL must not have a query');
  assert.equal(base.hash, '', 'Base URL must not have a fragment');
  const report = [];
  async function read(path) {
    const response = await fetcher(new URL(path, base), {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, path + ': expected HTTP 200 (Vercel protection may require authorized access)');
    const type = response.headers.get('content-type') || '';
    assert.match(type, /application\/json/, path + ': expected JSON');
    report.push({ path, status: response.status });
    return response.json();
  }
  const deployment = await read('/api/health/deployment');
  assert.equal(deployment.portal, 'ok');
  assert.equal(deployment.backend_configured, true);
  assert.equal(deployment.backend_connectivity, 'ok');
  assert.equal(deployment.mode, 'SANDBOX');
  assert.equal(deployment.production_enabled, false);
  const backend = await read('/api/health');
  assert.equal(backend.status, 'ok');
  assert.equal(backend.mode, 'SANDBOX');
  assert.equal(backend.production_enabled, false);
  assert.equal(backend.persistent, true);
  assert.equal(backend.backend, 'durable-object-sqlite');
  // Deliberately invalid verification token: never read a real guarantee.
  const negative = await read('/api/public/verify/uat-invalid-never-issued');
  assert.equal(negative.authentic, false);
  assert.equal(negative.valid, false);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] || process.env.BG_SANDBOX_BASE_URL;
  if (!target) {
    console.error('Usage: node scripts/check-vercel-sandbox.mjs https://<your-sandbox-domain>/');
    process.exitCode = 2;
  } else {
    checkSandbox(target).then(report => {
      for (const item of report) console.log('PASS ' + item.path + ' HTTP ' + item.status);
      console.log('PASS: read-only SANDBOX Vercel/backend contract');
    }).catch(error => {
      console.error('FAIL: ' + error.message);
      process.exitCode = 1;
    });
  }
}
