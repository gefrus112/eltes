/* ==========================================================================
   Eltes — mail function (Supabase Edge Function, Deno)
   One endpoint: welcome, magic link, password reset. Sends through Resend's
   HTTPS API and answers with what actually happened.

   This file is plain JavaScript in a .ts file on purpose: it runs unchanged
   under `deno` and under the test harness in test/supabase.test.cjs, which
   evaluates it with a small Deno shim. No imports, no build step.

   Secrets (Supabase → Project Settings → Edge Functions → Secrets):
     RESEND_API_KEY   re_…                        required to send
     ELTES_MAIL_FROM  Eltes <hello@yourdomain>    optional
     ELTES_SITE_URL   https://gefrus112.github.io/eltes/    optional
     ELTES_REPLY_TO   optional
   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
   ========================================================================== */

const SITE = (Deno.env.get('ELTES_SITE_URL') || 'https://gefrus112.github.io/eltes/').replace(/\/+$/, '/');
const FROM = Deno.env.get('ELTES_MAIL_FROM') || 'Eltes <onboarding@resend.dev>';
const REPLY_TO = Deno.env.get('ELTES_REPLY_TO') || '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function normaliseEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return '';
  return email;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function displayName(value, email) {
  const name = String(value == null ? '' : value).trim().slice(0, 60);
  if (name.length >= 2) return name;
  const local = email.split('@')[0] || 'there';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'there';
}

async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`rest ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function consume(bucket, limit, seconds) {
  const rows = await rest('rpc/mail_consume', {
    method: 'POST',
    body: JSON.stringify({ p_bucket: bucket, p_limit: limit, p_window: `${seconds} seconds` })
  });
  const result = Array.isArray(rows) ? rows[0] : rows;
  return !!(result && result.allowed);
}

function clientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

const SHELL = (body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Eltes</title></head>
<body style="margin:0;padding:0;background:#07070a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07070a;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#101014;border:1px solid #23232b;border-radius:18px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:28px 30px 8px;">
<div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#ff7a18;font-weight:700;">Eltes AI Workspace</div>
</td></tr>
<tr><td style="padding:0 30px 30px;color:#e8e8ee;font-size:15px;line-height:1.65;">${body}</td></tr>
<tr><td style="padding:18px 30px 26px;border-top:1px solid #23232b;color:#8b8b96;font-size:12px;line-height:1.6;">
Sent by your own Eltes deployment — a Supabase project plus Resend. No tracking pixel, no newsletter, no third-party analytics.
</td></tr>
</table>
</td></tr></table></body></html>`;

function button(href, label) {
  return `<p style="margin:26px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#ff7a18;color:#0a0a0d;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:11px;">${escapeHtml(label)}</a></p>`;
}

function letter(intent, name, link) {
  const workspace = `${SITE}app.html`;
  if (intent === 'welcome') {
    const action = link || workspace;
    return {
      subject: 'Welcome to Eltes AI Workspace',
      text: [
        `Hi ${name},`,
        '',
        'Welcome to Eltes AI Workspace.',
        '',
        link
          ? 'Your account is ready. Open it here — the same link also confirms this address if that is still pending:'
          : 'Your account is ready. Open the workspace:',
        action,
        '',
        'What you get: live web search with numbered citations, 66 models across 14 providers with your own keys, a local Studio, and Eltes Lab — a small character-level network you can train in the browser.',
        '',
        'Everything runs from the browser, the desktop app, or your own machine. No credit card, no subscription.',
        '',
        '— Eltes'
      ].join('\n'),
      html: SHELL(`
        <h1 style="margin:14px 0 10px;font-size:24px;line-height:1.25;color:#fff;">Welcome to Eltes AI Workspace</h1>
        <p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>
        <p style="margin:0 0 12px;">Your account is ready${link ? ' — the button below also confirms this address if that is still pending' : ''}.</p>
        ${button(action, link ? 'Confirm and open Eltes' : 'Open the workspace')}
        <p style="margin:0 0 12px;color:#a9a9b6;font-size:14px;">Live web search with numbered citations, 66 models across 14 providers with your own keys, a local Studio, and Eltes Lab — a small character-level network you can train in the browser.</p>
        <p style="margin:0;color:#a9a9b6;font-size:14px;">Free, no card, no subscription.</p>`)
    };
  }
  if (intent === 'magiclink') {
    return {
      subject: 'Your Eltes sign-in link',
      text: [
        `Hi ${name},`,
        '',
        'Use the link below to sign in to Eltes. It is single-use and expires in about an hour.',
        '',
        link || workspace,
        '',
        'If you did not ask for this, ignore the message — nothing changes.'
      ].join('\n'),
      html: SHELL(`
        <h1 style="margin:14px 0 10px;font-size:22px;line-height:1.25;color:#fff;">Your sign-in link</h1>
        <p style="margin:0 0 12px;">Hi ${escapeHtml(name)}, this link signs you in once and expires in about an hour.</p>
        ${button(link || workspace, 'Sign in to Eltes')}
        <p style="margin:0;color:#a9a9b6;font-size:14px;">If you did not ask for it, ignore this message — nothing changes.</p>`)
    };
  }
  return {
    subject: 'Reset your Eltes password',
    text: [
      `Hi ${name},`,
      '',
      'Open the link below to choose a new password. It is single-use and expires in about an hour.',
      '',
      link || `${SITE}auth.html`,
      '',
      'If you did not ask for a reset, ignore this message — your password stays as it is.'
    ].join('\n'),
    html: SHELL(`
      <h1 style="margin:14px 0 10px;font-size:22px;line-height:1.25;color:#fff;">Reset your password</h1>
      <p style="margin:0 0 12px;">Hi ${escapeHtml(name)}, choose a new password with the button below. Single use, about an hour to act.</p>
      ${button(link || `${SITE}auth.html`, 'Choose a new password')}
      <p style="margin:0;color:#a9a9b6;font-size:14px;">If you did not ask for a reset, ignore this message — your password stays as it is.</p>`)
  };
}

async function send(to, mail) {
  const payload = {
    from: FROM,
    to: [to],
    subject: mail.subject,
    html: mail.html,
    text: mail.text
  };
  if (REPLY_TO) payload.reply_to = REPLY_TO;

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return { ok: false, error: `network: ${error.message}` };
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data.message || data.error || `resend ${response.status}`;
    return { ok: false, error: String(message).slice(0, 300) };
  }
  return { ok: true, id: String(data.id || '') };
}

async function logEvent(row) {
  try { await rest('email_events', { method: 'POST', body: JSON.stringify(row) }); }
  catch (error) { console.error('email_events insert failed', error.message); }
}

async function findProfile(email, userId) {
  const query = userId
    ? `profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,display_name&limit=1`
    : `profiles?email=eq.${encodeURIComponent(email)}&select=id,email,display_name&limit=1`;
  const rows = await rest(query);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;
  if (String(row.email || '').toLowerCase() !== email) return null;
  return row;
}

async function alreadyWelcomed(userId) {
  const rows = await rest(
    `email_events?user_id=eq.${encodeURIComponent(userId)}&kind=eq.welcome&status=eq.sent` +
    '&select=created_at&order=created_at.desc&limit=1'
  );
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? String(row.created_at || '') : null;
}

async function actionLink(type, email, redirect) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ type, email, redirect_to: redirect })
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data.msg || data.message || data.error_description || `auth ${response.status}`;
    return { link: null, error: String(message).slice(0, 200) };
  }
  const link = String(data.action_link || data.actionLink || '');
  return { link: link || null };
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ configured: false, delivered: false, reason: 'no_backend', detail: 'The function is missing its Supabase service credentials.' }, 500);
  }

  if (req.method === 'GET') {
    return json({
      configured: Boolean(RESEND_KEY),
      provider: 'resend',
      from: FROM,
      site: SITE,
      limits: { perAddress: 3, perIp: 6, windowSeconds: 600, dailyResendFree: 100 }
    });
  }

  if (req.method !== 'POST') return json({ delivered: false, reason: 'method' }, 405);

  const ip = clientIp(req);
  let body;
  try { body = await req.json(); } catch { return json({ delivered: false, reason: 'bad_json' }, 400); }

  const intent = String(body.intent || 'welcome');
  if (!['welcome', 'magiclink', 'recovery'].includes(intent)) {
    return json({ delivered: false, reason: 'bad_intent' }, 400);
  }

  const email = normaliseEmail(body.email);
  if (!email) return json({ delivered: false, reason: 'bad_email' }, 400);

  try {
    if (!(await consume(`ip:${ip}`, 6, 600))) {
      return json({ delivered: false, reason: 'rate_limited', detail: 'Too many messages from this network. Try again in a few minutes.' }, 429);
    }
    if (!(await consume(`addr:${email}`, 3, 600))) {
      return json({ delivered: false, reason: 'rate_limited', detail: 'That address already asked for several messages. Try again in ten minutes.' }, 429);
    }

    const suppressed = await rest(`suppressed_emails?email=eq.${encodeURIComponent(email)}&select=reason,detail&limit=1`);
    if (Array.isArray(suppressed) && suppressed.length) {
      const row = suppressed[0];
      await logEvent({ email, kind: intent, status: 'suppressed', provider: 'resend', detail: String(row.reason || 'suppressed'), ip });
      return json({ delivered: false, reason: 'suppressed', detail: String(row.reason || '') });
    }

    const profile = await findProfile(email, String(body.userId || ''));
    if (!profile) {
      return json({ delivered: false, reason: 'no_account', detail: 'No Eltes account uses that address yet.' });
    }
    const userId = String(profile.id);
    const name = displayName(profile.display_name ?? body.name, email);

    if (intent === 'welcome') {
      const previous = await alreadyWelcomed(userId);
      if (previous) {
        return json({ delivered: false, reason: 'already_sent', sentAt: previous });
      }
    }

    if (!RESEND_KEY) {
      await logEvent({ email, user_id: userId, kind: intent, status: 'unconfigured', provider: 'resend', detail: 'RESEND_API_KEY is not set', ip });
      return json({
        delivered: false,
        configured: false,
        reason: 'no_mail_provider',
        detail: 'Add RESEND_API_KEY in Supabase → Edge Functions → Secrets to send real mail.'
      });
    }

    const redirect = `${SITE}auth.html?intent=${intent}`;
    const type = intent === 'recovery' ? 'recovery' : 'magiclink';
    const built = await actionLink(type, email, redirect);
    if (built.error) {
      await logEvent({ email, user_id: userId, kind: intent, status: 'failed', provider: 'resend', detail: built.error, ip });
      return json({ delivered: false, reason: 'auth_link_failed', detail: built.error });
    }

    const mail = letter(intent, name, built.link);
    const result = await send(email, mail);
    if (!result.ok) {
      await logEvent({ email, user_id: userId, kind: intent, status: 'failed', provider: 'resend', detail: result.error, ip });
      return json({ delivered: false, reason: 'provider_error', detail: result.error }, 502);
    }

    await logEvent({
      email, user_id: userId, kind: intent, status: 'sent',
      provider: 'resend', provider_id: result.id || null, ip
    });
    if (intent === 'welcome') {
      try {
        await rest(`profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            welcome_email_status: 'sent',
            welcome_email_id: result.id || null,
            welcome_email_at: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error('profile welcome stamp failed', error.message);
      }
    }

    return json({ delivered: true, provider: 'resend', id: result.id || null, to: email, kind: intent });
  } catch (error) {
    console.error('eltes-mail', error);
    return json({ delivered: false, reason: 'server_error', detail: error.message.slice(0, 200) }, 500);
  }
}

Deno.serve(handle);
