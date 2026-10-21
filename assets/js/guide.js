/* ==========================================================================
   Eltes site guide — the blue cloud in the corner.

   A deterministic, rules-based helper that walks you around the landing page:
   it matches a question against section keywords and scrolls there. It is not
   a model and it makes no network requests. Drag the cloud anywhere; its
   position is remembered per browser.
   ========================================================================== */
(function () {
  'use strict';

  const dock = document.getElementById('guideDock');
  const orb = document.getElementById('guideOrb');
  const panel = document.getElementById('guidePanel');
  const closeBtn = document.getElementById('guideClose');
  const log = document.getElementById('guideLog');
  const chips = document.getElementById('guideChips');
  const form = document.getElementById('guideForm');
  const input = document.getElementById('guideInput');
  if (!dock || !orb || !panel || !log || !form || !input) return;

  const POS_KEY = 'eltes.guide.pos';
  const HINT_KEY = 'eltes.guide.hinted';
  const EDGE = 10;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const smallScreen = window.matchMedia('(max-width: 700px)');

  /* ------------------------------- position ------------------------------- */

  let pos = null;

  function dockSize() {
    return { w: dock.offsetWidth || 58, h: dock.offsetHeight || 58 };
  }

  function place(x, y) {
    const { w, h } = dockSize();
    const maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - h - EDGE);
    pos = {
      x: Math.min(Math.max(x, EDGE), maxX),
      y: Math.min(Math.max(y, EDGE), maxY)
    };
    dock.style.left = pos.x + 'px';
    dock.style.top = pos.y + 'px';
    dock.style.right = 'auto';
    dock.style.bottom = 'auto';
    dock.classList.add('is-placed');
    orient();
  }

  function restore() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    } catch (err) {
      saved = null;
    }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y);
  }

  function remember() {
    if (!pos) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch (err) {
      /* storage blocked — the orb just will not stay where it was put */
    }
  }

  // flip the panel when the orb is dragged near an edge
  function orient() {
    if (panel.hidden) return;
    const r = orb.getBoundingClientRect();
    const panelH = panel.offsetHeight || 420;
    const panelW = panel.offsetWidth || 340;
    const roomAbove = r.top;
    const roomBelow = window.innerHeight - r.bottom;
    panel.classList.toggle('is-below', roomAbove < panelH + 18 && roomBelow > roomAbove);
    panel.classList.toggle('is-left', r.left < panelW - 60);
  }

  /* -------------------------------- dragging ------------------------------ */

  let drag = null;

  orb.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const r = dock.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      dx: event.clientX - r.left,
      dy: event.clientY - r.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    try {
      orb.setPointerCapture(event.pointerId);
    } catch (err) {
      /* pointermove still reaches the orb in most browsers */
    }
    dock.classList.add('is-dragging');
  });

  orb.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      drag.moved = true;
      dismissHint();
    }
    place(event.clientX - drag.dx, event.clientY - drag.dy);
  });

  orb.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    dock.classList.remove('is-dragging');
    if (moved) {
      remember();
      return;
    }
    toggle();
  });

  orb.addEventListener('pointercancel', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    dock.classList.remove('is-dragging');
    remember();
  });

  // keyboard: Enter/Space produce a click with detail 0; arrows nudge the orb
  orb.addEventListener('click', (event) => {
    if (event.detail === 0) toggle();
  });

  orb.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 42 : 14;
    const move = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }[event.key];
    if (!move) return;
    event.preventDefault();
    const r = dock.getBoundingClientRect();
    place(r.left + move[0], r.top + move[1]);
    remember();
  });

  /* --------------------------------- panel -------------------------------- */

  function isOpen() {
    return !panel.hidden;
  }

  function open() {
    panel.hidden = false;
    dock.classList.add('is-open');
    orb.setAttribute('aria-expanded', 'true');
    orb.setAttribute('aria-label', 'Close the Eltes guide');
    dismissHint();
    requestAnimationFrame(() => {
      orient();
      panel.classList.add('is-in');
      if (!log.childElementCount) {
        addBot('Hi — I am the Eltes guide. Tell me what you are looking for and I will scroll you to it, or take the **tour**.');
      }
      input.focus({ preventScroll: true });
    });
  }

  function close(returnFocus) {
    panel.hidden = true;
    panel.classList.remove('is-in');
    dock.classList.remove('is-open');
    orb.setAttribute('aria-expanded', 'false');
    orb.setAttribute('aria-label', 'Open the Eltes guide');
    if (returnFocus) orb.focus({ preventScroll: true });
  }

  function toggle() {
    if (isOpen()) close(true);
    else open();
  }

  closeBtn.addEventListener('click', () => close(true));

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
    }
  });

  window.addEventListener('resize', () => {
    if (pos) place(pos.x, pos.y);
    orient();
  });

  /* ------------------------------- messages ------------------------------- */

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  // **bold** and `code`, built as nodes so no markup is ever injected
  function fill(node, text) {
    String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).forEach((part) => {
      if (!part) return;
      if (part.slice(0, 2) === '**' && part.slice(-2) === '**') {
        const strong = el('strong');
        strong.textContent = part.slice(2, -2);
        node.appendChild(strong);
      } else if (part[0] === '`' && part.slice(-1) === '`') {
        const code = el('code');
        code.textContent = part.slice(1, -1);
        node.appendChild(code);
      } else {
        node.appendChild(document.createTextNode(part));
      }
    });
    return node;
  }

  function scrollLog() {
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  function addBot(text, actions) {
    const row = el('div', 'guide-msg bot');
    const ava = el('span', 'guide-msg-ava');
    ava.setAttribute('aria-hidden', 'true');
    row.appendChild(ava);

    const body = el('div', 'guide-msg-body');
    const bubble = el('p', 'guide-bubble');
    fill(bubble, text);
    body.appendChild(bubble);

    if (actions && actions.length) {
      const bar = el('div', 'guide-actions');
      actions.forEach((action) => {
        const node = action.href ? el('a', 'guide-action') : el('button', 'guide-action');
        node.textContent = action.label;
        if (action.href) {
          node.href = action.href;
        } else {
          node.type = 'button';
          node.addEventListener('click', () => runAction(action));
        }
        bar.appendChild(node);
      });
      body.appendChild(bar);
    }

    row.appendChild(body);
    log.appendChild(row);
    scrollLog();
  }

  function addUser(text) {
    const row = el('div', 'guide-msg user');
    const bubble = el('p', 'guide-bubble');
    bubble.textContent = text;
    row.appendChild(bubble);
    log.appendChild(row);
    scrollLog();
  }

  function typing() {
    const row = el('div', 'guide-msg bot is-typing');
    const ava = el('span', 'guide-msg-ava');
    ava.setAttribute('aria-hidden', 'true');
    row.appendChild(ava);
    const body = el('div', 'guide-msg-body');
    const bubble = el('p', 'guide-bubble');
    ['', '', ''].forEach(() => bubble.appendChild(el('span')));
    body.appendChild(bubble);
    row.appendChild(body);
    log.appendChild(row);
    scrollLog();
    return row;
  }

  /* ------------------------------ navigation ------------------------------ */

  let flashTimer = 0;
  let settleTimer = 0;

  function goTo(selector) {
    const target = document.querySelector(selector);
    if (!target) return false;

    target.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });

    window.clearTimeout(flashTimer);
    window.clearTimeout(settleTimer);
    document.querySelectorAll('.guide-target').forEach((node) => node.classList.remove('guide-target'));
    settleTimer = window.setTimeout(() => {
      target.classList.add('guide-target');
      flashTimer = window.setTimeout(() => target.classList.remove('guide-target'), 2000);
    }, reduceMotion.matches ? 0 : 430);

    if (smallScreen.matches) window.setTimeout(() => close(false), 560);
    return true;
  }

  /* -------------------------------- intents ------------------------------- */

  const CHIPS = [
    { label: 'Show me around', ask: 'show me around' },
    { label: 'Models', ask: 'where are the models' },
    { label: 'Pricing', ask: 'how much does it cost' },
    { label: 'Downloads', ask: 'download' },
    { label: 'Keys & privacy', ask: 'where are my keys stored' }
  ];

  const ROUTES = [
    {
      keys: ['free', 'free tier', 'no cost', 'ollama', 'lm studio', 'local model', 'local weights', 'offline model'],
      text: 'Three ways to pay nothing: **CAI** runs in the tab, **your own weights** run on your machine through Ollama or LM Studio, and a **provider free tier** costs nothing while the quota lasts. The docs spell out each one.',
      actions: [{ label: 'Read the free-models guide', href: 'docs.html#free' }]
    },
    {
      keys: ['pricing', 'price', 'cost', 'plan', 'subscription', 'paid', 'credits', 'waitlist'],
      text: '**Pricing** is below the comparison table. BYOK is free — you pay your provider directly. Hosted plans are still in design, with a waitlist you can join; nothing is charged.',
      actions: [
        { label: 'Take me to pricing', go: '#pricing' },
        { label: 'Open the waitlist', run: 'waitlist' }
      ]
    },
    {
      keys: ['model', 'models', 'llm', 'provider', 'providers', 'catalogue', 'catalog', 'claude', 'gpt', 'gemini', 'grok', 'llama', 'mistral', 'deepseek'],
      text: 'This is the **model wall** — every provider and its routes. Filter it to hosted or on-device, and each tile opens the workspace with that model selected.',
      actions: [{ label: 'Show me the model wall', go: '#models' }]
    },
    {
      keys: ['feature', 'features', 'capabilit', 'bento', 'workflow', 'compare labs'],
      text: '**Workspace features** covers comparing labs on one prompt, local history, key handling, tool calls and what the error states actually say.',
      actions: [{ label: 'Show features', go: '#features' }]
    },
    {
      keys: ['agent', 'tool', 'tools', 'tool loop', 'function calling'],
      text: '**Agent mode** is on by default. Hosted models ask through native function calling; with Eltes CAI-1 a deterministic planner runs in the tab, up to six steps. Eight tools, no shell, no server-side execution — the docs page has the full table.',
      actions: [{ label: 'Open the agent docs', href: 'docs.html#agent' }]
    },
    {
      keys: ['download', 'downloads', 'install', 'windows', 'desktop', 'chromebook', 'zip', 'offline'],
      text: '**Downloads** has the Windows launcher, the macOS/Linux command, and a plain-spoken panel about what installing as an app can and cannot reach on a Chromebook.',
      actions: [{ label: 'Show downloads', go: '#downloads' }]
    },
    {
      keys: ['account', 'sign up', 'signup', 'sign in', 'signin', 'profile', 'log in', 'login'],
      text: '**Accounts** are optional. A local profile needs only a name and an email — no password, and nothing is sent anywhere.',
      actions: [{ label: 'Show accounts', go: '#account' }]
    },
    {
      keys: ['compare', 'why eltes', 'rules', 'difference', 'versus', 'supports'],
      text: 'The **comparison** lists what Eltes does and what it deliberately does not: bring your own key, local history, provider-controlled billing, no shell access.',
      actions: [{ label: 'Show the comparison', go: '#compare' }]
    },
    {
      keys: ['preview', 'look inside', 'interface', 'inside'],
      text: 'The **features** grid shows the workspace surfaces: the agent trace, live search with sources, Studio, the Lab you train in the tab, and the local history panel.',
      actions: [{ label: 'Show features', go: '#features' }]
    },
    {
      keys: ['key', 'keys', 'privacy', 'private', 'safe', 'security', 'stored', 'local'],
      text: 'Keys stay in this browser and are attached only when you send a request. **History is local by default**, and exports leave keys out.',
      actions: [
        { label: 'Show the comparison', go: '#compare' },
        { label: 'Privacy docs', href: 'docs.html#privacy' }
      ]
    },
    {
      keys: ['doc', 'docs', 'documentation', 'manual', 'reference'],
      text: 'The **documentation** covers quickstart, keys, providers and CORS, the tool loop and self-hosting.',
      actions: [{ label: 'Open docs', href: 'docs.html' }]
    },
    {
      keys: ['workspace', 'app', 'chat', 'start', 'try', 'open'],
      text: 'The **workspace** is the real app — model picker, streaming, tools and local history. You can start on-device with Eltes CAI and no key at all.',
      actions: [{ label: 'Open the workspace', href: 'app.html' }]
    }
  ];

  const TOUR = [
    { sel: '#models', title: 'the model wall', text: 'hosted providers and on-device models in one filterable grid.' },
    { sel: '#web-search', title: 'live search', text: 'your own search key, numbered sources and citations.' },
    { sel: '#features', title: 'workspace features', text: 'the agent trace, Studio, the Lab and local history.' },
    { sel: '#pricing', title: 'pricing', text: 'BYOK is free; hosted plans are still being designed.' },
    { sel: '#downloads', title: 'downloads', text: 'Windows launcher, macOS/Linux command and web-app install.' }
  ];

  let tour = -1;

  function tourStop(index) {
    tour = index;
    if (tour >= TOUR.length) {
      tour = -1;
      addBot('That is the whole page. Ask me for anything by name and I will jump straight there.');
      return;
    }
    const step = TOUR[tour];
    const last = tour === TOUR.length - 1;
    addBot(
      '**Stop ' + (tour + 1) + ' of ' + TOUR.length + ' — ' + step.title + '.** ' + step.text,
      last
        ? [{ label: 'Open the workspace', href: 'app.html' }, { label: 'End tour', run: 'tour-end' }]
        : [{ label: 'Next stop →', run: 'tour-next' }, { label: 'End tour', run: 'tour-end' }]
    );
    goTo(step.sel);
  }

  function runAction(action) {
    if (action.go) {
      if (action.confirm) addBot(action.confirm);
      goTo(action.go);
      return;
    }
    if (action.run === 'tour-start') {
      addBot('Six quick stops, then I will get out of your way.');
      tourStop(0);
      return;
    }
    if (action.run === 'tour-next') return tourStop(tour + 1);
    if (action.run === 'tour-end') {
      tour = -1;
      addBot('Tour ended. Ask for any section by name whenever you want.');
      return;
    }
    if (action.run === 'waitlist') {
      const btn = document.getElementById('waitlistBtn');
      if (btn) {
        btn.click();
        addBot('That is the waitlist — email only, nothing charged.');
      }
      return;
    }
    if (action.run === 'chip') {
      ask(action.ask);
    }
  }

  function normalise(text) {
    return String(text || '').toLowerCase().replace(/[\u2019']/g, "'").replace(/\s+/g, ' ').trim();
  }

  function reply(raw) {
    const text = normalise(raw);
    if (!text) return;

    if (/^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/.test(text)) {
      addBot('Hey. I can walk you to any part of this page — models, pricing, downloads, docs. Where do you want to go?');
      return;
    }
    if (/^(thanks|thank you|cheers|ty)\b/.test(text)) {
      addBot('Anytime. Pick another section whenever you like.');
      return;
    }
    if (/(who|what) are you|are you (a|an) (ai|bot|model)|how do you work/.test(text)) {
      addBot('I am a **rules-based guide**, not a language model. I match what you type against this page\'s sections and scroll there. For real answers, open the workspace and pick a model.', [
        { label: 'Open the workspace', href: 'app.html' }
      ]);
      return;
    }
    if (/(^|\b)(tour|show me around|walk me|guide me|overview|everything)\b/.test(text)) {
      addBot('Happy to. Six stops, and you can bail out whenever.');
      tourStop(0);
      return;
    }
    if (/what is eltes|about eltes|what does eltes do/.test(text)) {
      addBot('Eltes is a local-first AI workspace: bring your own provider key, switch models mid-thread, keep history in this browser, and run a small on-device helper when you have no key.', [
        { label: 'Show me around', run: 'tour-start' },
        { label: 'Open the workspace', href: 'app.html' }
      ]);
      return;
    }

    for (const route of ROUTES) {
      if (route.keys.some((key) => text.includes(key))) {
        addBot(route.text, route.actions);
        return;
      }
    }

    addBot('I did not catch a section in that. I know the **tour**, **models**, **features**, **agent tools**, the **comparison**, **pricing**, **accounts**, **downloads** and the **docs**.', [
      { label: 'Show me around', run: 'tour-start' },
      { label: 'Models', run: 'chip', ask: 'models' },
      { label: 'Pricing', run: 'chip', ask: 'pricing' },
      { label: 'Downloads', run: 'chip', ask: 'downloads' }
    ]);
  }

  /* --------------------------------- chips -------------------------------- */

  function ask(text) {
    addUser(text);
    const pending = typing();
    window.setTimeout(() => {
      pending.remove();
      reply(text);
    }, reduceMotion.matches ? 60 : 330);
  }

  CHIPS.forEach((chip) => {
    const btn = el('button', 'guide-chip');
    btn.type = 'button';
    btn.textContent = chip.label;
    btn.addEventListener('click', () => ask(chip.ask));
    chips.appendChild(btn);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    ask(value);
  });

  /* ------------------------------- first hint ----------------------------- */

  const hint = el('span', 'guide-hint');
  hint.textContent = 'Need a hand?';
  hint.setAttribute('aria-hidden', 'true');
  dock.appendChild(hint);

  let hintTimer = 0;
  let hinted = false;
  try {
    hinted = sessionStorage.getItem(HINT_KEY) === '1';
  } catch (err) {
    hinted = false;
  }

  function dismissHint() {
    window.clearTimeout(hintTimer);
    hint.classList.remove('is-in');
    try {
      sessionStorage.setItem(HINT_KEY, '1');
    } catch (err) {
      /* no storage, no problem */
    }
  }

  if (!hinted && !reduceMotion.matches) {
    hintTimer = window.setTimeout(() => {
      if (isOpen()) return;
      hint.classList.add('is-in');
      hintTimer = window.setTimeout(() => hint.classList.remove('is-in'), 7000);
    }, 6000);
  }

  /* --------------------------------- boot --------------------------------- */

  restore();
  dock.classList.add('is-ready');
})();
