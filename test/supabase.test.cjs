/* ==========================================================================
   Eltes — cloud account tests
   --------------------------------------------------------------------------
   No network and no Supabase project: the Edge Functions are executed here
   with a small Deno shim against a fake PostgREST/Auth/Resend, and the
   browser client runs in a VM with a fake localStorage and fetch. What is
   asserted is the honest contract: what gets sent, what gets recorded, and
   what the answer says when nothing was sent.

   The live project (ripcraft) holds copies of the SQL and both functions;
   `npm run supabase:deploy` re-pushes them with the Supabase CLI.
   ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, resolve, relative } = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = resolve(__dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/* ---------------------------- fake back ends ----------------------------- */

function makeSupabase(state) {
  state.profiles = state.profiles || [];
  state.events = state.events || [];
  state.suppressed = state.suppressed || [];
  state.rate = state.rate || {};
  state.links = state.links || [];
  state.sent = state.sent || [];
  state.patches = state.patches || [];

  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

  return async function fakeFetch(url, init) {
    const parsed = new URL(url);
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : null;

    if (parsed.hostname === 'api.resend.com') {
      if (state.resendFails) return reply({ message: 'The domain is not verified' }, 403);
      const id = `em_${state.sent.length + 1}`;
      state.sent.push({ id, ...body });
      return reply({ id });
    }

    if (parsed.pathname.endsWith('/auth/v1/admin/generate_link')) {
      state.links.push(body);
      if (state.linkFails) return reply({ msg: 'User not found' }, 404);
      const token = `tok_${state.links.length}`;
      return reply({
        action_link: `https://demo.supabase.co/auth/v1/verify?token=${token}&type=${body.type}&redirect_to=${encodeURIComponent(body.redirect_to)}`,
        email_otp: '123456',
        verification_type: body.type
      });
    }

    if (parsed.pathname.endsWith('/rest/v1/rpc/mail_consume')) {
      const bucket = body.p_bucket;
      state.rate[bucket] = (state.rate[bucket] || 0) + 1;
      const hits = state.rate[bucket];
      return reply({ allowed: hits <= body.p_limit, remaining: Math.max(0, body.p_limit - hits) });
    }

    if (parsed.pathname.endsWith('/rest/v1/profiles')) {
      const idFilter = parsed.searchParams.get('id');
      if (method === 'PATCH') {
        state.patches.push({ id: String(idFilter || '').replace('eq.', ''), body });
        return reply([]);
      }
      const rows = state.profiles.filter((row) => {
        if (idFilter) return row.id === idFilter.replace('eq.', '');
        const emailFilter = parsed.searchParams.get('email');
        if (emailFilter) return row.email === emailFilter.replace('eq.', '');
        return true;
      });
      return reply(rows);
    }

    if (parsed.pathname.endsWith('/rest/v1/email_events')) {
      if (method === 'POST') {
        state.events.push(body);
        return reply([body]);
      }
      const userFilter = parsed.searchParams.get('user_id');
      const kind = parsed.searchParams.get('kind');
      const status = parsed.searchParams.get('status');
      const rows = state.events.filter((row) =>
        (!userFilter || row.user_id === userFilter.replace('eq.', '')) &&
        (!kind || row.kind === kind.replace('eq.', '')) &&
        (!status || row.status === status.replace('eq.', ''))
      );
      return reply(rows.map((row, index) => ({ created_at: `2026-10-20T10:00:0${index}Z` })));
    }

    if (parsed.pathname.endsWith('/rest/v1/suppressed_emails')) {
      if (method === 'POST') {
        state.suppressed.push(body);
        return reply([], 201);
      }
      const emailFilter = (parsed.searchParams.get('email') || '').replace('eq.', '');
      return reply(state.suppressed.filter((row) => row.email === emailFilter));
    }

    return reply({ error: `unexpected ${method} ${parsed.pathname}` }, 404);
  };
}

function loadEdgeFunction(file, env, fetchImpl) {
  const source = readFileSync(join(root, file), 'utf8');
  let handler = null;
  const sandbox = {
    Deno: {
      env: { get: (name) => (Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined) },
      serve: (fn) => { handler = fn; },
      stdin: null
    },
    fetch: fetchImpl,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: file });
  assert.ok(handler, `${file} must call Deno.serve()`);
  return handler;
}

function mailEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
    RESEND_API_KEY: 're_test_key',
    ELTES_MAIL_FROM: 'Eltes <hello@eltes.test>',
    ELTES_SITE_URL: 'https://example.test/eltes/',
    ...overrides
  };
}

const post = (payload, headers) => new Request('https://fn.test/eltes-mail', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(payload)
});

const ADA = { id: '11111111-1111-4111-8111-111111111111', email: 'ada@example.com', display_name: 'Ada Lovelace' };

/* ------------------------------- the mail -------------------------------- */

test('a new account gets the welcome letter, recorded as sent', async () => {
  const state = { profiles: [ADA] };
  const fake = makeSupabase(state);
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), fake);

  const response = await handler(post({ intent: 'welcome', email: 'ada@example.com', name: 'Ada' }, {
    'x-forwarded-for': '203.0.113.7'
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.delivered, true);
  assert.equal(body.provider, 'resend');
  assert.equal(body.id, 'em_1');

  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].to[0], 'ada@example.com');
  assert.equal(state.sent[0].from, 'Eltes <hello@eltes.test>');
  assert.equal(state.sent[0].subject, 'Welcome to Eltes AI Workspace');
  assert.match(state.sent[0].text, /Welcome to Eltes AI Workspace/);
  assert.match(state.sent[0].html, /Confirm and open Eltes/);
  assert.ok(!/tracking/i.test(state.sent[0].html) || /No tracking pixel/.test(state.sent[0].html));

  const logged = state.events.find((row) => row.kind === 'welcome');
  assert.equal(logged.status, 'sent');
  assert.equal(logged.user_id, ADA.id);
  assert.equal(state.patches[0].body.welcome_email_status, 'sent');
});

test('the letter carries a real confirmation link for the address', async () => {
  const state = { profiles: [ADA] };
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), makeSupabase(state));
  await handler(post({ intent: 'welcome', email: 'ADA@Example.com' }));

  assert.equal(state.links.length, 1);
  assert.equal(state.links[0].type, 'magiclink');
  assert.equal(state.links[0].email, 'ada@example.com');
  assert.match(state.links[0].redirect_to, /^https:\/\/example\.test\/eltes\/auth\.html\?intent=welcome$/);
  assert.match(state.sent[0].html, /token=tok_1/);
});

test('a second welcome is refused, not sent twice', async () => {
  const state = { profiles: [ADA] };
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), makeSupabase(state));

  const first = await (await handler(post({ intent: 'welcome', email: 'ada@example.com' }))).json();
  const second = await (await handler(post({ intent: 'welcome', email: 'ada@example.com' }))).json();

  assert.equal(first.delivered, true);
  assert.equal(second.delivered, false);
  assert.equal(second.reason, 'already_sent');
  assert.equal(state.sent.length, 1);
});

test('without a Resend key nothing is sent and the answer says so', async () => {
  const state = { profiles: [ADA] };
  const handler = loadEdgeFunction(
    'supabase/functions/eltes-mail/index.ts',
    mailEnv({ RESEND_API_KEY: '' }),
    makeSupabase(state)
  );
  const body = await (await handler(post({ intent: 'welcome', email: 'ada@example.com' }))).json();

  assert.equal(body.delivered, false);
  assert.equal(body.reason, 'no_mail_provider');
  assert.equal(body.configured, false);
  assert.equal(state.sent.length, 0);
  assert.equal(state.events[0].status, 'unconfigured');
});

test('a suppressed address is skipped before Resend is called', async () => {
  const state = { profiles: [ADA], suppressed: [{ email: 'ada@example.com', reason: 'bounce' }] };
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), makeSupabase(state));
  const body = await (await handler(post({ intent: 'welcome', email: 'ada@example.com' }))).json();

  assert.equal(body.delivered, false);
  assert.equal(body.reason, 'suppressed');
  assert.equal(state.sent.length, 0);
});

test('an address with no account gets no letter', async () => {
  const state = {};
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), makeSupabase(state));
  const body = await (await handler(post({ intent: 'welcome', email: 'nobody@example.com' }))).json();

  assert.equal(body.delivered, false);
  assert.equal(body.reason, 'no_account');
  assert.equal(state.sent.length, 0);
});

test('the function refuses malformed input and surfaces provider errors', async () => {
  const state = { profiles: [ADA], resendFails: true };
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), makeSupabase(state));

  assert.equal((await handler(post({ intent: 'welcome', email: 'not-an-email' }))).status, 400);
  assert.equal((await handler(post({ intent: 'launch', email: 'ada@example.com' }))).status, 400);

  const failed = await handler(post({ intent: 'magiclink', email: 'ada@example.com' }));
  assert.equal(failed.status, 502);
  const body = await failed.json();
  assert.equal(body.delivered, false);
  assert.equal(body.reason, 'provider_error');
  assert.match(body.detail, /not verified/);
  assert.equal(state.events.filter((row) => row.kind === 'magiclink')[0].status, 'failed');
});

test('password resets and sign-in links use their own letters', async () => {
  const state = { profiles: [ADA] };
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), makeSupabase(state));

  const reset = await (await handler(post({ intent: 'recovery', email: 'ada@example.com' }))).json();
  const link = await (await handler(post({ intent: 'magiclink', email: 'ada@example.com' }))).json();

  assert.equal(reset.delivered, true);
  assert.equal(link.delivered, true);
  assert.equal(state.links[0].type, 'recovery');
  assert.equal(state.sent[0].subject, 'Reset your Eltes password');
  assert.equal(state.sent[1].subject, 'Your Eltes sign-in link');
});

test('the status probe reports whether a provider is wired up', async () => {
  const state = {};
  const handler = loadEdgeFunction('supabase/functions/eltes-mail/index.ts', mailEnv(), makeSupabase(state));
  const response = await handler(new Request('https://fn.test/eltes-mail?status=1'));
  const body = await response.json();

  assert.equal(body.configured, true);
  assert.equal(body.provider, 'resend');
  assert.equal(body.from, 'Eltes <hello@eltes.test>');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
});

/* -------------------------------- webhook -------------------------------- */

const BOUNCE = {
  type: 'email.bounced',
  data: { email_id: 'em_9', to: ['dead@example.com'], bounce: { message: 'mailbox does not exist', type: 'permanent' } }
};

test('bounces are written to the suppression list', async () => {
  const state = {};
  const handler = loadEdgeFunction(
    'supabase/functions/email-webhook/index.ts',
    { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'key', ELTES_WEBHOOK_TOKEN: 'shh' },
    makeSupabase(state)
  );
  const response = await handler(new Request('https://fn.test/email-webhook?token=shh', {
    method: 'POST',
    body: JSON.stringify(BOUNCE)
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.suppressed, true);
  assert.equal(state.suppressed[0].email, 'dead@example.com');
  assert.equal(state.suppressed[0].reason, 'bounce');
  assert.match(state.suppressed[0].detail, /mailbox does not exist/);
  assert.equal(state.events[0].status, 'suppressed');
});

test('the webhook stays closed when it has no secret', async () => {
  const state = {};
  const handler = loadEdgeFunction(
    'supabase/functions/email-webhook/index.ts',
    { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'key' },
    makeSupabase(state)
  );
  const response = await handler(new Request('https://fn.test/email-webhook', {
    method: 'POST',
    body: JSON.stringify(BOUNCE)
  }));

  assert.equal(response.status, 503);
  assert.equal(state.suppressed.length, 0);
});

test('the webhook rejects a wrong token and accepts deliveries', async () => {
  const state = {};
  const handler = loadEdgeFunction(
    'supabase/functions/email-webhook/index.ts',
    { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'key', ELTES_WEBHOOK_TOKEN: 'shh' },
    makeSupabase(state)
  );

  const wrong = await handler(new Request('https://fn.test/email-webhook?token=nope', {
    method: 'POST',
    body: JSON.stringify(BOUNCE)
  }));
  assert.equal(wrong.status, 401);

  const delivered = await handler(new Request('https://fn.test/email-webhook?token=shh', {
    method: 'POST',
    body: JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_3', to: ['ada@example.com'] } })
  }));
  assert.equal(delivered.status, 200);
  assert.equal(state.events[0].status, 'sent');
  assert.equal(state.suppressed.length, 0);
});

/* ------------------------------ browser client --------------------------- */

function loadClient(config, options = {}) {
  const source = read('assets/js/supabase.js');
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); }
  };
  const location = {
    hash: options.hash || '',
    pathname: '/eltes/auth.html',
    search: options.search || '',
    href: 'https://example.test/eltes/auth.html'
  };
  const window = { ELTES_CONFIG: config, dispatchEvent: () => true };
  const sandbox = {
    window,
    localStorage,
    location,
    history: { replaceState: () => { location.hash = ''; } },
    fetch: options.fetch,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'assets/js/supabase.js' });
  return { cloud: window.EltesCloud, store, location, sandbox };
}

const CONFIG = { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'sb_publishable_test', functionsPath: '/functions/v1' };

function sessionBody(overrides = {}) {
  return {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_in: 3600,
    user: { id: ADA.id, email: ADA.email, user_metadata: { display_name: 'Ada Lovelace' } },
    ...overrides
  };
}

test('signing up stores the session and reports confirmation needs honestly', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(sessionBody()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { cloud, store } = loadClient(CONFIG, { fetch: fake });

  assert.equal(cloud.enabled, true);
  const result = await cloud.signUp({ email: 'Ada@Example.com', password: 'correct horse', name: 'Ada Lovelace' });

  assert.equal(result.needsConfirm, false);
  assert.equal(result.session.user.email, 'ada@example.com');
  assert.equal(calls[0].url, 'https://demo.supabase.co/auth/v1/signup');
  assert.equal(calls[0].body.email, 'ada@example.com');
  assert.equal(calls[0].body.data.display_name, 'Ada Lovelace');
  assert.ok(store.get('eltes.cloud.v1'), 'the session is persisted');
  assert.equal(cloud.user().id, ADA.id);
});

test('an unconfirmed sign-up returns no session instead of pretending', async () => {
  const fake = async () => new Response(JSON.stringify({ user: { id: ADA.id, email: ADA.email } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const { cloud, store } = loadClient(CONFIG, { fetch: fake });
  const result = await cloud.signUp({ email: 'ada@example.com', password: 'secret123', name: 'Ada' });

  assert.equal(result.needsConfirm, true);
  assert.equal(result.session, null);
  assert.equal(store.has('eltes.cloud.v1'), false);
});

test('sign-in errors are translated, never swallowed', async () => {
  const fake = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
  const { cloud } = loadClient(CONFIG, { fetch: fake });

  await assert.rejects(
    () => cloud.signIn({ email: 'ada@example.com', password: 'wrong' }),
    /do not match an account/
  );
});

test('a stored session is restored and refreshed before it expires', async () => {
  const fake = async (url) => {
    if (String(url).includes('grant_type=refresh_token')) {
      return new Response(JSON.stringify(sessionBody({ access_token: 'access-2', refresh_token: 'refresh-2' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404 });
  };
  const { cloud, store } = loadClient(CONFIG, { fetch: fake });
  store.set('eltes.cloud.v1', JSON.stringify({
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_at: Date.now() - 1000,
    user: { id: ADA.id, email: ADA.email }
  }));

  const session = await cloud.restore();
  assert.equal(session.access_token, 'access-2');
  assert.equal(JSON.parse(store.get('eltes.cloud.v1')).refresh_token, 'refresh-2');
});

test('a recovery link is read from the hash and asks for a new password', async () => {
  const { cloud, location } = loadClient(CONFIG, {
    fetch: async () => new Response('{}', { status: 200 }),
    hash: '#access_token=recover-1&refresh_token=r1&expires_in=3600&type=recovery'
  });

  const session = await cloud.restore();
  assert.equal(session.access_token, 'recover-1');
  assert.equal(session.recovered, true);
  assert.equal(location.hash, '', 'the token is stripped from the address bar');
});

test('the client maps every mail answer to an honest state', async () => {
  const answers = [
    [{ delivered: true, provider: 'resend', id: 'em_1' }, 'sent'],
    [{ delivered: false, reason: 'no_mail_provider' }, 'unconfigured'],
    [{ delivered: false, reason: 'suppressed' }, 'suppressed'],
    [{ delivered: false, reason: 'no_account' }, 'no-account'],
    [{ delivered: false, reason: 'already_sent', sentAt: '2026-10-20T10:00:00Z' }, 'already'],
    [{ delivered: false, reason: 'rate_limited' }, 'rate-limited'],
    [{ delivered: false, reason: 'provider_error', detail: 'domain not verified' }, 'error']
  ];
  for (const [payload, expected] of answers) {
    const { cloud } = loadClient(CONFIG, {
      fetch: async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    });
    const outcome = await cloud.welcome({ email: 'ada@example.com', name: 'Ada' });
    assert.equal(outcome.status, expected, JSON.stringify(payload));
  }
});

test('with no config the client is off and never calls the network', async () => {
  let called = 0;
  const { cloud } = loadClient({}, { fetch: async () => { called += 1; return new Response('{}'); } });
  assert.equal(cloud.enabled, false);
  assert.equal((await cloud.welcome({ email: 'ada@example.com' })).status, 'unavailable');
  assert.equal(called, 0);
});

/* --------------------------------- files --------------------------------- */

test('config.js ships public identifiers only', () => {
  const source = read('config.js');
  assert.match(source, /supabaseUrl:\s*'https:\/\/[a-z0-9]+\.supabase\.co'/);
  assert.match(source, /supabaseAnonKey:\s*'sb_publishable_[A-Za-z0-9_-]+'/);
  assert.ok(!/service_role['"]?\s*:/.test(source), 'the service role key never ships');
  assert.ok(!/sb_secret_/.test(source), 'secret keys never ship');
  assert.ok(!/re_[A-Za-z0-9]{8,}/.test(source), 'no provider API key');
});

test('no secret is written anywhere in the repository', () => {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.mail']);
  const findings = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) { walk(full); continue; }
      if (!/\.(js|cjs|mjs|ts|html|css|md|json|sql|yml|yaml)$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8');
      if (/sb_secret_[A-Za-z0-9]{10,}/.test(text) || /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text)) {
        findings.push(relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(findings, []);
});

test('the migration creates the tables, the trigger and the policies', () => {
  const sql = read('supabase/migrations/0001_eltes_accounts.sql');
  for (const table of ['profiles', 'email_events', 'suppressed_emails', 'mail_rate']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`), table);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), table);
  }
  assert.match(sql, /create trigger eltes_on_auth_user_created[\s\S]*after insert on auth\.users/);
  assert.match(sql, /create unique index if not exists email_events_one_welcome/);
  assert.match(sql, /revoke all on public\.profiles from anon/);
  assert.match(sql, /security definer/);
});

test('both functions are self-contained, deployable Deno modules', () => {
  const mail = read('supabase/functions/eltes-mail/index.ts');
  const hook = read('supabase/functions/email-webhook/index.ts');

  for (const [name, source] of [['eltes-mail', mail], ['email-webhook', hook]]) {
    assert.match(source, /Deno\.serve\(/, name);
    assert.ok(!/^import\s/m.test(source), `${name} has no imports, so it deploys as one file`);
    assert.ok(!/RESEND_API_KEY\s*=\s*['"]re_/.test(source), `${name} never hardcodes a key`);
  }
  assert.match(mail, /api\.resend\.com\/emails/);
  assert.match(mail, /admin\/generate_link/);
  assert.match(hook, /svix-signature/);
  assert.match(hook, /suppressed_emails/);
});
