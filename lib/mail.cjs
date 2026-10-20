'use strict';
/* ==========================================================================
   Eltes — mail core
   --------------------------------------------------------------------------
   Sends the real "Welcome to Eltes AI Workspace" email. No dependencies:

     Resend    POST https://api.resend.com/emails          (3,000/month free)
     Brevo     POST https://api.brevo.com/v3/smtp/email    (300/day free)
     SMTP      a tiny client over node:net / node:tls      (any mailbox)

   No provider configured is a supported state, not an error: the message is
   written to <mailDir>/outbox as a real .eml file and the result says so. The
   site never pretends an email left the machine when it did not.

   Bounces are handled where they actually happen:
     - SMTP: a 5xx at RCPT TO or DATA is a hard bounce, right now.
     - APIs: a 4xx that names the recipient is treated the same way.
     - Webhooks: /api/email/webhook normalises Brevo and Resend events.
   Hard bounces and complaints land in <mailDir>/suppressed.json, and every
   later send to that address short-circuits instead of burning quota.
   ========================================================================== */

const { randomUUID } = require('node:crypto');
const { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { connect: netConnect } = require('node:net');
const { connect: tlsConnect } = require('node:tls');
const { join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const DEFAULT_MAIL_DIR = join(ROOT, '.mail');
const WELCOME_SUBJECT = 'Welcome to Eltes AI Workspace';
const MAX_EVENTS = 500;

/* ------------------------------- configuration ---------------------------- */

function parseFrom(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2].trim() };
  return { name: '', email: raw };
}

function smtpTarget(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') {
    throw new Error('ELTES_SMTP_URL must start with smtp:// or smtps://');
  }
  const secure = url.protocol === 'smtps:';
  return {
    host: url.hostname,
    port: Number(url.port) || (secure ? 465 : 587),
    secure,
    user: decodeURIComponent(url.username || ''),
    pass: decodeURIComponent(url.password || ''),
    insecure: url.searchParams.get('tls') === 'off'
  };
}

function readConfig(env = process.env) {
  const from = parseFrom(env.ELTES_MAIL_FROM);
  const explicit = String(env.ELTES_MAIL_PROVIDER || '').toLowerCase();
  const has = (value) => !!(value && String(value).trim());

  let provider = null;
  if (explicit) {
    provider = explicit === 'none' ? null : explicit;
  } else if (has(env.RESEND_API_KEY)) provider = 'resend';
  else if (has(env.BREVO_API_KEY)) provider = 'brevo';
  else if (has(env.ELTES_SMTP_URL)) provider = 'smtp';

  const problems = [];
  if (provider && !from) problems.push('ELTES_MAIL_FROM is not set, so there is no sender address');
  if (provider === 'resend' && !has(env.RESEND_API_KEY)) problems.push('RESEND_API_KEY is missing');
  if (provider === 'brevo' && !has(env.BREVO_API_KEY)) problems.push('BREVO_API_KEY is missing');
  if (provider === 'smtp' && !has(env.ELTES_SMTP_URL)) problems.push('ELTES_SMTP_URL is missing');
  if (!provider) problems.push('no mail provider is configured');

  return {
    provider,
    from,
    fromHeader: from ? (from.name ? `${from.name} <${from.email}>` : from.email) : null,
    apiKey: provider === 'resend' ? env.RESEND_API_KEY : provider === 'brevo' ? env.BREVO_API_KEY : null,
    smtpUrl: provider === 'smtp' ? env.ELTES_SMTP_URL : null,
    replyTo: parseFrom(env.ELTES_MAIL_REPLY_TO)?.email || null,
    webhookSecret: env.ELTES_MAIL_WEBHOOK_SECRET || '',
    mailDir: resolve(env.ELTES_MAIL_DIR || DEFAULT_MAIL_DIR),
    ready: !!provider && problems.length === 0,
    problems
  };
}

/* --------------------------------- templates ------------------------------ */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstName(name) {
  const clean = String(name || '').trim().split(/\s+/)[0];
  return clean ? clean.slice(0, 40) : 'there';
}

function welcomeEmail(options = {}) {
  const name = firstName(options.name);
  const workspace = options.workspaceUrl || 'http://localhost:4173/app.html';
  const docs = options.docsUrl || 'http://localhost:4173/docs.html';
  const studio = options.studioUrl || 'http://localhost:4173/studio.html';
  const lab = options.labUrl || 'http://localhost:4173/train.html';
  const sentBy = options.sentBy || 'your own Eltes server';

  const text = [
    `Hi ${name},`,
    '',
    'Welcome to Eltes AI Workspace — one workspace for the models you choose.',
    '',
    'Three things worth doing first:',
    '1. Paste one provider key (OpenAI, Anthropic, DeepSeek, Gemini …). Keys stay in this browser.',
    '2. Open Studio and write something that runs: a page, a script, a small tool.',
    '3. Train a character-level model in Lab and watch the loss drop in your own tab.',
    '',
    'Eltes has no server in the middle and counts no telemetry. Your chats, keys and Studio files stay on the device that created this profile.',
    '',
    `Open the workspace: ${workspace}`,
    `Studio:             ${studio}`,
    `Lab:                ${lab}`,
    `Docs:               ${docs}`,
    '',
    `You are reading this because a local profile with this address was created on a device running Eltes. This message was sent by ${sentBy}. There is no tracking pixel and no unsubscribe database — if it was not you, ignore it and the profile stays in that browser.`
  ].join('\n');

  const row = (label, href, note) => `
    <tr><td style="padding:0 0 14px 0">
      <a href="${escapeHtml(href)}" style="color:#39dca2;text-decoration:none;font-weight:600;font-size:15px">${escapeHtml(label)}</a>
      <span style="color:#6b7b99;font-size:13px"> — ${escapeHtml(note)}</span>
    </td></tr>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(WELCOME_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#05070c">
<div style="display:none;max-height:0;overflow:hidden">Your workspace is ready: keys, Studio and Lab, all on your machine.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070c;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0a0e16;border:1px solid #1a2231;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <tr><td style="padding:26px 28px 6px 28px">
        <span style="display:inline-block;color:#39dca2;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">Eltes AI</span>
      </td></tr>
      <tr><td style="padding:6px 28px 0 28px">
        <h1 style="margin:0 0 12px 0;color:#eef4ff;font-size:26px;line-height:1.25;font-weight:700">Welcome to Eltes AI Workspace</h1>
        <p style="margin:0 0 18px 0;color:#9dadc9;font-size:15px;line-height:1.65">Hi ${escapeHtml(name)} — your workspace is ready. One place for the models you choose, a Studio that runs what you write, and a Lab that trains a small model in your own tab.</p>
      </td></tr>
      <tr><td style="padding:0 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e1420;border:1px solid #1a2231;border-radius:12px;padding:18px 18px 6px 18px">
          <tr><td style="padding:0 0 14px 0;color:#dbe6fb;font-size:14px;font-weight:600">Start here</td></tr>
          ${row('Open the workspace', workspace, 'ask anything, pick a model mid-thread')}
          ${row('Write and run in Studio', studio, 'a page, a script, a small tool')}
          ${row('Train in Lab', lab, 'a real character-level network, in your browser')}
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px 0 28px">
        <p style="margin:0 0 14px 0;color:#9dadc9;font-size:15px;line-height:1.65">Keys, chats and Studio files stay on this device. Eltes has no server in the middle and counts no telemetry.</p>
      </td></tr>
      <tr><td style="padding:0 28px 26px 28px">
        <a href="${escapeHtml(workspace)}" style="display:inline-block;background:#39dca2;color:#04101a;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px">Open Eltes</a>
        <a href="${escapeHtml(docs)}" style="display:inline-block;color:#9dadc9;text-decoration:none;font-size:14px;padding:12px 14px">Read the docs</a>
      </td></tr>
      <tr><td style="padding:18px 28px 26px 28px;border-top:1px solid #1a2231">
        <p style="margin:0;color:#6b7b99;font-size:12px;line-height:1.6">You are reading this because a local profile with this address was created on a device running Eltes. This message was sent by ${escapeHtml(sentBy)}. No tracking pixel, no unsubscribe database — if it was not you, ignore it and the profile stays in that browser.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject: WELCOME_SUBJECT, text, html };
}

/* ------------------------------- message wire ----------------------------- */

function encodeHeader(value) {
  const clean = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function wrap64(base64) {
  return (base64.match(/.{1,76}/g) || ['']).join('\r\n');
}

function buildMessage({ from, to, subject, text, html, messageId, date = new Date() }) {
  const boundary = `eltes-${randomUUID()}`;
  const part = (type, content) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset="utf-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(Buffer.from(content, 'utf8').toString('base64')),
    ''
  ].join('\r\n');

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    'X-Mailer: Eltes',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];

  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', text)}${part('text/html', html)}--${boundary}--\r\n`;
}

/* ---------------------------------- store --------------------------------- */

function mailPaths(dir) {
  return {
    dir,
    outbox: join(dir, 'outbox'),
    events: join(dir, 'events.jsonl'),
    suppressed: join(dir, 'suppressed.json')
  };
}

function ensureDirs(dir) {
  mkdirSync(join(dir, 'outbox'), { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function appendEvent(dir, event) {
  const entry = { at: new Date().toISOString(), ...event };
  try {
    ensureDirs(dir);
    appendFileSync(mailPaths(dir).events, `${JSON.stringify(entry)}\n`);
  } catch {
    /* an unwritable log must not break delivery */
  }
  return entry;
}

function readEvents(dir, limit = MAX_EVENTS) {
  const file = mailPaths(dir).events;
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return { at: null, type: 'unreadable' }; }
    });
  } catch {
    return [];
  }
}

function suppressedList(dir) {
  return readJson(mailPaths(dir).suppressed, {});
}

function suppress(dir, email, reason) {
  const address = normaliseAddress(email);
  if (!address) return;
  const list = suppressedList(dir);
  if (list[address]) return;
  list[address] = { reason: reason || 'hard bounce', at: new Date().toISOString() };
  try {
    ensureDirs(dir);
    writeFileSync(mailPaths(dir).suppressed, `${JSON.stringify(list, null, 2)}\n`);
  } catch {
    /* ignore */
  }
}

function isSuppressed(dir, email) {
  return !!suppressedList(dir)[normaliseAddress(email)];
}

function outboxFile(dir, to) {
  ensureDirs(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = normaliseAddress(to).replace(/[^a-z0-9]+/gi, '-').slice(0, 48) || 'message';
  return join(dir, 'outbox', `${stamp}-${slug}.eml`);
}

function outboxCount(dir) {
  try {
    return readdirSync(join(dir, 'outbox')).filter((name) => name.endsWith('.eml')).length;
  } catch {
    return 0;
  }
}

function normaliseAddress(email) {
  return String(email || '').trim().toLowerCase();
}

function validAddress(email) {
  const address = String(email || '').trim();
  return address.length <= 254 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(address);
}

function maskSecret(value) {
  const text = String(value || '');
  if (text.length <= 6) return text ? '••••' : '';
  return `${text.slice(0, 3)}…${text.slice(-4)}`;
}

/* ---------------------------------- SMTP ---------------------------------- */

class MailError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MailError';
    this.bounce = !!options.bounce;
    this.code = options.code || null;
    this.stage = options.stage || null;
  }
}

function smtpSession(socket) {
  let buffer = '';
  let pending = null;
  let failure = null;
  let reply = [];

  const drain = () => {
    let index;
    /* servers may use CRLF or bare LF */
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      reply.push(line);
      if (/^\d{3} /.test(line)) {
        const message = { code: Number(line.slice(0, 3)), lines: reply };
        reply = [];
        if (pending) {
          const waiter = pending;
          pending = null;
          waiter.resolve(message);
        }
      }
    }
  };

  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    drain();
  };
  const onError = (error) => {
    failure = error;
    if (pending) {
      const waiter = pending;
      pending = null;
      waiter.reject(error);
    }
  };
  const onClose = () => {
    if (!pending) return;
    const waiter = pending;
    pending = null;
    waiter.reject(failure || new MailError('The SMTP server closed the connection.', { stage: 'close' }));
  };

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  return {
    read() {
      return new Promise((resolvePromise, rejectPromise) => {
        if (failure) return rejectPromise(failure);
        pending = { resolve: resolvePromise, reject: rejectPromise };
        drain();
      });
    },
    write(line) {
      socket.write(`${line}\r\n`);
    },
    detach() {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    }
  };
}

function openSocket(target, timeoutMs) {
  const options = { host: target.host, port: target.port, servername: target.host };
  const socket = target.secure
    ? tlsConnect({ ...options, rejectUnauthorized: !target.insecure })
    : netConnect({ host: target.host, port: target.port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('The SMTP server did not answer in time.')));
  return socket;
}

function expectOk(response, stage, allowed = []) {
  if (response.code >= 200 && response.code < 400) return response;
  if (allowed.includes(response.code)) return response;
  const bounce = response.code >= 500 && (stage === 'rcpt' || stage === 'data');
  throw new MailError(`${stage}: ${response.lines.join(' ')}`, { code: response.code, bounce, stage });
}

async function smtpSend({ target, from, to, message, timeoutMs = 15000 }) {
  const socket = openSocket(target, timeoutMs);
  await new Promise((resolvePromise, rejectPromise) => {
    const ready = target.secure ? 'secureConnect' : 'connect';
    socket.once(ready, resolvePromise);
    socket.once('error', rejectPromise);
  });

  let session = smtpSession(socket);
  const close = () => { try { socket.end(); } catch { /* ignore */ } };

  try {
    expectOk(await session.read(), 'greeting');

    const ehloHost = 'eltes.local';
    session.write(`EHLO ${ehloHost}`);
    let ehlo = await session.read();
    if (ehlo.code !== 250) {
      session.write('HELO eltes.local');
      ehlo = await session.read();
      expectOk(ehlo, 'helo');
    }

    const features = ehlo.lines.join('\n').toUpperCase();
    if (!target.secure && features.includes('STARTTLS')) {
      session.write('STARTTLS');
      expectOk(await session.read(), 'starttls');
      session.detach();
      const secured = tlsConnect({ socket, servername: target.host, rejectUnauthorized: !target.insecure });
      await new Promise((resolvePromise, rejectPromise) => {
        secured.once('secureConnect', resolvePromise);
        secured.once('error', rejectPromise);
      });
      session = smtpSession(secured);
      session.write(`EHLO ${ehloHost}`);
      expectOk(await session.read(), 'ehlo');
    }

    if (target.user) {
      const token = Buffer.from(`\0${target.user}\0${target.pass}`, 'utf8').toString('base64');
      session.write(`AUTH PLAIN ${token}`);
      const auth = await session.read();
      if (auth.code !== 235) {
        throw new MailError(`auth: ${auth.lines.join(' ')}`, { code: auth.code, stage: 'auth' });
      }
    }

    session.write(`MAIL FROM:<${from}>`);
    expectOk(await session.read(), 'mail');

    session.write(`RCPT TO:<${to}>`);
    expectOk(await session.read(), 'rcpt');

    session.write('DATA');
    expectOk(await session.read(), 'data-start');

    const body = message.replace(/\r\n/g, '\n').split('\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
    socket.write(`${body}\r\n.\r\n`);
    const accepted = await session.read();
    expectOk(accepted, 'data');

    session.write('QUIT');
    return { code: accepted.code, response: accepted.lines.join(' ') };
  } finally {
    session.detach();
    close();
  }
}

/* --------------------------------- providers ------------------------------ */

function providerSend({ config, to, message, subject, text, html, fetchImpl, timeoutMs }) {
  const send = fetchImpl || globalThis.fetch;
  if (typeof send !== 'function') {
    return Promise.resolve({ ok: false, error: 'This Node build has no fetch(); use Node 18 or newer.', provider: config.provider });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let request;
  if (config.provider === 'resend') {
    request = {
      url: 'https://api.resend.com/emails',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'eltes-mail/1'
      },
      body: {
        from: config.fromHeader,
        to: [to],
        subject,
        html,
        text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {})
      }
    };
  } else {
    request = {
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: {
        'api-key': config.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'eltes-mail/1'
      },
      body: {
        sender: { email: config.from.email, ...(config.from.name ? { name: config.from.name } : {}) },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        ...(config.replyTo ? { replyTo: { email: config.replyTo } } : {})
      }
    };
  }

  return send(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: controller.signal
  }).then(async (response) => {
    const raw = await response.text();
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch { payload = { raw }; }
    if (response.ok) {
      return {
        ok: true,
        provider: config.provider,
        id: payload.id || payload.messageId || null,
        status: response.status
      };
    }
    const detail = payload.message || payload.error || payload.code || raw || `HTTP ${response.status}`;
    const text = String(detail);
    /* 4xx that names the recipient is a rejection of that address, not a bug */
    const bounce = response.status === 422 || (response.status >= 400 && response.status < 500 && /(recipient|email|address).*(invalid|reject|not valid|does not exist|blocked)/i.test(text));
    return {
      ok: false,
      provider: config.provider,
      status: response.status,
      error: text.slice(0, 300),
      bounce
    };
  }).catch((error) => ({
    ok: false,
    provider: config.provider,
    error: error.name === 'AbortError' ? 'the provider did not answer in time' : (error.message || String(error)),
    bounce: false
  })).finally(() => clearTimeout(timer));
}

/* ---------------------------------- send ---------------------------------- */

function createMailer(options = {}) {
  const env = options.env || process.env;
  const config = options.config || readConfig(env);
  const dir = config.mailDir;
  const fetchImpl = options.fetchImpl;
  const timeoutMs = options.timeoutMs || 15000;
  const log = options.log || (() => {});

  function send(letter) {
    const started = Date.now();
    const to = normaliseAddress(letter.to);
    const base = { to, subject: letter.subject, at: new Date().toISOString() };

    if (!validAddress(to)) {
      return Promise.resolve({ ...base, ok: false, error: 'That is not a valid email address.', invalid: true });
    }
    if (isSuppressed(dir, to)) {
      const entry = suppressedList(dir)[to];
      appendEvent(dir, { type: 'skipped', to, reason: 'suppressed', detail: entry?.reason });
      return Promise.resolve({
        ...base,
        ok: false,
        suppressed: true,
        reason: `This address hard-bounced before (${entry?.reason || 'bounce'}); nothing was sent.`
      });
    }

    const messageId = `eltes-${randomUUID()}@${(config.from && config.from.email.split('@')[1]) || 'eltes.local'}`;
    const message = buildMessage({
      from: config.fromHeader || 'Eltes <hello@eltes.local>',
      to,
      subject: letter.subject,
      text: letter.text,
      html: letter.html,
      messageId
    });

    const finish = (result) => {
      const ms = Date.now() - started;
      const bounced = !!(result.bounce || result.bounced);
      if (result.ok) {
        appendEvent(dir, { type: 'sent', to, provider: result.provider || 'outbox', id: result.id || null, subject: letter.subject, ms });
      } else if (bounced) {
        suppress(dir, to, result.error || 'hard bounce');
        appendEvent(dir, { type: 'bounced', to, provider: config.provider, detail: result.error, ms });
      } else if (result.outbox) {
        appendEvent(dir, { type: 'outbox', to, file: result.file, subject: letter.subject, ms });
      } else {
        appendEvent(dir, { type: 'error', to, provider: config.provider, detail: result.error, ms });
      }
      log(`[mail] ${result.ok ? 'sent' : result.outbox ? 'outbox' : 'failed'} → ${to} (${ms} ms)${result.error ? ` · ${result.error}` : ''}`);
      return { ...base, ...result, ...(bounced ? { bounced: true } : {}), ms, messageId };
    };

    if (!config.ready) {
      const file = outboxFile(dir, to);
      try {
        writeFileSync(file, message);
      } catch (error) {
        return Promise.resolve(finish({ ok: false, error: `The outbox is not writable: ${error.message}` }));
      }
      return Promise.resolve(finish({
        ok: false,
        outbox: true,
        file,
        reason: config.problems[0] || 'no mail provider is configured',
        mode: 'outbox'
      }));
    }

    if (config.provider === 'smtp') {
      let target;
      try {
        target = smtpTarget(config.smtpUrl);
      } catch (error) {
        return Promise.resolve(finish({ ok: false, error: error.message }));
      }
      return smtpSend({ target, from: config.from.email, to, message, timeoutMs })
        .then((result) => finish({ ok: true, provider: 'smtp', id: result.response }))
        .catch((error) => finish({
          ok: false,
          provider: 'smtp',
          error: error.message,
          bounce: !!error.bounce || (error.code >= 500 && error.stage === 'rcpt')
        }));
    }

    return providerSend({ config, to, message, subject: letter.subject, text: letter.text, html: letter.html, fetchImpl, timeoutMs })
      .then(finish);
  }

  function sendWelcome({ name, email, baseUrl }) {
    const origin = String(baseUrl || env.ELTES_APP_URL || 'http://localhost:4173').replace(/\/+$/, '');
    const template = welcomeEmail({
      name,
      workspaceUrl: `${origin}/app.html`,
      docsUrl: `${origin}/docs.html`,
      studioUrl: `${origin}/studio.html`,
      labUrl: `${origin}/train.html`,
      sentBy: config.ready ? `${config.provider} on your own Eltes server` : 'your own Eltes server'
    });
    return send({ to: email, subject: template.subject, text: template.text, html: template.html });
  }

  function status() {
    const events = readEvents(dir);
    const counts = { sent: 0, bounced: 0, outbox: 0, error: 0, skipped: 0 };
    for (const event of events) {
      if (counts[event.type] !== undefined) counts[event.type] += 1;
    }
    return {
      configured: config.ready,
      provider: config.provider,
      from: config.fromHeader,
      mode: config.ready ? 'live' : 'outbox',
      problems: config.problems,
      delivery: config.ready
        ? `Sending through ${config.provider}; real messages leave this machine.`
        : 'No provider configured: every message is written to the outbox as a .eml file.',
      mailDir: dir,
      outboxDir: mailPaths(dir).outbox,
      outbox: outboxCount(dir),
      counts,
      suppressed: Object.entries(suppressedList(dir)).map(([email, meta]) => ({ email, ...meta })),
      recent: events.slice(-8).reverse()
    };
  }

  function webhook(payload, hint) {
    const events = normaliseWebhook(payload, hint);
    if (!events.length) return { ok: false, error: 'No event in that payload.' };
    for (const event of events) {
      const type = event.type;
      if ((type === 'bounced' || type === 'complaint') && event.to) suppress(dir, event.to, event.detail || type);
      appendEvent(dir, event);
    }
    return { ok: true, handled: events.length, events };
  }

  return { config, dir, send, sendWelcome, status, webhook, isSuppressed: (email) => isSuppressed(dir, email), paths: mailPaths(dir) };
}

/* -------------------------------- webhooks -------------------------------- */

function normaliseWebhook(payload, hint) {
  const body = payload || {};
  const events = [];

  const push = (type, to, detail) => {
    const address = normaliseAddress(to);
    if (!address) return;
    events.push({ at: new Date().toISOString(), type, to: address, detail: detail || null, source: hint || 'webhook' });
  };

  if (Array.isArray(body)) return body.flatMap((entry) => normaliseWebhook(entry, hint));

  /* Brevo: { event: "hard_bounce", email: "a@b.c", reason } */
  if (typeof body.event === 'string' && !body.type) {
    const map = {
      hard_bounce: 'bounced',
      soft_bounce: 'soft-bounce',
      blocked: 'bounced',
      spam: 'complaint',
      complaint: 'complaint',
      delivered: 'delivered',
      opened: 'opened',
      click: 'clicked'
    };
    const type = map[body.event] || body.event;
    const to = body.email || body['email'] || body.recipient;
    push(type, to, body.reason || body.message || body.detail || body.event);
    return events;
  }

  /* Resend: { type: "email.bounced", data: { to: ["a@b.c"] } } */
  if (typeof body.type === 'string' && body.type.startsWith('email.')) {
    const map = {
      'email.bounced': 'bounced',
      'email.delivery_delayed': 'soft-bounce',
      'email.complained': 'complaint',
      'email.delivered': 'delivered',
      'email.opened': 'opened',
      'email.clicked': 'clicked'
    };
    const to = (body.data && body.data.to) || body.to;
    const address = Array.isArray(to) ? to[0] : to;
    push(map[body.type] || body.type.replace('email.', ''), address, (body.data && (body.data.bounce || body.data.reason)) || body.type);
    return events;
  }

  /* our own shim: { type, to, detail } */
  if (typeof body.type === 'string' && (body.to || body.email)) {
    push(body.type, body.to || body.email, body.detail || body.reason);
    return events;
  }

  return events;
}

module.exports = {
  DEFAULT_MAIL_DIR,
  WELCOME_SUBJECT,
  MailError,
  buildMessage,
  createMailer,
  encodeHeader,
  isSuppressed,
  normaliseAddress,
  normaliseWebhook,
  readConfig,
  readEvents,
  smtpTarget,
  suppressedList,
  validAddress,
  welcomeEmail,
  maskSecret
};
