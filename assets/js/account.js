/* Eltes — Supabase Auth account session
   Passwords are handled by Supabase Auth. Session tokens are held in HttpOnly,
   same-site cookies by /api/auth; this module keeps only a display profile in memory. */
window.EltesAccount = (function () {
  'use strict';

  let current = null;
  let loading = null;
  let lastError = '';
  let loaded = false;

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'EL';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function normalize(profile) {
    if (!profile || typeof profile !== 'object' || !profile.id) return null;
    return {
      id: String(profile.id),
      name: String(profile.name || profile.user_metadata?.display_name || profile.email || 'Eltes user').trim().slice(0, 60),
      email: String(profile.email || '').slice(0, 254),
      username: '',
      provider: 'supabase',
      avatarUrl: safeAvatar(profile.avatarUrl || profile.user_metadata?.avatar_url),
      bio: String(profile.bio || profile.user_metadata?.bio || '').slice(0, 240),
      createdAt: Number(profile.createdAt) || Date.parse(profile.created_at) || Date.now(),
      plan: 'byok'
    };
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('eltes:account', { detail: current }));
  }

  async function request(action, method = 'GET', body) {
    let response;
    try {
      response = await fetch(`/api/auth?action=${encodeURIComponent(action)}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch {
      throw new Error('Account service is unreachable. Use the Eltes Vercel deployment or start the configured local server.');
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        throw new Error('Real accounts need the Eltes API backend. GitHub Pages alone cannot host account sign-in.');
      }
      throw new Error(String(result.error || 'Account request failed. Please retry.'));
    }
    return result;
  }

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const result = await request('session');
        current = normalize(result.user);
        lastError = '';
        loaded = true;
        emit();
        return current;
      } catch (error) {
        current = null;
        lastError = error.message || 'Could not check your account session.';
        loaded = true;
        emit();
        return null;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function signUp({ name, email, password }) {
    const result = await request('signup', 'POST', { name, email, password });
    current = normalize(result.user);
    lastError = '';
    loaded = true;
    emit();
    return { account: current, confirmationRequired: !!result.confirmationRequired };
  }

  async function signIn({ email, password }) {
    const result = await request('signin', 'POST', { email, password });
    current = normalize(result.user);
    lastError = '';
    loaded = true;
    emit();
    return current;
  }

  async function create(data) {
    const account = current;
    if (!account) throw new Error('Sign in to update your Supabase account.');
    const result = await request('profile', 'POST', { name: data && data.name || account.name });
    current = normalize(result.user);
    lastError = '';
    emit();
    return current;
  }

  async function signOut() {
    let completed = false;
    try { await request('signout', 'POST', {}); completed = true; }
    catch (error) { lastError = error.message || 'Could not revoke the server session.'; }
    current = null;
    loaded = true;
    emit();
    return completed;
  }

  function safeAvatar(value) {
    const url = String(value || '').trim();
    if (/^https:\/\//i.test(url)) return url.slice(0, 2048);
    return '';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function avatarHtml(account, size, extraClass) {
    const a = account || current;
    if (!a) return '';
    const cls = `avatar ${size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : ''} ${extraClass || ''}`.trim();
    const safeUrl = safeAvatar(a.avatarUrl);
    if (safeUrl) return `<span class="${cls}"><img src="${esc(safeUrl)}" alt="" referrerpolicy="no-referrer" /></span>`;
    return `<span class="${cls}" aria-hidden="true">${esc(initials(a.name))}</span>`;
  }

  function get() { return current; }
  function isSignedIn() { return !!current; }
  function getError() { return lastError; }
  function isLoaded() { return loaded; }

  // Discard the old, unauthenticated local profile. Chats, settings, and provider
  // keys remain local; this key was never proof of identity.
  try { localStorage.removeItem('eltes.account.v1'); } catch { /* storage may be unavailable */ }
  void load();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void load();
  });

  return { get, load, signUp, signIn, create, signOut, initials, avatarHtml, isSignedIn, safeAvatar, getError, isLoaded };
})();
