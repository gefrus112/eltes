/* Eltes — accounts and provider connect (v3)
   Sign up or sign in with OpenAI, Anthropic or DeepSeek. A hosted deployment can
   set window.ELTES_CONFIG.authEndpoint for a real OAuth redirect; on a static copy
   the same panel connects a real provider key, stored in this browser. No session
   is ever invented. */
(function () {
  'use strict';

  const Account = window.EltesAccount;
  const I = window.EltesIcons;
  const M = window.EltesModels;
  if (!Account || !I) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ic = (n, size = 14) => I.icon(n, { size });
  const params = new URLSearchParams(location.search);
  const config = window.ELTES_CONFIG || {};
  const SETTINGS_KEY = 'eltes.settings.v1';
  const PROVIDERS = ['openai', 'anthropic', 'deepseek'];
  const nextUrl = sanitizeNext(params.get('next'));

  const els = {
    flow: $('#authFlow'),
    form: $('#authForm'),
    tabs: $$('.auth-tabs [data-mode]'),
    title: $('#authTitle'),
    sub: $('#authSub'),
    nameField: $('#nameField'),
    nameInput: $('#nameInput'),
    emailInput: $('#emailInput'),
    submit: $('#submitBtn'),
    submitLabel: $('#submitLabel'),
    error: $('#authError'),
    errorText: $('#authErrorText'),
    providerGrid: $('#providerGrid'),
    providerBtns: $$('#providerGrid [data-provider]'),
    pf: $('#providerFlow'),
    pfLogo: $('#pfLogo'),
    pfTitle: $('#pfTitle'),
    pfSub: $('#pfSub'),
    pfMode: $('#pfMode'),
    pfKey: $('#providerKey'),
    pfKeyErr: $('#pfKeyErr'),
    pfKeyLabel: $('#pfKeyLabel'),
    pfReveal: $('#pfReveal'),
    pfKeyLink: $('#pfKeyLink'),
    pfNote: $('#pfNote'),
    pfConnect: $('#pfConnect'),
    pfConnectLabel: $('#pfConnectLabel'),
    pfCancel: $('#pfCancel'),
    pfClose: $('#pfClose'),
    signedIn: $('#signedIn'),
    siAvatar: $('#siAvatar'),
    siName: $('#siName'),
    siEmail: $('#siEmail'),
    siProvider: $('#siProvider'),
    siConnections: $('#siConnections'),
    siId: $('#siId'),
    siCreated: $('#siCreated'),
    siContinue: $('#siContinue'),
    toastStack: $('#toastStack'),
    blocks: $('#authBlocks')
  };

  let mode = params.get('mode') === 'signin' ? 'signin' : 'signup';
  let activeProvider = null;
  let verifying = false;

  /* ------------------------------- storage -------------------------------- */

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeKey(providerId, key) {
    const settings = readSettings();
    settings.keys = settings.keys || {};
    if (key) settings.keys[providerId] = key;
    else delete settings.keys[providerId];
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage off */ }
  }
  function keyFor(providerId) {
    const s = readSettings();
    return (s.keys && s.keys[providerId]) || '';
  }

  /* -------------------------------- helpers ------------------------------- */

  function setUrl(value) {
    try { history.replaceState({}, '', value); } catch (e) { /* file:// or sandboxed history */ }
  }

  function sanitizeNext(value) {
    if (!value) return 'app.html';
    if (/^[a-z]+:/i.test(value) || value.startsWith('//') || value.startsWith('/')) return 'app.html';
    return value;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, icon = 'check') {
    if (!els.toastStack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${ic(icon, 15)}<span>${escapeHtml(message)}</span>`;
    els.toastStack.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, 3200);
  }

  function showError(text) {
    if (!els.error) return;
    els.errorText.textContent = text;
    els.error.hidden = false;
  }

  function clearErrors() {
    if (els.error) els.error.hidden = true;
    $$('.fld').forEach((f) => f.classList.remove('invalid', 'valid'));
    $$('.fld-err').forEach((e) => { e.textContent = ''; });
  }

  function setFieldState(input, valid, message) {
    const fld = input && input.closest('.fld');
    if (!fld) return;
    fld.classList.toggle('valid', !!valid);
    fld.classList.toggle('invalid', valid === false);
    const err = fld.querySelector('.fld-err');
    if (err) err.textContent = valid === false ? message || 'Check this field.' : '';
  }

  function emailValid(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  function providerMeta(id) {
    const p = M.PROVIDERS[id] || {};
    return {
      id,
      name: p.name || id,
      brand: p.brand || id,
      keyUrl: p.keyUrl || '',
      keyHint: p.keyHint || 'API key',
      blurb: p.blurb || ''
    };
  }

  /* ---------------------------- blocks / motion --------------------------- */

  (function blocks() {
    if (!els.blocks) return;
    const specs = [
      [6, 14, 44, 18], [14, 34, 22, -10], [22, 8, 30, 22], [33, 26, 16, 7], [44, 12, 38, -16],
      [55, 30, 20, 11], [64, 9, 34, -22], [73, 24, 24, 16], [84, 13, 40, -8], [92, 33, 18, 20],
      [4, 56, 26, -12], [12, 72, 36, 15], [20, 88, 18, -18], [30, 62, 42, 9], [40, 78, 22, 21],
      [52, 58, 28, -14], [62, 84, 20, 12], [70, 64, 34, -20], [80, 90, 24, 8], [90, 60, 30, -10],
      [8, 40, 16, 14], [26, 44, 28, -9], [46, 40, 18, 17], [66, 46, 32, -13], [86, 44, 22, 10]
    ];
    els.blocks.innerHTML = specs.map(([x, y, s, d], i) =>
      `<span class="ab" style="--x:${x};--y:${y};--s:${s};--d:${d};--r:${((i * 29) % 22) - 11}deg;--delay:${((i * 11) % 70) / 10}s"></span>`
    ).join('');
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    let raf = null;
    const apply = () => {
      raf = null;
      const y = window.scrollY || 0;
      const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
      els.blocks.style.setProperty('--p', String(Math.min(1, y / max)));
      els.blocks.style.setProperty('--sy', String(y));
    };
    window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    apply();
  })();

  /* ------------------------------- mode switch ---------------------------- */

  function setMode(next, push) {
    mode = next === 'signin' ? 'signin' : 'signup';
    els.tabs.forEach((tab) => {
      const on = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    if (els.title) els.title.textContent = mode === 'signup' ? 'Create your account' : 'Sign in to Eltes';
    if (els.sub) {
      els.sub.textContent = mode === 'signup'
        ? 'Connect a provider, or keep a local profile.'
        : 'Restore this browser’s profile and its connections.';
    }
    if (els.submitLabel) els.submitLabel.textContent = mode === 'signup' ? 'Create local profile' : 'Continue';
    if (els.nameField) els.nameField.hidden = mode !== 'signup';
    if (els.emailInput) els.emailInput.placeholder = mode === 'signup' ? 'ada@example.com' : 'the email for this profile';
    clearErrors();
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('mode', mode);
      setUrl(url.pathname + '?' + url.searchParams.toString());
    }
    const focusEl = mode === 'signup' ? els.nameInput : els.emailInput;
    if (focusEl && !activeProvider && els.providerGrid && !els.providerGrid.hidden) setTimeout(() => focusEl.focus(), 60);
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode, true));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = mode === 'signup' ? 'signin' : 'signup';
      setMode(next, true);
      const btn = els.tabs.find((t) => t.dataset.mode === next);
      if (btn) btn.focus();
    });
  });

  /* ---------------------------- provider connect -------------------------- */

  function refreshProviderStates() {
    PROVIDERS.forEach((id) => {
      const has = !!keyFor(id);
      const badge = $(`[data-state-for="${id}"]`);
      if (badge) {
        badge.textContent = has ? 'connected' : 'connect';
        badge.classList.toggle('on', has);
      }
      const btn = $(`#providerGrid [data-provider="${id}"]`);
      if (btn) btn.classList.toggle('connected', has);
    });
  }

  function oauthStart(id) {
    const base = String(config.authEndpoint).replace(/\/+$/, '');
    const back = new URL(location.href);
    back.searchParams.set('provider', id);
    back.searchParams.set('mode', mode);
    back.searchParams.delete('account');
    back.searchParams.delete('provider_error');
    location.href = `${base}/${encodeURIComponent(id)}/start?return=${encodeURIComponent(back.toString())}&mode=${mode}`;
  }

  function openProvider(id) {
    activeProvider = id;
    const meta = providerMeta(id);
    if (!M.PROVIDERS[id] || !PROVIDERS.includes(id)) {
      showError('That provider is not available for accounts yet.');
      return;
    }
    if (config.authEndpoint) {
      oauthStart(id);
      return;
    }

    els.providerGrid.hidden = true;
    els.form.hidden = true;
    els.pf.hidden = false;
    els.pfLogo.dataset.brand = meta.brand;
    els.pfLogo.innerHTML = window.EltesBrandSvg ? window.EltesBrandSvg(meta.brand, 22) : '';
    els.pfTitle.textContent = `Connect ${meta.name}`;
    els.pfSub.textContent = meta.blurb;
    els.pfKeyLabel.textContent = `${meta.name} API key`;
    els.pfKey.placeholder = meta.keyHint;
    els.pfKey.value = keyFor(id);
    els.pfKey.setAttribute('aria-label', `${meta.name} API key`);
    els.pfKey.type = 'password';
    els.pfReveal.innerHTML = ic('eye', 14);
    els.pfReveal.setAttribute('aria-label', 'Show key');
    els.pfKeyLink.href = meta.keyUrl || '#';
    els.pfKeyLink.style.display = meta.keyUrl ? '' : 'none';
    els.pfKeyErr.textContent = '';
    els.pfKey.closest('.fld').classList.remove('invalid', 'valid');
    els.pfMode.innerHTML = '';
    els.pfConnect.disabled = false;
    els.pfConnectLabel.textContent = keyFor(id) ? 'Update connection' : 'Connect account';
    els.pfNote.innerHTML = `Hosted OAuth needs a backend to exchange the code. On this static copy, connecting
      means saving a real <strong>${escapeHtml(meta.name)}</strong> key on this device — Eltes verifies it
      against the provider when the browser is allowed to.`;

    const url = new URL(location.href);
    url.searchParams.set('provider', id);
    url.searchParams.set('mode', mode);
    setUrl(url.pathname + '?' + url.searchParams.toString());

    setTimeout(() => els.pfKey.focus(), 80);
  }

  function closeProvider() {
    activeProvider = null;
    els.pf.hidden = true;
    els.pfKey.value = '';
    els.pfKey.type = 'password';
    const url = new URL(location.href);
    url.searchParams.delete('provider');
    setUrl(url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
    refreshProviderStates();
    if (Account.get()) {
      renderSignedIn(Account.get());
    } else {
      els.providerGrid.hidden = false;
      els.form.hidden = false;
    }
  }

  els.providerBtns.forEach((btn) => btn.addEventListener('click', () => openProvider(btn.dataset.provider)));
  els.pfCancel.addEventListener('click', closeProvider);
  els.pfClose.addEventListener('click', closeProvider);

  els.pfReveal.addEventListener('click', () => {
    const shown = els.pfKey.type === 'text';
    els.pfKey.type = shown ? 'password' : 'text';
    els.pfReveal.setAttribute('aria-label', shown ? 'Hide key' : 'Show key');
    els.pfKey.focus();
  });

  els.pfKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); connectProvider(); } });
  els.pfKey.addEventListener('input', () => {
    els.pfKeyErr.textContent = '';
    els.pfKey.closest('.fld').classList.remove('invalid', 'valid');
  });

  async function verifyKey(id, key) {
    const headers = { 'content-type': 'application/json' };
    let url = '';
    if (id === 'openai') {
      url = 'https://api.openai.com/v1/models';
      headers.authorization = `Bearer ${key}`;
    } else if (id === 'anthropic') {
      url = 'https://api.anthropic.com/v1/models?limit=1';
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (id === 'deepseek') {
      url = 'https://api.deepseek.com/models';
      headers.authorization = `Bearer ${key}`;
    }
    if (!url) return { status: 'skipped' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal, mode: 'cors', credentials: 'omit' });
      if (res.ok) return { status: 'verified' };
      if (res.status === 401 || res.status === 403) return { status: 'rejected', code: res.status };
      return { status: 'unverified', code: res.status };
    } catch (err) {
      return { status: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  function statusLine(kind, text) {
    const map = { ok: 'check', info: 'info', warn: 'triangle-alert', busy: 'loader-circle' };
    els.pfMode.className = `pf-mode ${kind}`;
    els.pfMode.innerHTML = `<span data-icon="${map[kind] || 'info'}" data-icon-size="13"></span><span>${escapeHtml(text)}</span>`;
    I.hydrate(els.pfMode);
  }

  async function connectProvider() {
    if (!activeProvider || verifying) return;
    const id = activeProvider;
    const meta = providerMeta(id);
    const key = els.pfKey.value.trim();

    if (!key) {
      els.pfKey.closest('.fld').classList.add('invalid');
      els.pfKeyErr.textContent = `Paste a ${meta.name} key to connect this account.`;
      els.pfKey.focus();
      return;
    }
    if (key.length < 12 || /\s/.test(key)) {
      els.pfKey.closest('.fld').classList.add('invalid');
      els.pfKeyErr.textContent = 'That does not look like a provider key (it is too short or contains spaces).';
      els.pfKey.focus();
      return;
    }

    verifying = true;
    els.pfConnect.disabled = true;
    statusLine('busy', `Checking this key with ${meta.name}…`);

    const result = await verifyKey(id, key);
    verifying = false;
    els.pfConnect.disabled = false;

    if (result.status === 'rejected') {
      els.pfKey.closest('.fld').classList.add('invalid');
      els.pfKeyErr.textContent = `${meta.name} rejected this key (${result.code}). Nothing was saved.`;
      statusLine('warn', 'The key was not accepted.');
      return;
    }

    writeKey(id, key);
    let account = Account.get();
    if (!account) {
      account = Account.create({
        name: `${meta.name} account`,
        email: '',
        username: '',
        provider: id
      });
    } else if (account.provider === 'local') {
      account = Account.create(Object.assign({}, account, { provider: id }));
    }

    refreshProviderStates();
    closeProvider();
    renderSignedIn(Account.get() || account);

    if (result.status === 'verified') toast(`${meta.name} connected and verified`, 'badge-check');
    else if (result.status === 'unreachable') toast(`${meta.name} key saved — the browser could not verify it (CORS)`, 'shield-check');
    else toast(`${meta.name} key saved on this device`, 'shield-check');
  }

  els.pfConnect.addEventListener('click', connectProvider);

  /* --------------------------------- submit ------------------------------- */

  els.nameInput.addEventListener('input', () => {
    const v = els.nameInput.value.trim();
    setFieldState(els.nameInput, v.length >= 2, 'Use at least two characters.');
  });
  els.emailInput.addEventListener('input', () => {
    const v = els.emailInput.value.trim();
    setFieldState(els.emailInput, emailValid(v), 'Use a valid email address.');
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    const name = els.nameInput.value.trim();
    const email = els.emailInput.value.trim();
    let firstInvalid = null;

    if (mode === 'signup' && name.length < 2) {
      setFieldState(els.nameInput, false, 'Use at least two characters.');
      firstInvalid = firstInvalid || els.nameInput;
    } else if (mode === 'signup') setFieldState(els.nameInput, true);

    if (!emailValid(email)) {
      setFieldState(els.emailInput, false, 'Use a valid email address.');
      firstInvalid = firstInvalid || els.emailInput;
    } else setFieldState(els.emailInput, true);

    if (firstInvalid) {
      showError(mode === 'signup' ? 'Check the highlighted fields to continue.' : 'Enter the email for this profile.');
      firstInvalid.focus();
      return;
    }

    const existing = Account.get();
    if (mode === 'signin' && existing) {
      const updated = Object.assign({}, existing, { email: existing.email || email });
      Account.create(updated);
      renderSignedIn(Account.get());
      toast('Welcome back — profile restored', 'user-check');
      return;
    }

    const derived = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const account = Account.create({
      name: mode === 'signup' ? name : (derived || 'Eltes user'),
      email,
      username: '',
      provider: 'local'
    });
    toast(mode === 'signup' ? 'Profile created in this browser' : 'Local profile created', 'check');
    renderSignedIn(account);
  });

  /* ------------------------------ signed in ------------------------------- */

  function connectionHtml(id) {
    const meta = providerMeta(id);
    const key = keyFor(id);
    const connected = !!key;
    return `<div class="conn${connected ? ' on' : ''}" data-conn="${id}">
      <span class="conn-logo" data-brand="${meta.brand}" data-brand-size="18"></span>
      <div class="conn-text">
        <strong>${escapeHtml(meta.name)}</strong>
        <span>${connected ? `Key saved${key ? ' · ends ${escapeHtml(key.slice(-4))}' : ''}` : 'Not connected'}</span>
      </div>
      ${connected
        ? `<button type="button" class="btn btn-ghost btn-sm" data-manage="${id}">Manage</button>
           <button type="button" class="conn-x" data-disconnect="${id}" aria-label="Disconnect ${escapeHtml(meta.name)}" title="Disconnect">${ic('x', 13)}</button>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-connect-now="${id}">Connect</button>`}
    </div>`;
  }

  function renderSignedIn(account) {
    const a = account || Account.get();
    if (!a) {
      els.signedIn.hidden = true;
      els.flow.hidden = false;
      return;
    }
    els.flow.hidden = true;
    els.signedIn.hidden = false;

    const avatarEl = $('#siAvatar');
    if (avatarEl) avatarEl.outerHTML = Account.avatarHtml(a, 'lg').replace('class="avatar lg"', 'class="avatar lg" id="siAvatar"');
    els.siName.textContent = a.name;
    els.siEmail.textContent = a.email || 'No email — local profile';
    const connected = PROVIDERS.filter((id) => !!keyFor(id));
    els.siProvider.innerHTML = `<i></i>${connected.length
      ? `${connected.length} provider${connected.length === 1 ? '' : 's'}`
      : a.provider === 'local' || !M.PROVIDERS[a.provider] ? 'Local profile' : escapeHtml(providerMeta(a.provider).name)}`;
    els.siId.textContent = a.id;
    els.siCreated.textContent = new Date(a.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    els.siContinue.setAttribute('href', nextUrl);

    els.siConnections.innerHTML = PROVIDERS.map(connectionHtml).join('') + `
      <div class="conn local">
        <span class="conn-logo" data-brand="eltes" data-brand-size="18"></span>
        <div class="conn-text"><strong>Eltes CAI</strong><span>On-device model · always available</span></div>
        <span class="key-status ok"><i></i>ready</span>
      </div>`;

    $$('.conn-logo', els.siConnections).forEach((el) => {
      el.innerHTML = window.EltesBrandSvg ? window.EltesBrandSvg(el.dataset.brand, 18) : '';
    });
    I.hydrate(els.signedIn);
  }

  els.siConnections.addEventListener('click', (e) => {
    const manage = e.target.closest('[data-manage]');
    const connect = e.target.closest('[data-connect-now]');
    const disconnect = e.target.closest('[data-disconnect]');
    if (manage || connect) {
      els.signedIn.hidden = true;
      els.flow.hidden = false;
      els.providerGrid.hidden = false;
      els.form.hidden = false;
      openProvider((manage || connect).dataset.manage || (manage || connect).dataset.connectNow);
      return;
    }
    if (disconnect) {
      const id = disconnect.dataset.disconnect;
      if (disconnect.dataset.armed !== '1') {
        disconnect.dataset.armed = '1';
        disconnect.innerHTML = ic('trash-2', 12);
        disconnect.setAttribute('aria-label', `Click again to disconnect ${providerMeta(id).name}`);
        setTimeout(() => {
          if (disconnect.dataset.armed === '1') {
            disconnect.dataset.armed = '0';
            disconnect.innerHTML = ic('x', 13);
          }
        }, 3500);
        return;
      }
      writeKey(id, '');
      toast(`${providerMeta(id).name} disconnected — the key was removed`, 'log-out');
      renderSignedIn(Account.get());
    }
  });

  $('#siSignOut').addEventListener('click', () => {
    Account.signOut();
    els.signedIn.hidden = true;
    els.flow.hidden = false;
    els.providerGrid.hidden = false;
    els.form.hidden = false;
    toast('Signed out — chats and keys are untouched', 'log-out');
    setMode('signin', true);
    refreshProviderStates();
  });

  let deleteArmed = false;
  $('#siDelete').addEventListener('click', (e) => {
    if (!deleteArmed) {
      deleteArmed = true;
      e.currentTarget.innerHTML = `${ic('trash-2', 12)}Click again to delete the profile`;
      setTimeout(() => {
        if (!deleteArmed) return;
        deleteArmed = false;
        e.currentTarget.innerHTML = `${ic('trash-2', 12)}Delete this profile`;
      }, 4000);
      return;
    }
    Account.signOut();
    deleteArmed = false;
    e.currentTarget.innerHTML = `${ic('trash-2', 12)}Delete this profile`;
    els.signedIn.hidden = true;
    els.flow.hidden = false;
    els.providerGrid.hidden = false;
    els.form.hidden = false;
    toast('Profile deleted from this browser — provider keys kept', 'trash-2');
    setMode('signup', true);
  });

  /* ------------------------- hosted OAuth callback ------------------------- */

  function decodeProfile(value) {
    const b64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function handleCallback() {
    const raw = params.get('account');
    const denied = params.get('error') || params.get('provider_error');
    if (denied) {
      showError(`The provider did not complete the connection (${denied}). Try again, or connect a key instead.`);
      const url = new URL(location.href);
      url.searchParams.delete('error');
      url.searchParams.delete('provider_error');
      setUrl(url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
      return false;
    }
    if (!raw) return false;
    try {
      const profile = decodeProfile(raw);
      if (profile && (profile.name || profile.email || profile.username)) {
        const account = Account.create({
          name: profile.name || profile.username || 'Eltes user',
          email: profile.email || '',
          username: profile.username || '',
          provider: PROVIDERS.includes(profile.provider) ? profile.provider : 'local',
          avatarUrl: profile.avatarUrl || ''
        });
        toast(`Welcome back, ${account.name.split(' ')[0]}`, 'user-check');
        renderSignedIn(account);
        const url = new URL(location.href);
        url.searchParams.delete('account');
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        setUrl(url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
        return true;
      }
      showError('The OAuth callback did not include a usable profile.');
    } catch (err) {
      showError('Could not read the OAuth profile. Check that the callback encodes base64url JSON.');
    }
    return false;
  }

  /* --------------------------------- boot --------------------------------- */

  setMode(mode, false);
  refreshProviderStates();
  I.hydrate(document);
  $$('#providerGrid .pb-logo, .pl-logo, .conn-logo').forEach((el) => {
    if (el.dataset.brand && window.EltesBrandSvg) el.innerHTML = window.EltesBrandSvg(el.dataset.brand, Number(el.dataset.brandSize || 18));
  });

  // Show an existing profile; an OAuth callback is applied by handleCallback() below.
  if (!params.get('account') && Account.get()) renderSignedIn(Account.get());

  const callbackHandled = handleCallback();

  if (!callbackHandled && params.get('provider')) {
    const id = params.get('provider');
    if (PROVIDERS.includes(id)) {
      if (Account.get()) {
        // a signed-in visitor managing connections
        const a = Account.get();
        renderSignedIn(a);
        els.signedIn.hidden = true;
        els.flow.hidden = false;
      }
      openProvider(id);
    } else {
      const url = new URL(location.href);
      url.searchParams.delete('provider');
      setUrl(url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeProvider) closeProvider();
  });
})();
