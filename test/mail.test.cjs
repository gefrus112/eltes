/* ==========================================================================
   Eltes — mail tests
   --------------------------------------------------------------------------
   No network, no real provider accounts: the provider HTTP calls are stubbed,
   the SMTP server is a small socket in the test process, and the HTTP routes
   run against a real tools/local-server.mjs on an ephemeral port.
   ========================================================================== */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { spawn } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const mail = require(join(root, 'lib', 'mail.cjs'));

function tempDir(label) {
  return mkdtempSync(join(tmpdir(), `eltes-${label}-`));
}

function env(overrides = {}) {
  return {
    ELTES_MAIL_FROM: 'Eltes <hello@eltes.test>',
    ELTES_MAIL_DIR: tempDir('mail'),
    ...overrides
  };
}

/* ------------------------------- the email -------------------------------- */

test('the welcome email says what it is and escapes the name', () => {
  const letter = mail.welcomeEmail({
    name: '<b>Ada</b> Lovelace',
    workspaceUrl: 'http://localhost:4173/app.html'
  });
  assert.equal(letter.subject, 'Welcome to Eltes AI Workspace');
  assert.match(letter.text, /^Hi /);
  assert.match(letter.text, /Open the workspace: http:\/\/localhost:4173\/app\.html/);
  assert.match(letter.html, /Welcome to Eltes AI Workspace/);
  assert.ok(!letter.html.includes('<b>Ada</b>'), 'the name is escaped, not injected');
  assert.match(letter.html, /&lt;b&gt;Ada&lt;\/b&gt;/);
  assert.match(letter.html, /No tracking pixel/);
});

test('the wire format is a real multipart message', () => {
  const message = mail.buildMessage({
    from: 'Eltes <hello@eltes.test>',
    to: 'ada@example.com',
    subject: 'Welcome to Eltes AI Workspace',
    text: 'hello there',
    html: '<p>hello there</p>',
    messageId: 'eltes-test@eltes.test',
    date: new Date('2026-01-02T03:04:05Z')
  });
  assert.match(message, /^From: Eltes <hello@eltes\.test>\r\n/);
  assert.match(message, /To: ada@example\.com\r\n/);
  assert.match(message, /Message-ID: <eltes-test@eltes\.test>\r\n/);
  assert.match(message, /Date: Fri, 02 Jan 2026 03:04:05 GMT/);
  assert.match(message, /Content-Type: multipart\/alternative; boundary="eltes-/);
  const bodies = message.split('Content-Transfer-Encoding: base64\r\n\r\n').slice(1)
    .map((chunk) => Buffer.from(chunk.split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8'));
  assert.deepEqual(bodies, ['hello there', '<p>hello there</p>']);
});

test('non-ASCII subjects are encoded, headers cannot be injected', () => {
  assert.match(mail.encodeHeader('Héllo'), /^=\?UTF-8\?B\?/);
  assert.equal(mail.encodeHeader('Hello\r\nBcc: sneaky@example.com'), 'Hello Bcc: sneaky@example.com');
});

/* ----------------------------- configuration ------------------------------ */

test('a provider is picked from the environment and needs a sender', () => {
  const none = mail.readConfig({ ELTES_MAIL_DIR: '/tmp/x' });
  assert.equal(none.provider, null);
  assert.equal(none.ready, false);
  assert.match(none.problems[0], /no mail provider/);

  const resend = mail.readConfig({ RESEND_API_KEY: 're_123456789', ELTES_MAIL_FROM: 'Eltes <hi@eltes.test>' });
  assert.equal(resend.provider, 'resend');
  assert.equal(resend.ready, true);
  assert.equal(resend.fromHeader, 'Eltes <hi@eltes.test>');

  const noFrom = mail.readConfig({ RESEND_API_KEY: 're_123' });
  assert.equal(noFrom.ready, false);
  assert.match(noFrom.problems.join(' '), /ELTES_MAIL_FROM/);

  const brevo = mail.readConfig({ BREVO_API_KEY: 'xkeysib-1', ELTES_MAIL_FROM: 'hi@eltes.test' });
  assert.equal(brevo.provider, 'brevo');

  const smtp = mail.readConfig({ ELTES_SMTP_URL: 'smtps://user:pass@smtp.example.com:465', ELTES_MAIL_FROM: 'hi@eltes.test' });
  assert.equal(smtp.provider, 'smtp');
  const target = mail.smtpTarget(smtp.smtpUrl);
  assert.equal(target.secure, true);
  assert.equal(target.port, 465);
  assert.equal(target.user, 'user');

  const explicitOff = mail.readConfig({ RESEND_API_KEY: 're_1', ELTES_MAIL_PROVIDER: 'none' });
  assert.equal(explicitOff.provider, null);
});

/* -------------------------------- outbox ---------------------------------- */

test('with no provider the message lands in a real .eml outbox', async () => {
  const config = mail.readConfig(env());
  const mailer = mail.createMailer({ config });
  const result = await mailer.sendWelcome({ name: 'Ada', email: 'ada@example.com', baseUrl: 'http://localhost:4173' });

  assert.equal(result.ok, false);
  assert.equal(result.outbox, true);
  assert.equal(result.mode, 'outbox');
  assert.ok(existsSync(result.file), 'the .eml file exists');
  const saved = readFileSync(result.file, 'utf8');
  assert.match(saved, /Subject: Welcome to Eltes AI Workspace/);
  assert.match(saved, /To: ada@example\.com/);

  const status = mailer.status();
  assert.equal(status.configured, false);
  assert.equal(status.outbox, 1);
  assert.equal(status.counts.outbox, 1);
  assert.equal(status.recent[0].type, 'outbox');
});

test('the outbox refuses an invalid address before writing anything', async () => {
  const mailer = mail.createMailer({ config: mail.readConfig(env()) });
  const result = await mailer.sendWelcome({ name: 'Ada', email: 'not-an-email' });
  assert.equal(result.ok, false);
  assert.equal(result.invalid, true);
  assert.equal(mailer.status().outbox, 0);
});

/* ------------------------------- providers -------------------------------- */

test('Resend gets the documented payload and reports its id', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 're_abc123' }) };
  };
  const config = mail.readConfig(env({ RESEND_API_KEY: 're_secret_key' }));
  const mailer = mail.createMailer({ config, fetchImpl });
  const result = await mailer.sendWelcome({ name: 'Ada', email: 'Ada@Example.com', baseUrl: 'http://localhost:4173' });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'resend');
  assert.equal(result.id, 're_abc123');
  assert.equal(result.to, 'ada@example.com');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer re_secret_key');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.from, 'Eltes <hello@eltes.test>');
  assert.deepEqual(body.to, ['ada@example.com']);
  assert.equal(body.subject, 'Welcome to Eltes AI Workspace');
  assert.match(body.html, /Welcome to Eltes AI Workspace/);
  assert.match(body.text, /Hi Ada/);
});

test('Brevo gets htmlContent/textContent and a sender object', async () => {
  let seen = null;
  const fetchImpl = async (url, options) => {
    seen = { url, options };
    return { ok: true, status: 201, text: async () => JSON.stringify({ messageId: '<brevo@x>' }) };
  };
  const config = mail.readConfig(env({ BREVO_API_KEY: 'xkeysib-secret' }));
  const mailer = mail.createMailer({ config, fetchImpl });
  const result = await mailer.sendWelcome({ name: 'Ada', email: 'ada@example.com' });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'brevo');
  assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(seen.options.headers['api-key'], 'xkeysib-secret');
  const body = JSON.parse(seen.options.body);
  assert.deepEqual(body.sender, { email: 'hello@eltes.test', name: 'Eltes' });
  assert.deepEqual(body.to, [{ email: 'ada@example.com' }]);
  assert.match(body.htmlContent, /Welcome/);
  assert.match(body.textContent, /Hi Ada/);
});

test('a provider rejection of the address is a bounce and suppresses it', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 422,
    text: async () => JSON.stringify({ message: 'Invalid `to` field: recipient email is invalid', name: 'validation_error' })
  });
  const config = mail.readConfig(env({ RESEND_API_KEY: 're_secret_key' }));
  const mailer = mail.createMailer({ config, fetchImpl });

  const first = await mailer.sendWelcome({ name: 'Ada', email: 'gone@example.com' });
  assert.equal(first.ok, false);
  assert.equal(first.bounce, true);
  assert.equal(mailer.isSuppressed('gone@example.com'), true);

  const second = await mailer.sendWelcome({ name: 'Ada', email: 'gone@example.com' });
  assert.equal(second.suppressed, true);
  assert.match(second.reason, /hard-bounced/);
});

/* ---------------------------------- SMTP ---------------------------------- */

function fakeSmtp({ rcpt = '250 2.1.5 Ok', advertiseTls = false } = {}) {
  const received = [];
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    let buffer = '';
    let inData = false;
    let message = '';
    socket.write('220 fake.eltes.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(message);
            socket.write('250 2.0.0 queued as 7F3A\r\n');
          } else {
            message += `${line}\n`;
          }
          continue;
        }
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') {
          socket.write(`250-fake.eltes.test\r\n250-AUTH PLAIN LOGIN\r\n${advertiseTls ? '250-STARTTLS\r\n' : ''}250 SIZE 10485760\r\n`);
        } else if (verb === 'AUTH') {
          socket.write('235 2.7.0 authentication successful\r\n');
        } else if (verb === 'MAIL') {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (verb === 'RCPT') {
          socket.write(`${rcpt}\r\n`);
        } else if (verb === 'DATA') {
          inData = true;
          message = '';
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 2.0.0 Ok\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });
  return {
    server,
    received,
    get connections() { return connections; },
    listen: () => new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port))),
    close: () => new Promise((done) => server.close(() => done()))
  };
}

test('SMTP delivers the welcome email over a real socket exchange', async () => {
  const smtp = fakeSmtp();
  const port = await smtp.listen();
  try {
    const config = mail.readConfig(env({ ELTES_SMTP_URL: `smtp://ada:secret@127.0.0.1:${port}` }));
    const mailer = mail.createMailer({ config });
    const result = await mailer.sendWelcome({ name: 'Ada', email: 'ada@example.com', baseUrl: 'http://localhost:4173' });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.provider, 'smtp');
    assert.equal(smtp.received.length, 1);
    assert.match(smtp.received[0], /Subject: Welcome to Eltes AI Workspace/);
    assert.match(smtp.received[0], /To: ada@example\.com/);
    assert.equal(smtp.connections, 1);
  } finally {
    await smtp.close();
  }
});

test('a 5xx at RCPT is a hard bounce, and later sends skip the server entirely', async () => {
  const smtp = fakeSmtp({ rcpt: '550 5.1.1 <gone@example.com>: Recipient address rejected: User unknown' });
  const port = await smtp.listen();
  try {
    const config = mail.readConfig(env({ ELTES_SMTP_URL: `smtp://ada:secret@127.0.0.1:${port}` }));
    const mailer = mail.createMailer({ config });

    const first = await mailer.sendWelcome({ name: 'Ada', email: 'gone@example.com' });
    assert.equal(first.ok, false);
    assert.equal(first.bounced, true);
    assert.match(first.error, /550|Recipient/);
    assert.equal(mailer.isSuppressed('gone@example.com'), true);
    assert.equal(smtp.connections, 1);

    const second = await mailer.sendWelcome({ name: 'Ada', email: 'gone@example.com' });
    assert.equal(second.suppressed, true);
    assert.equal(smtp.connections, 1, 'the suppressed address never reaches the server again');
  } finally {
    await smtp.close();
  }
});

/* -------------------------------- webhooks -------------------------------- */

test('Brevo and Resend bounce payloads normalise to the same event', () => {
  const brevo = mail.normaliseWebhook({ event: 'hard_bounce', email: 'Ada@Example.com', reason: '550 unknown' }, 'brevo');
  assert.deepEqual(brevo.map((event) => [event.type, event.to]), [['bounced', 'ada@example.com']]);

  const resend = mail.normaliseWebhook({ type: 'email.bounced', data: { to: ['ada@example.com'] } }, 'resend');
  assert.equal(resend[0].type, 'bounced');

  const complaint = mail.normaliseWebhook({ type: 'email.complained', data: { to: 'ada@example.com' } }, 'resend');
  assert.equal(complaint[0].type, 'complaint');

  const delivered = mail.normaliseWebhook([{ event: 'delivered', email: 'ada@example.com' }], 'brevo');
  assert.equal(delivered[0].type, 'delivered');
  assert.deepEqual(mail.normaliseWebhook({ hello: 'world' }), []);
});

test('a hard bounce from a webhook suppresses the address', async () => {
  const mailer = mail.createMailer({ config: mail.readConfig(env()) });
  const handled = mailer.webhook({ event: 'hard_bounce', email: 'gone@example.com', reason: '550' }, 'brevo');
  assert.equal(handled.ok, true);
  assert.equal(mailer.isSuppressed('gone@example.com'), true);
  const result = await mailer.sendWelcome({ name: 'Ada', email: 'gone@example.com' });
  assert.equal(result.suppressed, true);
  assert.equal(mailer.status().suppressed.length, 1);
});

/* ----------------------------- the HTTP routes ---------------------------- */

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const dir = tempDir('mail-http');
  const child = spawn(process.execPath, [join(root, 'tools', 'local-server.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ELTES_STUDIO: '0',
      ELTES_MAIL_DIR: dir,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok) return { child, base, dir };
    } catch { /* not up yet */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  child.kill();
  throw new Error('the local server did not start');
}

test('POST /api/email/welcome answers honestly when no provider is set', async () => {
  const { child, base, dir } = await startServer();
  try {
    const response = await fetch(`${base}/api/email/welcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ email: 'ada@example.com', name: 'Ada Lovelace' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.delivered, false);
    assert.equal(body.outbox, true);
    assert.match(body.reason, /no mail provider/);
    assert.ok(existsSync(body.file), 'the .eml exists on disk');
    assert.equal(readdirSync(join(dir, 'outbox')).length, 1);

    const status = await (await fetch(`${base}/api/email/status`)).json();
    assert.equal(status.mode, 'outbox');
    assert.equal(status.configured, false);
    assert.equal(status.counts.outbox, 1);
    assert.equal(status.config.provider, null);

    const invalid = await fetch(`${base}/api/email/welcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope' })
    });
    assert.equal(invalid.status, 400);
  } finally {
    child.kill();
  }
});

test('a webhook from this machine suppresses the address for the next send', async () => {
  const { child, base } = await startServer();
  try {
    const hook = await fetch(`${base}/api/email/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'hard_bounce', email: 'gone@example.com', reason: '550 mailbox unavailable' })
    });
    assert.equal(hook.status, 200);
    assert.equal((await hook.json()).handled, 1);

    const response = await fetch(`${base}/api/email/welcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'gone@example.com' })
    });
    const body = await response.json();
    assert.equal(body.delivered, false);
    assert.equal(body.suppressed, true);
    assert.match(body.reason, /hard-bounced/);
  } finally {
    child.kill();
  }
});

test('a configured webhook secret rejects unsigned calls', async () => {
  const { child, base } = await startServer({ ELTES_MAIL_WEBHOOK_SECRET: 's3cret' });
  try {
    const denied = await fetch(`${base}/api/email/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'hard_bounce', email: 'gone@example.com' })
    });
    assert.equal(denied.status, 403);

    const signed = await fetch(`${base}/api/email/webhook?secret=s3cret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'hard_bounce', email: 'gone@example.com' })
    });
    assert.equal(signed.status, 200);
  } finally {
    child.kill();
  }
});

test('email routes are documented on the server and in the CLI', () => {
  const server = readFileSync(join(root, 'tools', 'local-server.mjs'), 'utf8');
  assert.match(server, /api\/email/);
  assert.match(server, /import email from '..\/api\/email\.js'/);
  const cli = readFileSync(join(root, 'tools', 'mail.mjs'), 'utf8');
  for (const command of ['status', 'welcome', 'test', 'bounce', 'unsuppress']) {
    assert.ok(cli.includes(`'${command}'`), command);
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['mail'], 'npm run mail exists');
});
