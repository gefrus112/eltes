/* ==========================================================================
   Eltes Studio — client
   --------------------------------------------------------------------------
   Works in two modes:
     online   → local server (.studio/), real shell, /preview/ origin
     offline  → localStorage project, preview assembled in the browser
   Both modes can create files, preview any .html and export a zip.
   ========================================================================== */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const I = window.EltesIcons;
  const icon = (name, size = 14) => (I ? I.icon(name, { size }) : '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const LS_PROJECT = 'eltes.studio.v1';
  const LS_PREFS = 'eltes.studio.prefs.v1';
  const MAX_LINES = 4000;
  const PREVIEWABLE = /\.(html?|svg)$/i;

  /* ------------------------------- starter -------------------------------- */

  const STARTER = {
    'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>My page</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="card">
    <span class="pill">Eltes Studio</span>
    <h1>Hello from the workspace.</h1>
    <p>Edit this file, press <kbd>Ctrl/⌘ S</kbd>, and the preview reloads. Run commands in the terminal below — the preview follows the files on disk.</p>
    <button id="cta">Count clicks</button>
    <p class="count" id="count">0 clicks</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
    'styles.css': `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: radial-gradient(900px 500px at 20% 0%, #10203a, #05070c 60%);
  color: #e9effb; padding: 24px;
}
.card {
  width: min(560px, 100%); padding: 32px; border-radius: 18px;
  border: 1px solid rgba(130, 162, 220, .18);
  background: rgba(9, 14, 24, .82);
  box-shadow: 0 30px 80px -40px #000;
}
.pill {
  display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px;
  letter-spacing: .08em; text-transform: uppercase; color: #8ff0c8;
  background: rgba(57, 220, 162, .12); border: 1px solid rgba(57, 220, 162, .3);
}
h1 { font-size: 30px; line-height: 1.15; margin: 18px 0 10px; }
p { color: #9dadc9; line-height: 1.6; }
kbd { padding: 1px 5px; border-radius: 4px; background: #162033; border: 1px solid #26344d; font-size: 12px; }
button {
  margin-top: 8px; padding: 10px 16px; border-radius: 9px; border: 0; cursor: pointer;
  background: linear-gradient(180deg, #4785ff, #2a63ee); color: #fff; font-weight: 600;
}
.count { font-variant-numeric: tabular-nums; color: #7aa8ff; }
`,
    'app.js': `const button = document.getElementById('cta');
const label = document.getElementById('count');
let clicks = 0;

button.addEventListener('click', () => {
  clicks += 1;
  label.textContent = clicks + (clicks === 1 ? ' click' : ' clicks');
});
`,
    'notes.md': '# Workspace notes\n\n- Preview any .html file.\n- The terminal runs real commands next to these files.\n',
    'README.txt': 'Eltes Studio workspace\n\nCreate another .html file and open it in the preview to test it.\n'
  };

  /* -------------------------------- state --------------------------------- */

  const state = {
    online: false,
    token: '',
    shell: 'sh',
    workspace: '',
    cwd: '',
    files: [],
    open: new Map(),     // path -> { content, saved, dirty }
    tabs: [],
    active: null,
    preview: 'index.html',
    device: 'desktop',
    history: [],
    historyIndex: -1,
    running: null,
    termCollapsed: false,
    termHeight: 232,
    lastTreeKey: '',
    offlineProject: null,
    saveTimer: null,
    reloadTimer: null
  };

  const el = {};
  let watchAbort = null;

  /* -------------------------------- helpers ------------------------------- */

  const extOf = (path) => {
    const base = String(path).split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  };
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function fileKind(path) {
    const ext = extOf(path);
    if (ext === 'html' || ext === 'htm') return { key: 'html', label: 'HTML', short: 'H', cls: 'fi-html' };
    if (ext === 'css') return { key: 'css', label: 'CSS', short: 'C', cls: 'fi-css' };
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') return { key: 'js', label: 'JavaScript', short: 'JS', cls: 'fi-js' };
    if (ext === 'json') return { key: 'json', label: 'JSON', short: '{ }', cls: 'fi-json' };
    if (ext === 'md') return { key: 'md', label: 'Markdown', short: 'M', cls: 'fi-md' };
    if (['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) return { key: 'img', label: 'Image', short: 'IMG', cls: 'fi-img' };
    return { key: 'other', label: ext ? ext.toUpperCase() : 'Text', short: '·', cls: 'fi-other' };
  }

  function toast(message, kind = 'ok') {
    let stack = $('.st-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'st-toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const node = document.createElement('div');
    node.className = `st-toast ${kind}`;
    node.textContent = message;
    stack.appendChild(node);
    setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 240); }, 2600);
  }

  function askConfirm(message) {
    try { return window.confirm(message); } catch { return true; }
  }

  function openModal(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeModal(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function prefs() {
    try { return JSON.parse(localStorage.getItem(LS_PREFS) || '{}') || {}; } catch { return {}; }
  }
  function savePrefs(patch) {
    try { localStorage.setItem(LS_PREFS, JSON.stringify({ ...prefs(), ...patch })); } catch { /* storage off */ }
  }

  /* ------------------------------- offline DB ------------------------------ */

  function loadOfflineProject() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_PROJECT) || 'null'); } catch { saved = null; }
    if (saved && saved.files && typeof saved.files === 'object' && Object.keys(saved.files).length) {
      state.offlineProject = saved.files;
    } else {
      state.offlineProject = { ...STARTER };
    }
  }
  function persistOfflineProject() {
    try {
      localStorage.setItem(LS_PROJECT, JSON.stringify({ files: state.offlineProject, savedAt: Date.now() }));
    } catch {
      toast('Local storage is full — export the project to keep it', 'warn');
    }
  }
  function offlineTree() {
    return Object.keys(state.offlineProject).sort((a, b) => {
      const ad = a.includes('/'), bd = b.includes('/');
      if (ad !== bd) return ad ? 1 : -1;
      return a.localeCompare(b);
    }).map((path) => ({
      path, name: path.split('/').pop(), dir: false,
      size: new Blob([state.offlineProject[path]]).size
    }));
  }

  /* --------------------------------- API ---------------------------------- */

  async function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
    try { return await Promise.race([promise, timeout]); }
    finally { clearTimeout(timer); }
  }

  async function refreshSession() {
    const response = await fetch('/api/studio/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('The local server is not reachable');
    const session = await response.json();
    if (!session || !session.ok) throw new Error('The local server did not return a session');
    state.online = true;
    state.token = session.token;
    state.shell = session.shell || state.shell;
    state.workspace = session.workspace || state.workspace;
    return session;
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) headers['x-studio-token'] = state.token;
    if (opts.body !== undefined) headers['content-type'] = 'text/plain; charset=utf-8';
    const response = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
      cache: 'no-store'
    });
    // A restarted server issues a new token. Refresh once and retry.
    if (response.status === 401 && !opts.retried) {
      await refreshSession();
      return api(path, { ...opts, retried: true });
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) throw new Error((data && data.error) || `Request failed (${response.status})`);
    return data;
  }

  async function postRun(payload, signal) {
    const send = () => fetch('/api/studio/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-token': state.token },
      body: JSON.stringify(payload),
      signal
    });
    let response = await send();
    if (response.status === 401) {
      await refreshSession();
      response = await send();
    }
    return response;
  }

  /* -------------------------------- boot ---------------------------------- */

  async function boot() {
    cacheEls();
    const savedPrefs = prefs();
    if (savedPrefs.termHeight) state.termHeight = savedPrefs.termHeight;
    if (savedPrefs.device) state.device = savedPrefs.device;
    if (savedPrefs.collapsed) state.termCollapsed = true;
    applyTermHeight();
    setDevice(state.device, false);

    bindUI();
    renderTerminalBanner('checking');

    try {
      const session = await withTimeout(fetch('/api/studio/session', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error('no studio');
        return r.json();
      }), 2500);
      if (!session || !session.ok) throw new Error('no studio');
      state.online = true;
      state.token = session.token;
      state.shell = session.shell || 'sh';
      state.workspace = session.workspace || '';
      setBackend(true, session);
      await refreshTree(true);
      await seedOnlineIfEmpty();
      renderTerminalBanner('online');
      startWatch();
    } catch {
      state.online = false;
      setBackend(false);
      loadOfflineProject();
      await refreshTree(true);
      renderTerminalBanner('offline');
    }

    if (!state.cwd) state.cwd = '';

    // Prefer index.html, otherwise the first html file.
    const html = state.files.find((f) => !f.dir && /^index\.html?$/i.test(f.path))
      || state.files.find((f) => !f.dir && /\.html?$/i.test(f.path));
    if (html) {
      state.preview = html.path;
      await openFile(html.path);
      setPreviewPath(html.path);
    } else {
      renderTabs();
      renderEditor();
    }
    updateTerminalPrompt();
    if (!state.termCollapsed) setTimeout(() => el.termInput.focus({ preventScroll: true }), 120);
    state.booted = true;
  }

  function cacheEls() {
    el.filesPanel = $('#filesPanel');
    el.fileList = $('#fileList');
    el.tabs = $('#tabs');
    el.code = $('#code');
    el.gutter = $('#gutter');
    el.editorEmpty = $('#editorEmpty');
    el.statusPath = $('#statusPath');
    el.statusSaved = $('#statusSaved');
    el.statusLang = $('#statusLang');
    el.statusPos = $('#statusPos');
    el.previewPanel = $('#previewPanel');
    el.frame = $('#previewFrame');
    el.frameWrap = $('#frameWrap');
    el.previewPath = $('#previewPath');
    el.termPanel = $('#termPanel');
    el.termBody = $('#termBody');
    el.termInput = $('#termInput');
    el.termPrompt = $('#termPrompt');
    el.termCwd = $('#termCwd');
    el.backendBadge = $('#backendBadge');
    el.backendText = $('#backendText');
    el.workspacePath = $('#workspacePath');
    el.newFileForm = $('#newFileForm');
    el.newFileName = $('#newFileName');
    el.helpDialog = $('#helpDialog');
    el.effectsDialog = $('#effectsDialog');
    el.effectGrid = $('#effectGrid');
    el.guideDialog = $('#guideDialog');
    el.guideSteps = $('#guideSteps');
    el.guideCount = $('#guideCount');
    el.guideLabel = $('#guideLabel');
  }

  function setBackend(online, session) {
    document.body.classList.toggle('offline', !online);
    el.backendBadge.classList.toggle('live', online);
    el.backendBadge.classList.toggle('offline', !online);
    el.backendText.textContent = online ? 'local workspace' : 'browser only';
    el.backendBadge.title = online
      ? `Connected to the local server${session && session.shell ? ` · ${session.shell}` : ''}`
      : 'No local backend found — the editor works, the terminal does not';
    if (online && session) {
      el.workspacePath.textContent = '.studio/';
      el.workspacePath.title = session.workspace || '';
    } else {
      el.workspacePath.textContent = 'localStorage';
      el.workspacePath.title = 'Saved in this browser';
    }
  }

  /* ------------------------------- file tree ------------------------------- */

  async function refreshTree(initial = false) {
    if (state.online) {
      try {
        const data = await api('/api/studio/tree');
        state.files = data.files || [];
        state.lastTreeKey = treeKey(state.files);
      } catch (error) {
        toast(`File list failed: ${error.message}`, 'warn');
        state.files = [];
      }
    } else {
      state.files = offlineTree();
    }
    renderFileList();
    if (initial) renderTabs();
  }

  const treeKey = (files) => files.map((f) => `${f.path}:${f.dir ? 'd' : (f.mtime || f.size || 0)}`).join('|');

  function renderFileList() {
    if (!state.files.length) {
      el.fileList.innerHTML = '<li class="st-file"><span class="fname" style="color:var(--text-4)">empty workspace</span></li>';
      return;
    }
    el.fileList.innerHTML = state.files.map((file) => {
      const depth = file.path.split('/').length - 1;
      const kind = fileKind(file.path);
      const active = state.active === file.path ? ' active' : '';
      const skipped = file.skipped ? ' skipped' : '';
      if (file.dir) {
        return `<li class="st-file dir${skipped}" data-dir="${esc(file.path)}" style="padding-left:${7 + depth * 13}px" role="treeitem" aria-expanded="true">
          <span class="fi">▸</span><span class="fname">${esc(file.name)}</span></li>`;
      }
      return `<li class="st-file${active}" data-path="${esc(file.path)}" style="padding-left:${7 + depth * 13}px" role="treeitem" tabindex="0">
        <span class="fi ${kind.cls}">${esc(kind.short)}</span>
        <span class="fname">${esc(file.name)}</span>
        <button class="del" data-del="${esc(file.path)}" title="Delete ${esc(file.name)}" aria-label="Delete ${esc(file.name)}">×</button>
      </li>`;
    }).join('');
  }

  function selectFile(path) {
    el.fileList.querySelectorAll('.st-file').forEach((node) => {
      node.classList.toggle('active', node.dataset.path === path);
    });
  }

  /* --------------------------------- tabs --------------------------------- */

  function renderTabs() {
    if (!state.tabs.length) {
      el.tabs.innerHTML = '<span style="display:flex;align-items:center;padding:0 14px;color:var(--text-4);font-size:11.5px">No open files</span>';
      return;
    }
    el.tabs.innerHTML = state.tabs.map((path) => {
      const entry = state.open.get(path);
      const kind = fileKind(path);
      return `<div class="st-tab${state.active === path ? ' active' : ''}${entry && entry.dirty ? ' dirty' : ''}" data-tab="${esc(path)}" role="tab" aria-selected="${state.active === path}" tabindex="0">
        <span class="fi ${kind.cls}" style="font-size:9px;font-weight:700">${esc(kind.short)}</span>
        <span>${esc(path.split('/').pop())}</span>
        <span class="dot" aria-hidden="true"></span>
        <span class="x" data-close="${esc(path)}" role="button" aria-label="Close ${esc(path)}">×</span>
      </div>`;
    }).join('');
  }

  async function openFile(path) {
    if (!path) return;
    const entry = state.open.get(path);
    if (!entry) {
      let content;
      if (state.online) {
        try {
          const data = await api(`/api/studio/file?path=${encodeURIComponent(path)}`);
          content = data.content;
        } catch (error) {
          toast(error.message, 'warn');
          return;
        }
      } else {
        content = state.offlineProject[path];
        if (content === undefined) { toast('File not found', 'warn'); return; }
      }
      state.open.set(path, { content, saved: content, dirty: false });
      state.tabs.push(path);
    }
    state.active = path;
    renderTabs();
    renderFileList();
    renderEditor();
    updateStatus();
    if (PREVIEWABLE.test(path) && isHtml(path)) {
      setPreviewPath(path);
      reloadPreview();
    }
    el.code.focus({ preventScroll: true });
  }

  const isHtml = (path) => /\.html?$/i.test(path);

  function closeTab(path) {
    const entry = state.open.get(path);
    if (entry && entry.dirty && !askConfirm(`Discard unsaved changes to ${path}?`)) return;
    state.open.delete(path);
    state.tabs = state.tabs.filter((p) => p !== path);
    if (state.active === path) {
      state.active = state.tabs[state.tabs.length - 1] || null;
    }
    renderTabs();
    renderEditor();
    updateStatus();
    renderFileList();
  }

  /* -------------------------------- editor -------------------------------- */

  function renderEditor() {
    const entry = state.active ? state.open.get(state.active) : null;
    if (!entry) {
      el.code.value = '';
      el.code.disabled = true;
      el.editorEmpty.hidden = false;
      el.gutter.textContent = '1';
      return;
    }
    el.editorEmpty.hidden = true;
    el.code.disabled = false;
    if (el.code.value !== entry.content) el.code.value = entry.content;
    renderGutter();
    updateStatus();
  }

  function renderGutter() {
    const lines = el.code.value.split('\n').length;
    const total = Math.min(lines, MAX_LINES);
    const parts = new Array(total);
    for (let i = 1; i <= total; i += 1) parts[i - 1] = i;
    el.gutter.textContent = parts.join('\n');
    el.gutter.scrollTop = el.code.scrollTop;
  }

  function updateStatus() {
    const entry = state.active ? state.open.get(state.active) : null;
    if (!entry) {
      el.statusPath.textContent = 'no file open';
      el.statusLang.textContent = '';
      el.statusSaved.textContent = '';
      el.statusPos.textContent = '';
      return;
    }
    const kind = fileKind(state.active);
    el.statusPath.textContent = state.active;
    el.statusLang.textContent = kind.label;
    const pos = cursorPosition();
    el.statusPos.textContent = `Ln ${pos.line}, Col ${pos.col}`;
    el.statusSaved.textContent = entry.dirty ? 'unsaved changes' : 'saved';
    el.statusSaved.className = entry.dirty ? 'dirty' : 'saved';
    if (entry.dirty) el.statusSaved.textContent = '● unsaved';
  }

  function cursorPosition() {
    const value = el.code.value;
    const index = el.code.selectionStart || 0;
    const before = value.slice(0, index);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    return { line, col };
  }

  function onEdit() {
    if (!state.active) return;
    const entry = state.open.get(state.active);
    if (!entry) return;
    entry.content = el.code.value;
    entry.dirty = entry.content !== entry.saved;
    renderGutter();
    updateStatus();
    const tab = el.tabs.querySelector(`[data-tab="${cssEscape(state.active)}"]`);
    if (tab) tab.classList.toggle('dirty', entry.dirty);
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { if (entry.dirty) saveActive({ silent: true }); }, 1400);
  }

  const cssEscape = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));

  async function saveActive({ silent = false } = {}) {
    if (!state.active) return false;
    const path = state.active;
    const entry = state.open.get(path);
    if (!entry) return false;
    clearTimeout(state.saveTimer);
    if (!entry.dirty && silent) return true;
    try {
      if (state.online) {
        await api(`/api/studio/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: entry.content });
      } else {
        state.offlineProject[path] = entry.content;
        persistOfflineProject();
      }
      entry.saved = entry.content;
      entry.dirty = false;
      updateStatus();
      renderTabs();
      if (!silent) toast(`Saved ${path}`, 'ok');
      return true;
    } catch (error) {
      toast(`Could not save: ${error.message}`, 'warn');
      return false;
    }
  }

  function insertText(text, selectOffset = 0) {
    const start = el.code.selectionStart;
    const end = el.code.selectionEnd;
    const value = el.code.value;
    el.code.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length - selectOffset;
    el.code.selectionStart = el.code.selectionEnd = pos;
    onEdit();
  }

  function editorKeydown(event) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveActive();
      return;
    }
    if (mod && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      cycleFile(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) {
        const start = el.code.selectionStart;
        const value = el.code.value;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        if (value.slice(lineStart, lineStart + 2) === '  ') {
          el.code.value = value.slice(0, lineStart) + value.slice(lineStart + 2);
          el.code.selectionStart = el.code.selectionEnd = Math.max(lineStart, start - 2);
          onEdit();
        }
      } else {
        insertText('  ');
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const start = el.code.selectionStart;
      const value = el.code.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      const indent = (line.match(/^[ \t]*/) || [''])[0];
      const opensBlock = /[{([]\s*$/.test(line);
      const extra = opensBlock ? '  ' : '';
      if (indent || extra) {
        event.preventDefault();
        const payload = `\n${indent}${extra}`;
        insertText(payload);
        if (opensBlock) {
          // keep the closing bracket on its own line
          const after = el.code.value.slice(el.code.selectionStart);
          if (/^\s*[})\]]/.test(after)) {
            const pos = el.code.selectionStart;
            el.code.value = `${el.code.value.slice(0, pos)}\n${indent}${el.code.value.slice(pos)}`;
            el.code.selectionStart = el.code.selectionEnd = pos;
            onEdit();
          }
        }
      }
    }
  }

  function cycleFile(direction) {
    const paths = state.files.filter((f) => !f.dir).map((f) => f.path);
    if (!paths.length) return;
    const index = paths.indexOf(state.active);
    const next = paths[(index + direction + paths.length) % paths.length] || paths[0];
    openFile(next);
    toast(next, 'ok');
  }

  /* -------------------------------- preview -------------------------------- */

  function setPreviewPath(path) {
    state.preview = path;
    el.previewPath.value = state.online ? `/preview/${path}` : `/${path}`;
    savePrefs({ preview: path });
  }

  function normalizePreviewInput(raw) {
    let value = String(raw || '').trim();
    if (!value) return '';
    try {
      if (/^https?:/i.test(value)) {
        const url = new URL(value);
        value = url.pathname.replace(/^\/preview\/?/, '');
      }
    } catch { /* treat as path */ }
    value = value.replace(/^\/preview\/?/, '').replace(/^\/+/, '');
    if (!value) value = 'index.html';
    return value;
  }

  function reloadPreview() {
    if (!state.preview) return;
    // The initial load is not a completed step; later reloads are real previews.
    if (state.booted) markWorkflow('preview');
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => {
      if (state.online) {
        const clean = state.preview.replace(/^\/+/, '');
        const url = `/preview/${clean.split('/').map(encodeURIComponent).join('/')}?v=${Date.now()}`;
        el.frame.removeAttribute('srcdoc');
        el.frame.src = url;
      } else {
        el.frame.removeAttribute('src');
        el.frame.srcdoc = buildOfflineDoc(state.preview);
      }
      el.previewPanel.classList.add('loading');
      setTimeout(() => el.previewPanel.classList.remove('loading'), 500);
    }, 90);
  }

  function buildOfflineDoc(htmlPath) {
    const source = state.offlineProject[htmlPath];
    if (source == null) {
      return `<!doctype html><meta charset="utf-8"><body style="font:15px/1.6 ui-sans-serif,system-ui;background:#05070c;color:#9dadc9;padding:36px">
        <h1 style="color:#e9effb;font-size:19px">${esc(htmlPath)} is not in this project</h1>
        <p>Create it in the file list, then preview again. Offline mode keeps files in this browser.</p></body>`;
    }
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const baseDir = htmlPath.includes('/') ? htmlPath.slice(0, htmlPath.lastIndexOf('/') + 1) : '';
    const resolve = (href) => {
      const raw = String(href || '').trim();
      if (!raw || /^(?:[a-z]+:|\/\/|#|data:)/i.test(raw)) return null;
      const clean = raw.split('#')[0].split('?')[0];
      if (!clean) return null;
      let resolved = new URL(clean, `http://studio.local/${baseDir}`).pathname.replace(/^\/+/, '');
      try { resolved = decodeURIComponent(resolved); } catch { /* keep raw */ }
      return state.offlineProject[resolved] != null ? { path: resolved, body: state.offlineProject[resolved] } : null;
    };
    doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach((node) => {
      const found = resolve(node.getAttribute('href'));
      if (!found) return;
      const style = doc.createElement('style');
      style.textContent = `/* ${found.path} */\n${found.body}`;
      node.replaceWith(style);
    });
    doc.querySelectorAll('script[src]').forEach((node) => {
      const found = resolve(node.getAttribute('src'));
      if (!found) return;
      const script = doc.createElement('script');
      script.textContent = `// ${found.path}\n${found.body}`;
      node.replaceWith(script);
    });
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  }

  function setDevice(device, persist = true) {
    state.device = device;
    el.frameWrap.dataset.device = device;
    $$('.st-devices button').forEach((btn) => btn.classList.toggle('on', btn.dataset.device === device));
    if (persist) savePrefs({ device });
  }

  /* -------------------------------- terminal ------------------------------- */

  function renderTerminalBanner(mode) {
    el.termBody.innerHTML = '';
    const banner = document.createElement('div');
    banner.className = 't-banner';
    if (mode === 'offline') {
      banner.innerHTML = '<b>Offline mode.</b> No local server was found, so commands cannot run. '
        + 'Start it with <b>npm start</b> and reload this page — the editor, preview and export still work here.';
    } else if (mode === 'online') {
      banner.innerHTML = `<b>${esc(state.shell)}</b> in your Studio workspace. Real commands, real output. `
        + 'The preview reloads when files here change.';
    } else {
      banner.innerHTML = 'Connecting to the local workspace…';
    }
    el.termBody.appendChild(banner);
    scrollTerminal();
  }

  function scrollTerminal() {
    el.termBody.scrollTop = el.termBody.scrollHeight;
  }

  function termLine(className, text) {
    const line = document.createElement('div');
    line.className = className;
    line.textContent = text;
    el.termBody.appendChild(line);
    return line;
  }

  function promptText() {
    return `~/studio${state.cwd ? `/${state.cwd}` : ''}`;
  }

  function updateTerminalPrompt() {
    const path = promptText();
    el.termCwd.textContent = path;
    el.termPrompt.innerHTML = `${esc(path)} <span>$</span>`;
  }

  function appendCommandEcho(cmd) {
    const line = document.createElement('div');
    line.className = 't-cmd';
    line.innerHTML = `<span class="t-prompt">${esc(promptText())}</span> <span class="t-path">$</span> ${esc(cmd)}`;
    el.termBody.appendChild(line);
  }

  function appendOutput(container, text, isErr) {
    const chunk = text.replace(/\r(?!\n)/g, '\n').replace(/\r\n/g, '\n');
    if (isErr) {
      const span = document.createElement('span');
      span.className = 't-err';
      span.textContent = chunk;
      container.appendChild(span);
    } else {
      container.appendChild(document.createTextNode(chunk));
    }
  }

  async function execute(cmd) {
    const command = String(cmd || '').trim();
    if (!command) return;

    appendCommandEcho(command);
    scrollTerminal();

    if (!state.online) {
      termLine('t-err', 'Terminal unavailable — this page is not connected to a local server.');
      termLine('t-sys', 'Run `npm start` in the project, then open http://localhost:4173/studio.html');
      return;
    }
    if (/^clear$/i.test(command)) {
      el.termBody.innerHTML = '';
      return;
    }
    if (/^pwd$/i.test(command)) {
      termLine('t-out', `/${['studio', state.cwd].filter(Boolean).join('/')}`);
      return;
    }
    if (/^cd(\s|$)/i.test(command) || command === 'cd ..') {
      await changeDirectory(command.replace(/^cd\s*/i, '').trim());
      return;
    }

    const output = document.createElement('pre');
    output.className = 't-out';
    el.termBody.appendChild(output);
    scrollTerminal();

    const controller = new AbortController();
    state.running = controller;

    try {
      const response = await postRun({ cmd: command, cwd: state.cwd }, controller.signal);
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || `HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let exitInfo = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) > -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const lines = frame.split('\n');
          let event = 'message';
          let payload = '';
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) payload += line.slice(5).trim();
          }
          if (!payload) continue;
          let data;
          try { data = JSON.parse(payload); } catch { continue; }
          if (event === 'out') appendOutput(output, data.text, false);
          else if (event === 'err') appendOutput(output, data.text, true);
          else if (event === 'error') appendOutput(output, `\n${data.error || 'failed'}\n`, true);
          else if (event === 'exit') exitInfo = data;
          scrollTerminal();
        }
      }

      if (exitInfo) {
        const ok = exitInfo.code === 0 && !exitInfo.signal;
        const ms = exitInfo.ms >= 1000 ? `${(exitInfo.ms / 1000).toFixed(1)}s` : `${exitInfo.ms}ms`;
        const label = exitInfo.error
          ? exitInfo.error
          : exitInfo.signal
            ? `stopped · ${exitInfo.signal} · ${ms}`
            : `exit ${exitInfo.code} · ${ms}`;
        termLine(`t-exit${ok ? '' : ' fail'}`, label);
      }
    } catch (error) {
      if (error.name === 'AbortError') termLine('t-exit fail', '^C stopped');
      else termLine('t-err', `Could not run: ${error.message}`);
    } finally {
      state.running = null;
      scrollTerminal();
      markWorkflow('terminal');
    }
  }

  async function changeDirectory(target) {
    if (!target) {
      state.cwd = '';
      updateTerminalPrompt();
      return;
    }
    if (!state.online) return;
    // Validate by asking the shell itself, then keep the path relative to the workspace.
    const controller = new AbortController();
    let collected = '';
    try {
      const response = await postRun({ cmd: `cd ${JSON.stringify(target)} && pwd`, cwd: state.cwd }, controller.signal);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) > -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let event = 'message';
          let payload = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) payload += line.slice(5).trim();
          }
          let data = {};
          try { data = JSON.parse(payload || '{}'); } catch { data = {}; }
          if (event === 'out') collected += data.text || '';
          if (event === 'err') collected += data.text || '';
        }
      }
      const absolute = collected.trim().split('\n').pop() || '';
      const base = state.workspace.replace(/\/+$/, '');
      if (absolute && base && absolute.startsWith(base)) {
        state.cwd = absolute.slice(base.length).replace(/^\/+/, '');
        updateTerminalPrompt();
        toast(`cwd → ~/studio${state.cwd ? `/${state.cwd}` : ''}`, 'ok');
      } else {
        termLine('t-err', `cd: no such directory: ${target}`);
      }
    } catch (error) {
      termLine('t-err', `cd failed: ${error.message}`);
    }
  }

  function clearTerminal() {
    el.termBody.innerHTML = '';
    renderTerminalBanner(state.online ? 'online' : 'offline');
  }

  function applyTermHeight() {
    el.termPanel.style.setProperty('--term-h', `${state.termHeight}px`);
    el.termPanel.classList.toggle('collapsed', state.termCollapsed);
  }

  function bindTerminal() {
    el.termInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = el.termInput.value;
        if (!value.trim()) return;
        state.history.push(value);
        state.historyIndex = state.history.length;
        el.termInput.value = '';
        execute(value);
      } else if (event.key === 'ArrowUp') {
        if (!state.history.length) return;
        event.preventDefault();
        state.historyIndex = Math.max(0, state.historyIndex - 1);
        el.termInput.value = state.history[state.historyIndex] || '';
        requestAnimationFrame(() => el.termInput.setSelectionRange(el.termInput.value.length, el.termInput.value.length));
      } else if (event.key === 'ArrowDown') {
        if (!state.history.length) return;
        event.preventDefault();
        state.historyIndex = Math.min(state.history.length, state.historyIndex + 1);
        el.termInput.value = state.history[state.historyIndex] || '';
      } else if (event.key === 'l' && event.ctrlKey) {
        event.preventDefault();
        clearTerminal();
      } else if (event.key === 'c' && event.ctrlKey && state.running) {
        event.preventDefault();
        state.running.abort();
      }
    });

    $('#btnTermRun').addEventListener('click', () => {
      const value = el.termInput.value;
      if (!value.trim()) return;
      state.history.push(value);
      state.historyIndex = state.history.length;
      el.termInput.value = '';
      execute(value);
    });

    $$('.st-term-quick button').forEach((btn) => {
      btn.addEventListener('click', () => execute(btn.dataset.cmd));
    });

    $('#btnTermClear').addEventListener('click', clearTerminal);

    $('#btnTermToggle').addEventListener('click', () => {
      state.termCollapsed = !state.termCollapsed;
      applyTermHeight();
      savePrefs({ collapsed: state.termCollapsed });
      const toggle = $('#btnTermToggle');
      toggle.setAttribute('aria-label', state.termCollapsed ? 'Expand terminal' : 'Collapse terminal');
      toggle.title = state.termCollapsed ? 'Expand' : 'Collapse';
      if (!state.termCollapsed) el.termInput.focus({ preventScroll: true });
    });

    // drag to resize
    let dragging = false;
    let startY = 0;
    let startHeight = 0;
    const handle = $('#termResize');
    handle.addEventListener('pointerdown', (event) => {
      dragging = true;
      startY = event.clientY;
      startHeight = state.termPanel.getBoundingClientRect().height;
      handle.setPointerCapture(event.pointerId);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const next = Math.min(Math.max(startHeight + (startY - event.clientY), 120), window.innerHeight * 0.7);
      state.termHeight = Math.round(next);
      el.termPanel.style.setProperty('--term-h', `${state.termHeight}px`);
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      savePrefs({ termHeight: state.termHeight });
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);

    el.termBody.addEventListener('click', () => el.termInput.focus({ preventScroll: true }));
  }

  /* --------------------------------- watch -------------------------------- */

  async function startWatch() {
    if (!state.online) return;
    stopWatch();
    const controller = new AbortController();
    watchAbort = controller;
    try {
      let response = await fetch('/api/studio/watch', {
        headers: { 'x-studio-token': state.token },
        signal: controller.signal,
        cache: 'no-store'
      });
      if (response.status === 401) {
        await refreshSession();
        if (controller.signal.aborted) return;
        response = await fetch('/api/studio/watch', {
          headers: { 'x-studio-token': state.token },
          signal: controller.signal,
          cache: 'no-store'
        });
      }
      if (!response.ok || !response.body) throw new Error('watch unavailable');
      state.watchRetries = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let timer = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) > -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (!frame.includes('event: change')) continue;
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const previous = state.files.map((f) => f.path).join('|');
            await refreshTree();
            const next = state.files.map((f) => f.path).join('|');
            if (previous !== next && state.active && !state.open.has(state.active)) {
              state.active = state.tabs[state.tabs.length - 1] || null;
              renderEditor();
            }
            if (state.preview) reloadPreview();
          }, 220);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (watchAbort === controller) watchAbort = null;
      // The server may be restarting: try again shortly, with a light backoff.
      state.watchRetries = (state.watchRetries || 0) + 1;
      const wait = Math.min(1500 * state.watchRetries, 15_000);
      setTimeout(() => { if (!watchAbort) startWatch(); }, wait);
    }
  }

  function stopWatch() {
    if (watchAbort) { try { watchAbort.abort(); } catch { /* noop */ } }
    watchAbort = null;
  }

  /* ---------------------------------- zip --------------------------------- */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
    const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
    return { time: time & 0xFFFF, day: day & 0xFFFF };
  }

  function makeZip(entries) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const { time, day } = dosDateTime(new Date());

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, day, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      chunks.push(local, data);

      const dir = new Uint8Array(46 + nameBytes.length);
      const dv = new DataView(dir.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, time, true);
      dv.setUint16(14, day, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, data.length, true);
      dv.setUint32(24, data.length, true);
      dv.setUint16(28, nameBytes.length, true);
      dv.setUint16(30, 0, true);
      dv.setUint16(32, 0, true);
      dv.setUint16(34, 0, true);
      dv.setUint16(36, 0, true);
      dv.setUint32(38, 0, true);
      dv.setUint32(42, offset, true);
      dir.set(nameBytes, 46);
      central.push(dir);

      offset += local.length + data.length;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }

  async function exportProject() {
    const entries = [];
    if (state.online) {
      const texts = state.files.filter((f) => !f.dir && f.text !== false && !state.open.has(f.path));
      for (const file of texts) {
        try {
          const data = await api(`/api/studio/file?path=${encodeURIComponent(file.path)}`);
          entries.push({ name: file.path, data: data.content });
        } catch { /* skip unreadable */ }
      }
    }
    for (const [path, entry] of state.open) entries.push({ name: path, data: entry.content });
    if (!state.online) {
      for (const [path, content] of Object.entries(state.offlineProject)) {
        if (!entries.some((e) => e.name === path)) entries.push({ name: path, data: content });
      }
    }
    const unique = [...new Map(entries.map((e) => [e.name, e])).values()];
    if (!unique.length) { toast('Nothing to export yet', 'warn'); return; }
    const blob = makeZip(unique);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'eltes-studio.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Exported ${unique.length} file${unique.length === 1 ? '' : 's'}`, 'ok');
  }

  /* --------------------------------- files -------------------------------- */

  /* -------------------------------- effects -------------------------------- */

  function renderEffects() {
    if (!el.effectGrid) return;
    const items = (window.EltesEffects && window.EltesEffects.items) || [];
    if (!items.length) {
      el.effectGrid.innerHTML = '<p class="effect-empty">The effect library did not load.</p>';
      return;
    }
    el.effectGrid.innerHTML = items.map((item) => `
      <article class="effect-card" data-effect="${esc(item.id)}">
        <span class="effect-swatch" style="background:${esc(item.swatch)}" aria-hidden="true"></span>
        <div class="effect-body">
          <div class="effect-title"><strong>${esc(item.name)}</strong><span>${esc(item.tag)}</span></div>
          <p>${esc(item.blurb)}</p>
          <button class="st-btn" type="button" data-make-effect="${esc(item.id)}">Create &amp; preview</button>
        </div>
      </article>`).join('');
  }

  async function createEffect(id) {
    const items = (window.EltesEffects && window.EltesEffects.items) || [];
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const path = `effects/${item.id}.html`;
    if (el.effectsDialog && el.effectsDialog.open) closeModal(el.effectsDialog);
    try {
      await writeWorkspaceFile(path, item.code);
      state.open.delete(path);
      state.tabs = state.tabs.filter((tab) => tab !== path);
      await refreshTree();
      await openFile(path);
      setPreviewPath(path);
      reloadPreview();
      markWorkflow('create');
      markWorkflow('preview');
      toast(`${item.name} → ${path}`, 'ok');
    } catch (error) {
      toast(`Could not generate the effect: ${error.message}`, 'warn');
    }
  }

  function bindEffects() {
    renderEffects();
    const dialog = $('#effectsDialog');
    if ($('#btnEffects')) {
      $('#btnEffects').addEventListener('click', () => {
        renderEffects();
        openModal(dialog);
      });
    }
    if ($('#btnEffectsClose')) $('#btnEffectsClose').addEventListener('click', () => closeModal(dialog));
    if (el.effectGrid) {
      el.effectGrid.addEventListener('click', (event) => {
        const button = event.target.closest('[data-make-effect]');
        if (!button) return;
        button.disabled = true;
        createEffect(button.dataset.makeEffect).finally(() => { button.disabled = false; });
      });
    }
  }

  /* ------------------------------- workflow -------------------------------- */
  /* A guided version of the real flow: scaffold files, run a command, add a
     page, preview it, open it. Every step is completed by the action itself,
     not by a timer, and progress is stored locally. */

  const WF_STEPS = ['scaffold', 'terminal', 'create', 'preview', 'open'];

  function workflowDone() {
    const saved = prefs().workflow;
    return new Set(Array.isArray(saved) ? saved.filter((id) => WF_STEPS.includes(id)) : []);
  }

  function renderWorkflow() {
    const done = workflowDone();
    if (!el.guideSteps) return;
    el.guideSteps.querySelectorAll('[data-wf-step]').forEach((item) => {
      const id = item.dataset.wfStep;
      const complete = done.has(id);
      item.classList.toggle('done', complete);
      const button = item.querySelector('[data-wf-action]');
      if (button) {
        if (!button.dataset.wfOriginal) button.dataset.wfOriginal = button.textContent;
        button.textContent = complete ? 'Run again' : button.dataset.wfOriginal;
      }
    });
    const count = done.size;
    if (el.guideCount) el.guideCount.textContent = `${count}/${WF_STEPS.length}`;
    if (el.guideLabel) el.guideLabel.textContent = count === WF_STEPS.length ? 'Guide done' : 'Guide';
    const nav = $('#btnGuide');
    if (nav) {
      nav.classList.toggle('complete', count === WF_STEPS.length);
      nav.title = count === WF_STEPS.length
        ? 'Guided workflow complete — reopen it any time'
        : `Guided workflow: build a website (${count}/${WF_STEPS.length} done)`;
    }
  }

  function markWorkflow(id) {
    if (!WF_STEPS.includes(id)) return;
    const done = workflowDone();
    if (done.has(id)) return;
    done.add(id);
    savePrefs({ workflow: [...done] });
    renderWorkflow();
    if (done.size === WF_STEPS.length) toast('Workflow complete — the page is live in your browser', 'ok');
  }

  function resetWorkflow() {
    savePrefs({ workflow: [] });
    renderWorkflow();
    toast('Workflow progress reset', 'ok');
  }

  async function writeWorkspaceFile(path, content) {
    if (state.online) {
      await api(`/api/studio/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: content });
    } else {
      state.offlineProject[path] = content;
      persistOfflineProject();
    }
  }

  async function scaffoldSite() {
    const files = {
      'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Eltes starter site</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-nav">
    <a class="logo" href="index.html">Your site</a>
    <nav>
      <a href="index.html" aria-current="page">Home</a>
      <a href="about.html">About</a>
    </nav>
  </header>

  <main>
    <p class="eyebrow">Built in Eltes Studio</p>
    <h1>A website you can actually run.</h1>
    <p class="lede">This page lives in <code>.studio/</code> and is served from <code>/preview/</code>. Edit any file, save, and the preview reloads.</p>
    <div class="actions">
      <a class="btn" href="about.html">Read the about page</a>
      <button class="btn ghost" id="shuffle" type="button">Change the accent</button>
    </div>
    <section class="cards">
      <article><h2>Files</h2><p>Add as many pages as you need — every <code>.html</code> file previews.</p></article>
      <article><h2>Terminal</h2><p>Run <code>npm init -y</code>, install a framework, or build to <code>dist/</code>.</p></article>
      <article><h2>Preview</h2><p>Desktop, tablet and phone widths, or open the page in its own tab.</p></article>
    </section>
  </main>

  <footer>Built with Eltes · <a href="about.html">About</a></footer>
  <script>
    const accents = ['#4785ff', '#39dca2', '#ff9f68', '#b7a6ff'];
    let index = 0;
    document.getElementById('shuffle').addEventListener('click', () => {
      index = (index + 1) % accents.length;
      document.documentElement.style.setProperty('--accent', accents[index]);
    });
  </script>
</body>
</html>
`,
      'about.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>About · Eltes starter site</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-nav">
    <a class="logo" href="index.html">Your site</a>
    <nav>
      <a href="index.html">Home</a>
      <a href="about.html" aria-current="page">About</a>
    </nav>
  </header>

  <main>
    <p class="eyebrow">About</p>
    <h1>A second page, already wired up.</h1>
    <p class="lede">The same stylesheet applies, links work both ways, and the preview follows whichever file you open.</p>
    <p><a class="btn" href="index.html">Back home</a></p>
  </main>

  <footer>Built with Eltes · <a href="index.html">Home</a></footer>
</body>
</html>
`,
      'styles.css': `:root {
  --accent: #4785ff;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  padding: 0 24px 40px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.65;
  color: #e9effb;
  background:
    radial-gradient(900px 520px at 15% -10%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 62%),
    #05070c;
}
.site-nav, main, footer { width: min(920px, 100%); margin: 0 auto; }
.site-nav {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 20px 0 44px;
}
.site-nav .logo { font-weight: 700; color: #fff; text-decoration: none; }
.site-nav nav { margin-left: auto; display: flex; gap: 18px; }
.site-nav nav a { color: #9dadc9; text-decoration: none; font-size: 14px; }
.site-nav nav a[aria-current="page"] { color: #fff; }
.eyebrow {
  margin: 0 0 10px;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}
h1 { margin: 0 0 14px; font-size: clamp(30px, 5vw, 46px); line-height: 1.1; letter-spacing: -0.02em; }
h2 { font-size: 16px; margin: 0 0 6px; }
.lede { max-width: 62ch; color: #9dadc9; font-size: 17px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; color: #cfe0ff; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 40px; }
.btn {
  display: inline-flex;
  align-items: center;
  padding: 10px 16px;
  border: 0;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.btn.ghost { background: transparent; border: 1px solid rgba(150, 180, 240, 0.28); color: #cfe0ff; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.cards article {
  padding: 18px;
  border-radius: 12px;
  border: 1px solid rgba(130, 162, 220, 0.16);
  background: rgba(9, 14, 24, 0.72);
}
.cards p { margin: 0; color: #8fa1bf; font-size: 13.5px; }
footer { margin-top: 46px; padding-top: 18px; border-top: 1px solid rgba(130, 162, 220, 0.12); color: #63779a; font-size: 12.5px; }
footer a { color: #9dadc9; }
`,
      'package.json': `{
  "name": "eltes-starter-site",
  "version": "1.0.0",
  "private": true,
  "description": "A starter site built in Eltes Studio.",
  "scripts": {
    "build": "node build.mjs"
  }
}
`,
      'build.mjs': `/* Copy the site into dist/ — no dependencies, no network. */
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const include = /\\.(html|css|js|svg|json)$/i;
const skip = new Set(['node_modules', 'dist', 'build']);

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await walk(file, out);
    else if (include.test(entry.name)) out.push(file);
  }
  return out;
}

const files = await walk('.');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of files) {
  await mkdir(dirname(join('dist', file)), { recursive: true });
  await cp(file, join('dist', file));
}
console.log(\`built \${files.length} files into dist/: \${files.join(', ')}\`);
`,
      'README.md': `# Starter site

Built in Eltes Studio.

- \`index.html\` — home page
- \`about.html\` — second page, linked both ways
- \`styles.css\` — one stylesheet for both pages

Open any HTML file and the preview follows it. Run \`npm run build\` in the
terminal to copy the site into \`dist/\`, then preview \`dist/index.html\`.
Swap \`build.mjs\` for Vite or any other tool whenever you want one.
`
    };

    const existing = state.files.filter((f) => !f.dir).map((f) => f.path);
    const clashes = Object.keys(files).filter((name) => existing.includes(name));
    if (clashes.length && !askConfirm(`Replace ${clashes.join(', ')} with the starter version?`)) {
      return false;
    }

    for (const [name, body] of Object.entries(files)) {
      await writeWorkspaceFile(name, body);
      state.open.delete(name);
      state.tabs = state.tabs.filter((path) => path !== name);
    }
    await refreshTree();
    renderTabs();
    await openFile('index.html');
    setPreviewPath('index.html');
    reloadPreview();
    markWorkflow('scaffold');
    markWorkflow('preview');
    toast('Starter site created — index.html, about.html, styles.css', 'ok');
    return true;
  }

  async function runWorkflowAction(action) {
    if (!state.online && action === 'terminal') {
      toast('The terminal needs the local server — run npm start', 'warn');
      return;
    }
    if (el.guideDialog && el.guideDialog.open) closeModal(el.guideDialog);
    if (action === 'scaffold') {
      await scaffoldSite();
      return;
    }
    if (action === 'terminal') {
      if (state.termCollapsed) {
        state.termCollapsed = false;
        applyTermHeight();
        $('#btnTermToggle').setAttribute('aria-label', 'Collapse terminal');
      }
      el.termInput.focus({ preventScroll: true });
      await execute('npm run build');
      markWorkflow('terminal');
      return;
    }
    if (action === 'create') {
      el.newFileForm.classList.add('open');
      el.newFileName.focus();
      if (window.innerWidth <= 780) el.filesPanel.classList.add('open');
      return;
    }
    if (action === 'preview') {
      const current = state.preview && state.files.some((f) => !f.dir && f.path === state.preview);
      const target = (current && isHtml(state.preview))
        ? { path: state.preview }
        : state.files.find((f) => !f.dir && isHtml(f.path)) || null;
      if (!target) { toast('Create an HTML file first', 'warn'); return; }
      await openFile(target.path);
      setPreviewPath(target.path);
      reloadPreview();
      markWorkflow('preview');
      toast(`Previewing ${target.path}`, 'ok');
      return;
    }
    if (action === 'open') {
      if (!state.online && !state.preview) { toast('Nothing to open yet', 'warn'); return; }
      $('#btnPopout').click();
      markWorkflow('open');
    }
  }

  function bindWorkflow() {
    renderWorkflow();
    const dialog = $('#guideDialog');
    if ($('#btnGuide')) {
      $('#btnGuide').addEventListener('click', () => {
        renderWorkflow();
        openModal(dialog);
      });
    }
    if ($('#btnGuideClose')) $('#btnGuideClose').addEventListener('click', () => closeModal(dialog));
    if ($('#btnGuideReset')) $('#btnGuideReset').addEventListener('click', resetWorkflow);
    if (el.guideSteps) {
      el.guideSteps.addEventListener('click', (event) => {
        const button = event.target.closest('[data-wf-action]');
        if (!button) return;
        runWorkflowAction(button.dataset.wfAction).catch((error) => toast(error.message, 'warn'));
      });
    }
  }

  function createFile(rawName) {
    let name = String(rawName || '').trim().replace(/^\/+/, '');
    if (!name) return;
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.html';
    if (name.includes('..')) { toast('That name is not allowed', 'warn'); return; }
    const exists = state.files.some((f) => f.path === name);
    if (exists) { toast('That file already exists', 'warn'); openFile(name); return; }

    const templates = {
      html: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>${esc(name.replace(/\.html?$/i, ''))}</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n  <main>\n    <h1>${esc(name.replace(/\.html?$/i, ''))}</h1>\n    <p>Built in Eltes Studio.</p>\n  </main>\n</body>\n</html>\n`,
      css: `/* ${name} */\n:root { color-scheme: dark; }\nbody { font-family: ui-sans-serif, system-ui, sans-serif; background: #05070c; color: #e9effb; }\n`,
      js: `// ${name}\n`,
      md: `# ${name.replace(/\.md$/i, '')}\n`
    };
    const ext = extOf(name);
    const content = templates[ext] !== undefined ? templates[ext] : '';

    if (state.online) {
      api(`/api/studio/file?path=${encodeURIComponent(name)}`, { method: 'PUT', body: content })
        .then(async () => {
          await refreshTree();
          await openFile(name);
          if (isHtml(name)) { setPreviewPath(name); reloadPreview(); }
          markWorkflow('create');
          toast(`Created ${name}`, 'ok');
        })
        .catch((error) => toast(error.message, 'warn'));
    } else {
      state.offlineProject[name] = content;
      persistOfflineProject();
      state.files = offlineTree();
      renderFileList();
      openFile(name).then(() => {
        if (isHtml(name)) { setPreviewPath(name); reloadPreview(); }
        markWorkflow('create');
      });
      toast(`Created ${name}`, 'ok');
    }
  }

  let deleteArmed = null;
  function handleDelete(button, path) {
    if (deleteArmed !== path) {
      if (deleteArmed) {
        const previous = el.fileList.querySelector(`[data-del="${cssEscape(deleteArmed)}"]`);
        if (previous) { previous.classList.remove('confirm'); previous.textContent = '×'; }
      }
      deleteArmed = path;
      button.classList.add('confirm');
      button.textContent = 'delete?';
      setTimeout(() => {
        if (deleteArmed === path) {
          deleteArmed = null;
          button.classList.remove('confirm');
          button.textContent = '×';
        }
      }, 2600);
      return;
    }
    deleteArmed = null;
    performDelete(path);
  }

  async function performDelete(path) {
    try {
      if (state.online) await api(`/api/studio/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      else { delete state.offlineProject[path]; persistOfflineProject(); }
      state.open.delete(path);
      state.tabs = state.tabs.filter((p) => p !== path);
      if (state.active === path) state.active = state.tabs[state.tabs.length - 1] || null;
      await refreshTree();
      renderTabs();
      renderEditor();
      if (state.preview === path) {
        const next = state.files.find((f) => !f.dir && isHtml(f.path));
        if (next) { setPreviewPath(next.path); reloadPreview(); }
      }
      toast(`Deleted ${path}`, 'ok');
    } catch (error) {
      toast(error.message, 'warn');
    }
  }

  /* ---------------------------------- UI ---------------------------------- */

  function bindUI() {
    el.fileList.addEventListener('click', (event) => {
      const del = event.target.closest('[data-del]');
      if (del) { event.stopPropagation(); handleDelete(del, del.dataset.del); return; }
      const row = event.target.closest('[data-path]');
      if (row) openFile(row.dataset.path);
    });
    el.fileList.addEventListener('keydown', (event) => {
      const row = event.target.closest('[data-path]');
      if (row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openFile(row.dataset.path);
      }
    });

    el.tabs.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close]');
      if (close) { event.stopPropagation(); closeTab(close.dataset.close); return; }
      const tab = event.target.closest('[data-tab]');
      if (tab) openFile(tab.dataset.tab);
    });

    el.code.addEventListener('input', onEdit);
    el.code.addEventListener('keydown', editorKeydown);
    el.code.addEventListener('click', updateStatus);
    el.code.addEventListener('keyup', updateStatus);
    el.code.addEventListener('scroll', () => { el.gutter.scrollTop = el.code.scrollTop; });

    $('#btnNewFile').addEventListener('click', () => {
      el.newFileForm.classList.add('open');
      el.newFileName.focus();
      if (window.innerWidth <= 780) el.filesPanel.classList.add('open');
    });
    el.newFileForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = el.newFileName.value;
      el.newFileName.value = '';
      el.newFileForm.classList.remove('open');
      createFile(value);
    });
    el.newFileName.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { el.newFileForm.classList.remove('open'); }
    });

    $('#btnRefreshFiles').addEventListener('click', async () => {
      await refreshTree();
      toast('Workspace refreshed', 'ok');
    });

    $('#btnReload').addEventListener('click', () => { reloadPreview(); toast('Preview reloaded', 'ok'); });
    $('#btnPopout').addEventListener('click', () => {
      if (state.online) {
        window.open(`/preview/${state.preview}`, '_blank', 'noopener');
        markWorkflow('open');
      } else {
        const blob = new Blob([buildOfflineDoc(state.preview)], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 20_000);
        markWorkflow('open');
      }
    });
    el.previewPath.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const next = normalizePreviewInput(el.previewPath.value);
      if (!next) return;
      setPreviewPath(next);
      reloadPreview();
    });
    $$('.st-devices button').forEach((btn) => {
      btn.addEventListener('click', () => setDevice(btn.dataset.device));
    });

    $('#btnDownload').addEventListener('click', exportProject);
    $('#btnHelp').addEventListener('click', () => openModal(el.helpDialog));
    $('#btnHelpClose').addEventListener('click', () => closeModal(el.helpDialog));
    bindWorkflow();
    bindEffects();

    $('#btnRunBuild').addEventListener('click', runBuild);
    $('#btnFilesMobile').addEventListener('click', () => el.filesPanel.classList.toggle('open'));
    $('#btnPreviewMobile').addEventListener('click', () => el.previewPanel.classList.toggle('open'));

    document.addEventListener('keydown', (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 's') {
        if (document.activeElement === el.code) return; // handled there
        event.preventDefault();
        saveActive();
      }
      if (event.key === 'Escape') {
        el.filesPanel.classList.remove('open');
        el.previewPanel.classList.remove('open');
      }
    });

    window.addEventListener('beforeunload', (event) => {
      const dirty = [...state.open.values()].some((entry) => entry.dirty);
      if (!state.online && dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    // keep the offline project safe on tab close
    window.addEventListener('pagehide', () => {
      if (!state.online) persistOfflineProject();
    });

    bindTerminal();
  }

  async function runBuild() {
    if (!state.online) {
      toast('Builds need the local server — run npm start', 'warn');
      return;
    }
    let command = null;
    try {
      const manifest = await api('/api/studio/file?path=package.json');
      const parsed = JSON.parse(manifest.content);
      const scripts = parsed.scripts || {};
      if (scripts.build) command = 'npm run build';
      else if (scripts.dev) command = 'npm run dev';
      else if (scripts.start) command = 'npm start';
    } catch { /* no manifest in this workspace */ }
    if (state.termCollapsed) {
      state.termCollapsed = false;
      applyTermHeight();
      $('#btnTermToggle').setAttribute('aria-label', 'Collapse terminal');
    }
    if (!command) {
      el.termInput.focus({ preventScroll: true });
      toast('No build script yet — try npm init -y, then npm run build', 'warn');
      return;
    }
    execute(command);
    toast(`Running: ${command}`, 'ok');
  }

  async function seedOnlineIfEmpty() {
    if (!state.online || state.files.length) return;
    for (const [name, body] of Object.entries(STARTER)) {
      await api(`/api/studio/file?path=${encodeURIComponent(name)}`, { method: 'PUT', body }).catch(() => {});
    }
    await refreshTree();
  }

  window.addEventListener('DOMContentLoaded', boot);

  /* Small surface for tests and for the console. */
  window.EltesStudio = {
    state,
    makeZip,
    crc32,
    buildOfflineDoc,
    normalizePreviewInput,
    createFile,
    openFile,
    execute,
    scaffoldSite,
    markWorkflow,
    renderWorkflow,
    createEffect
  };
})();
