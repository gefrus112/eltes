/* Eltes — local account store
   Profiles live in this browser. When a hosted auth endpoint is configured
   (window.ELTES_CONFIG.authEndpoint) the same shape is filled from a real
   GitHub OAuth session instead. */
window.EltesAccount = (function () {
  'use strict';

  const KEY = 'eltes.account.v1';

  function get() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function save(account) {
    try {
      localStorage.setItem(KEY, JSON.stringify(account));
    } catch (e) {
      /* storage disabled */
    }
    window.dispatchEvent(new CustomEvent('eltes:account', { detail: account }));
    return account;
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'EL';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function create(data) {
    const now = Date.now();
    const name = String(data.name || data.username || 'Eltes user').trim().slice(0, 60);
    const account = {
      id: String(data.id || ('u_' + Math.random().toString(36).slice(2, 10))),
      name,
      email: String(data.email || '').trim().slice(0, 120),
      username: String(data.username || '').replace(/^@/, '').trim().slice(0, 40),
      provider: data.provider || 'local',
      avatarUrl: safeAvatar(data.avatarUrl),
      bio: String(data.bio || '').trim().slice(0, 240),
      createdAt: Number(data.createdAt) || now,
      plan: 'byok'
    };
    return save(account);
  }

  function signOut() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
    window.dispatchEvent(new CustomEvent('eltes:account', { detail: null }));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeAvatar(value) {
    const url = String(value || '').trim();
    if (/^https:\/\//i.test(url)) return url.slice(0, 2048);
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/i.test(url) && url.length <= 2800000) return url;
    return '';
  }

  function avatarHtml(account, size, extraClass) {
    const a = account || get();
    if (!a) return '';
    const cls = `avatar ${size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : ''} ${extraClass || ''}`.trim();
    const safeUrl = safeAvatar(a.avatarUrl);
    if (safeUrl) {
      return `<span class="${cls}"><img src="${esc(safeUrl)}" alt="" referrerpolicy="no-referrer" /></span>`;
    }
    return `<span class="${cls}" aria-hidden="true">${esc(initials(a.name))}</span>`;
  }

  function isSignedIn() {
    return !!get();
  }

  /* Ask the server that served this page to send the welcome email. It is the
     same origin, so a static host simply has no route and we say so. Never
     reports a delivery that did not happen. */
  async function welcome(account, options) {
    const target = account || get();
    const email = (target && target.email) || '';
    if (!email) return { status: 'no-email' };

    const timeout = (options && options.timeout) || 4000;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;

    try {
      const response = await fetch('/api/email/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: (target && target.name) || '' }),
        signal: controller ? controller.signal : undefined,
        keepalive: true
      });
      let data = {};
      try { data = await response.json(); } catch (e) { data = {}; }
      if (data.delivered) return { status: 'sent', provider: data.provider, id: data.id || null };
      if (data.outbox) return { status: 'outbox', file: data.file || '' };
      if (data.suppressed) return { status: 'suppressed', reason: data.reason || '' };
      if (response.status === 404 || response.status === 405 || response.status >= 500) return { status: 'unavailable' };
      return { status: 'error', error: data.error || '' };
    } catch (error) {
      return { status: 'unavailable' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { get, create, signOut, initials, avatarHtml, isSignedIn, safeAvatar, welcome, KEY };
})();
