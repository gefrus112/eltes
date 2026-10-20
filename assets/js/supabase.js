/* ==========================================================================
   Eltes — cloud accounts (Supabase, no SDK)
   --------------------------------------------------------------------------
   Talks to Supabase Auth over plain HTTPS: sign up, sign in, magic link,
   password reset, sign out and session restore. The publishable key in
   config.js is the only credential that lives here; row-level security and
   the Edge Functions do the rest.

   Everything is optional. With no config.js the site keeps its local profile
   (window.EltesAccount) and the welcome email is sent by a server you run.
   ========================================================================== */
window.EltesCloud = (function () {
  'use strict';

  const config = window.ELTES_CONFIG || {};
  const base = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const key = String(config.supabaseAnonKey || '');
  const functionsPath = String(config.functionsPath || '/functions/v1').replace(/\/+$/, '');
  const mailFunction = String(config.mailFunction || 'eltes-mail');
  const enabled = Boolean(base && key);
  const STORE = 'eltes.cloud.v1';

  let state = null;
  let timer = null;
  let refreshing = null;
  const listeners = new Set();

  /* ------------------------------- storage -------------------------------- */

  function storage() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      const probe = '__eltes_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    } catch (error) {
      return null;
    }
  }

  function persist(next) {
    const store = storage();
    if (!store) return;
    try {
      if (next) store.setItem(STORE, JSON.stringify(next));
      else store.removeItem(STORE);
    } catch (error) {
      /* quota or private mode — the session simply will not survive a reload */
    }
  }

  function emit() {
    try {
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('eltes:cloud', { detail: state }));
      }
    } catch (error) {}
    listeners.forEach((fn) => {
      try { fn(state); } catch (error) {}
    });
  }

  function setState(next) {
    state = next;
    persist(next);
    scheduleRefresh();
    emit();
    return state;
  }

  function readStored() {
    const store = storage();
    if (!store) return null;
    try {
      const raw = store.getItem(STORE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.access_token) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  /* -------------------------------- errors -------------------------------- */

  const MESSAGES = {
    invalid_credentials: 'That email and password do not match an account.',
    email_not_confirmed: 'Check your inbox for the confirmation link, then sign in.',
    user_already_exists: 'That address already has an Eltes account — sign in instead.',
    email_exists: 'That address already has an Eltes account — sign in instead.',
    weak_password: 'Use at least 6 characters for the password.',
    over_email_send_rate_limit: 'Too many messages just now. Wait a minute and try again.',
    over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
    signup_disabled: 'New accounts are closed on this project right now.',
    user_not_found: 'No Eltes account uses that address yet.',
    same_password: 'That is already the current password.',
    validation_failed: 'That email or password is not in a shape Supabase accepts.'
  };

  function friendly(error) {
    if (!error) return 'Something went wrong.';
    const code = String(error.code || '');
    if (MESSAGES[code]) return MESSAGES[code];
    const message = String(error.message || '');
    if (/Invalid login credentials/i.test(message)) return MESSAGES.invalid_credentials;
    if (/Email not confirmed/i.test(message)) return MESSAGES.email_not_confirmed;
    if (/User already registered/i.test(message)) return MESSAGES.user_already_exists;
    if (/Password should be/i.test(message)) return MESSAGES.weak_password;
    if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
    return message ? message.replace(/^Error:\s*/, '').slice(0, 220) : 'Something went wrong.';
  }

  /* -------------------------------- transport ----------------------------- */

  async function request(path, options) {
    const opts = options || {};
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.headers) Object.assign(headers, opts.headers);

    let response;
    try {
      response = await fetch(base + path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      });
    } catch (error) {
      const failure = new Error('Eltes could not reach Supabase. Check the connection and try again.');
      failure.code = 'network';
      throw failure;
    }

    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (error) { data = { raw: text }; }

    if (!response.ok) {
      const failure = new Error(friendly({
        code: data.error_code || data.code || data.error || '',
        message: data.msg || data.message || data.error_description || data.error || ('HTTP ' + response.status)
      }));
      failure.code = data.error_code || data.code || '';
      failure.status = response.status;
      failure.detail = data;
      throw failure;
    }
    return data;
  }

  function sessionFrom(data) {
    if (!data || !data.access_token) return null;
    const expiresIn = Number(data.expires_in) || 3600;
    const absolute = Number(data.expires_at);
    return {
      access_token: String(data.access_token),
      refresh_token: data.refresh_token ? String(data.refresh_token) : null,
      expires_at: absolute && absolute > 1000000000 ? absolute * 1000 : Date.now() + expiresIn * 1000,
      user: data.user || null
    };
  }

  function scheduleRefresh() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!state || !state.refresh_token || typeof setTimeout !== 'function') return;
    const wait = Math.max(15000, Math.min(state.expires_at - Date.now() - 60000, 3600000));
    timer = setTimeout(() => { refresh().catch(() => {}); }, wait);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function absorbHash() {
    if (typeof location === 'undefined' || !location.hash) return null;
    const raw = String(location.hash).replace(/^#/, '');
    if (!raw.includes('access_token=')) return null;
    const params = new URLSearchParams(raw);
    const access = params.get('access_token');
    if (!access) return null;
    const type = params.get('type') || '';
    const expiresIn = Number(params.get('expires_in')) || 3600;
    setState({
      access_token: access,
      refresh_token: params.get('refresh_token') || null,
      expires_at: Date.now() + expiresIn * 1000,
      user: null,
      recovered: type === 'recovery'
    });
    try {
      const clean = location.pathname + (location.search || '');
      if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', clean);
      else location.hash = '';
    } catch (error) {}
    return { type };
  }

  /* --------------------------------- auth --------------------------------- */

  async function signUp(input) {
    if (!enabled) throw new Error('Cloud accounts are not configured.');
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const name = String(input.name || '').trim().slice(0, 60);
    const data = await request('/auth/v1/signup', {
      method: 'POST',
      body: { email, password, data: name ? { display_name: name } : {} }
    });
    const session = sessionFrom(data);
    if (session) {
      if (!session.user && data.user) session.user = data.user;
      setState(session);
      return { ok: true, needsConfirm: false, session, user: session.user };
    }
    return { ok: true, needsConfirm: true, session: null, user: data.user || data };
  }

  async function signIn(input) {
    if (!enabled) throw new Error('Cloud accounts are not configured.');
    const data = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: {
        email: String(input.email || '').trim().toLowerCase(),
        password: String(input.password || '')
      }
    });
    const session = sessionFrom(data);
    if (!session) throw new Error('Supabase returned no session.');
    setState(session);
    return { ok: true, session, user: session.user };
  }

  async function refresh() {
    if (!enabled) return null;
    if (!state || !state.refresh_token) return null;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: { refresh_token: state.refresh_token }
        });
        const session = sessionFrom(data);
        if (!session) return setState(null);
        if (!session.user && state.user) session.user = state.user;
        if (state.recovered) session.recovered = true;
        return setState(session);
      } catch (error) {
        if (error && (error.status === 400 || error.status === 401)) setState(null);
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function restore() {
    if (!enabled) return null;
    const recovered = absorbHash();
    if (state && state.access_token) {
      if (state.expires_at - Date.now() > 60000) return state;
      return refresh();
    }
    const stored = readStored();
    if (!stored) return null;
    state = stored;
    if (stored.expires_at - Date.now() <= 60000 && stored.refresh_token) {
      const next = await refresh();
      if (next) return next;
    }
    scheduleRefresh();
    emit();
    if (recovered) state = Object.assign({}, state, { recovered: recovered.type === 'recovery' });
    return state;
  }

  async function signOut() {
    const token = state && state.access_token;
    setState(null);
    if (!token) return { ok: true };
    try {
      await request('/auth/v1/logout', { method: 'POST', token });
    } catch (error) {
      /* the local session is already gone — that is the part we control */
    }
    return { ok: true };
  }

  async function accessToken() {
    if (!state) return null;
    if (state.expires_at - Date.now() > 60000) return state.access_token;
    const next = await refresh();
    return next ? next.access_token : null;
  }

  async function updatePassword(password) {
    const token = await accessToken();
    if (!token) throw new Error('Sign in again to change the password.');
    const data = await request('/auth/v1/user', {
      method: 'PUT',
      token,
      body: { password: String(password || '') }
    });
    if (state) setState(Object.assign({}, state, { recovered: false, user: data.user || state.user }));
    return { ok: true, user: data.user || null };
  }

  async function profile() {
    const token = await accessToken();
    const user = user();
    if (!token || !user || !user.id) return null;
    try {
      const rows = await request(
        '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=id,display_name,email,plan,created_at,welcome_email_status',
        { token }
      );
      return Array.isArray(rows) ? rows[0] || null : null;
    } catch (error) {
      return null;
    }
  }

  /* --------------------------------- mail --------------------------------- */

  async function callMail(payload) {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    const response = await fetch(base + functionsPath + '/' + mailFunction, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (error) { data = {}; }
    return { status: response.status, data };
  }

  function mailOutcome(result) {
    const data = result.data || {};
    if (data.delivered) return { status: 'sent', provider: data.provider || 'resend', id: data.id || null };
    switch (data.reason) {
      case 'no_mail_provider':
        return { status: 'unconfigured', detail: data.detail || '' };
      case 'suppressed':
        return { status: 'suppressed', detail: data.detail || '' };
      case 'no_account':
        return { status: 'no-account', detail: data.detail || '' };
      case 'already_sent':
        return { status: 'already', sentAt: data.sentAt || '' };
      case 'rate_limited':
        return { status: 'rate-limited', detail: data.detail || '' };
      default:
        return { status: 'error', error: data.detail || data.error || data.reason || ('HTTP ' + result.status) };
    }
  }

  /* Ask the hosted function to send the welcome letter. The answer is what
     actually happened — never an optimistic guess. */
  async function welcome(input) {
    if (!enabled) return { status: 'unavailable' };
    const account = input || {};
    const email = String(account.email || '').trim().toLowerCase();
    if (!email) return { status: 'no-email' };
    try {
      const result = await callMail({
        intent: 'welcome',
        email,
        name: account.name || '',
        userId: account.userId || (user() && user().id) || ''
      });
      return mailOutcome(result);
    } catch (error) {
      return { status: 'unavailable', error: error.message };
    }
  }

  async function magicLink(email) {
    if (!enabled) return { status: 'unavailable' };
    const result = await callMail({ intent: 'magiclink', email: String(email || '').trim().toLowerCase() });
    return mailOutcome(result);
  }

  async function recover(email) {
    if (!enabled) return { status: 'unavailable' };
    const result = await callMail({ intent: 'recovery', email: String(email || '').trim().toLowerCase() });
    return mailOutcome(result);
  }

  async function mailStatus() {
    if (!enabled) return { configured: false, reason: 'no_config' };
    try {
      const response = await fetch(base + functionsPath + '/' + mailFunction + '?status=1', {
        headers: { apikey: key }
      });
      const data = await response.json();
      return { configured: Boolean(data.configured), from: data.from || '', provider: data.provider || '', site: data.site || '' };
    } catch (error) {
      return { configured: false, reason: 'unreachable' };
    }
  }

  /* -------------------------------- public -------------------------------- */

  function user() {
    if (!state) return null;
    if (state.user && state.user.email) return state.user;
    return state.user || null;
  }

  return {
    enabled,
    url: base,
    STORE,
    session: function () { return state; },
    user,
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    restore,
    refresh,
    signUp,
    signIn,
    signOut,
    updatePassword,
    profile,
    welcome,
    magicLink,
    recover,
    mailStatus,
    absorbHash,
    accessToken,
    friendly
  };
})();
