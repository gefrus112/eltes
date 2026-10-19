/* Eltes — shared marketing behaviour: nav, account chip, reveals, parallax,
   block scatter, brand marks, model wall, waitlist and small forms. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  /* -------------------------------- brand marks --------------------------- */
  function hydrateBrands(root = document) {
    $$('[data-brand]', root).forEach((el) => {
      if (el.dataset.brandReady) return;
      const name = el.dataset.brand;
      const size = Number(el.dataset.brandSize || 18);
      const mono = el.dataset.brandMono === 'true';
      if (window.EltesBrandSvg) el.innerHTML = window.EltesBrandSvg(name, size, { mono });
      el.dataset.brandReady = '1';
      el.setAttribute('aria-hidden', 'true');
    });
  }

  /* ---------------------------------- nav --------------------------------- */
  const nav = $('#nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const toggle = $('#navToggle');
  const menu = $('#mobileMenu');
  if (toggle && menu) {
    const close = () => {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = window.EltesIcons.icon('menu', { size: 20 });
    };
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.innerHTML = window.EltesIcons.icon(open ? 'x' : 'menu', { size: 20 });
    });
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) close();
    });
  }

  /* -------------------------------- account ------------------------------- */
  function renderAccountNav() {
    const box = $('#navAccount');
    const authActions = $('#navAuth');
    if (!box || !window.EltesAccount) return;
    const account = window.EltesAccount.get();
    if (!account) {
      box.hidden = true;
      if (authActions) authActions.hidden = false;
      return;
    }
    box.hidden = false;
    if (authActions) authActions.hidden = true;
    box.innerHTML = `
      <div class="account-wrap" style="position:relative">
        <button class="account-btn" id="accountBtn" aria-haspopup="menu" aria-expanded="false">
          ${window.EltesAccount.avatarHtml(account)}
          <span class="who"><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.email || (account.username ? '@' + account.username : 'local profile'))}</span></span>
          <span data-icon="chevron-down" data-icon-size="13" style="color:var(--text-3)"></span>
        </button>
      </div>`;
    if (window.EltesIcons) window.EltesIcons.hydrate(box);

    const btn = $('#accountBtn', box);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = $('.account-menu', box);
      if (existing) { existing.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      const m = document.createElement('div');
      m.className = 'account-menu';
      m.setAttribute('role', 'menu');
      m.innerHTML = `
        <div class="am-head">
          ${window.EltesAccount.avatarHtml(account, 'sm')}
          <div><strong>${escapeHtml(account.name)}</strong><span>${account.provider === 'local' ? 'Local profile' : (window.EltesModels && window.EltesModels.PROVIDERS[account.provider] ? window.EltesModels.PROVIDERS[account.provider].name : 'Provider')} · BYOK</span></div>
        </div>
        <a href="app.html"><span data-icon="layout-grid" data-icon-size="14"></span>Open workspace</a>
        <a href="auth.html"><span data-icon="user" data-icon-size="14"></span>Account settings</a>
        <a href="index.html#downloads"><span data-icon="download" data-icon-size="14"></span>Downloads</a>
        <a href="index.html#pricing"><span data-icon="gift" data-icon-size="14"></span>Pricing</a>
        <hr />
        <button type="button" id="accountSignOut"><span data-icon="log-out" data-icon-size="14"></span>Sign out</button>`;
      box.appendChild(m);
      if (window.EltesIcons) window.EltesIcons.hydrate(m);
      const off = () => { m.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', off); };
      setTimeout(() => document.addEventListener('click', off), 0);
      $('#accountSignOut', m).addEventListener('click', (ev) => {
        ev.stopPropagation();
        window.EltesAccount.signOut();
        toast('Signed out locally', 'log-out');
      });
    });
  }

  window.addEventListener('eltes:account', renderAccountNav);

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* -------------------------------- reveals ------------------------------- */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && reveals.length && !reduceMotion()) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  /* ------------------------------ card glow ------------------------------- */
  $$('.card, .model-tile').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    });
  });

  /* --------------------------- block scatter ------------------------------ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildBlocks(el) {
    if (el.dataset.blocksReady) return;
    const spec = (el.dataset.blocks || '10x4').split('x');
    const cols = clamp(parseInt(spec[0], 10) || 10, 2, 24);
    const rows = clamp(parseInt(spec[1], 10) || 4, 2, 12);
    const rand = mulberry32(Number(el.dataset.blocksSeed || 3));
    const frag = document.createDocumentFragment();
    const cw = 100 / cols;
    const ch = 100 / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const b = document.createElement('span');
        b.className = 'blk';
        b.style.left = `calc(${c * cw}% + 3px)`;
        b.style.top = `calc(${r * ch}% + 3px)`;
        b.style.width = `calc(${cw}% - 6px)`;
        b.style.height = `calc(${ch}% - 6px)`;
        b.style.setProperty('--dx', `${((rand() * 2 - 1) * (120 + rand() * 220)).toFixed(1)}px`);
        b.style.setProperty('--dy', `${((rand() * 2 - 1) * (80 + rand() * 170)).toFixed(1)}px`);
        b.style.setProperty('--dz', `${(rand() * 140).toFixed(0)}px`);
        b.style.setProperty('--rot', `${((rand() * 2 - 1) * 26).toFixed(1)}deg`);
        b.style.opacity = '';
        frag.appendChild(b);
      }
    }
    el.appendChild(frag);
    el.dataset.blocksReady = '1';
  }

  const blockEls = $$('[data-blocks]');
  blockEls.forEach(buildBlocks);

  const parallaxEls = $$('[data-parallax]');

  let ticking = false;
  function frame() {
    ticking = false;
    const vh = window.innerHeight || 800;

    blockEls.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -160 || rect.top > vh + 160) return;
      // 0 when entering, 0.5 at centre, 1 when leaving
      const t = clamp((vh - rect.top) / (vh + rect.height), 0, 1);
      const assembled = Math.abs(Math.cos(Math.PI * t));
      const p = 0.03 + 0.97 * Math.pow(assembled, 0.85);
      el.style.setProperty('--p', p.toFixed(3));
      el.style.setProperty('--label-o', clamp((p - 0.32) / 0.6, 0, 1).toFixed(3));
    });

    parallaxEls.forEach((el) => {
      const speed = parseFloat(el.dataset.parallax) || 0.12;
      const rect = el.getBoundingClientRect();
      const offset = rect.top + rect.height / 2 - vh / 2;
      const y = -offset * speed;
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }

  if (!reduceMotion()) {
    frame();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  } else {
    blockEls.forEach((el) => {
      el.style.setProperty('--p', '1');
      el.style.setProperty('--label-o', '1');
    });
  }

  /* ------------------------------- model wall ----------------------------- */
  const WALL = [
    {
      brand: 'eltes', name: 'Eltes CAI', meta: 'On-device · no key, no network', local: true,
      models: ['Eltes CAI-1', 'CAI-1 Fast', 'CAI Docs'], href: 'app.html?model=eltes-cai-1'
    },
    {
      provider: 'openai', brand: 'openai', name: 'OpenAI', meta: 'api.openai.com · real-time streaming',
      models: ['ChatGPT Astra', 'GPT‑6 Sol', 'GPT‑6 Luna'], href: 'app.html?model=gpt-6-astra'
    },
    {
      provider: 'anthropic', brand: 'claude', name: 'Anthropic', meta: 'Native Messages API',
      models: ['Claude Sonnet 5.5', 'Claude Opus 5.5', 'Claude Haiku 5.5'], href: 'app.html?model=claude-sonnet-5-5'
    },
    {
      provider: 'deepseek', brand: 'deepseek', name: 'DeepSeek', meta: 'deepseek.com · 1M context',
      models: ['V4.1 Flash', 'V4 Pro'], href: 'app.html?model=deepseek-flash'
    },
    {
      provider: 'google', brand: 'gemini', name: 'Google Gemini', meta: 'OpenAI-compatible endpoint',
      models: ['Gemini 2.5 Pro', 'Gemini 2.5 Flash'], href: 'app.html?model=gemini-2-5-pro'
    },
    {
      provider: 'zai', brand: 'glm', name: 'Z.ai · GLM', meta: 'api.z.ai · tool calling',
      models: ['GLM-4.6', 'GLM-4.5', 'GLM-4.5 Air'], href: 'app.html?model=glm-4-6'
    },
    {
      provider: 'xai', brand: 'grok', name: 'xAI Grok', meta: 'api.x.ai',
      models: ['Grok 4', 'Grok 3'], href: 'app.html?model=grok-4'
    },
    {
      provider: 'qwen', brand: 'qwen', name: 'Qwen · Alibaba', meta: 'Model Studio',
      models: ['Qwen3 Max', 'Qwen3 Coder Plus'], href: 'app.html?model=qwen3-max'
    },
    {
      provider: 'groq', brand: 'llama', name: 'Llama · Meta', meta: 'via Groq or OpenRouter',
      models: ['Llama 3.3 70B', 'Llama 4 Scout'], href: 'app.html?model=llama-3-3-70b'
    },
    {
      provider: 'groq', brand: 'groq', name: 'Groq', meta: 'api.groq.com · Llama + Qwen',
      models: ['Llama 3.3 70B', 'Llama 4 Scout', 'Qwen 3'], href: 'app.html?model=llama-3-3-70b'
    },
    {
      provider: 'mistral', brand: 'mistral', name: 'Mistral', meta: 'api.mistral.ai',
      models: ['Mistral Large', 'Codestral'], href: 'app.html?model=mistral-large'
    },
    {
      provider: 'openrouter', brand: 'openrouter', name: 'OpenRouter', meta: 'one key · 200+ models',
      models: ['Auto router', 'Claude, Gemini, Qwen…', 'Fallback chains'], href: 'app.html?model=openrouter-auto'
    }
  ];

  const ACCOUNT_PROVIDERS = ['openai', 'anthropic', 'deepseek'];
  function wallLink(p) {
    if (p.local || !ACCOUNT_PROVIDERS.includes(p.provider)) return p.href;
    return `auth.html?provider=${p.provider}&mode=signup&next=${encodeURIComponent(p.href)}`;
  }

  function renderModelWall() {
    const wall = $('#modelWall');
    if (!wall) return;
    wall.innerHTML = WALL.map(
      (p) => `<a class="model-tile reveal" href="${wallLink(p)}" aria-label="${escapeHtml(p.name)} ${p.local ? 'on-device models' : ACCOUNT_PROVIDERS.includes(p.provider) ? '— connect your account' : 'models'}">
        <span class="mt-top">
          <span class="p-logo lg" data-brand="${p.brand}" data-brand-size="22"></span>
          <span>
            <span class="mt-name">${escapeHtml(p.name)}</span>
            <span class="mt-meta">${escapeHtml(p.meta)}</span>
          </span>
        </span>
        <ul>${p.models.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>
        <span class="mt-link">${p.local ? 'Run on-device' : ACCOUNT_PROVIDERS.includes(p.provider) ? 'Connect account' : 'Open with a key'} <span data-icon="arrow-right" data-icon-size="11"></span></span>
      </a>`
    ).join('');
    hydrateBrands(wall);
    if (window.EltesIcons) window.EltesIcons.hydrate(wall);
    wall.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  }

  function renderMiniProviders() {
    const box = $('#miniProviders');
    if (!box) return;
    box.innerHTML = WALL.map(
      (p) => `<span class="mp"><span class="p-logo sm" data-brand="${p.brand}" data-brand-size="14"></span>${escapeHtml(p.name.replace(' · Alibaba', ''))}</span>`
    ).join('');
    hydrateBrands(box);
  }

  /* --------------------------------- year --------------------------------- */
  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* -------------------------------- toasts -------------------------------- */
  function toast(message, icon = 'check') {
    let stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${window.EltesIcons.icon(icon, { size: 15 })}<span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 2600);
  }
  window.EltesSite = { toast };

  /* ------------------------------- copy buttons --------------------------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.dataset.copy;
    const done = () => {
      toast('Copied to clipboard');
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1400);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => toast('Copy failed — select the text manually', 'triangle-alert'));
    } else {
      toast('Copy is blocked in this context', 'triangle-alert');
    }
  });

  /* ------------------------------- waitlist ------------------------------- */
  function ensureWaitlist() {
    let dlg = $('#waitlistDialog');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'waitlistDialog';
    dlg.setAttribute('aria-label', 'Join the pricing waitlist');
    dlg.innerHTML = `
      <div class="dlg" style="width:min(430px,calc(100vw - 32px))">
        <div class="dlg-head">
          <span data-icon="gift" data-icon-size="16" style="color:#9cc0ff"></span>
          <div><h3>Join the pricing waitlist</h3><div class="sub">Hosted pricing is not announced yet.</div></div>
          <span class="grow"></span>
          <button class="icon-btn" type="button" data-close aria-label="Close" data-icon="x" data-icon-size="17"></button>
        </div>
        <form id="waitlistForm">
          <div class="dlg-body">
            Hosted keys, usage caps and shared threads are in the works. Leave an email and we'll tell you
            when plans open — nothing else is sent, ever.
            <label class="auth-field" style="margin-top:14px">
              <span data-icon="mail" data-icon-size="14"></span>
              <input type="email" name="email" placeholder="you@domain.com" autocomplete="email" required />
            </label>
          </div>
          <div class="dlg-actions">
            <button class="btn btn-ghost btn-sm" type="button" data-close>Cancel</button>
            <button class="btn btn-primary btn-sm" type="submit">Join waitlist</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(dlg);
    if (window.EltesIcons) window.EltesIcons.hydrate(dlg);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
    $('#waitlistForm', dlg).addEventListener('submit', (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get('email').toString().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast('That email does not look right', 'triangle-alert');
        return;
      }
      try {
        const list = JSON.parse(localStorage.getItem('eltes.waitlist.v1') || '[]');
        if (!list.some((x) => x.email === email)) list.push({ email, at: Date.now() });
        localStorage.setItem('eltes.waitlist.v1', JSON.stringify(list));
      } catch (err) {}
      dlg.close();
      toast('You are on the list — stored in this browser', 'check');
    });
    return dlg;
  }

  const waitlistBtn = $('#waitlistBtn');
  if (waitlistBtn) {
    waitlistBtn.addEventListener('click', () => {
      const dlg = ensureWaitlist();
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
      const input = dlg.querySelector('input');
      if (input) setTimeout(() => input.focus(), 40);
    });
  }

  /* ----------------------------- quick signup ----------------------------- */
  const quick = $('#quickSignup');
  if (quick) {
    quick.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(quick);
      const name = (data.get('name') || '').toString().trim();
      const email = (data.get('email') || '').toString().trim();
      if (name.length < 2) {
        toast('Add a name with at least two characters', 'triangle-alert');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast('Enter a valid email address', 'triangle-alert');
        return;
      }
      window.EltesAccount.create({ name, email, provider: 'local' });
      toast(`Welcome, ${name.split(' ')[0]} — profile saved locally`, 'user-check');
      setTimeout(() => { window.location.href = 'app.html'; }, 700);
    });
  }

  /* -------------------------------- boot ---------------------------------- */
  renderAccountNav();
  renderMiniProviders();
  renderModelWall();
  hydrateBrands();
  if (window.EltesIcons) window.EltesIcons.hydrate();
})();
