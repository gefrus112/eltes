/* Eltes — Supabase-backed account sign-up and sign-in. */
(function () {
  'use strict';

  const Account = window.EltesAccount;
  if (!Account) return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const allowedNext = /^(?:app|index|docs|video)\.html(?:[?#][^\s]*)?$/;
  const requestedNext = params.get('next') || 'app.html';
  const nextUrl = allowedNext.test(requestedNext) && !requestedNext.includes('..') ? requestedNext : 'app.html';
  const els = {
    flow: $('#authFlow'), form: $('#authForm'), tabs: Array.from(document.querySelectorAll('.auth-tabs [data-mode]')),
    title: $('#authTitle'), sub: $('#authSub'), nameField: $('#nameField'), name: $('#nameInput'), email: $('#emailInput'),
    password: $('#passwordInput'), passwordHint: $('#passwordHint'), submit: $('#submitBtn'), submitLabel: $('#submitLabel'),
    error: $('#authError'), errorText: $('#authErrorText'), notice: $('#authNotice'), backendNote: $('#authBackendNote'),
    signedIn: $('#signedIn'), avatar: $('#siAvatar'), userName: $('#siName'), userEmail: $('#siEmail'), userId: $('#siId'),
    created: $('#siCreated'), continue: $('#siContinue'), signOut: $('#siSignOut')
  };
  let mode = params.get('mode') === 'signin' ? 'signin' : 'signup';
  let busy = false;
  let hadSession = !!Account.get();

  function showError(message) {
    els.errorText.textContent = message;
    els.error.hidden = false;
    els.notice.hidden = true;
  }
  function showNotice(message) {
    els.notice.textContent = message;
    els.notice.hidden = false;
    els.error.hidden = true;
  }
  function setMode(next, updateUrl = true) {
    mode = next === 'signin' ? 'signin' : 'signup';
    els.tabs.forEach((tab) => {
      const selected = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    els.title.textContent = mode === 'signup' ? 'Create your account' : 'Sign in to Eltes';
    els.sub.textContent = mode === 'signup' ? 'Sign up securely with Supabase Auth.' : 'Use your Supabase account email and password.';
    els.nameField.hidden = mode !== 'signup';
    els.name.required = mode === 'signup';
    els.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    els.password.minLength = mode === 'signup' ? 12 : 1;
    els.passwordHint.textContent = mode === 'signup' ? 'At least 12 characters' : '';
    els.submitLabel.textContent = mode === 'signup' ? 'Create secure account' : 'Sign in securely';
    els.error.hidden = true;
    els.notice.hidden = true;
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('mode', mode);
      history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
    }
  }

  function renderSignedIn(account) {
    if (!account) {
      els.signedIn.hidden = true;
      els.flow.hidden = false;
      return;
    }
    els.flow.hidden = true;
    els.signedIn.hidden = false;
    els.avatar.textContent = Account.initials(account.name);
    els.userName.textContent = account.name;
    els.userEmail.textContent = account.email;
    els.userId.textContent = account.id;
    els.created.textContent = new Date(account.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    els.continue.href = nextUrl;
  }

  function setBusy(value) {
    busy = value;
    els.submit.disabled = value;
    els.submitLabel.textContent = value ? (mode === 'signup' ? 'Creating account…' : 'Signing in…') : (mode === 'signup' ? 'Create secure account' : 'Sign in securely');
  }

  els.tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
  els.email.addEventListener('input', () => { els.error.hidden = true; });
  els.password.addEventListener('input', () => { els.error.hidden = true; });
  els.name.addEventListener('input', () => { els.error.hidden = true; });

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const name = els.name.value.trim();
    const email = els.email.value.trim();
    const password = els.password.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError('Enter a valid email address.');
    if (mode === 'signup' && name.length < 2) return showError('Display name must be at least two characters.');
    if (mode === 'signup' && password.length < 12) return showError('Choose a password with at least 12 characters.');
    if (!password) return showError('Enter your password.');

    setBusy(true);
    try {
      if (mode === 'signup') {
        const result = await Account.signUp({ name, email, password });
        if (result.confirmationRequired) {
          setMode('signin', false);
          els.email.value = email;
          showNotice('Account created. Check your email for Supabase’s confirmation message, then sign in here.');
          return;
        }
        renderSignedIn(result.account);
      } else {
        const account = await Account.signIn({ email, password });
        renderSignedIn(account);
      }
      if (nextUrl !== 'app.html') {
        window.location.assign(nextUrl);
      } else {
        showNotice(mode === 'signup' ? 'Your Supabase account is ready.' : 'You are signed in securely.');
      }
    } catch (error) {
      showError(error.message || 'Could not sign in. Please retry.');
    } finally {
      setBusy(false);
    }
  });

  els.signOut.addEventListener('click', async () => {
    els.signOut.disabled = true;
    try {
      const revoked = await Account.signOut();
      renderSignedIn(null);
      setMode('signin');
      showNotice(revoked ? 'Signed out. Your chats and API keys remain on this device.' : 'Signed out on this page, but the server could not confirm cookie revocation. Close the browser tab and retry if needed.');
    } finally {
      els.signOut.disabled = false;
    }
  });

  window.addEventListener('eltes:account', (event) => {
    if (event.detail) {
      hadSession = true;
      renderSignedIn(event.detail);
    } else {
      renderSignedIn(null);
      if (hadSession) setMode('signin', false);
      hadSession = false;
    }
  });
  setMode(mode, false);
  if (Account.get()) renderSignedIn(Account.get());
  Account.load().then((account) => {
    if (account) renderSignedIn(account);
    else if (Account.getError()) {
      els.backendNote.textContent = Account.getError();
      els.backendNote.hidden = false;
    }
  });
})();
