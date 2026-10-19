/* Eltes — account page behaviour
   Local-first profile creation plus a GitHub path that upgrades to real OAuth
   when window.ELTES_CONFIG.authEndpoint is present. No credentials are faked. */
(function () {
  'use strict';

  const Account = window.EltesAccount;
  const I = window.EltesIcons;
  if (!Account) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ic = (n, size = 14) => I.icon(n, { size });
  const params = new URLSearchParams(location.search);
  const config = window.ELTES_CONFIG || {};
  const nextUrl = sanitizeNext(params.get('next'));

  const els = {
    card: $('.auth-card'),
    flow: $('#authFlow'),
    form: $('#authForm'),
    tabs: $$('.auth-tabs [data-mode]'),
    title: $('#authTitle'),
    sub: $('#authSub'),
    nameField: $('#nameField'),
    nameInput: $('#nameInput'),
    emailInput: $('#emailInput'),
    handleField: $('#handleField'),
    handleInput: $('#handleInput'),
    submit: $('#submitBtn'),
    submitLabel: $('#submitLabel'),
    error: $('#authError'),
    errorText: $('#authErrorText'),
    github: $('#githubBtn'),
    ghFlow: $('#ghFlow'),
    ghHandle: $('#ghHandle'),
    ghErr: $('#ghErr'),
    ghWrap: $('#ghWrap'),
    ghConnect: $('#ghConnect'),
    ghCancel: $('#ghCancel'),
    signedIn: $('#signedIn'),
    siAvatar: $('#siAvatar'),
    siName: $('#siName'),
    siEmail: $('#siEmail'),
    siProvider: $('#siProvider'),
    siId: $('#siId'),
    siCreated: $('#siCreated'),
    siContinue: $('#siContinue'),
    toastStack: $('#toastStack')
  };

  let mode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  let ghOpen = false;

  function sanitizeNext(value) {
    if (!value) return 'app.html';
    // only same-site, relative targets
    if (/^[a-z]+:/i.test(value) || value.startsWith('//') || value.startsWith('/')) return 'app.html';
    return value;
  }

  function toast(message, icon = 'check') {
    if (!els.toastStack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${ic(icon, 15)}<span>${escapeHtml(message)}</span>`;
    els.toastStack.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, 2800);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setFieldState(input, valid, message) {
    const fld = input.closest('.fld');
    if (!fld) return;
    fld.classList.toggle('valid', !!valid);
    fld.classList.toggle('invalid', valid === false);
    const err = fld.querySelector('.fld-err');
    if (err) err.textContent = valid === false ? message || err.textContent || 'Check this field.' : '';
  }

  function clearErrors() {
    els.error.hidden = true;
    $$('.fld').forEach((f) => f.classList.remove('invalid', 'valid'));
    $$('.fld-err').forEach((e) => { e.textContent = ''; });
  }

  function showError(text) {
    els.errorText.textContent = text;
    els.error.hidden = false;
  }

  function emailValid(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function handleValid(value) {
    return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(value);
  }

  /* ------------------------------- mode switch ---------------------------- */

  function setMode(next, push) {
    mode = next === 'signup' ? 'signup' : 'signin';
    if (els.card) els.card.dataset.mode = mode;
    els.tabs.forEach((tab) => {
      const on = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    if (els.title) els.title.textContent = mode === 'signup' ? 'Create your account' : 'Sign in to this browser';
    if (els.sub) {
      els.sub.textContent = mode === 'signup'
        ? 'A local profile. No password, no email sent.'
        : 'Restore your local profile — or create one if this browser has none.';
    }
    if (els.submitLabel) els.submitLabel.textContent = mode === 'signup' ? 'Create account' : 'Continue';
    if (els.nameField) els.nameField.hidden = mode !== 'signup';
    if (els.handleField) els.handleField.hidden = mode !== 'signup';
    if (els.emailInput) els.emailInput.placeholder = mode === 'signup' ? 'ada@example.com' : 'the email for this profile';
    clearErrors();
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('mode', mode);
      history.replaceState({}, '', url.pathname + '?' + url.searchParams.toString() + url.hash);
    }
    const focusEl = mode === 'signup' ? els.nameInput : els.emailInput;
    if (focusEl) setTimeout(() => focusEl.focus(), 60);
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

  /* -------------------------------- live checks --------------------------- */

  els.nameInput.addEventListener('input', () => {
    const value = els.nameInput.value.trim();
    setFieldState(els.nameInput, value.length >= 2, 'Use at least two characters.');
  });
  els.emailInput.addEventListener('input', () => {
    const value = els.emailInput.value.trim();
    setFieldState(els.emailInput, emailValid(value), 'Use a valid email address.');
  });
  els.handleInput.addEventListener('input', () => {
    const value = els.handleInput.value.replace(/^@/, '').trim();
    setFieldState(els.handleInput, !value || handleValid(value), 'Letters, numbers and single hyphens only.');
  });
  els.ghHandle.addEventListener('input', () => {
    const value = els.ghHandle.value.replace(/^@/, '').trim();
    els.ghWrap.parentElement.classList.toggle('invalid', !!value && !handleValid(value));
    els.ghErr.textContent = value && !handleValid(value) ? 'GitHub usernames use letters, numbers and single hyphens.' : '';
  });

  /* --------------------------------- submit ------------------------------- */

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();

    const name = els.nameInput.value.trim();
    const email = els.emailInput.value.trim();
    const handle = mode === 'signup' ? els.handleInput.value.replace(/^@/, '').trim() : '';
    let firstInvalid = null;

    if (mode === 'signup') {
      if (name.length < 2) {
        setFieldState(els.nameInput, false, 'Use at least two characters.');
        firstInvalid = firstInvalid || els.nameInput;
      } else setFieldState(els.nameInput, true);

      if (handle && !handleValid(handle)) {
        setFieldState(els.handleInput, false, 'Letters, numbers and single hyphens only.');
        firstInvalid = firstInvalid || els.handleInput;
      }
    }

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

    if (mode === 'signin') {
      if (existing) {
        if (!existing.email) {
          existing.email = email;
          Account.create(existing);
        }
        renderSignedIn(Account.get());
        toast('Welcome back — local profile restored', 'user-check');
        return;
      }
      // no server: a local sign-in cannot verify anything, so create the profile it refers to
      const derived = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      createProfile({ name: derived || 'Eltes user', email, username: '', provider: 'local' }, 'Local profile created for this browser');
      return;
    }

    createProfile({
      name,
      email,
      username: handle,
      provider: handle ? 'github' : 'local'
    }, 'Account created — stored in this browser');
  });

  function createProfile(data, message) {
    const account = Account.create(data);
    toast(message, 'check');
    renderSignedIn(account);
  }

  /* -------------------------------- GitHub -------------------------------- */

  function startGithub() {
    if (config.authEndpoint) {
      const base = String(config.authEndpoint).replace(/\/+$/, '');
      const back = new URL(location.href);
      back.searchParams.set('mode', 'signup');
      back.searchParams.delete('method');
      location.href = `${base}/github/start?return=${encodeURIComponent(back.toString())}`;
      return;
    }
    ghOpen = true;
    els.flow.hidden = true;
    els.signedIn.hidden = true;
    els.ghFlow.hidden = false;
    setTimeout(() => els.ghHandle.focus(), 80);
    const url = new URL(location.href);
    url.searchParams.set('method', 'github');
    history.replaceState({}, '', url.pathname + '?' + url.searchParams.toString());
  }

  function closeGithub() {
    ghOpen = false;
    els.ghFlow.hidden = true;
    els.flow.hidden = false;
    const url = new URL(location.href);
    url.searchParams.delete('method');
    history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  }

  els.github.addEventListener('click', startGithub);
  els.ghCancel.addEventListener('click', closeGithub);

  els.ghConnect.addEventListener('click', () => {
    const handle = els.ghHandle.value.replace(/^@/, '').trim();
    if (!handleValid(handle)) {
      els.ghWrap.parentElement.classList.add('invalid');
      els.ghErr.textContent = 'Enter a valid GitHub username.';
      els.ghHandle.focus();
      return;
    }
    const account = Account.create({
      name: handle,
      username: handle,
      email: `${handle}@users.noreply.github.com`,
      provider: 'github'
    });
    toast(`GitHub handle @${handle} linked locally`, 'github');
    renderSignedIn(account);
  });

  els.ghHandle.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.ghConnect.click(); });

  /* ------------------------------ signed in ------------------------------- */

  function renderSignedIn(account) {
    const a = account || Account.get();
    if (!a) {
      els.signedIn.hidden = true;
      els.flow.hidden = false;
      return;
    }
    els.flow.hidden = true;
    els.ghFlow.hidden = true;
    els.signedIn.hidden = false;
    const avatarEl = $('#siAvatar');
    if (avatarEl) avatarEl.outerHTML = Account.avatarHtml(a, 'lg').replace('class="avatar lg"', 'class="avatar lg" id="siAvatar"');
    els.siName.textContent = a.name;
    els.siEmail.textContent = a.email || (a.username ? '@' + a.username : 'Local profile');
    els.siProvider.innerHTML = `<i></i>${a.provider === 'github' ? 'GitHub · local link' : 'Local profile'}`;
    els.siId.textContent = a.id;
    els.siCreated.textContent = new Date(a.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    els.siContinue.setAttribute('href', nextUrl);
    I.hydrate(els.signedIn);
  }

  $('#siSignOut').addEventListener('click', () => {
    Account.signOut();
    els.signedIn.hidden = true;
    els.flow.hidden = false;
    toast('Signed out — chats and keys are untouched', 'log-out');
    setMode('signin', true);
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
    toast('Profile deleted from this browser', 'trash-2');
    setMode('signup', true);
  });

  /* --------------------------------- boot --------------------------------- */

  setMode(mode, false);
  I.hydrate(document);

  // Hosted OAuth callback contract: the backend returns ?account=<base64url JSON>
  const returned = params.get('account');
  if (returned) {
    try {
      const padded = returned.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((returned.length + 3) % 4);
      const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const profile = JSON.parse(new TextDecoder().decode(bytes));
      if (profile && (profile.name || profile.username)) {
        const account = Account.create({
          name: profile.name || profile.username,
          email: profile.email || '',
          username: profile.username || '',
          provider: 'github',
          avatarUrl: profile.avatarUrl || ''
        });
        toast('Signed in with GitHub', 'github');
        renderSignedIn(account);
        const clean = new URL(location.href);
        clean.searchParams.delete('account');
        clean.searchParams.delete('method');
        history.replaceState({}, '', clean.pathname + (clean.searchParams.toString() ? '?' + clean.searchParams.toString() : ''));
      } else {
        showError('The GitHub callback did not include a usable profile.');
      }
    } catch (e) {
      showError('Could not read the GitHub callback. Try signing in again.');
    }
  } else {
    renderSignedIn(Account.get());
  }

  if (params.get('method') === 'github') {
    setTimeout(startGithub, 140);
  }
  if (params.get('github') === 'error') {
    showError('GitHub sign-in did not complete. Try again, or use a local profile.');
    setMode('signin', false);
  }

  // Keyboard shortcut from the marketing site
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ghOpen) closeGithub();
  });
})();
