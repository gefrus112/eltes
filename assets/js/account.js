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

  return { get, create, signOut, initials, avatarHtml, isSignedIn, safeAvatar, KEY };
})();
