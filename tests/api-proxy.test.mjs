import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyApi } from '../frontend/lib/api-proxy.ts';

const baseUrl = 'https://backend.example.test';
const url = 'https://bg.example.test/api/auth/login';
const get = () => new Request(url);
const post = (headers = {}, body = '{}') => new Request(url, { method: 'POST', headers, body });

test('an unconfigured backend fails closed and never fabricates an authenticated session', async () => {
  let called = false;
  const response = await proxyApi(get(), ['auth', 'me'], { fetcher: async () => { called = true; } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'BACKEND_NOT_CONFIGURED');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(called, false);
});

test('login preserves POST data and all response cookies; subsequent calls forward session and CSRF', async () => {
  const cookies = new Headers({ 'content-type': 'application/json' });
  cookies.append('set-cookie', 'bg_session=session-fixture; HttpOnly; Secure; SameSite=Strict');
  cookies.append('set-cookie', 'other=value; Secure');
  let calls = 0;
  const fetcher = async (target, init) => {
    calls++;
    assert.equal(init.redirect, 'manual');
    if (calls === 1) {
      assert.equal(target.href, baseUrl + '/auth/login');
      assert.equal(new TextDecoder().decode(init.body), '{"username":"fixture"}');
      assert.equal(init.headers.get('authorization'), null);
      return new Response('{"csrf":"csrf-fixture"}', { headers: cookies });
    }
    assert.equal(target.href, baseUrl + '/applications?offset=10');
    assert.equal(init.headers.get('cookie'), 'bg_session=session-fixture');
    assert.equal(init.headers.get('x-csrf-token'), 'csrf-fixture');
    return Response.json({ id: 'app-from-backend' }, { status: 201 });
  };
  const login = await proxyApi(post({ origin: new URL(url).origin, authorization: 'do-not-forward' }, '{"username":"fixture"}'), ['auth', 'login'], { baseUrl, fetcher });
  assert.equal(login.headers.getSetCookie().length, 2);
  const created = await proxyApi(new Request('https://bg.example.test/api/applications?offset=10', {
    method: 'POST', headers: { cookie: 'bg_session=session-fixture', 'x-csrf-token': 'csrf-fixture' }, body: '{}',
  }), ['applications'], { baseUrl, fetcher });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).id, 'app-from-backend');
});

test('backend authorization denials and logout cookie revocation reach the browser unchanged', async () => {
  for (const status of [401, 403, 409]) {
    const result = await proxyApi(get(), ['auth', 'me'], { baseUrl, fetcher: async () => Response.json({ detail: 'denied' }, { status }) });
    assert.equal(result.status, status);
    assert.deepEqual(await result.json(), { detail: 'denied' });
  }
  const result = await proxyApi(post(), ['auth', 'logout'], { baseUrl, fetcher: async () => Response.json({ logged_out: true }, { headers: { 'set-cookie': 'bg_session=""; Max-Age=0; Path=/' } }) });
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
});

test('cross-site POST requests are rejected before contacting the backend', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}); };
  assert.equal((await proxyApi(post({ origin: 'https://evil.test' }), ['auth', 'login'], { baseUrl, fetcher })).status, 403);
  assert.equal((await proxyApi(post({ 'sec-fetch-site': 'cross-site' }), ['auth', 'login'], { baseUrl, fetcher })).status, 403);
  assert.equal(calls, 0);
});

test('same-origin browser requests survive Next.js internal URL reconstruction', async () => {
  const request = new Request('http://localhost:3000/api/auth/login', {
    method: 'POST', headers: { host: 'bg.example.test', origin: 'https://bg.example.test' }, body: '{}',
  });
  const response = await proxyApi(request, ['auth', 'login'], { baseUrl, fetcher: async () => Response.json({ csrf: 'fixture' }) });
  assert.equal(response.status, 200);
  const otherPort = post({ host: 'bg.example.test', origin: 'https://bg.example.test:444' });
  assert.equal((await proxyApi(otherPort, ['auth', 'login'], { baseUrl })).status, 403);
});

test('invalid backend configuration, URL traversal and loops are rejected', async () => {
  for (const value of ['http://remote.example.test', 'http://127.0.0.1:8000', 'https://user:secret@api.test', 'https://bg.example.test', 'https://api.test/?query=1', 'not-a-url']) {
    assert.equal((await proxyApi(get(), ['health'], { baseUrl: value })).status, 503, value);
  }
  for (const path of [[], ['..'], ['auth', '../admin'], ['auth', '\\evil'], ['health\u0000']]) {
    assert.equal((await proxyApi(get(), path, { baseUrl })).status, 400);
  }
  const result = await proxyApi(get(), ['health'], { baseUrl: 'http://127.0.0.1:8000', allowLocal: true, fetcher: async () => Response.json({ status: 'ok' }) });
  assert.equal(result.status, 200);
});

test('redirects and unavailable upstream fail closed without leaking internals', async () => {
  const redirected = await proxyApi(get(), ['health'], { baseUrl, fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }) });
  assert.equal(redirected.status, 502);
  assert.equal(redirected.headers.get('location'), null);
  const failed = await proxyApi(get(), ['health'], { baseUrl, fetcher: async () => { throw new Error('sensitive internal information'); } });
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('sensitive internal'));
});

test('both declared and streamed bodies over the upload limit are stopped before forwarding', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}); };
  assert.equal((await proxyApi(post({ 'content-length': '3000001' }), ['documents'], { baseUrl, fetcher })).status, 413);
  assert.equal((await proxyApi(post({}, 'x'.repeat(3_000_001)), ['documents'], { baseUrl, fetcher })).status, 413);
  assert.equal(calls, 0);
});
