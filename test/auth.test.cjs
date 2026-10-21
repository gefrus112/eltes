'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const auth = require('../api/auth.js');

class MockResponse extends EventEmitter {
  constructor() { super(); this.headers = {}; this.statusCode = 200; this.headersSent = false; this.writableEnded = false; this.chunks = []; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  getHeader(name) { return this.headers[name.toLowerCase()]; }
  end(chunk = '') { this.chunks.push(Buffer.from(chunk)); this.headersSent = true; this.writableEnded = true; }
  get text() { return Buffer.concat(this.chunks).toString('utf8'); }
  get json() { return JSON.parse(this.text || '{}'); }
}
function request({ method = 'POST', action = 'signup', body = {}, headers = {} } = {}) {
  return {
    method,
    url: `/api/auth?action=${action}`,
    body,
    socket: {},
    headers: { host: 'eltes.example', origin: 'https://eltes.example', 'x-forwarded-proto': 'https', ...headers }
  };
}
const fakeProfile = { user_id: 'user-uuid', display_name: 'Ada Lovelace', created_at: '2026-10-21T12:00:00Z' };

test('Supabase sign-up stores profile through the user-scoped API and sets HttpOnly cookies without returning tokens', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/signup')) return Response.json({
      access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600,
      user: { id: 'user-uuid', email: 'ada@example.com', created_at: '2026-10-21T12:00:00Z', user_metadata: { display_name: 'Ada Lovelace' } }
    });
    if (String(url).includes('/rest/v1/eltes_profiles?select=')) return Response.json([]);
    if (String(url).endsWith('/rest/v1/eltes_profiles')) return Response.json([fakeProfile]);
    throw new Error(`Unexpected upstream URL: ${url}`);
  };
  try {
    const res = new MockResponse();
    await auth(request({ body: { name: 'Ada Lovelace', email: 'ada@example.com', password: 'long-test-password' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.user.name, 'Ada Lovelace');
    assert.equal(res.json.user.provider, 'supabase');
    assert.equal(res.json.access_token, undefined);
    assert.equal(res.text.includes('access-secret'), false);
    assert.equal(res.text.includes('refresh-secret'), false);
    assert.equal(res.text.includes('long-test-password'), false);
    const setCookies = res.headers['set-cookie'];
    assert.equal(setCookies.length, 2);
    assert.ok(setCookies.every((cookie) => /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie)));
    assert.equal(calls[0].options.headers.apikey.startsWith('sb_publishable_'), true);
    assert.equal(calls[0].options.headers.authorization, undefined);
    assert.match(calls.at(-1).options.headers.authorization, /^Bearer access-secret$/);
    assert.equal(JSON.parse(calls.at(-1).options.body).user_id, 'user-uuid');
  } finally { global.fetch = originalFetch; }
});

test('profile reads use the authenticated user token and never return session material', async () => {
  const originalFetch = global.fetch;
  let profileRequest;
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json({
      id: 'user-uuid', email: 'ada@example.com', created_at: '2026-10-21T12:00:00Z', user_metadata: {}
    });
    if (String(url).includes('/rest/v1/eltes_profiles?select=')) {
      profileRequest = options;
      return Response.json([fakeProfile]);
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  };
  try {
    const res = new MockResponse();
    await auth(request({ method: 'GET', action: 'session', headers: {
      origin: undefined,
      cookie: 'eltes_auth_access=access-secret; eltes_auth_refresh=refresh-secret'
    } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.user.name, 'Ada Lovelace');
    assert.equal(res.text.includes('access-secret'), false);
    assert.equal(res.text.includes('refresh-secret'), false);
    assert.match(profileRequest.headers.authorization, /^Bearer access-secret$/);
  } finally { global.fetch = originalFetch; }
});

test('account mutations reject cross-origin requests before contacting Supabase', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('must not contact Supabase'); };
  try {
    const res = new MockResponse();
    await auth(request({ headers: { origin: 'https://attacker.example' }, body: { email: 'x@example.com', password: 'long-enough-password', name: 'Bad Actor' } }), res);
    assert.equal(res.statusCode, 403);
    assert.match(res.json.error, /same origin/);
  } finally { global.fetch = originalFetch; }
});

test('sign-up rejects passwords below the application minimum before contacting Supabase', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('weak password must not reach Supabase'); };
  try {
    const res = new MockResponse();
    await auth(request({ body: { name: 'Ada Lovelace', email: 'ada@example.com', password: 'short' } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.json.error, /12 and 1024/);
  } finally { global.fetch = originalFetch; }
});

test('account profile migration enables RLS and restricts rows to auth.uid()', () => {
  const migration = fs.readFileSync(require.resolve('../supabase/migrations/20261021182200_create_eltes_auth_profiles.sql'), 'utf8');
  assert.match(migration, /enable row level security/i);
  assert.equal((migration.match(/create policy/gi) || []).length, 3);
  assert.equal((migration.match(/auth\.uid\(\)\s*=\s*user_id/gi) || []).length, 4);
  assert.match(migration, /references auth\.users\s*\(id\) on delete cascade/i);
});

test('accounts and passwords are not persisted in browser localStorage or service-role credentials', () => {
  const account = fs.readFileSync(require.resolve('../assets/js/account.js'), 'utf8');
  const authUi = fs.readFileSync(require.resolve('../assets/js/auth.js'), 'utf8');
  const apiSource = fs.readFileSync(require.resolve('../api/auth.js'), 'utf8');
  assert.doesNotMatch(account, /localStorage\.(?:setItem|getItem)\s*\(/);
  assert.doesNotMatch(authUi, /localStorage\.(?:setItem|getItem)\s*\(/);
  assert.match(apiSource, /HttpOnly/);
  assert.match(apiSource, /SameSite=Lax/);
  assert.doesNotMatch(apiSource, /service_role/i);
});
