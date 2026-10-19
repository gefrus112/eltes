/* ==========================================================================
   Eltes AI — application
   Real providers only. No demo mode, no simulated replies.
   ========================================================================== */
(function () {
  'use strict';

  const M = window.EltesModels;
  const I = window.EltesIcons;
  const B = window.EltesBrandSvg;
  const Account = window.EltesAccount;
  const ic = (name, size = 16) => I.icon(name, { size });
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s = '') =>
    String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const brand = (model, size = 14) => B(M.brandOf(model), size);

  /* ------------------------------- storage -------------------------------- */
  const LS = { chats: 'eltes.chats.v1', settings: 'eltes.settings.v1', active: 'eltes.active.v1' };

  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  };
  const writeJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('Storage is full — delete a conversation to keep saving', 'triangle-alert'); return false; }
  };

  const DEFAULTS = {
    model: M.DEFAULT_MODEL,
    keys: {},
    customBaseUrl: '',
    customModel: '',
    customKey: '',
    stream: true,
    sendKey: 'enter',
    tools: false,
    density: 'comfortable',
    reduceMotion: false,
    showTime: true,
    showMetrics: true,
    favorites: ['claude-sonnet-4-5', 'gpt-4-1', 'glm-4-6', 'gemini-2-5-pro']
  };

  const savedSettings = readJSON(LS.settings, {});
  const state = {
    chats: readJSON(LS.chats, []),
    activeId: readJSON(LS.active, null),
    settings: Object.assign({}, DEFAULTS, savedSettings, {
      keys: Object.assign({}, DEFAULTS.keys, savedSettings.keys || {})
    }),
    sending: false,
    stopped: false,
    abort: null,
    renameId: null,
    modelPickerFor: 'current',
    pendingRetry: null,
    connectProvider: null
  };

  function normalizeChats(list) {
    if (!Array.isArray(list)) return [];
    const validModel = (id) => M.MODELS.some((m) => m.id === id);
    return list
      .filter((c) => c && typeof c === 'object')
      .map((c) => {
        const now = Date.now();
        const messages = (Array.isArray(c.messages) ? c.messages : [])
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
          .map((m) => Object.assign({}, m, {
            id: m.id || uid(),
            content: typeof m.content === 'string' ? m.content : String(m.content == null ? '' : m.content),
            ts: m.ts || now,
            streaming: false,
            phase: null,
            tools: Array.isArray(m.tools) ? m.tools.map((t) => Object.assign({ status: 'done', runtime: 0 }, t)) : []
          }));
        return Object.assign({}, c, {
          id: c.id || uid(),
          title: (c.title || 'Untitled chat').slice(0, 120),
          model: validModel(c.model) ? c.model : M.DEFAULT_MODEL,
          messages,
          createdAt: c.createdAt || now,
          updatedAt: c.updatedAt || c.createdAt || now,
          pinned: !!c.pinned
        });
      });
  }

  state.chats = normalizeChats(state.chats);
  if (state.chats.length && !state.chats.some((c) => c.id === state.activeId)) {
    state.activeId = state.chats[0].id;
  }
  if (!state.chats.length) state.activeId = null;

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 140);
  }
  function persistNow() {
    clearTimeout(saveTimer);
    writeJSON(LS.chats, state.chats);
    writeJSON(LS.settings, state.settings);
    writeJSON(LS.active, state.activeId);
    updateStorageUI();
  }

  /* -------------------------------- helpers ------------------------------- */
  const activeChat = () => state.chats.find((c) => c.id === state.activeId) || null;
  const currentModelId = () => {
    const chat = activeChat();
    return (chat && chat.model) || state.settings.model;
  };
  const currentModel = () => M.byId(currentModelId());
  const providerKey = (providerId) =>
    providerId === 'custom' ? state.settings.customKey : state.settings.keys[providerId];
  const hasKeyFor = (model) => {
    if (!model) return false;
    if (model.provider === 'custom') return !!state.settings.customBaseUrl;
    return !!state.settings.keys[model.provider];
  };
  const connectedKeyCount = () =>
    Object.values(state.settings.keys).filter(Boolean).length + (state.settings.customBaseUrl ? 1 : 0);
  const anyKeyConnected = () => connectedKeyCount() > 0;

  const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
  const fmtNum = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

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
    el.innerHTML = `${ic(icon, 15)}<span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2500);
  }

  /* ------------------------------- markdown ------------------------------- */
  const KEYWORDS = new Set(
    ('const let var function return if else for while await async import from export default new class extends ' +
      'try catch finally throw typeof instanceof this super null undefined true false def elif in not and or None ' +
      'True False lambda with as pass raise select where join order by group limit insert update delete create ' +
      'table index on primary key foreign references begin commit rollback pub fn use mut impl struct enum match ' +
      'switch case break continue do interface type public private static void int string bool float echo cd ' +
      'export set local then fi done of is').split(/\s+/)
  );
  const LANGS = /^(js|javascript|jsx|ts|typescript|tsx|json|py|python|bash|sh|shell|zsh|sql|css|html|xml|go|rs|rust|yml|yaml|toml|diff|text)$/i;
  const escapeCode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function highlight(code, lang) {
    if (!lang || !LANGS.test(lang)) return escapeCode(code);
    const src = escapeCode(code);
    const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
    return src.replace(re, (match, comment, str, num, word, offset) => {
      if (comment) return `<span class="tok-com">${comment}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (num) return `<span class="tok-num">${num}</span>`;
      if (word) {
        if (KEYWORDS.has(word)) return `<span class="tok-key">${word}</span>`;
        const after = src.slice(offset + word.length, offset + word.length + 2);
        if (/^[A-Z]/.test(word)) return `<span class="tok-tag">${word}</span>`;
        if (after.startsWith('(')) return `<span class="tok-fn">${word}</span>`;
        return word;
      }
      return match;
    });
  }

  function inline(md) {
    const codes = [];
    let out = md.replace(/(`+)([\s\S]*?)\1/g, (m, ticks, body) => {
      codes.push(`<code class="inline">${body}</code>`);
      return `\u0000C${codes.length - 1}\u0000`;
    });
    out = out
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
      .replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>');
    return out.replace(/\u0000C(\d+)\u0000/g, (m, i) => codes[Number(i)]);
  }

  function renderMarkdown(raw) {
    let md = String(raw || '');
    if ((md.match(/```/g) || []).length % 2 === 1) md += '\n```';
    const lines = md.split('\n');
    const html = [];
    let i = 0;
    const isBlockStart = (line) =>
      /^```/.test(line) || /^#{1,3}\s/.test(line) || /^>\s?/.test(line) ||
      /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^---+$/.test(line.trim());

    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const lang = line.replace(/^```/, '').trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        const code = buf.join('\n');
        html.push(
          `<div class="code"><div class="code-head"><span class="lang">${ic('code-2', 11)}${esc(lang || 'text')}</span>` +
            `<button class="cpy" data-copy-code type="button">${ic('copy', 11)}<span>Copy</span></button></div>` +
            `<pre><code>${highlight(code, lang)}</code></pre></div>`
        );
        continue;
      }
      if (!line.trim()) { i++; continue; }
      if (/^---+$/.test(line.trim())) { html.push('<hr />'); i++; continue; }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) { html.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); i++; continue; }

      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        html.push(`<blockquote>${inline(esc(buf.join(' ')))}</blockquote>`);
        continue;
      }
      if (/^[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i])) { items.push(inline(esc(lines[i].replace(/^[-*+]\s+/, '')))); i++; }
        html.push(`<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`);
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(inline(esc(lines[i].replace(/^\d+\.\s+/, '')))); i++; }
        html.push(`<ol>${items.map((t) => `<li>${t}</li>`).join('')}</ol>`);
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const parseRow = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
        const head = parseRow(line);
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { body.push(parseRow(lines[i])); i++; }
        html.push(
          `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join('')}</tr></thead>` +
            `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        );
        continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
      html.push(`<p>${inline(esc(buf.join(' ')))}</p>`);
    }
    return html.join('');
  }

  /* --------------------------------- tools -------------------------------- */
  const TOOL_DEFS = [
    {
      name: 'calculate',
      description: 'Evaluate an arithmetic expression. Supports + - * / % ^, parentheses and decimal numbers. Use for any maths instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Arithmetic expression, e.g. "(17 * 43) / 2"' }
        },
        required: ['expression']
      },
      icon: 'calculator'
    },
    {
      name: 'current_time',
      description: 'Return the current date and time in ISO format plus the local timezone. Use whenever the answer depends on now.',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Optional IANA timezone, e.g. Europe/London' }
        }
      },
      icon: 'clock'
    },
    {
      name: 'search_history',
      description: 'Search the user\'s saved Eltes conversations for a phrase and return matching titles with snippets. Use when the user refers to something discussed earlier.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to search for' }
        },
        required: ['query']
      },
      icon: 'search'
    }
  ];

  function safeCalculate(expression) {
    const expr = String(expression || '').trim();
    if (!expr) return { error: 'Empty expression.' };
    if (!/^[0-9+\-*/%(). ^]+$/.test(expr)) {
      return { error: 'Only numbers and + - * / % ^ ( ) are allowed.' };
    }
    const js = expr.replace(/\^/g, '**');
    if (/\.\s*\./.test(js)) return { error: 'Malformed number.' };
    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict"; return (${js});`)();
      if (typeof value !== 'number' || !isFinite(value)) return { error: 'Result is not a finite number.' };
      return { result: String(Number(value.toPrecision(12))) };
    } catch (e) {
      return { error: 'Could not evaluate that expression.' };
    }
  }

  function toolCurrentTime(args) {
    const tz = args && args.timezone;
    try {
      const now = new Date();
      const formatted = tz
        ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }).format(now)
        : now.toISOString();
      return { result: `${formatted}${tz ? ` (${tz})` : ' (ISO, local offset ' + (-now.getTimezoneOffset() / 60) + 'h)'}` };
    } catch (e) {
      return { result: new Date().toISOString(), note: 'Unknown timezone, returned local ISO time.' };
    }
  }

  function toolSearchHistory(args) {
    const q = String((args && args.query) || '').toLowerCase().trim();
    if (!q) return { error: 'Empty query.' };
    const hits = [];
    state.chats.forEach((chat) => {
      const titleHit = (chat.title || '').toLowerCase().includes(q);
      let snippet = '';
      (chat.messages || []).forEach((m) => {
        if (!snippet && m.content && m.content.toLowerCase().includes(q)) {
          const at = m.content.toLowerCase().indexOf(q);
          snippet = m.content.slice(Math.max(0, at - 70), at + 130).replace(/\s+/g, ' ').trim();
        }
      });
      if (titleHit || snippet) {
        hits.push({ title: chat.title, when: new Date(chat.updatedAt || chat.createdAt).toISOString().slice(0, 10), snippet: snippet || '(title match)' });
      }
    });
    if (!hits.length) return { result: `No saved conversations match "${q}".` };
    return {
      result: hits.slice(0, 4).map((h, idx) => `${idx + 1}. ${h.title} · ${h.when}\n   ${h.snippet}`).join('\n'),
      meta: `${hits.length} match${hits.length === 1 ? '' : 'es'}`
    };
  }

  function runTool(name, args) {
    const started = performance.now();
    let out;
    if (name === 'calculate') out = safeCalculate(args && args.expression);
    else if (name === 'current_time') out = toolCurrentTime(args || {});
    else if (name === 'search_history') out = toolSearchHistory(args || {});
    else out = { error: `Unknown tool: ${name}` };
    const text = out.error ? `Error: ${out.error}` : out.result;
    return {
      name,
      args: args || {},
      result: text,
      runtime: Math.round(performance.now() - started),
      error: !!out.error
    };
  }

  const toolIcon = (name) => (TOOL_DEFS.find((t) => t.name === name) || {}).icon || 'wrench';

  /* ------------------------------- rendering ------------------------------ */
  const els = {
    shell: $('#shell'),
    chatList: $('#chatList'),
    messages: $('#messages'),
    empty: $('#emptyState'),
    thread: $('#thread'),
    input: $('#input'),
    send: $('#sendBtn'),
    modelBtnName: $('#modelBtnName'),
    modelBtnTier: $('#modelBtnTier'),
    modelBtnLogo: $('#modelBtnLogo'),
    composerModelName: $('#composerModelName'),
    composerLogo: $('#composerLogo'),
    keyPill: $('#keyPill'),
    keyPillText: $('#keyPillText'),
    modelDialog: $('#modelDialog'),
    modelList: $('#modelList'),
    modelSearch: $('#modelSearch'),
    cmdDialog: $('#cmdDialog'),
    cmdSearch: $('#cmdSearch'),
    cmdList: $('#cmdList'),
    settingsDialog: $('#settingsDialog'),
    shareDialog: $('#shareDialog'),
    confirmDialog: $('#confirmDialog'),
    connectDialog: $('#connectDialog'),
    keyList: $('#keyList'),
    modelPrefs: $('#modelPrefs'),
    storageLabel: $('#storageLabel'),
    storageBar: $('#storageBar'),
    accountSlot: $('#accountSlot'),
    connectStrip: $('#connectStrip'),
    providerQuick: $('#providerQuick')
  };

  function renderTopbar() {
    const model = currentModel();
    els.modelBtnName.textContent = model.name;
    els.modelBtnTier.textContent = model.tier;
    els.modelBtnLogo.dataset.brand = M.brandOf(model);
    els.modelBtnLogo.innerHTML = brand(model, 15);
    els.composerModelName.textContent = model.name;
    els.composerLogo.dataset.brand = M.brandOf(model);
    els.composerLogo.innerHTML = brand(model, 13);

    const n = connectedKeyCount();
    const live = hasKeyFor(model);
    els.keyPill.classList.toggle('live', live);
    els.keyPillText.textContent = live ? `${n} key${n === 1 ? '' : 's'}` : 'No key';
    els.keyPill.title = live ? 'Connected — manage API keys' : 'No key for this model — connect a provider';

    const profileName = $('#profileName');
    const profileMeta = $('#profileMeta');
    const account = Account && Account.get();
    if (profileName) profileName.textContent = account ? account.name : 'Local workspace';
    if (profileMeta) profileMeta.textContent = n ? `${n} key${n === 1 ? '' : 's'} connected` : 'No keys connected';
    const metaDot = $('#profileCard .meta i');
    if (metaDot) metaDot.classList.toggle('off', !n);
    const sideAvatar = $('#profileCard .side-avatar');
    if (sideAvatar) {
      if (account) sideAvatar.outerHTML = Account.avatarHtml(account, 'sm', 'side-avatar');
      else if (sideAvatar.classList.contains('avatar')) {
        sideAvatar.outerHTML = `<span class="side-avatar" data-icon="shield-check" data-icon-size="15"></span>`;
        I.hydrate($('#profileCard'));
      }
    }

    const settingsModelName = $('#settingsModelName');
    if (settingsModelName) settingsModelName.textContent = model.name;
    const aboutModel = $('#aboutModel');
    if (aboutModel) aboutModel.textContent = model.id;
    const defaultLabel = $('#defaultModelLabel');
    if (defaultLabel) defaultLabel.textContent = M.byId(state.settings.model).name;

    const emptySub = $('#emptySub');
    if (emptySub) {
      emptySub.textContent = anyKeyConnected()
        ? `Connected to ${n} provider${n === 1 ? '' : 's'}. Every answer streams live from ${model.name}.`
        : 'Connect a provider key and every answer comes live from the model you picked.';
    }
  }

  function renderAccountSlot() {
    if (!els.accountSlot || !Account) return;
    const account = Account.get();
    if (!account) {
      els.accountSlot.innerHTML = `<a class="btn btn-ghost signin-btn" href="auth.html">Sign in</a>`;
      return;
    }
    els.accountSlot.innerHTML = `
      <button class="account-btn" id="topAccountBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">
        ${Account.avatarHtml(account, 'sm')}
        <span class="who"><strong>${esc(account.name.split(' ')[0])}</strong><span>${account.provider === 'github' ? 'GitHub' : 'Local'}</span></span>
        <span data-icon="chevron-down" data-icon-size="12" style="color:var(--text-3)"></span>
      </button>`;
    I.hydrate(els.accountSlot);
    const btn = $('#topAccountBtn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = $('.account-menu', els.accountSlot);
      if (existing) { existing.remove(); return; }
      const m = document.createElement('div');
      m.className = 'account-menu';
      m.innerHTML = `
        <div class="am-head">
          ${Account.avatarHtml(account, 'sm')}
          <div><strong>${esc(account.name)}</strong><span>${esc(account.email || (account.username ? '@' + account.username : 'Local profile'))}</span></div>
        </div>
        <a href="index.html"><span data-icon="layout-grid" data-icon-size="14"></span>Home</a>
        <a href="docs.html"><span data-icon="book-open" data-icon-size="14"></span>Documentation</a>
        <button type="button" data-settings><span data-icon="user" data-icon-size="14"></span>Account settings</button>
        <a href="index.html#pricing"><span data-icon="gift" data-icon-size="14"></span>Pricing</a>
        <hr />
        <button type="button" data-signout><span data-icon="log-out" data-icon-size="14"></span>Sign out</button>`;
      els.accountSlot.appendChild(m);
      I.hydrate(m);
      m.querySelector('[data-settings]').addEventListener('click', () => { m.remove(); openSettings('account'); });
      m.querySelector('[data-signout]').addEventListener('click', () => { Account.signOut(); m.remove(); toast('Signed out locally', 'log-out'); });
      const off = () => { m.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', off); };
      setTimeout(() => document.addEventListener('click', off), 0);
    });
  }

  function chatBucket(ts) {
    const now = new Date();
    const d = new Date(ts);
    const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.floor((startOf(now) - startOf(d)) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days <= 7) return 'Previous 7 days';
    if (days <= 30) return 'Previous 30 days';
    return 'Older';
  }

  function renderSidebar() {
    const list = els.chatList;
    if (!state.chats.length) {
      list.innerHTML = `<div class="chat-empty">No conversations yet.<br />Your chats stay in this browser.</div>`;
      updateStorageUI();
      return;
    }
    const sorted = [...state.chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const pinned = sorted.filter((c) => c.pinned);
    const rest = sorted.filter((c) => !c.pinned);
    const groups = new Map();
    rest.forEach((c) => {
      const key = chatBucket(c.updatedAt || c.createdAt || Date.now());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });

    const row = (chat) => {
      const isActive = chat.id === state.activeId;
      const renaming = state.renameId === chat.id;
      const model = M.byId(chat.model);
      return `<div class="chat-row${isActive ? ' active' : ''}" data-chat="${chat.id}" role="button" tabindex="0" aria-label="${esc(chat.title)}">
        ${chat.pinned ? `<span class="pin-mark">${ic('pin', 11)}</span>` : `<span>${ic('message-square', 13)}</span>`}
        ${renaming
          ? `<input class="rename-input" data-rename="${chat.id}" value="${esc(chat.title)}" aria-label="Rename conversation" />`
          : `<span class="title">${esc(chat.title || 'New chat')}</span>`}
        <span class="row-actions">
          <button class="mini-btn" data-pin="${chat.id}" title="${chat.pinned ? 'Unpin' : 'Pin'}" aria-label="${chat.pinned ? 'Unpin' : 'Pin'}">${ic('pin', 12)}</button>
          <button class="mini-btn" data-menu="${chat.id}" title="More" aria-label="More actions">${ic('more-horizontal', 13)}</button>
        </span>
      </div>`;
    };

    let html = '';
    if (pinned.length) html += `<div class="chat-group"><h5>Pinned</h5>${pinned.map(row).join('')}</div>`;
    groups.forEach((items, key) => { html += `<div class="chat-group"><h5>${key}</h5>${items.map(row).join('')}</div>`; });
    list.innerHTML = html;

    if (state.renameId) {
      const input = list.querySelector(`[data-rename="${state.renameId}"]`);
      if (input) {
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commitRename(input.value);
          if (e.key === 'Escape') cancelRename();
          e.stopPropagation();
        });
        input.addEventListener('blur', () => commitRename(input.value));
        input.addEventListener('click', (e) => e.stopPropagation());
      }
    }
    updateStorageUI();
  }

  function updateStorageUI() {
    const size = new Blob([JSON.stringify(state.chats), JSON.stringify(state.settings)]).size;
    const kb = size / 1024;
    const label = kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
    if (els.storageLabel) els.storageLabel.textContent = label;
    if (els.storageBar) els.storageBar.style.width = `${clamp((size / (5 * 1024 * 1024)) * 100, 1, 100)}%`;
    const dc = $('#dataChats');
    if (dc) {
      const msgs = state.chats.reduce((n, c) => n + (c.messages ? c.messages.length : 0), 0);
      dc.textContent = `${state.chats.length} conversation${state.chats.length === 1 ? '' : 's'} · ${msgs} messages`;
    }
    const ds = $('#dataStorage');
    if (ds) ds.textContent = `${label} of local storage used`;
  }

  function toolCardsHtml(msg) {
    if (!msg.tools || !msg.tools.length) return '';
    return `<div class="tools-panel">${msg.tools
      .map((t) => {
        const stateCls = t.status === 'running' ? '' : t.error ? 'error' : 'done';
        const stateLabel = t.status === 'running'
          ? '<span class="spinner"></span>running'
          : t.error ? 'error' : `done · ${t.runtime} ms`;
        const argLine = Object.entries(t.args || {})
          .map(([k, v]) => `<div class="tool-kv"><span class="k">${esc(k)}</span><span class="v">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</span></div>`)
          .join('');
        return `<div class="tool-card">
          <div class="tool-head">
            <span class="tool-ico">${ic(toolIcon(t.name), 11)}</span>
            <span class="tname">${esc(t.name)}</span>
            <span class="state ${stateCls}">${stateLabel}</span>
          </div>
          <div class="tool-body">
            ${argLine || '<div class="tool-kv"><span class="k">args</span><span class="v">{}</span></div>'}
            ${t.status !== 'running' && t.result ? `<div class="tool-result${t.error ? ' error' : ''}">${esc(t.result)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('')}</div>`;
  }

  function metricsHtml(msg) {
    if (!state.settings.showMetrics || msg.error || msg.needsKey) return '';
    if (!msg.usage && !msg.latency) return '';
    const u = msg.usage || {};
    const l = msg.latency || {};
    const tps = u.output && l.total ? (u.output / (l.total / 1000)).toFixed(1) : null;
    return `<div class="metrics">
      ${l.ttft ? `<span>${ic('zap', 10)} first token <b>${fmtMs(l.ttft)}</b></span>` : ''}
      ${l.total ? `<span>${ic('clock', 10)} total <b>${fmtMs(l.total)}</b></span>` : ''}
      ${tps ? `<span>${ic('activity', 10)} <b>${tps}</b> tok/s</span>` : ''}
      <span>${ic('arrow-down-up', 10)} in <b>${fmtNum(u.input)}</b> · out <b>${fmtNum(u.output)}</b></span>
      <span class="ok">${ic('check-check', 10)} ${esc(M.byId(msg.model).provider === 'anthropic' ? 'Anthropic' : M.providerOf(M.byId(msg.model)).name)}</span>
    </div>`;
  }

  function actionButtons(msg, index, chat) {
    if (msg.role === 'user') {
      return `<div class="msg-actions">
        <button class="mini-btn" data-act="copy" data-id="${msg.id}" title="Copy">${ic('copy', 12)}<span>Copy</span></button>
        <button class="mini-btn" data-act="edit" data-id="${msg.id}" title="Edit">${ic('pencil', 12)}<span>Edit</span></button>
      </div>`;
    }
    const isLastAssistant = msg.role === 'assistant' && index === chat.messages.length - 1;
    return `<div class="msg-actions">
      <button class="mini-btn" data-act="copy" data-id="${msg.id}" title="Copy reply">${ic('copy', 12)}<span>Copy</span></button>
      ${isLastAssistant ? `<button class="mini-btn" data-act="regen" data-id="${msg.id}" title="Regenerate">${ic('refresh-cw', 12)}<span>Retry</span></button>` : ''}
      <span class="sep"></span>
      <button class="mini-btn${msg.rating === 'up' ? ' on' : ''}" data-act="good" data-id="${msg.id}" title="Good reply" aria-label="Good reply">${ic('thumbs-up', 12)}</button>
      <button class="mini-btn${msg.rating === 'down' ? ' on' : ''}" data-act="bad" data-id="${msg.id}" title="Bad reply" aria-label="Bad reply">${ic('thumbs-down', 12)}</button>
    </div>`;
  }

  function errorHtml(msg) {
    const e = msg.error;
    if (!e) return '';
    return `<div class="stream-error">
      <strong>${esc(e.title)}</strong><br />${esc(e.detail || '')}
      ${e.hint ? `<br /><span>${esc(e.hint)}</span>` : ''}
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-act="regen" data-id="${msg.id}">${ic('refresh-cw', 12)} Retry</button>
        <button class="btn btn-ghost btn-sm" data-act="keys" data-provider="${esc(e.provider || '')}">${ic('key-round', 12)} Fix key</button>
      </div>
    </div>`;
  }

  function connectCardHtml(msg) {
    if (!msg.needsKey) return '';
    const model = M.byId(msg.model);
    const p = M.providerOf(model);
    return `<div class="connect-card">
      <strong>No key for ${esc(p.name)}.</strong><br />
      Eltes has no demo replies — this is a real request that needs a real credential.
      Add a ${esc(p.name)} key or switch to a provider you already connected.
      <div class="providers">${Object.keys(M.PROVIDERS)
        .filter((id) => id !== 'custom')
        .map((id) => `<span class="p-logo sm" data-brand="${M.PROVIDERS[id].brand}" data-brand-size="13" title="${esc(M.PROVIDERS[id].name)}" data-connect="${id}" role="button" tabindex="0"></span>`)
        .join('')}</div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" data-act="keys" data-provider="${esc(model.provider)}">${ic('key-round', 12)} Connect ${esc(p.name)}</button>
        <button class="btn btn-ghost btn-sm" data-act="models">${ic('layers', 12)} Switch model</button>
      </div>
    </div>`;
  }

  function messageHtml(msg, index, chat) {
    const model = M.byId(msg.model || chat.model);
    if (msg.role === 'user') {
      return `<div class="msg user" data-msg="${msg.id}">
        <div class="msg-body">
          <div class="bubble">${esc(msg.content)}</div>
          ${actionButtons(msg, index, chat)}
        </div>
      </div>`;
    }
    const time = state.settings.showTime ? `<span class="time">${fmtTime(msg.ts)}</span>` : '';
    const streaming = msg.streaming || msg.phase === 'tools';
    const thinkingLabel = msg.phase === 'tools' ? 'Running tools…' : `Thinking with ${model.name}…`;
    return `<div class="msg ai" data-msg="${msg.id}">
      <span class="avatar-ai"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6c.7 5.2 4.2 8.7 9.4 9.4-5.2.7-8.7 4.2-9.4 9.4-.7-5.2-4.2-8.7-9.4-9.4 5.2-.7 8.7-4.2 9.4-9.4Z" fill="#fff"/></svg></span>
      <div class="msg-body">
        <div class="msg-head">
          <span class="who">Eltes</span>
          <span class="model-chip">${brand(model, 12)}${esc(model.name)}<span style="opacity:.6">· ${esc(M.providerOf(model).name)}</span></span>
          ${streaming ? `<span class="streaming-dot"><i></i>${msg.phase === 'tools' ? 'tool loop' : 'streaming'}</span>` : time}
        </div>
        ${toolCardsHtml(msg)}
        ${streaming && !msg.content ? `<div class="thinking"><span class="dots"><i></i><i></i><i></i></span><span class="shimmer">${esc(thinkingLabel)}</span></div>` : ''}
        <div class="prose">${renderMarkdown(msg.content)}${streaming && msg.content ? '<span class="caret"></span>' : ''}</div>
        ${connectCardHtml(msg)}
        ${errorHtml(msg)}
        ${metricsHtml(msg)}
        ${streaming || msg.error || msg.needsKey ? '' : actionButtons(msg, index, chat)}
      </div>
    </div>`;
  }

  function fmtTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderMessages() {
    const chat = activeChat();
    if (!chat || !chat.messages.length) {
      els.empty.hidden = false;
      els.messages.hidden = true;
      els.messages.innerHTML = '';
      renderEmptyProviders();
      return;
    }
    els.empty.hidden = true;
    els.messages.hidden = false;
    els.messages.innerHTML = chat.messages.map((m, i) => messageHtml(m, i, chat)).join('');
    hydrateLogos(els.messages);
  }

  function hydrateLogos(root) {
    $$('[data-brand]', root).forEach((el) => {
      if (el.dataset.brandReady) return;
      const size = Number(el.dataset.brandSize || 16);
      el.innerHTML = B(el.dataset.brand, size);
      el.dataset.brandReady = '1';
      el.setAttribute('aria-hidden', 'true');
    });
  }

  function renderEmptyProviders() {
    const box = els.providerQuick;
    if (!box) return;
    if (!state.settings) return;
    const providers = Object.keys(M.PROVIDERS).filter((id) => id !== 'custom');
    box.innerHTML = providers
      .map((id) => {
        const p = M.PROVIDERS[id];
        const on = !!state.settings.keys[id];
        return `<button data-connect="${id}" class="${on ? 'connected' : ''}" title="${esc(p.name)}">
          <span class="p-logo sm" data-brand="${p.brand}" data-brand-size="14"></span>
          ${esc(p.name.replace(' · Alibaba', '').replace(' · GLM', ''))}
          ${on ? ic('check', 11) : ''}
        </button>`;
      })
      .join('');
    hydrateLogos(box);
    if (els.connectStrip) els.connectStrip.hidden = anyKeyConnected();
  }

  function renderAll() {
    renderTopbar();
    renderAccountSlot();
    renderSidebar();
    renderMessages();
    renderComposerHint();
    applyPlatformKeys();
  }

  function renderComposerHint() {
    const hint = $('.composer-hint');
    if (!hint) return;
    hint.innerHTML =
      state.settings.sendKey === 'enter'
        ? '<span class="kbd">↵</span> send <span class="kbd">⇧↵</span> newline'
        : '<span class="kbd">⌘</span><span class="kbd">↵</span> send';
  }

  const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
  function applyPlatformKeys() {
    if (IS_MAC) return;
    $$('.kbd').forEach((k) => {
      if (k.textContent.indexOf('⌘') > -1) k.textContent = k.textContent.replace(/⌘/g, 'Ctrl');
    });
  }

  function scrollToBottom(force) {
    const t = els.thread;
    if (!t) return;
    const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 180;
    if (force || nearBottom) t.scrollTop = t.scrollHeight + 220;
  }

  /* ---------------------------- chat lifecycle ---------------------------- */
  function createChat() {
    const chat = {
      id: uid(),
      title: 'New chat',
      model: state.settings.model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false
    };
    state.chats.unshift(chat);
    state.activeId = chat.id;
    persistNow();
    renderAll();
    return chat;
  }

  function titleFrom(text) {
    const clean = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').slice(0, 8).join(' ');
    const t = words.length > 48 ? words.slice(0, 48).trimEnd() + '…' : words;
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'New chat';
  }

  function openChat(id) {
    state.activeId = id;
    const chat = activeChat();
    if (chat && !chat.model) chat.model = state.settings.model;
    persist();
    renderAll();
    if (window.innerWidth <= 900) setSidebar(false);
    scrollToBottom(true);
  }

  function deleteChat(id) {
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) return;
    confirmAction({
      title: 'Delete conversation?',
      body: `“${esc(chat.title)}” and its ${chat.messages.length} messages will be removed from this browser. This cannot be undone.`,
      ok: 'Delete'
    }).then((yes) => {
      if (!yes) return;
      state.chats = state.chats.filter((c) => c.id !== id);
      if (state.activeId === id) state.activeId = state.chats.length ? state.chats[0].id : null;
      persistNow();
      renderAll();
      toast('Conversation deleted', 'trash-2');
    });
  }

  function clearChat(id) {
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) return;
    confirmAction({
      title: 'Clear this conversation?',
      body: 'All messages will be removed. The chat itself stays in your sidebar.',
      ok: 'Clear'
    }).then((yes) => {
      if (!yes) return;
      chat.messages = [];
      chat.updatedAt = Date.now();
      persistNow();
      renderAll();
      toast('Conversation cleared', 'check');
    });
  }

  function commitRename(value) {
    const id = state.renameId;
    if (!id) return;
    const chat = state.chats.find((c) => c.id === id);
    if (chat) {
      chat.title = (value || '').trim().slice(0, 80) || 'Untitled chat';
      chat.updatedAt = chat.updatedAt || Date.now();
    }
    state.renameId = null;
    persistNow();
    renderSidebar();
  }
  function cancelRename() { state.renameId = null; renderSidebar(); }

  /* --------------------------------- menus -------------------------------- */
  let openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; $$('.chat-row.menu-open').forEach((r) => r.classList.remove('menu-open')); }
  }
  function showMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items
      .map((it) => it === 'sep' ? '<hr />'
        : `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-item="${it.key}">${ic(it.icon, 14)}<span>${esc(it.label)}</span></button>`)
      .join('');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 180;
    const h = menu.offsetHeight || 160;
    menu.style.left = `${clamp(r.right - w, 10, window.innerWidth - w - 10)}px`;
    menu.style.top = `${clamp(r.bottom + 6, 10, window.innerHeight - h - 10)}px`;
    openMenu = menu;
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-item]');
      if (!btn) return;
      const item = items.find((it) => it !== 'sep' && it.key === btn.dataset.item);
      closeMenu();
      if (item && item.action) item.action();
    });
    const row = anchor.closest('.chat-row');
    if (row) row.classList.add('menu-open');
  }
  document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });

  /* -------------------------------- dialogs ------------------------------- */
  function openDialog(dlg, focusSel) {
    if (!dlg) return;
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') {
        try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
      } else dlg.setAttribute('open', '');
    }
    if (focusSel) setTimeout(() => { const el = $(focusSel, dlg); if (el) el.focus(); }, 30);
  }
  function closeDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    else dlg.removeAttribute('open');
  }
  $$('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
    $$('[data-close]', dlg).forEach((btn) => btn.addEventListener('click', () => closeDialog($('#' + btn.dataset.close))));
  });

  /* ------------------------------ model picker ---------------------------- */
  function renderModelList(filter = '') {
    const q = filter.trim().toLowerCase();
    const current = currentModelId();
    const favs = state.settings.favorites || [];
    const matches = M.MODELS.filter((m) => {
      if (!q) return true;
      const p = M.providerOf(m);
      return [m.name, p.name, m.tier, m.blurb, m.id, ...(m.tags || [])].join(' ').toLowerCase().includes(q);
    });
    if (!matches.length) {
      els.modelList.innerHTML = `<div class="pick-empty">No models match “${esc(filter)}”.<br />Try “claude”, “fast”, “glm” or “vision”.</div>`;
      return;
    }
    const favorites = matches.filter((m) => favs.includes(m.id));
    const others = matches.filter((m) => !favs.includes(m.id));

    const item = (m) => {
      const p = M.providerOf(m);
      const starred = favs.includes(m.id);
      const isCurrent = m.id === current;
      const keyed = hasKeyFor(m);
      return `<button class="pick-item${isCurrent ? ' current' : ''}" data-model-id="${m.id}" role="option" aria-selected="${isCurrent}">
        <span class="p-logo" data-brand="${p.brand}" data-brand-size="17"></span>
        <span class="info">
          <strong>${esc(m.name)}
            <span class="tag">${esc(m.tier)}</span>
            ${keyed
              ? `<span class="tag" style="color:#8ce6c4;border-color:rgba(55,214,160,.26)">key</span>`
              : `<span class="needs-key">needs key</span>`}
          </strong>
          <span>${esc(p.name)} · ${esc(m.context)} context · ${esc(m.blurb)}</span>
        </span>
        <span class="right">
          ${isCurrent ? `<span class="check">${ic('check', 14)}</span>` : ''}
          <span class="star${starred ? ' on' : ''}" data-star="${m.id}" role="button" tabindex="0" aria-label="${starred ? 'Unstar' : 'Star'} ${esc(m.name)}" title="${starred ? 'Unstar' : 'Star'}">${starred ? ic('star', 14) : ic('star', 14)}</span>
        </span>
      </button>`;
    };
    const group = (label, list) => (list.length ? `<div class="pick-group">${label}</div>${list.map(item).join('')}` : '');
    els.modelList.innerHTML = group('Starred', favorites) + (q ? group('All models', others) : group('Anthropic · OpenAI · Google · Z.ai · DeepSeek · xAI · Qwen', others));
    hydrateLogos(els.modelList);

    const foot = $('#keysFoot');
    if (foot) {
      const n = connectedKeyCount();
      const live = hasKeyFor(currentModel());
      foot.textContent = n
        ? `${n} key${n === 1 ? '' : 's'} connected · ${live ? 'ready to stream' : 'this model needs a key'}`
        : 'No API keys connected — pick a provider to add one';
    }
  }

  function selectModel(id) {
    const model = M.byId(id);
    const chat = activeChat();
    if (chat && chat.messages.length) {
      chat.model = id;
      chat.updatedAt = Date.now();
    } else {
      if (chat) chat.model = id;
      state.settings.model = id;
    }
    persistNow();
    renderTopbar();
    renderMessages();
    renderSidebar();
    if (!hasKeyFor(model)) toast(`${model.name} selected · add a ${M.providerOf(model).name} key`, 'key-round');
    else toast(`Switched to ${model.name}`, 'check');
  }

  function setDefaultModel(id) {
    state.settings.model = id;
    const chat = activeChat();
    if (chat && !chat.messages.length) chat.model = id;
    persistNow();
    renderAll();
    renderDefaultSelect();
    toast(`Default model: ${M.byId(id).name}`, 'check');
  }

  const openModelPicker = () => {
    state.modelPickerFor = 'current';
    renderModelList('');
    els.modelSearch.value = '';
    openDialog(els.modelDialog, '#modelSearch');
  };
  $('#modelBtn').addEventListener('click', openModelPicker);
  $('#composerModel').addEventListener('click', openModelPicker);
  els.modelSearch.addEventListener('input', () => renderModelList(els.modelSearch.value));
  els.modelSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = els.modelList.querySelector('.pick-item');
    if (!first) return;
    if (state.modelPickerFor === 'default') setDefaultModel(first.dataset.modelId);
    else selectModel(first.dataset.modelId);
    closeDialog(els.modelDialog);
  });
  els.modelList.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); toggleFavorite(star.dataset.star); renderModelList(els.modelSearch.value); return; }
    const item = e.target.closest('[data-model-id]');
    if (!item) return;
    if (state.modelPickerFor === 'default') setDefaultModel(item.dataset.modelId);
    else selectModel(item.dataset.modelId);
    closeDialog(els.modelDialog);
  });
  els.modelList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const star = e.target.closest('[data-star]');
    if (!star) return;
    e.preventDefault();
    toggleFavorite(star.dataset.star);
    renderModelList(els.modelSearch.value);
  });

  function toggleFavorite(id) {
    const favs = state.settings.favorites || [];
    state.settings.favorites = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
    persist();
    renderModelPrefs();
  }

  $('#manageKeysBtn').addEventListener('click', () => { closeDialog(els.modelDialog); openSettings('keys'); });
  els.keyPill.addEventListener('click', () => openSettings('keys'));

  /* ---------------------------- command palette --------------------------- */
  let cmdItems = [];
  let cmdCursor = 0;

  function buildCommands(query) {
    const q = query.trim().toLowerCase();
    const actions = [
      { label: 'New chat', icon: 'plus', hint: '⌘N', run: () => { closeDialog(els.cmdDialog); newChat(); } },
      { label: 'Switch model', icon: 'layers', hint: '⌘M', run: () => { closeDialog(els.cmdDialog); openModelPicker(); } },
      { label: 'Connect a provider key', icon: 'key-round', run: () => { closeDialog(els.cmdDialog); openSettings('keys'); } },
      { label: 'Open settings', icon: 'settings', hint: '⌘,', run: () => { closeDialog(els.cmdDialog); openSettings('general'); } },
      { label: 'Toggle sidebar', icon: 'panel-left', hint: '⌘B', run: () => { closeDialog(els.cmdDialog); toggleSidebar(); } },
      { label: 'Export conversation', icon: 'download', run: () => { closeDialog(els.cmdDialog); openShare(); } },
      { label: 'Copy last reply', icon: 'copy', run: () => { closeDialog(els.cmdDialog); copyLastReply(); } },
      { label: 'Clear current conversation', icon: 'rotate-ccw', run: () => { closeDialog(els.cmdDialog); const c = activeChat(); if (c) clearChat(c.id); } },
      { label: 'Toggle tools for this chat', icon: 'wrench', run: () => { closeDialog(els.cmdDialog); toggleTools(); } },
      { label: 'Documentation', icon: 'book-open', run: () => { window.location.href = 'docs.html'; } },
      { label: 'Back to eltes.ai', icon: 'arrow-left', run: () => { window.location.href = 'index.html'; } }
    ];
    const chats = state.chats.map((c) => ({
      label: c.title,
      icon: 'message-square',
      hint: new Date(c.updatedAt || c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      run: () => { closeDialog(els.cmdDialog); openChat(c.id); }
    }));
    return {
      actions: actions.filter((a) => !q || a.label.toLowerCase().includes(q)),
      chats: chats.filter((c) => !q || c.label.toLowerCase().includes(q))
    };
  }

  function renderCmd(query = '') {
    const { actions, chats } = buildCommands(query);
    cmdItems = [...actions, ...chats];
    cmdCursor = 0;
    if (!cmdItems.length) {
      els.cmdList.innerHTML = `<div class="pick-empty">Nothing matches “${esc(query)}”.</div>`;
      $('#cmdCount').textContent = '0 results';
      return;
    }
    const row = (item, index) => `<button class="cmd-item${index === 0 ? ' cursor' : ''}" data-cmd="${index}" role="option">
      ${ic(item.icon, 15)}<span class="trunc">${esc(item.label)}</span>
      ${item.hint ? `<span class="hint">${esc(item.hint)}</span>` : ''}</button>`;
    let html = '';
    if (actions.length) html += `<div class="pick-group">Actions</div>${actions.map((a, i) => row(a, i)).join('')}`;
    if (chats.length) html += `<div class="pick-group">Conversations</div>${chats.map((c, i) => row(c, actions.length + i)).join('')}`;
    els.cmdList.innerHTML = html;
    $('#cmdCount').textContent = `${cmdItems.length} result${cmdItems.length === 1 ? '' : 's'}`;
  }

  function openCommandPalette() {
    els.cmdSearch.value = '';
    renderCmd('');
    openDialog(els.cmdDialog, '#cmdSearch');
  }
  function moveCursor(delta) {
    if (!cmdItems.length) return;
    cmdCursor = (cmdCursor + delta + cmdItems.length) % cmdItems.length;
    $$('.cmd-item', els.cmdList).forEach((r, i) => r.classList.toggle('cursor', i === cmdCursor));
    const el = $$('.cmd-item', els.cmdList)[cmdCursor];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  els.cmdSearch.addEventListener('input', () => renderCmd(els.cmdSearch.value));
  els.cmdSearch.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
    if (e.key === 'Enter') { e.preventDefault(); const item = cmdItems[cmdCursor]; if (item) item.run(); }
  });
  els.cmdList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (btn && cmdItems[Number(btn.dataset.cmd)]) cmdItems[Number(btn.dataset.cmd)].run();
  });

  /* -------------------------------- settings ------------------------------ */
  function openSettings(tab = 'general') {
    renderKeyList();
    renderModelPrefs();
    renderDefaultSelect();
    renderAccountPanel();
    applySettingsToUI();
    setTab(tab);
    openDialog(els.settingsDialog);
  }
  function setTab(name) {
    $$('.settings-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('#settingsPanel > section').forEach((s) => s.classList.toggle('active', s.dataset.panel === name));
    const panel = $('#settingsPanel');
    if (panel) panel.scrollTop = 0;
  }
  $$('.settings-nav button').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

  function applySettingsToUI() {
    const s = state.settings;
    const setToggle = (id, val) => { const t = $(id); if (t) t.setAttribute('aria-checked', String(!!val)); };
    setToggle('#toggleStream', s.stream);
    setToggle('#toggleTools', s.tools);
    setToggle('#toggleMotion', s.reduceMotion);
    setToggle('#toggleTime', s.showTime);
    setToggle('#toggleMetrics', s.showMetrics);
    const sendKey = $('#sendKeySelect'); if (sendKey) sendKey.value = s.sendKey;
    const density = $('#densitySelect'); if (density) density.value = s.density;
    const customUrl = $('#customBaseUrl'); if (customUrl) customUrl.value = s.customBaseUrl || '';
    const customKey = $('#customKey'); if (customKey) customKey.value = s.customKey || '';
    const customModel = $('#customModel'); if (customModel) customModel.value = s.customModel || '';
    const defaultLabel = $('#defaultModelLabel');
    if (defaultLabel) defaultLabel.textContent = M.byId(s.model).name;
    document.body.classList.toggle('compact', s.density === 'compact');
    document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
    $('#agentChip').classList.toggle('on', !!s.tools);
    $('#agentChip').setAttribute('aria-pressed', String(!!s.tools));
    renderComposerHint();
    applyPlatformKeys();
  }

  function bindToggle(sel, key, after) {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('click', () => {
      state.settings[key] = !state.settings[key];
      el.setAttribute('aria-checked', String(state.settings[key]));
      persist();
      if (after) after();
    });
  }
  bindToggle('#toggleStream', 'stream');
  bindToggle('#toggleTools', 'tools', applySettingsToUI);
  bindToggle('#toggleMotion', 'reduceMotion', applySettingsToUI);
  bindToggle('#toggleTime', 'showTime', renderMessages);
  bindToggle('#toggleMetrics', 'showMetrics', renderMessages);
  $('#sendKeySelect').addEventListener('change', (e) => { state.settings.sendKey = e.target.value; persist(); renderComposerHint(); });
  $('#densitySelect').addEventListener('change', (e) => { state.settings.density = e.target.value; persist(); applySettingsToUI(); });

  $('#defaultModelBtn').addEventListener('click', () => {
    state.modelPickerFor = 'default';
    renderModelList('');
    els.modelSearch.value = '';
    openDialog(els.modelDialog, '#modelSearch');
  });

  function renderDefaultSelect() {
    const sel = $('#defaultModelSelect');
    if (!sel) return;
    sel.innerHTML = M.MODELS.map(
      (m) => `<option value="${m.id}"${m.id === state.settings.model ? ' selected' : ''}>${esc(m.name)} · ${esc(M.providerOf(m).name)}</option>`
    ).join('');
  }
  $('#defaultModelSelect').addEventListener('change', (e) => setDefaultModel(e.target.value));

  function renderKeyList() {
    const providers = Object.keys(M.PROVIDERS).filter((p) => p !== 'custom');
    els.keyList.innerHTML = providers
      .map((id) => {
        const p = M.PROVIDERS[id];
        const val = state.settings.keys[id] || '';
        const connected = !!val;
        return `<div class="key-provider${connected ? ' connected' : ''}" data-provider="${id}">
          <div class="key-top">
            <span class="p-logo" data-brand="${p.brand}" data-brand-size="17"></span>
            <span class="who"><strong>${esc(p.name)}</strong><span>${esc(p.blurb)}</span></span>
            <span class="key-status${connected ? ' ok' : ''}"><i></i>${connected ? 'Connected' : 'No key'}</span>
          </div>
          <div class="key-input-row">
            <label class="key-input">
              <span data-icon="key-round" data-icon-size="13"></span>
              <input type="${connected ? 'password' : 'text'}" data-key-input="${id}" value="${esc(val)}" placeholder="${esc(p.keyHint)}" aria-label="${esc(p.name)} API key" autocomplete="off" spellcheck="false" />
              <button class="icon-btn" type="button" data-reveal="${id}" aria-label="Show or hide key" title="Show or hide">${ic('eye', 13)}</button>
            </label>
            <div class="key-actions">
              <button class="btn btn-ghost btn-sm" data-save-key="${id}">Save</button>
              ${connected ? `<button class="icon-btn" data-remove-key="${id}" aria-label="Remove key" title="Remove">${ic('trash-2', 14)}</button>` : ''}
            </div>
          </div>
          <div class="key-help"><span data-icon="lock" data-icon-size="10"></span>Stored locally · ${p.keyUrl ? `<a href="${p.keyUrl}" target="_blank" rel="noreferrer">get a ${esc(p.name.split(' · ')[0])} key</a>` : 'your own endpoint'}</div>
        </div>`;
      })
      .join('');
    hydrateLogos(els.keyList);
    I.hydrate(els.keyList);
  }

  els.keyList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('[data-key-input]');
    if (!input) return;
    e.preventDefault();
    const btn = els.keyList.querySelector(`[data-save-key="${input.dataset.keyInput}"]`);
    if (btn) btn.click();
  });

  els.keyList.addEventListener('click', (e) => {
    const reveal = e.target.closest('[data-reveal]');
    if (reveal) {
      const input = els.keyList.querySelector(`[data-key-input="${reveal.dataset.reveal}"]`);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        reveal.innerHTML = ic(input.type === 'password' ? 'eye' : 'eye-off', 13);
      }
      return;
    }
    const save = e.target.closest('[data-save-key]');
    if (save) {
      const id = save.dataset.saveKey;
      const input = els.keyList.querySelector(`[data-key-input="${id}"]`);
      const value = (input.value || '').trim();
      if (value) state.settings.keys[id] = value;
      else delete state.settings.keys[id];
      persistNow();
      renderKeyList();
      renderTopbar();
      renderEmptyProviders();
      renderModelList(els.modelSearch.value);
      toast(value ? `${M.PROVIDERS[id].name} key saved locally` : `${M.PROVIDERS[id].name} key removed`, value ? 'check' : 'trash-2');
      if (value && state.pendingRetry) {
        const pending = state.pendingRetry;
        state.pendingRetry = null;
        closeDialog(els.settingsDialog);
        retryTurn(pending.chat, pending.msg);
      }
      return;
    }
    const remove = e.target.closest('[data-remove-key]');
    if (remove) {
      delete state.settings.keys[remove.dataset.removeKey];
      persistNow();
      renderKeyList();
      renderTopbar();
      renderEmptyProviders();
      renderModelList(els.modelSearch.value);
      toast(`${M.PROVIDERS[remove.dataset.removeKey].name} key removed`, 'trash-2');
    }
  });

  $('#customSave').addEventListener('click', () => {
    const url = ($('#customBaseUrl').value || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) { toast('Base URL must start with http:// or https://', 'triangle-alert'); return; }
    state.settings.customBaseUrl = url;
    state.settings.customModel = ($('#customModel').value || '').trim();
    state.settings.customKey = ($('#customKey').value || '').trim();
    persistNow();
    renderTopbar();
    renderEmptyProviders();
    toast(url ? 'Custom endpoint saved' : 'Custom endpoint cleared', url ? 'check' : 'trash-2');
  });

  function renderModelPrefs() {
    const favs = state.settings.favorites || [];
    els.modelPrefs.innerHTML = M.MODELS.map((m) => {
      const p = M.providerOf(m);
      const on = favs.includes(m.id);
      const keyed = hasKeyFor(m);
      return `<div class="set-row">
        <span class="p-logo sm" data-brand="${p.brand}" data-brand-size="14"></span>
        <div class="lbl"><strong>${esc(m.name)}</strong><span>${esc(p.name)} · ${esc(m.context)}${keyed ? ' · connected' : ''}</span></div>
        <div class="ctl"><button class="toggle" role="switch" aria-checked="${on}" data-fav="${m.id}" aria-label="Star ${esc(m.name)}"></button></div>
      </div>`;
    }).join('');
    hydrateLogos(els.modelPrefs);
  }
  els.modelPrefs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fav]');
    if (!btn) return;
    toggleFavorite(btn.dataset.fav);
    btn.setAttribute('aria-checked', String((state.settings.favorites || []).includes(btn.dataset.fav)));
    renderModelList(els.modelSearch.value);
  });

  /* ------------------------------ account panel --------------------------- */
  function renderAccountPanel() {
    const box = $('#accountPanel');
    if (!box) return;
    const account = Account && Account.get();
    if (!account) {
      box.innerHTML = `
        <div class="profile-card">
          <span class="avatar lg" aria-hidden="true">EL</span>
          <div class="who"><strong>Not signed in</strong><span>Anonymous local workspace</span></div>
          <span class="badge"><span class="dot"></span>BYOK</span>
        </div>
        <p class="group-desc" style="margin-top:0">Create a profile to keep a name, avatar and preferences together. It is stored in this browser and can be deleted at any time.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-primary btn-sm" href="auth.html?mode=signup">Create account</a>
          <a class="btn btn-ghost btn-sm" href="auth.html?method=github"><span data-icon="github" data-icon-size="14"></span>Continue with GitHub</a>
        </div>`;
      I.hydrate(box);
      return;
    }
    box.innerHTML = `
      <div class="profile-card">
        ${Account.avatarHtml(account, 'lg')}
        <div class="who">
          <strong>${esc(account.name)}</strong>
          <span>${esc(account.email || (account.username ? '@' + account.username : 'Local profile'))}</span>
        </div>
        <span class="badge"><span class="dot"></span>${account.provider === 'github' ? 'GitHub' : 'Local'}</span>
      </div>
      <div class="set-row">
        <div class="lbl"><strong>Display name</strong><span>Shown in the sidebar and account menu.</span></div>
        <div class="ctl">
          <label class="key-input" style="max-width:210px">
            <input type="text" id="accountNameInput" value="${esc(account.name)}" aria-label="Display name" autocomplete="off" />
          </label>
          <button class="btn btn-ghost btn-sm" id="accountNameSave">Save</button>
        </div>
      </div>
      <div class="set-row">
        <div class="lbl"><strong>Email</strong><span>Only used locally. No email is ever sent.</span></div>
        <div class="ctl"><span class="mono" style="font-size:11.5px;color:var(--text-2)">${esc(account.email || '—')}</span></div>
      </div>
      <div class="set-row">
        <div class="lbl"><strong>Account page</strong><span>Manage sign-in, avatar and profile details.</span></div>
        <div class="ctl"><a class="btn btn-ghost btn-sm" href="auth.html">Open<span data-icon="arrow-up-right" data-icon-size="12"></span></a></div>
      </div>
      <div class="set-row">
        <div class="lbl"><strong>Sign out</strong><span>Keeps chats and keys on this device.</span></div>
        <div class="ctl"><button class="btn btn-ghost btn-sm" id="accountSignOut">Sign out</button></div>
      </div>
      <div class="set-row">
        <div class="lbl"><strong>Delete profile</strong><span>Removes name and email only. Chats stay.</span></div>
        <div class="ctl"><button class="btn btn-danger btn-sm" id="accountDelete">Delete</button></div>
      </div>`;
    I.hydrate(box);
    $('#accountNameSave').addEventListener('click', () => {
      const name = ($('#accountNameInput').value || '').trim();
      if (name.length < 2) { toast('Use at least two characters', 'triangle-alert'); return; }
      Account.create(Object.assign({}, account, { name }));
      renderAccountSlot();
      renderTopbar();
      toast('Profile updated', 'user-check');
    });
    $('#accountSignOut').addEventListener('click', () => {
      Account.signOut();
      renderAccountSlot();
      renderTopbar();
      renderAccountPanel();
      toast('Signed out locally', 'log-out');
    });
    $('#accountDelete').addEventListener('click', () => {
      confirmAction({ title: 'Delete profile?', body: 'Your name and email are removed from this browser. Chats and API keys stay.', ok: 'Delete profile' })
        .then((yes) => {
          if (!yes) return;
          Account.signOut();
          renderAccountSlot();
          renderTopbar();
          renderAccountPanel();
          toast('Profile deleted', 'trash-2');
        });
    });
  }

  /* --------------------------------- data --------------------------------- */
  function download(filename, text, type = 'text/plain') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function exportAll() {
    const payload = {
      app: 'Eltes',
      version: 2,
      exportedAt: new Date().toISOString(),
      chats: state.chats,
      settings: Object.assign({}, state.settings, { keys: {}, customKey: '' })
    };
    download(`eltes-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup downloaded (keys excluded)', 'download');
  }
  $('#exportAll').addEventListener('click', exportAll);
  $('#exportChats').addEventListener('click', exportAll);
  $('#refreshStorage').addEventListener('click', () => { updateStorageUI(); toast('Storage usage refreshed', 'refresh-cw'); });

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.chats)) throw new Error('bad file');
        state.chats = normalizeChats(data.chats);
        if (data.settings) {
          const keys = state.settings.keys;
          state.settings = Object.assign({}, DEFAULTS, data.settings, { keys });
        }
        state.activeId = state.chats.length ? state.chats[0].id : null;
        persistNow();
        applySettingsToUI();
        renderKeyList();
        renderModelPrefs();
        renderDefaultSelect();
        renderAll();
        toast(`Imported ${state.chats.length} conversations`, 'check');
      } catch (err) {
        toast('That file is not an Eltes backup', 'triangle-alert');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#clearChats').addEventListener('click', () => {
    confirmAction({
      title: 'Delete all chats?',
      body: `All ${state.chats.length} conversations will be removed from this browser. API keys, profile and settings are kept.`,
      ok: 'Delete all'
    }).then((yes) => {
      if (!yes) return;
      state.chats = [];
      state.activeId = null;
      persistNow();
      renderAll();
      toast('All conversations deleted', 'trash-2');
    });
  });

  /* -------------------------------- share --------------------------------- */
  function transcriptMarkdown(chat) {
    const lines = [`# ${chat.title}`, '', `Model: ${M.byId(chat.model).name} · ${new Date(chat.createdAt).toLocaleString()}`, ''];
    (chat.messages || []).forEach((m) => {
      if (m.role === 'user') lines.push('## You', '', m.content, '');
      else {
        lines.push(`## Eltes (${M.byId(m.model || chat.model).name})`, '', m.content, '');
        if (m.tools && m.tools.length) {
          lines.push(`<sub>Tools: ${m.tools.map((t) => `${t.name}(${JSON.stringify(t.args)}) → ${t.runtime} ms`).join(' · ')}</sub>`, '');
        }
        if (m.usage) lines.push(`<sub>${m.usage.input || 0} in · ${m.usage.output || 0} out · ${fmtMs((m.latency || {}).total)}</sub>`, '');
      }
    });
    lines.push('---', 'Exported from Eltes — local-first AI workspace.');
    return lines.join('\n');
  }
  function openShare() {
    const chat = activeChat();
    const preview = $('#sharePreview');
    if (!chat || !chat.messages.length) preview.textContent = 'No conversation yet. Send a message first, then export it.';
    else {
      const md = transcriptMarkdown(chat);
      preview.textContent = md.slice(0, 420) + (md.length > 420 ? '\n…' : '');
    }
    openDialog(els.shareDialog);
  }
  $('#shareBtn').addEventListener('click', openShare);
  $('#copyTranscript').addEventListener('click', () => {
    const chat = activeChat();
    if (!chat || !chat.messages.length) return toast('Nothing to copy yet', 'triangle-alert');
    copyText(transcriptMarkdown(chat));
  });
  $('#downloadMarkdown').addEventListener('click', () => {
    const chat = activeChat();
    if (!chat || !chat.messages.length) return toast('Nothing to export yet', 'triangle-alert');
    const slug = (chat.title || 'conversation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    download(`${slug || 'eltes-chat'}.md`, transcriptMarkdown(chat), 'text/markdown');
    toast('Markdown downloaded', 'download');
  });
  $('#downloadJson').addEventListener('click', () => {
    const chat = activeChat();
    if (!chat || !chat.messages.length) return toast('Nothing to export yet', 'triangle-alert');
    download(`eltes-chat-${chat.id}.json`, JSON.stringify({ app: 'Eltes', chat }, null, 2), 'application/json');
    toast('JSON downloaded', 'download');
  });
  $('#docsBtn').addEventListener('click', () => { window.location.href = 'docs.html'; });
  $('#settingsBtn').addEventListener('click', () => openSettings('general'));
  $('#profileCard').addEventListener('click', () => openSettings(Account && Account.get() ? 'account' : 'general'));
  $('#profileCard').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettings('general'); } });
  $('#cmdBtn').addEventListener('click', openCommandPalette);
  $('#searchBtn').addEventListener('click', openCommandPalette);

  /* -------------------------------- confirm ------------------------------- */
  let confirmResolve = null;
  function confirmAction({ title, body, ok = 'Delete' }) {
    $('#confirmTitle').textContent = title;
    $('#confirmBody').innerHTML = body;
    $('#confirmOk').textContent = ok;
    openDialog(els.confirmDialog);
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  const settleConfirm = (val) => {
    closeDialog(els.confirmDialog);
    if (confirmResolve) { confirmResolve(val); confirmResolve = null; }
  };
  $('#confirmOk').addEventListener('click', () => settleConfirm(true));
  $('#confirmCancel').addEventListener('click', () => settleConfirm(false));
  els.confirmDialog.addEventListener('close', () => { if (confirmResolve) { confirmResolve(false); confirmResolve = null; } });

  /* ------------------------------- sidebar -------------------------------- */
  function setSidebar(open) {
    const mobile = window.innerWidth <= 900;
    els.shell.classList.toggle('collapsed', !open);
    $('#sideBackdrop').classList.toggle('show', mobile && open);
  }
  function toggleSidebar() { setSidebar(els.shell.classList.contains('collapsed')); }
  $('#sidebarBtn').addEventListener('click', toggleSidebar);
  $('#collapseBtn').addEventListener('click', () => setSidebar(false));
  $('#sideBackdrop').addEventListener('click', () => setSidebar(false));

  function newChat() {
    if (state.sending) stopGeneration();
    const current = activeChat();
    if (!current || !current.messages.length) {
      els.input.focus();
      if (window.innerWidth <= 900) setSidebar(false);
      return;
    }
    createChat();
    els.input.value = '';
    autoGrow();
    updateSendState();
    els.input.focus();
    if (window.innerWidth <= 900) setSidebar(false);
  }
  $('#newChatBtn').addEventListener('click', newChat);

  els.chatList.addEventListener('click', (e) => {
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      e.stopPropagation();
      const chat = state.chats.find((c) => c.id === pin.dataset.pin);
      if (chat) {
        chat.pinned = !chat.pinned;
        persistNow();
        renderSidebar();
        toast(chat.pinned ? 'Pinned to top' : 'Unpinned', 'pin');
      }
      return;
    }
    const more = e.target.closest('[data-menu]');
    if (more) {
      e.stopPropagation();
      const chat = state.chats.find((c) => c.id === more.dataset.menu);
      if (!chat) return;
      showMenu(more, [
        { key: 'pin', label: chat.pinned ? 'Unpin conversation' : 'Pin conversation', icon: 'pin', action: () => { chat.pinned = !chat.pinned; persistNow(); renderSidebar(); } },
        { key: 'rename', label: 'Rename', icon: 'pencil', action: () => { state.renameId = chat.id; renderSidebar(); } },
        { key: 'clear', label: 'Clear messages', icon: 'rotate-ccw', action: () => clearChat(chat.id) },
        { key: 'export', label: 'Export as Markdown', icon: 'download', action: () => { openChat(chat.id); openShare(); } },
        'sep',
        { key: 'delete', label: 'Delete', icon: 'trash-2', danger: true, action: () => deleteChat(chat.id) }
      ]);
      return;
    }
    if (e.target.closest('.rename-input')) return;
    const row = e.target.closest('[data-chat]');
    if (row) openChat(row.dataset.chat);
  });
  els.chatList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('chat-row')) {
      e.preventDefault();
      openChat(e.target.dataset.chat);
    }
  });

  /* -------------------------------- composer ------------------------------ */
  function autoGrow() {
    const ta = els.input;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 190)}px`;
  }
  function updateSendState() {
    if (!els.send) return;
    els.send.disabled = !state.sending && !els.input.value.trim();
  }
  function setSending(on) {
    state.sending = on;
    els.send.classList.toggle('stop', on);
    els.send.innerHTML = on ? '<span class="stop-square"></span>' : ic('arrow-up', 17);
    els.send.setAttribute('aria-label', on ? 'Stop generating' : 'Send message');
    updateSendState();
  }
  function stopGeneration() {
    state.stopped = true;
    if (state.abort) { try { state.abort.abort(); } catch (e) {} }
    toast('Generation stopped', 'square');
  }
  function toggleTools() {
    state.settings.tools = !state.settings.tools;
    persist();
    applySettingsToUI();
    toast(state.settings.tools ? 'Tools enabled for new messages' : 'Tools disabled', 'wrench');
  }

  els.input.addEventListener('input', () => { autoGrow(); updateSendState(); });
  els.input.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key !== 'Enter') return;
    if (state.settings.sendKey === 'enter' && !e.shiftKey && !mod) { e.preventDefault(); send(); }
    else if (state.settings.sendKey === 'mod-enter' && mod) { e.preventDefault(); send(); }
  });
  els.send.addEventListener('click', () => { if (state.sending) stopGeneration(); else send(); });
  $('#agentChip').addEventListener('click', toggleTools);
  $('#connectNow').addEventListener('click', () => openConnect(''));
  $('#connectAdvanced').addEventListener('click', () => { closeDialog(els.connectDialog); openSettings('keys'); });

  $$('.suggestion').forEach((btn) => btn.addEventListener('click', () => {
    els.input.value = btn.dataset.prompt || '';
    autoGrow();
    updateSendState();
    els.input.focus();
  }));

  els.providerQuick.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-connect]');
    if (btn) openConnect(btn.dataset.connect);
  });

  /* -------------------------------- attach -------------------------------- */
  const LANG_BY_EXT = {
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', json: 'json',
    css: 'css', scss: 'css', html: 'html', xml: 'xml', py: 'python', go: 'go',
    rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', sh: 'bash', sql: 'sql',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', env: 'bash', csv: 'csv', log: 'text',
    ini: 'ini', md: 'markdown', markdown: 'markdown', txt: 'text'
  };
  async function attachFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let added = 0;
    let bytes = 0;
    for (const file of files) {
      if (file.size > 400 * 1024) { toast(`${file.name} is too large (max 400 KB per file)`, 'triangle-alert'); continue; }
      bytes += file.size;
      if (bytes > 800 * 1024) { toast('Attachments are limited to 800 KB in total', 'triangle-alert'); break; }
      let text;
      try { text = await file.text(); } catch (e) { toast(`${file.name} could not be read`, 'triangle-alert'); continue; }
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const fence = text.includes('```') ? '````' : '```';
      const current = els.input.value.trimEnd();
      els.input.value = `${current}${current ? '\n\n' : ''}**${file.name}** (${Math.max(1, Math.round(file.size / 1024))} KB)\n${fence}${LANG_BY_EXT[ext] || 'text'}\n${text.replace(/\n$/, '')}\n${fence}\n`;
      added++;
    }
    if (added) {
      autoGrow();
      updateSendState();
      els.input.focus();
      els.input.scrollTop = els.input.scrollHeight;
      toast(`${added} file${added === 1 ? '' : 's'} attached to this prompt`, 'paperclip');
    }
  }
  $('#attachBtn').addEventListener('click', () => $('#attachInput').click());
  $('#attachInput').addEventListener('change', (e) => { attachFiles(e.target.files); e.target.value = ''; });
  const composerEl = $('#composer');
  composerEl.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      composerEl.classList.add('dragging');
    }
  });
  composerEl.addEventListener('dragleave', () => composerEl.classList.remove('dragging'));
  composerEl.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    composerEl.classList.remove('dragging');
    attachFiles(e.dataTransfer.files);
  });

  /* ------------------------------ connect UI ------------------------------ */
  function openConnect(providerId) {
    state.connectProvider = providerId || null;
    const list = $('#connectList');
    const providers = Object.keys(M.PROVIDERS).filter((id) => id !== 'custom');
    list.innerHTML = providers
      .map((id) => {
        const p = M.PROVIDERS[id];
        const connected = !!state.settings.keys[id];
        const active = providerId === id;
        return `<div class="key-provider${connected ? ' connected' : ''}" data-provider="${id}" ${active ? 'style="border-color:rgba(116,164,255,.42)"' : ''}>
          <div class="key-top">
            <span class="p-logo" data-brand="${p.brand}" data-brand-size="17"></span>
            <span class="who"><strong>${esc(p.name)}</strong><span>${esc(p.blurb)}</span></span>
            <span class="key-status${connected ? ' ok' : ''}"><i></i>${connected ? 'Connected' : 'No key'}</span>
          </div>
          <div class="key-input-row">
            <label class="key-input">
              <span data-icon="key-round" data-icon-size="13"></span>
              <input type="text" data-connect-input="${id}" value="${esc(state.settings.keys[id] || '')}" placeholder="${esc(p.keyHint)}" aria-label="${esc(p.name)} API key" autocomplete="off" spellcheck="false" />
            </label>
            <div class="key-actions">
              <button class="btn btn-primary btn-sm" data-connect-save="${id}">Save</button>
            </div>
          </div>
        </div>`;
      })
      .join('');
    hydrateLogos(list);
    I.hydrate(list);
    openDialog(els.connectDialog, providerId ? `[data-connect-input="${providerId}"]` : '[data-connect-input]');
  }

  $('#connectList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('[data-connect-input]');
    if (!input) return;
    e.preventDefault();
    const btn = $(`[data-connect-save="${input.dataset.connectInput}"]`);
    if (btn) btn.click();
  });

  $('#connectList').addEventListener('click', (e) => {
    const save = e.target.closest('[data-connect-save]');
    if (!save) return;
    const id = save.dataset.connectSave;
    const input = $(`[data-connect-input="${id}"]`);
    const value = (input.value || '').trim();
    if (!value) { toast('Paste a key first', 'triangle-alert'); return; }
    state.settings.keys[id] = value;
    persistNow();
    renderTopbar();
    renderKeyList();
    renderEmptyProviders();
    renderModelList(els.modelSearch.value);
    toast(`${M.PROVIDERS[id].name} connected`, 'check');
    closeDialog(els.connectDialog);
    if (state.pendingRetry) {
      const pending = state.pendingRetry;
      state.pendingRetry = null;
      retryTurn(pending.chat, pending.msg);
    }
  });

  /* -------------------------------- sending ------------------------------- */
  function titleOrKeep(chat, text) {
    if (!chat.messages.some((m) => m.role === 'user')) chat.title = titleFrom(text);
  }

  async function send() {
    const text = els.input.value.trim();
    if (!text || state.sending) return;
    state.pendingRetry = null;
    let chat = activeChat();
    if (!chat) chat = createChat();
    if (!chat.model) chat.model = state.settings.model;

    const userMsg = { id: uid(), role: 'user', content: text, ts: Date.now() };
    chat.messages.push(userMsg);
    titleOrKeep(chat, text);
    chat.updatedAt = Date.now();

    const assistant = {
      id: uid(),
      role: 'assistant',
      content: '',
      model: chat.model,
      ts: Date.now(),
      streaming: true,
      tools: [],
      usage: null,
      latency: null
    };
    chat.messages.push(assistant);

    els.input.value = '';
    autoGrow();
    updateSendState();
    persist();
    renderSidebar();
    renderMessages();
    scrollToBottom(true);
    setSending(true);
    await runTurn(chat, assistant, text);
  }

  async function retryTurn(chat, msg) {
    if (state.sending) return;
    const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const index = chat.messages.indexOf(msg);
    if (index >= 0) chat.messages = chat.messages.slice(0, index);
    Object.assign(msg, {
      content: '',
      error: null,
      needsKey: false,
      streaming: true,
      tools: [],
      usage: null,
      latency: null,
      ts: Date.now(),
      model: chat.model,
      phase: 'thinking'
    });
    chat.messages.push(msg);
    persistNow();
    renderMessages();
    scrollToBottom(true);
    setSending(true);
    await runTurn(chat, msg, lastUser.content);
  }

  /* ------------------------------ the turn -------------------------------- */
  const SYSTEM_PROMPT = [
    'You are Eltes, a precise and practical AI agent inside a local-first workspace.',
    'Answer directly with Markdown. Put code in fenced blocks with a language tag.',
    'Be concise unless the user asks for depth. Never claim to have run a tool you were not given.',
    'If you need arithmetic, the current time or earlier conversation, call the provided tools.'
  ].join(' ');

  const MAX_TOOL_ROUNDS = 4;

  async function runTurn(chat, assistant, prompt) {
    state.stopped = false;
    const model = M.byId(assistant.model || chat.model);
    const provider = M.providerOf(model);
    const key = providerKey(model.provider);

    if (!hasKeyFor(model)) {
      assistant.streaming = false;
      assistant.needsKey = true;
      assistant.phase = null;
      saveAndRender(chat, assistant);
      return;
    }

    assistant.needsKey = false;
    assistant.error = null;
    assistant.phase = 'thinking';
    renderMessages();

    const useTools = !!(state.settings.tools && model.tools);
    const controller = new AbortController();
    state.abort = controller;
    const started = performance.now();
    let firstTokenAt = 0;
    let usage = { input: 0, output: 0 };
    const toolsUsed = [];

    // conversation state for the tool loop
    const history = chat.messages
      .filter((m) => m !== assistant && !m.streaming && !m.needsKey && m.content)
      .slice(-24)
      .map((m) => ({ role: m.role, content: m.content }));

    let apiMessages;
    let anthropicMessages;
    if (provider.api === 'anthropic') {
      // the Messages API expects alternating roles and a user-first conversation
      const merged = [];
      history.forEach((m) => {
        const last = merged[merged.length - 1];
        if (last && last.role === m.role) last.content += `\n\n${m.content}`;
        else merged.push({ role: m.role, content: m.content });
      });
      if (merged.length && merged[0].role !== 'user') merged.unshift({ role: 'user', content: 'Continue.' });
      anthropicMessages = merged;
    } else {
      apiMessages = [{ role: /^o\d/.test(model.apiId || '') ? 'developer' : 'system', content: SYSTEM_PROMPT }, ...history];
    }

    const paint = throttle(() => updateStreamingNode(assistant), 40);

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (state.stopped) break;
        assistant.phase = round === 0 ? 'thinking' : 'tools';
        if (round > 0) renderMessages();

        const before = assistant.content || '';
        const request = { model, provider, key, prompt, controller, assistant, tools: useTools, started, paint, state };
        let result;
        if (provider.api === 'anthropic') {
          request.messages = anthropicMessages;
          result = state.settings.stream ? await streamAnthropic(request) : await completeAnthropic(request);
        } else {
          request.messages = apiMessages;
          result = state.settings.stream ? await streamOpenAI(request) : await completeOpenAI(request);
        }

        assistant._prefix = assistant.content || before;
        if (result.firstTokenAt && !firstTokenAt) firstTokenAt = result.firstTokenAt;
        if (result.usage) {
          usage.input = Math.max(usage.input, result.usage.input || 0);
          usage.output = Math.max(usage.output, result.usage.output || 0);
        }

        if (!result.toolCalls || !result.toolCalls.length) break;

        // execute tools and feed results back
        for (const call of result.toolCalls) {
          if (state.stopped) break;
          const toolMsg = { name: call.name, args: call.args, status: 'running', result: '', runtime: 0, id: call.id };
          assistant.tools.push(toolMsg);
          toolsUsed.push(toolMsg);
          assistant.phase = 'tools';
          renderMessages();
          scrollToBottom(false);

          await sleep(90);
          const out = runTool(call.name, call.args);
          toolMsg.status = 'done';
          toolMsg.result = out.result;
          toolMsg.runtime = out.runtime;
          toolMsg.error = out.error;
          renderMessages();
          scrollToBottom(false);
        }

        if (provider.api === 'anthropic') {
          const blocks = [];
          if (result.text) blocks.push({ type: 'text', text: result.text });
          result.toolCalls.forEach((c) => blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args }));
          anthropicMessages.push({ role: 'assistant', content: blocks });
          anthropicMessages.push({
            role: 'user',
            content: result.toolCalls.map((c) => ({
              type: 'tool_result',
              tool_use_id: c.id,
              content: assistant.tools.find((t) => t.id === c.id)?.result || ''
            }))
          });
        } else {
          apiMessages.push({
            role: 'assistant',
            content: result.text || null,
            tool_calls: result.toolCalls.map((c) => ({
              id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) }
            }))
          });
          result.toolCalls.forEach((c) => {
            apiMessages.push({
              role: 'tool',
              tool_call_id: c.id,
              content: assistant.tools.find((t) => t.id === c.id)?.result || ''
            });
          });
        }
      }

      if (!assistant.content && !state.stopped && toolsUsed.length) {
        assistant.content = '_The model finished without a text answer. Try rephrasing or disabling tools._';
      }
    } catch (err) {
      if (!(err && err.name === 'AbortError')) {
        assistant.error = describeError(err, model);
        if (assistant.error.status === 401 || assistant.error.status === 403) {
          state.pendingRetry = { chat, msg: assistant };
        }
      }
    } finally {
      state.abort = null;
    }

    const total = Math.round(performance.now() - started);
    delete assistant._prefix;
    assistant.streaming = false;
    assistant.phase = null;
    if (!assistant.usage) {
      assistant.usage = {
        input: usage.input || estimateTokens(history.map((h) => h.content).join(' ') + prompt),
        output: usage.output || estimateTokens(assistant.content)
      };
    }
    assistant.latency = assistant.error ? null : { ttft: firstTokenAt ? Math.round(firstTokenAt - started) : null, total };
    if (state.stopped && !assistant.content && !assistant.error) {
      assistant.content = '_Stopped before the model returned text._';
    }
    saveAndRender(chat, assistant);
  }

  function saveAndRender(chat, assistant) {
    chat.updatedAt = Date.now();
    persistNow();
    setSending(false);
    state.stopped = false;
    renderMessages();
    renderSidebar();
    renderTopbar();
    scrollToBottom(false);
  }

  function estimateTokens(text) {
    return Math.max(1, Math.round(String(text || '').length / 4));
  }

  function throttle(fn, ms) {
    let last = 0;
    let timer = null;
    return function () {
      const now = performance.now();
      if (now - last >= ms) { last = now; fn(); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = performance.now(); fn(); }, ms - (now - last));
      }
    };
  }

  function updateStreamingNode(msg) {
    const node = els.messages.querySelector(`[data-msg="${msg.id}"]`);
    if (!node) return;
    const prose = node.querySelector('.prose');
    if (prose) prose.innerHTML = renderMarkdown(msg.content) + (msg.streaming ? '<span class="caret"></span>' : '');
    const thinking = node.querySelector('.thinking');
    if (thinking && msg.content) thinking.remove();
    scrollToBottom(false);
  }

  function describeError(err, model) {
    const p = M.providerOf(model);
    const status = err && err.status;
    if (!navigator.onLine) {
      return { title: 'You are offline.', detail: 'The request never left the browser.', hint: 'Reconnect and press retry.', provider: model.provider };
    }
    if (status === 401 || status === 403) {
      return {
        title: `${p.name} rejected that key (${status}).`,
        detail: 'The request reached the provider, but the credential was not accepted.',
        hint: 'Paste a fresh key for this provider, then retry.',
        provider: model.provider, status
      };
    }
    if (status === 429) {
      return {
        title: `${p.name} rate limit or quota reached (429).`,
        detail: 'Too many requests, or no remaining credit on this key.',
        hint: 'Wait a few seconds and retry, or switch to another connected model.',
        provider: model.provider, status
      };
    }
    if (status === 404) {
      return {
        title: 'Model not available (404).',
        detail: `${model.name} may not be enabled for your ${p.name} account.`,
        hint: 'Pick another model from the picker and retry.',
        provider: model.provider, status
      };
    }
    if (status === 400) {
      return {
        title: `${p.name} rejected the request (400).`,
        detail: (err && err.message) || 'The provider did not accept the payload.',
        hint: 'Check the model id, or try another model.',
        provider: model.provider, status
      };
    }
    if (err && /fetch|network|cors|failed to fetch/i.test(err.message || '')) {
      return {
        title: `Could not reach ${p.name}.`,
        detail: 'Browsers block some direct API calls. This is usually CORS, an ad-blocker or an offline network.',
        hint: 'Your key stays local. Try again, use another provider, or point a custom endpoint at a proxy.',
        provider: model.provider
      };
    }
    return {
      title: err && err.status ? `Request failed (${err.status}).` : 'Request failed.',
      detail: (err && err.message) || 'The provider did not return a usable response.',
      hint: 'Retry, switch models, or check the key under Settings → API keys.',
      provider: model.provider, status
    };
  }

  /* --------------------------- OpenAI-compatible --------------------------- */
  async function streamOpenAI({ model, provider, key, prompt, controller, assistant, tools, messages, started, paint }) {
    const base = (provider.baseUrl || state.settings.customBaseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('No base URL configured for this provider.');
    const body = {
      model: model.provider === 'custom' ? (state.settings.customModel || 'local-model') : model.apiId,
      messages,
      stream: true
    };
    if (tools) {
      body.tools = TOOL_DEFS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    if (['openai', 'groq', 'openrouter', 'mistral'].includes(model.provider)) {
      body.stream_options = { include_usage: true };
    }

    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    if (provider.name === 'OpenRouter') {
      headers['HTTP-Referer'] = location.origin;
      headers['X-Title'] = 'Eltes';
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      mode: 'cors', credentials: 'omit'
    });
    if (!res.ok) throw await httpError(res);
    if (!res.body) throw new Error('This browser cannot read streaming responses.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const prefix = assistant._prefix || '';
    let buffer = '';
    let text = '';
    let firstTokenAt = 0;
    let usage = null;
    const calls = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let obj;
        try { obj = JSON.parse(payload); } catch (e) { continue; }
        if (obj.usage) usage = { input: obj.usage.prompt_tokens, output: obj.usage.completion_tokens };
        const choice = (obj.choices && obj.choices[0]) || null;
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.content) {
          if (!firstTokenAt) firstTokenAt = performance.now();
          text += delta.content;
          assistant.content = prefix + text;
          assistant.phase = 'streaming';
          paint();
        }
        if (delta.tool_calls) {
          delta.tool_calls.forEach((tc) => {
            const idx = tc.index == null ? 0 : tc.index;
            const cur = calls.get(idx) || { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function) {
              if (tc.function.name) cur.name = tc.function.name;
              if (tc.function.arguments) cur.args += tc.function.arguments;
            }
            calls.set(idx, cur);
          });
        }
      }
    }

    const toolCalls = Array.from(calls.values())
      .filter((c) => c.name)
      .map((c) => {
        let args = {};
        try { args = JSON.parse(c.args || '{}'); } catch (e) { args = { raw: c.args }; }
        return { id: c.id || `call_${uid()}`, name: c.name, args };
      });

    return { text, toolCalls, usage, firstTokenAt };
  }

  /* ------------------------------- Anthropic ------------------------------- */
  async function streamAnthropic({ model, key, controller, assistant, tools, messages, started, paint }) {
    const body = {
      model: model.apiId,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
      stream: true
    };
    if (tools) {
      body.tools = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    const headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      mode: 'cors', credentials: 'omit'
    });
    if (!res.ok) throw await httpError(res);
    if (!res.body) throw new Error('This browser cannot read streaming responses.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const prefix = assistant._prefix || '';
    let buffer = '';
    let text = '';
    let firstTokenAt = 0;
    let usage = null;
    const blocks = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('event:') || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        let obj;
        try { obj = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (obj.type === 'message_start' && obj.message && obj.message.usage) {
          usage = { input: obj.message.usage.input_tokens || 0, output: 0 };
        }
        if (obj.type === 'content_block_start' && obj.content_block && obj.content_block.type === 'tool_use') {
          blocks.set(obj.index, { id: obj.content_block.id, name: obj.content_block.name, json: '' });
        }
        if (obj.type === 'content_block_delta' && obj.delta) {
          if (obj.delta.type === 'text_delta' && obj.delta.text) {
            if (!firstTokenAt) firstTokenAt = performance.now();
            text += obj.delta.text;
            assistant.content = prefix + text;
            assistant.phase = 'streaming';
            paint();
          }
          if (obj.delta.type === 'input_json_delta' && blocks.has(obj.index)) {
            blocks.get(obj.index).json += obj.delta.partial_json || '';
          }
        }
        if (obj.type === 'message_delta' && obj.usage) {
          usage = { input: (usage && usage.input) || 0, output: obj.usage.output_tokens || 0 };
        }
        if (obj.type === 'error') {
          const message = (obj.error && obj.error.message) || 'Anthropic stream error';
          const err = new Error(message);
          throw err;
        }
      }
    }

    const toolCalls = Array.from(blocks.values()).map((b) => {
      let args = {};
      try { args = JSON.parse(b.json || '{}'); } catch (e) { args = {}; }
      return { id: b.id, name: b.name, args };
    });

    return { text, toolCalls, usage, firstTokenAt };
  }

  /* ------------------------- non-streaming (toggle off) ------------------- */
  async function completeOpenAI({ model, provider, key, tools, messages, assistant, controller }) {
    const base = (provider.baseUrl || state.settings.customBaseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('No base URL configured for this provider.');
    const body = {
      model: model.provider === 'custom' ? (state.settings.customModel || 'local-model') : model.apiId,
      messages,
      stream: false
    };
    if (tools) {
      body.tools = TOOL_DEFS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
    }
    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    if (provider.name === 'OpenRouter') {
      headers['HTTP-Referer'] = location.origin;
      headers['X-Title'] = 'Eltes';
    }
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body), mode: 'cors', credentials: 'omit', signal: controller.signal
    });
    if (!res.ok) throw await httpError(res);
    const json = await res.json();
    const choice = (json.choices && json.choices[0]) || {};
    const message = choice.message || {};
    const text = message.content || '';
    if (text) {
      assistant.content = (assistant._prefix || '') + text;
      assistant.phase = 'streaming';
    }
    const toolCalls = (message.tool_calls || []).map((tc) => {
      let args = {};
      try { args = JSON.parse((tc.function && tc.function.arguments) || '{}'); } catch (e) { args = {}; }
      return { id: tc.id || `call_${uid()}`, name: tc.function && tc.function.name, args };
    }).filter((c) => c.name);
    const usage = json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : null;
    return { text, toolCalls, usage, firstTokenAt: 0 };
  }

  async function completeAnthropic({ model, key, tools, messages, assistant, controller }) {
    const body = { model: model.apiId, max_tokens: 4096, system: SYSTEM_PROMPT, messages, stream: false };
    if (tools) {
      body.tools = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    const headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body), mode: 'cors', credentials: 'omit', signal: controller.signal
    });
    if (!res.ok) throw await httpError(res);
    const json = await res.json();
    const blocks = Array.isArray(json.content) ? json.content : [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (text) {
      assistant.content = (assistant._prefix || '') + text;
      assistant.phase = 'streaming';
    }
    const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
    const usage = json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : null;
    return { text, toolCalls, usage, firstTokenAt: 0 };
  }

  async function httpError(res) {
    let detail = '';
    try {
      const raw = await res.text();
      try {
        const j = JSON.parse(raw);
        detail = (j.error && (j.error.message || j.error)) || j.message || '';
      } catch (e) { detail = raw.slice(0, 300); }
    } catch (e) {}
    const err = new Error(detail || res.statusText || 'HTTP error');
    err.status = res.status;
    return err;
  }

  /* -------------------------- message interactions ------------------------ */
  function findMsg(id) {
    const chat = activeChat();
    if (!chat) return {};
    return { chat, msg: chat.messages.find((m) => m.id === id), index: chat.messages.findIndex((m) => m.id === id) };
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    const done = () => toast('Copied to clipboard', 'clipboard-check');
    const fail = () => toast('Copy failed — select the text manually', 'triangle-alert');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => (legacyCopy(text) ? done() : fail()));
    } else if (legacyCopy(text)) done();
    else fail();
  }
  function copyLastReply() {
    const chat = activeChat();
    if (!chat) return toast('No conversation yet', 'triangle-alert');
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant' && m.content);
    if (last) copyText(last.content);
    else toast('No reply to copy yet', 'triangle-alert');
  }

  els.messages.addEventListener('click', async (e) => {
    const copyCode = e.target.closest('[data-copy-code]');
    if (copyCode) {
      const pre = copyCode.closest('.code').querySelector('pre');
      copyText(pre.innerText);
      copyCode.classList.add('copied');
      copyCode.innerHTML = `${ic('check', 11)}<span>Copied</span>`;
      setTimeout(() => {
        copyCode.classList.remove('copied');
        copyCode.innerHTML = `${ic('copy', 11)}<span>Copy</span>`;
      }, 1600);
      return;
    }

    const providerChip = e.target.closest('[data-connect]');
    if (providerChip) { openConnect(providerChip.dataset.connect); return; }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'keys') {
      const target = findMsg(btn.dataset.id);
      if (target.msg && target.msg.error && target.msg.error.status === 401) {
        state.pendingRetry = { chat: target.chat, msg: target.msg };
      }
      openConnect(btn.dataset.provider || '');
      return;
    }
    if (act === 'models') { openModelPicker(); return; }

    const id = btn.dataset.id;
    const { chat, msg, index } = findMsg(id);
    if (!chat || !msg) return;

    if (act === 'copy') { copyText(msg.content); return; }

    if (act === 'good' || act === 'bad') {
      msg.rating = msg.rating === (act === 'good' ? 'up' : 'down') ? null : act === 'good' ? 'up' : 'down';
      persist();
      renderMessages();
      if (msg.rating) toast(msg.rating === 'up' ? 'Feedback saved locally' : 'Noted — try another model', 'thumbs-up');
      return;
    }

    if (act === 'edit') {
      if (state.sending) return toast('Stop the current reply first', 'triangle-alert');
      els.input.value = msg.content;
      chat.messages = chat.messages.slice(0, index);
      chat.updatedAt = Date.now();
      persistNow();
      renderAll();
      autoGrow();
      updateSendState();
      els.input.focus();
      return;
    }

    if (act === 'regen') {
      if (state.sending) return toast('Already generating', 'triangle-alert');
      if (index < chat.messages.length - 1) chat.messages = chat.messages.slice(0, index + 1);
      state.pendingRetry = null;
      await retryTurn(chat, msg);
    }
  });

  /* ------------------------------- shortcuts ------------------------------ */
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    const anyDialog = $('dialog[open]');

    if (e.key === 'Escape') { closeMenu(); return; }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (els.cmdDialog.open) closeDialog(els.cmdDialog);
      else if (!anyDialog) openCommandPalette();
      return;
    }
    if (mod && e.key.toLowerCase() === 'm') { e.preventDefault(); if (!anyDialog) openModelPicker(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); if (!anyDialog) toggleSidebar(); return; }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); if (!anyDialog) newChat(); return; }
    if (mod && e.key === ',') { e.preventDefault(); openSettings('general'); return; }
    if (mod && e.key === '/') { e.preventDefault(); els.input.focus(); return; }
    if (!typing && !anyDialog && e.key === '/') { e.preventDefault(); els.input.focus(); }
  });

  window.addEventListener('beforeunload', persistNow);
  window.addEventListener('resize', () => { if (window.innerWidth > 900) $('#sideBackdrop').classList.remove('show'); });
  window.addEventListener('eltes:account', () => { renderAccountSlot(); renderAccountPanel(); renderTopbar(); });

  /* --------------------------------- boot --------------------------------- */
  function boot() {
    if (window.innerWidth <= 900) els.shell.classList.add('collapsed');
    applySettingsToUI();
    renderAll();
    autoGrow();
    updateSendState();
    if (activeChat() && activeChat().messages.length) scrollToBottom(true);
    if (!state.chats.length) setTimeout(() => els.input.focus(), 120);

    // ?model= deep link from the landing page
    const wanted = new URLSearchParams(location.search).get('model');
    if (wanted && M.MODELS.some((m) => m.id === wanted)) {
      selectModel(wanted);
      const chat = activeChat();
      if (chat && !chat.messages.length) {
        chat.model = wanted;
        state.settings.model = wanted;
        persistNow();
        renderAll();
      }
    }
  }
  boot();

  window.Eltes = { state, renderAll, persistNow, openSettings, selectModel, openConnect, send };
})();
