import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSandbox } from '../scripts/check-vercel-sandbox.mjs';

const fake = {
  '/api/health/deployment': {
    portal: 'ok', backend_configured: true, backend_connectivity: 'ok',
    mode: 'SANDBOX', production_enabled: false,
  },
  '/api/health': {
    status: 'ok', mode: 'SANDBOX', production_enabled: false,
    backend: 'durable-object-sqlite', persistent: true,
  },
  '/api/public/verify/uat-invalid-never-issued': {
    authentic: false, valid: false, status: 'NOT_FOUND',
  },
};

test('Vercel smoke makes only non-mutating, credential-free GET requests', async () => {
  const visited = [];
  const report = await checkSandbox('https://bg-collman.vercel.app/', async (url, init) => {
    visited.push(url.pathname);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.body, undefined);
    assert.equal(init.headers, undefined);
    assert.equal(url.origin, 'https://bg-collman.vercel.app');
    return Response.json(fake[url.pathname]);
  });
  assert.deepEqual(visited, Object.keys(fake));
  assert.equal(report.length, 3);
});

test('Vercel smoke rejects a configured backend without actual connectivity', async () => {
  await assert.rejects(
    checkSandbox('https://bg-collman.vercel.app/', async () =>
      Response.json({ ...fake['/api/health/deployment'], backend_connectivity: 'not_checked' })),
    /not_checked.*ok|ok.*not_checked|Expected values to be strictly equal/,
  );
});

test('Vercel smoke fails closed on production_enabled or forged certificate validity', async () => {
  for (const path of ['/api/health', '/api/public/verify/uat-invalid-never-issued']) {
    await assert.rejects(checkSandbox('https://bg-collman.vercel.app/', async url => {
      const data = { ...fake[url.pathname] };
      if (url.pathname === path) {
        if (path === '/api/health') data.production_enabled = true;
        else data.authentic = true;
      }
      return Response.json(data);
    }));
  }
});

test('Vercel smoke never accepts insecure or credential-bearing base URLs', async () => {
  for (const base of ['http://bg.test/', 'https://admin:pass@bg.test/', 'https://bg.test/api', 'https://bg.test/?token=foo']) {
    await assert.rejects(checkSandbox(base, () => { throw Error('network must not be called'); }));
  }
});
