/* ==========================================================================
   Eltes — Resend webhook (Supabase Edge Function, Deno)
   --------------------------------------------------------------------------
   Resend posts delivery events here. Bounces and complaints are written to
   public.suppressed_emails so the mail function stops writing to a dead or
   hostile address. Everything else is logged to public.email_events.

   Plain JavaScript in a .ts file: runs under `deno` unchanged and is evaluated
   by test/supabase.test.cjs with a small Deno shim.

   Security: Resend signs with Svix. Set RESEND_WEBHOOK_SECRET (whsec_…) in
   Edge Function secrets and the signature becomes mandatory. Without it the
   endpoint stays closed unless ELTES_WEBHOOK_TOKEN is set and passed as
   ?token=… — an unsigned endpoint that trusts arbitrary JSON would let anyone
   suppress any address.
   ========================================================================== */

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SVIX_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
const FALLBACK_TOKEN = Deno.env.get('ELTES_WEBHOOK_TOKEN') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function verifySvix(req, raw) {
  if (!SVIX_SECRET) return false;
  const id = req.headers.get('svix-id') || '';
  const timestamp = req.headers.get('svix-timestamp') || '';
  const signatures = req.headers.get('svix-signature') || '';
  if (!id || !timestamp || !signatures) return false;

  // Reject anything older than five minutes so a captured request cannot replay.
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(Date.now() / 1000 - sent) > 300) return false;

  const secret = SVIX_SECRET.startsWith('whsec_') ? SVIX_SECRET.slice(6) : SVIX_SECRET;
  const key = await crypto.subtle.importKey(
    'raw', base64ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  const expected = bytesToBase64(new Uint8Array(mac));

  return signatures.split(' ').some((part) => {
    const value = part.includes(',') ? part.split(',').slice(1).join(',') : part;
    return value.length === expected.length && value === expected;
  });
}

async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`rest ${response.status}: ${text.slice(0, 200)}`);
  }
  return response;
}

function addresses(data) {
  const to = data.to;
  const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : [];
  return list
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value));
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: 'no_backend' }, 500);

  const raw = await req.text();

  if (SVIX_SECRET) {
    if (!(await verifySvix(req, raw))) return json({ ok: false, error: 'bad_signature' }, 401);
  } else {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-eltes-token') || '';
    if (!FALLBACK_TOKEN) return json({ ok: false, error: 'webhook_not_configured' }, 503);
    if (token !== FALLBACK_TOKEN) return json({ ok: false, error: 'bad_token' }, 401);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const type = String(event.type || '');
  const data = event.data || {};
  const recipients = addresses(data);
  const bounce = data.bounce || {};
  const detail = String(bounce.message || bounce.type || event.type || '').slice(0, 300);

  const suppress = type === 'email.bounced' || type === 'email.complained';
  const status = suppress ? 'suppressed'
    : type === 'email.delivered' ? 'sent'
    : 'queued';

  try {
    for (const email of recipients) {
      await rest('email_events', {
        method: 'POST',
        body: JSON.stringify({
          email,
          kind: 'webhook',
          status,
          provider: 'resend',
          provider_id: data.email_id ? String(data.email_id) : null,
          detail: `${type}${detail ? `: ${detail}` : ''}`.slice(0, 400)
        })
      });

      if (suppress) {
        await rest('suppressed_emails?on_conflict=email', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            email,
            reason: type === 'email.bounced' ? 'bounce' : 'complaint',
            detail: `${type}: ${detail}`.slice(0, 300),
            source: 'resend'
          })
        });
      }
    }
    return json({ ok: true, type, recipients: recipients.length, suppressed: suppress });
  } catch (error) {
    console.error('email-webhook', error);
    return json({ ok: false, error: (error && error.message ? error.message : 'failed').slice(0, 200) }, 500);
  }
}

Deno.serve(handle);
