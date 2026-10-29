import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store, initializeSchema, passwordHash } from '../cloudflare/core.ts';
import { bootstrap, IDENTITIES } from '../cloudflare/bootstrap.ts';
import { Service } from '../cloudflare/service.ts';
import { route } from '../cloudflare/router.ts';
import { proxyApi } from '../frontend/lib/api-proxy.ts';

const FRONTEND = 'https://bg.test.example';
const BACKEND = 'https://worker.test.example/api';
const NOW = Date.parse('2026-10-28T07:00:00.000Z');

function sandboxFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const db = {
    all: (sql, ...values) => sqlite.prepare(sql).all(...values.map(value =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value)),
    run: (sql, ...values) => sqlite.prepare(sql).run(...values.map(value =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value)),
  };
  initializeSchema(db);
  const key = randomBytes(32).toString('hex');
  const secret = 'UAT-' + randomBytes(24).toString('base64url');
  const hashes = Object.fromEntries(IDENTITIES.map(([name]) => [name, passwordHash(secret)]));
  bootstrap(new Store(db), JSON.stringify(hashes), key);
  const accounts = new Map();

  async function backendFetcher(target, init) {
    assert.equal(target.origin, 'https://worker.test.example');
    assert.ok(target.pathname.startsWith('/api/'));
    const body = init.method === 'POST' && init.body?.length ?
      JSON.parse(Buffer.from(init.body).toString('utf8')) : {};
    sqlite.exec('BEGIN');
    try {
      const service = new Service(new Store(db), key, NOW);
      const response = route(service, {
        method: init.method,
        path: target.pathname.slice('/api/'.length).split('/').map(decodeURIComponent),
        body,
        cookie: init.headers.get('cookie') || '',
        csrf: init.headers.get('x-csrf-token') || '',
        secure: true,
      });
      service.flush();
      sqlite.exec('COMMIT');
      return response;
    } catch (err) {
      sqlite.exec('ROLLBACK');
      return Response.json({ code: err.code || 'INTERNAL', detail: err.message }, {
        status: err.status || 500,
      });
    }
  }

  async function call(username, pathname, body, { noCsrf = false, origin = FRONTEND } = {}) {
    const account = accounts.get(username);
    const headers = new Headers();
    if (account?.cookie) headers.set('cookie', account.cookie);
    if (account?.csrf && !noCsrf) headers.set('x-csrf-token', account.csrf);
    const method = body === undefined ? 'GET' : 'POST';
    if (method === 'POST') {
      headers.set('content-type', 'application/json');
      headers.set('origin', origin);
    }
    const request = new Request(FRONTEND + '/api/' + pathname, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await proxyApi(request, pathname.split('/'), {
      baseUrl: BACKEND,
      fetcher: backendFetcher,
    });
    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) data = await response.json();
    else data = await response.text();
    return { status: response.status, data, headers: response.headers };
  }

  async function login(username) {
    const result = await call(undefined, 'auth/login', { username, password: secret });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /bg_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.ok(result.data.csrf);
    accounts.set(username, { cookie: cookie.split(';')[0], csrf: result.data.csrf });
    return result.data;
  }
  return { sqlite, accounts, call, login, close: () => sqlite.close() };
}

test('Vercel proxy authenticates five actors and enforces session, CSRF and role isolation', async () => {
  const f = sandboxFixture();
  try {
    for (const path of ['auth/me', 'applications', 'claims', 'users', 'audit/events']) {
      const result = await f.call(undefined, path);
      assert.equal(result.status, 401, path + ': expected unauthenticated denial');
      assert.equal(result.data.code, 'AUTH');
    }

    const actors = {
      principal: 'PRINCIPAL',
      mpo: 'MPO',
      penjamin: 'PENJAMIN',
      obligee: 'OBLIGEE',
      broker: 'BROKER',
      compliance: 'COMPLIANCE',
      audit: 'AUDIT',
    };
    for (const [username, role] of Object.entries(actors)) {
      const actor = await f.login(username);
      assert.equal(actor.role, role);
      const me = await f.call(username, 'auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.data.role, role);
      assert.equal(me.data.username, username);
    }

    // Public catalog is scoped by authenticated role, not exposed without login.
    assert.equal((await f.call(undefined, 'catalog')).status, 401);
    for (const username of Object.keys(actors))
      assert.equal((await f.call(username, 'catalog')).status, 200);

    for (const username of ['principal', 'mpo', 'penjamin', 'obligee', 'broker', 'compliance', 'audit']) {
      const blocked = await f.call(username, 'users');
      assert.equal(blocked.status, 403, username + ' must not access admin user list');
      assert.equal(blocked.data.code, 'FORBIDDEN');
    }

    const created = await f.call('principal', 'applications', {
      principal: 'principal-1',
      obligee: 'obligee-apbn',
      partner: 'partner-1',
      processing_office: 'cabang-1',
      issuing_office: 'cabang-1',
      project_name: 'Synthetic Vercel Proxy UAT',
      amount: '2000000000',
      issue_on: '2026-10-28',
      expires_on: '2027-04-27',
      bg_type: 'PELAKSANAAN',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const app = created.data;
    assert.equal((await f.call('principal', 'applications/' + app.id)).status, 200);

    const brokerAttempt = await f.call('broker', 'applications/' + app.id);
    assert.equal(brokerAttempt.status, 404, 'Broker may not access without principal mandate');
    const otherObligee = await f.login('obligee_private');
    assert.equal(otherObligee.role, 'OBLIGEE');
    assert.equal((await f.call('obligee_private', 'applications/' + app.id)).status, 404);

    const wrongOrigin = await f.call('principal', 'auth/logout', {}, {
      origin: 'https://attacker.invalid',
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.data.code, 'ORIGIN');
    assert.equal((await f.call('principal', 'auth/me')).status, 200);

    const missingCsrf = await f.call('principal', 'auth/logout', {}, { noCsrf: true });
    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.data.code, 'CSRF');
    assert.equal((await f.call('principal', 'auth/me')).status, 200);

    const upload = await f.call('principal', 'applications/' + app.id + '/documents', {
      kind: 'NIB',
      content_base64: Buffer.from('Synthetic UAT NIB source').toString('base64'),
      source_reference: 'Synthetic source UAT only',
    });
    assert.equal(upload.status, 201, JSON.stringify(upload.data));
    const badVerify = await f.call('principal', 'documents/' + upload.data.id + '/verify', {
      source_reference: 'Synthetic independent reference',
    });
    assert.equal(badVerify.status, 403, 'Uploader must never self-verify');

    const verified = await f.call('compliance', 'documents/' + upload.data.id + '/verify', {
      source_reference: 'Independent synthetic compliance check',
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.equal(verified.data.verified, true);
    const fresh = await f.call('principal', 'applications/' + app.id);
    assert.equal(fresh.status, 200);

    const submit = await f.call('principal', 'applications/' + app.id + '/commands/submit', {
      expected_version: fresh.data.version,
      idempotency_key: randomUUID(),
      payload: {},
    });
    assert.equal(submit.status, 200, JSON.stringify(submit.data));
    assert.notEqual(submit.data.state, 'DRAFT');

    // Principal logout revokes only that authenticated principal session.
    const logout = await f.call('principal', 'auth/logout', {});
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    const revoked = await f.call('principal', 'auth/me');
    assert.equal(revoked.status, 401);
    assert.equal((await f.call('mpo', 'auth/me')).status, 200);
    assert.equal((await f.call('penjamin', 'auth/me')).status, 200);
    assert.equal((await f.call('obligee', 'auth/me')).status, 200);

    const invalidPublic = await f.call(undefined, 'public/verify/uat-never-issued');
    assert.equal(invalidPublic.status, 200);
    assert.equal(invalidPublic.data.authentic, false);
  } finally {
    f.close();
  }
});
