import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { proxyApi } from '../frontend/lib/api-proxy.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Vercel portal uses the Next.js app root and not the Cloudflare OpenNext adapter', () => {
  const deployment = JSON.parse(read('frontend/vercel.json'));
  const packageJson = JSON.parse(read('frontend/package.json'));
  assert.equal(deployment.framework, 'nextjs');
  assert.equal(deployment.installCommand, 'npm ci');
  assert.equal(deployment.buildCommand, 'npm run build');
  assert.equal(packageJson.scripts.build, 'next build');
  assert.notEqual(packageJson.scripts.build, packageJson.scripts['build:cloudflare']);
});

test('Vercel runbook requires preserved backend and an explicit server-only endpoint', () => {
  const guide = read('docs/VERCEL_MIGRATION.md');
  assert.match(guide, /BG_API_INTERNAL_URL/);
  assert.match(guide, /durable-object-sqlite/);
  assert.match(guide, /SANDBOX/);
  assert.doesNotMatch(read('frontend/vercel.json'), /BG_INITIAL_USERS|BG_ENCRYPTION_KEY/);
});

test('proxy supports the real /api path prefix through a HTTPS upstream without forwarding browser origin', async () => {
  let calls = 0;
  const result = await proxyApi(new Request('https://portal.example.test/api/auth/me', {
    headers: { cookie: 'bg_session=fixture', origin: 'https://portal.example.test' },
  }), ['auth', 'me'], {
    baseUrl: 'https://backend.example.test/api',
    fetcher: async (target, init) => {
      calls++;
      assert.equal(target.href, 'https://backend.example.test/api/auth/me');
      assert.equal(init.headers.get('cookie'), 'bg_session=fixture');
      assert.equal(init.headers.get('origin'), null);
      return Response.json({ detail: 'not authenticated' }, { status: 401 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 401);
});
