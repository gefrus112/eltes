'use strict';

const { bodyJson, json } = require('../lib/http.cjs');

const ACCESS_COOKIE = 'eltes_auth_access';
const REFRESH_COOKIE = 'eltes_auth_refresh';
const ACCESS_MAX_AGE = 60 * 60;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;
const MAX_PASSWORD_LENGTH = 1024;
const DEFAULT_SUPABASE_URL = 'https://odemzfpgercjitrrdlvk.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Cibcmscgz4asLmS2wessmA_p07xhye5';

function config() {
  const url = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY);
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Supabase URL is not configured correctly.'); }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('Supabase URL must use HTTPS.');
  }
  if (!key || /[\r\n]/.test(key)) throw new Error('Supabase publishable key is not configured.');
  return { url, key };
}

function cookies(req) {
  const result = Object.create(null);
  for (const item of String(req.headers.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const name = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

function secureRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || !!(req.socket && req.socket.encrypted);
}

function appendCookies(res, values) {
  const existing = res.getHeader ? res.getHeader('Set-Cookie') : null;
  const prior = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader('Set-Cookie', prior.concat(values));
}

function cookieLine(name, value, req, maxAge) {
  const bits = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secureRequest(req)) bits.push('Secure');
  return bits.join('; ');
}

function setSessionCookies(req, res, session) {
  appendCookies(res, [
    cookieLine(ACCESS_COOKIE, encodeURIComponent(session.access_token), req, Math.min(Number(session.expires_in) || ACCESS_MAX_AGE, ACCESS_MAX_AGE)),
    cookieLine(REFRESH_COOKIE, encodeURIComponent(session.refresh_token), req, REFRESH_MAX_AGE)
  ]);
}

function clearSessionCookies(req, res) {
  appendCookies(res, [cookieLine(ACCESS_COOKIE, '', req, 0), cookieLine(REFRESH_COOKIE, '', req, 0)]);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = forwardedProto || (req.socket && req.socket.encrypted ? 'https' : 'http');
  try {
    const parsed = new URL(origin);
    return parsed.origin === `${proto}://${host}`.toLowerCase();
  } catch { return false; }
}

function safeUser(user, profile) {
  if (!user || typeof user !== 'object' || !user.id || !profile) return null;
  return {
    id: String(user.id),
    name: String(profile.display_name || user.email || 'Eltes user').trim().slice(0, 60),
    email: String(user.email || '').slice(0, 254),
    username: '',
    provider: 'supabase',
    avatarUrl: '',
    bio: '',
    createdAt: Date.parse(user.created_at) || Date.now(),
    plan: 'byok'
  };
}

function supabaseRequest(path, key, options = {}) {
  const { url } = config();
  return fetch(`${url}/auth/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      'content-type': 'application/json',
      ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: 'no-store',
    redirect: 'error'
  });
}

async function readUpstream(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data.msg || data.message || data.error_description || data.error || 'Authentication request failed.'));
    error.status = response.status;
    throw error;
  }
  return data;
}

async function profileRequest(path, key, accessToken, options = {}) {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...(options.prefer ? { prefer: options.prefer } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: 'no-store',
    redirect: 'error'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Could not read the Eltes profile from Supabase.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function ensureProfile(user, key, accessToken) {
  if (!user || !user.id || !accessToken) throw new Error('Supabase returned an incomplete account.');
  const query = `eltes_profiles?select=user_id,display_name,created_at&user_id=eq.${encodeURIComponent(user.id)}&limit=1`;
  const rows = await profileRequest(query, key, accessToken);
  if (Array.isArray(rows) && rows[0]) return rows[0];

  const metadata = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const fromEmail = String(user.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  let displayName = String(metadata.display_name || fromEmail || 'Eltes user').trim().slice(0, 60);
  if (displayName.length < 2) displayName = 'Eltes user';
  try {
    const created = await profileRequest('eltes_profiles', key, accessToken, {
      method: 'POST', prefer: 'return=representation', body: { user_id: user.id, display_name: displayName }
    });
    if (Array.isArray(created) && created[0]) return created[0];
  } catch (error) {
    // Another tab may have completed first sign-in at the same time.
    if (error.status !== 409) throw error;
  }
  const retry = await profileRequest(query, key, accessToken);
  if (Array.isArray(retry) && retry[0]) return retry[0];
  throw new Error('The Supabase account exists, but its Eltes profile could not be created. Please retry.');
}

async function getUserSession(req, res, key) {
  const stored = cookies(req);
  let accessToken = '';
  let refreshToken = '';
  try {
    accessToken = decodeURIComponent(stored[ACCESS_COOKIE] || '');
    refreshToken = decodeURIComponent(stored[REFRESH_COOKIE] || '');
  } catch { return null; }
  if (!accessToken && !refreshToken) return null;

  if (accessToken) {
    try {
      const user = await readUpstream(await supabaseRequest('/user', key, { accessToken }));
      const profile = await ensureProfile(user, key, accessToken);
      return { user, accessToken, profile };
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) throw error;
    }
  }
  if (!refreshToken) {
    clearSessionCookies(req, res);
    return null;
  }

  try {
    const session = await readUpstream(await supabaseRequest('/token?grant_type=refresh_token', key, {
      method: 'POST', body: { refresh_token: refreshToken }
    }));
    if (!session.access_token || !session.refresh_token || !session.user) throw new Error('Supabase returned an incomplete session.');
    const profile = await ensureProfile(session.user, key, session.access_token);
    setSessionCookies(req, res, session);
    return { user: session.user, accessToken: session.access_token, profile };
  } catch (error) {
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      clearSessionCookies(req, res);
      return null;
    }
    throw error;
  }
}

function authError(error, action) {
  if (error.status === 429) return { status: 429, message: 'Too many attempts. Wait a little and try again.' };
  if (action === 'signup' && (error.status === 400 || error.status === 422)) {
    return { status: 400, message: 'Could not create the account. Check the details or try signing in if you already registered.' };
  }
  if (action === 'signin' && (error.status === 400 || error.status === 401 || error.status === 403)) {
    return { status: 401, message: 'Email or password was not accepted.' };
  }
  if (error.status === 422) return { status: 400, message: 'The profile details were not accepted.' };
  return { status: error.status && error.status < 500 ? error.status : 502, message: 'Supabase authentication is temporarily unavailable. Please retry.' };
}

module.exports = async function auth(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url || '/api/auth', 'http://localhost');
  const action = url.searchParams.get('action') || '';
  const mutation = req.method !== 'GET';
  if (mutation && !sameOrigin(req)) return json(res, 403, { error: 'This account request must come from Eltes on the same origin.' });

  let supabase;
  try { supabase = config(); }
  catch { return json(res, 503, { error: 'Supabase Auth is not configured for this deployment.' }); }

  if (req.method === 'GET' && action === 'session') {
    try {
      const session = await getUserSession(req, res, supabase.key);
      return json(res, 200, { user: session ? safeUser(session.user, session.profile) : null });
    } catch {
      return json(res, 502, { error: 'Could not check the Supabase session. Please retry.' });
    }
  }

  if (req.method === 'POST' && action === 'signup') {
    let body;
    try { body = await bodyJson(req); }
    catch { return json(res, 400, { error: 'Request JSON is invalid.' }); }
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(res, 400, { error: 'Enter a valid email address.' });
    if (name.length < 2 || name.length > 60) return json(res, 400, { error: 'Display name must be between 2 and 60 characters.' });
    if (password.length < 12 || password.length > MAX_PASSWORD_LENGTH) return json(res, 400, { error: 'Use a password between 12 and 1024 characters.' });
    try {
      const data = await readUpstream(await supabaseRequest('/signup', supabase.key, {
        method: 'POST', body: { email, password, data: { display_name: name } }
      }));
      if (!data.access_token || !data.refresh_token) {
        return json(res, 200, { confirmationRequired: true, user: null });
      }
      const profile = await ensureProfile(data.user, supabase.key, data.access_token);
      setSessionCookies(req, res, data);
      return json(res, 200, { confirmationRequired: false, user: safeUser(data.user, profile) });
    } catch (error) {
      const mapped = authError(error, 'signup');
      return json(res, mapped.status, { error: mapped.message });
    }
  }

  if (req.method === 'POST' && action === 'signin') {
    let body;
    try { body = await bodyJson(req); }
    catch { return json(res, 400, { error: 'Request JSON is invalid.' }); }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254 || !password || password.length > MAX_PASSWORD_LENGTH) {
      return json(res, 400, { error: 'Enter your email and password.' });
    }
    try {
      const session = await readUpstream(await supabaseRequest('/token?grant_type=password', supabase.key, {
        method: 'POST', body: { email, password }
      }));
      if (!session.access_token || !session.refresh_token || !session.user) throw new Error('Supabase returned an incomplete session.');
      const profile = await ensureProfile(session.user, supabase.key, session.access_token);
      setSessionCookies(req, res, session);
      return json(res, 200, { user: safeUser(session.user, profile) });
    } catch (error) {
      const mapped = authError(error, 'signin');
      return json(res, mapped.status, { error: mapped.message });
    }
  }

  if (req.method === 'POST' && action === 'profile') {
    let body;
    try { body = await bodyJson(req); }
    catch { return json(res, 400, { error: 'Request JSON is invalid.' }); }
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 60) return json(res, 400, { error: 'Display name must be between 2 and 60 characters.' });
    try {
      const session = await getUserSession(req, res, supabase.key);
      if (!session) return json(res, 401, { error: 'Sign in to update your account.' });
      const rows = await profileRequest(`eltes_profiles?user_id=eq.${encodeURIComponent(session.user.id)}`, supabase.key, session.accessToken, {
        method: 'PATCH', prefer: 'return=representation', body: { display_name: name, updated_at: new Date().toISOString() }
      });
      const profile = Array.isArray(rows) ? rows[0] : null;
      if (!profile) return json(res, 404, { error: 'Could not find your Eltes profile. Sign out and sign in again.' });
      return json(res, 200, { user: safeUser(session.user, profile) });
    } catch (error) {
      const mapped = authError(error, 'profile');
      return json(res, mapped.status, { error: mapped.message });
    }
  }

  if (req.method === 'POST' && action === 'signout') {
    const stored = cookies(req);
    let accessToken = '';
    try { accessToken = decodeURIComponent(stored[ACCESS_COOKIE] || ''); } catch { /* malformed cookie */ }
    clearSessionCookies(req, res);
    if (accessToken) {
      try { await supabaseRequest('/logout', supabase.key, { method: 'POST', accessToken }); } catch { /* Local cookies are still revoked. */ }
    }
    return json(res, 200, { signedOut: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return json(res, 404, { error: 'Unknown account action.' });
};
