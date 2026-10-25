'use strict';
/* ==========================================================================
   Eltes — email endpoints
   --------------------------------------------------------------------------
     GET  /api/email/status                  what is configured, what happened
     POST /api/email/welcome  {email,name}   the real welcome email
     POST /api/email/test     {to}           prove a provider works
     POST /api/email/webhook                 Brevo / Resend bounce events

   The welcome email is sent from your own machine, through your own free
   provider account. With nothing configured the message is written to the
   outbox and the response says delivered: false — no fake success anywhere.
   ========================================================================== */

const { timingSafeEqual } = require('node:crypto');
const { createMailer, maskSecret, validAddress } = require('../lib/mail.cjs');
const { setCors, json, bodyJson, endOptions } = require('../lib/http.cjs');

const mailer = createMailer();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS = 8;
const hits = new Map();

function clientKey(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function rateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_SENDS) {
    hits.set(key, recent);
    return Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
  }
  recent.push(now);
  hits.set(key, recent);
  return 0;
}

function loopback(req) {
  const address = String(req.socket?.remoteAddress || '');
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address === '';
}

function secretOk(req, url) {
  const expected = mailer.config.webhookSecret;
  if (!expected) return loopback(req);
  const given = url.searchParams.get('secret') || req.headers['x-eltes-secret'] || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function baseUrl(req) {
  if (process.env.ELTES_APP_URL) return process.env.ELTES_APP_URL;
  const host = req.headers.host || `localhost:${process.env.PORT || 4173}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

function publicConfig() {
  const config = mailer.config;
  return {
    configured: config.ready,
    provider: config.provider,
    from: config.fromHeader,
    problems: config.problems,
    key: config.apiKey ? maskSecret(config.apiKey) : null,
    smtp: config.smtpUrl ? config.smtpUrl.replace(/\/\/[^@]*@/, '//•••@') : null
  };
}

module.exports = async function email(req, res, url) {
  if (endOptions(req, res)) return;
  if (!setCors(req, res)) return json(res, 403, { error: 'Origin is not allowed.' });

  const path = (url.pathname.replace(/\/+$/, '') || '/api/email').slice('/api/email'.length) || '/';

  if (path === '/' || path === '/status') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Use GET.' });
    res.setHeader('Cache-Control', 'no-store');
    return json(res, 200, { ...mailer.status(), config: publicConfig() });
  }

  if (path === '/welcome' || path === '/test') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

    const wait = rateLimited(req);
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      return json(res, 429, { ok: false, error: `Too many emails from this machine. Try again in ${wait} s.` });
    }

    let body;
    try {
      body = await bodyJson(req);
    } catch {
      return json(res, 400, { ok: false, error: 'Send a JSON body.' });
    }

    const to = String(body.email || body.to || '').trim();
    if (!validAddress(to)) return json(res, 400, { ok: false, error: 'That is not a valid email address.', invalid: true });

    const name = String(body.name || '').trim().slice(0, 60);
    const result = path === '/welcome'
      ? await mailer.sendWelcome({ name, email: to, baseUrl: baseUrl(req) })
      : await mailer.send({
        to,
        subject: 'Eltes mail test',
        text: `This is a test from your Eltes server (${baseUrl(req)}). If you can read it, the mail provider is configured correctly.`,
        html: `<p style="font-family:system-ui,sans-serif">This is a test from your Eltes server (<a href="${baseUrl(req)}">${baseUrl(req)}</a>).</p><p style="font-family:system-ui,sans-serif;color:#666">If you can read it, the mail provider is configured correctly.</p>`
      });

    if (result.ok) {
      return json(res, 200, {
        ok: true,
        delivered: true,
        provider: result.provider,
        id: result.id || null,
        to: result.to,
        subject: result.subject,
        ms: result.ms
      });
    }
    if (result.suppressed) {
      return json(res, 200, { ok: false, delivered: false, suppressed: true, to: result.to, reason: result.reason });
    }
    if (result.outbox) {
      return json(res, 200, {
        ok: false,
        delivered: false,
        outbox: true,
        to: result.to,
        subject: result.subject,
        reason: result.reason,
        file: result.file
      });
    }
    if (result.invalid) return json(res, 400, { ok: false, delivered: false, error: result.error, invalid: true });
    return json(res, 502, {
      ok: false,
      delivered: false,
      to: result.to,
      provider: result.provider,
      error: result.error,
      bounced: !!result.bounced
    });
  }

  if (path === '/webhook') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
    if (!secretOk(req, url)) return json(res, 403, { error: 'Webhook secret required.' });
    let body;
    try {
      body = await bodyJson(req);
    } catch {
      return json(res, 400, { ok: false, error: 'Send the provider payload as JSON.' });
    }
    const result = mailer.webhook(body, url.searchParams.get('provider') || req.headers['x-eltes-provider'] || 'webhook');
    if (!result.ok) return json(res, 400, result);
    return json(res, 200, { ok: true, handled: result.handled, suppressed: mailer.status().suppressed.length });
  }

  return json(res, 404, { error: 'Unknown email endpoint. Try /api/email/status.' });
};

module.exports.mailer = mailer;
