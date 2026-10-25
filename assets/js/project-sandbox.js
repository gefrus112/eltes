/* Transient browser coding workspace. Local execution is delegated to an approved, paired runner. */
(function (root) {
  'use strict';
  const MAX_BYTES = 100 * 1024;
  const MAX_FILES = 24;
  function validateFile(filename, content) {
    if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:html|css|js|ts|py|json|txt|md|jac)$/i.test(filename)) throw new Error('Use a simple top-level source filename, such as index.html or styles.css.');
    if (/(?:secret|credential|private|production|deploy|vercel|firebase|package)/i.test(filename)) throw new Error('Sensitive/configuration filenames are not allowed in this workspace.');
    if (typeof content !== 'string' || new TextEncoder().encode(content).length > MAX_BYTES) throw new Error('Provide complete file content up to 100 KB.');
    return { filename, content };
  }
  function replaceExact(content, search, replacement) {
    if (typeof search !== 'string' || !search || typeof replacement !== 'string') throw new Error('Provide nonempty exact search text and a replacement string.');
    const at = content.indexOf(search);
    if (at < 0) throw new Error('Search text was not found. Read the current file before editing.');
    if (content.indexOf(search, at + 1) >= 0) throw new Error('Search text is ambiguous. Include enough surrounding source to match exactly once.');
    return content.slice(0, at) + replacement + content.slice(at + search.length);
  }
  // Parse HTML inertly, then inline only selected virtual assets. All network
  // resources remain subject to the CSP placed before any user-provided markup.
  function previewDocument(files, entry) {
    if (!/\.html$/i.test(entry) || typeof files[entry] !== 'string') throw new Error('Select an HTML file to preview.');
    const doc = new DOMParser().parseFromString(files[entry], 'text/html');
    doc.querySelectorAll('base, meta[http-equiv]').forEach((node) => node.remove());
    const localName = (s) => String(s || '').replace(/^\.\//, '');
    doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      const name = localName(link.getAttribute('href'));
      if (typeof files[name] !== 'string') return;
      const style = doc.createElement('style');
      style.textContent = files[name].replace(/<\/style/gi, '<\\/style');
      link.replaceWith(style);
    });
    doc.querySelectorAll('script[src]').forEach((script) => {
      const name = localName(script.getAttribute('src'));
      if (typeof files[name] !== 'string') return;
      script.removeAttribute('src');
      script.textContent = files[name].replace(/<\/script/gi, '<\\/script');
    });
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src data:; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
    // Parent controls a separate opaque-origin frame. Never allow same-origin.
    return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + policy + '">' + doc.documentElement.outerHTML;
  }
  // Display-only decoding of an unfinished streamed tool argument. Never executed
  // or saved: the provider's complete JSON still goes through validation/review.
  function partialField(raw, field) {
    const match = String(raw).match(new RegExp('"' + field + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)'));
    if (!match) return '';
    for (let trim = 0; trim <= Math.min(6, match[1].length); trim++) {
      try { return JSON.parse('"' + match[1].slice(0, match[1].length - trim) + '"'); } catch { /* incomplete escape */ }
    }
    return '';
  }
  async function readRunnerResponse(response, onEvent) {
    if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || `Local runner returned HTTP ${response.status}.`);
      return result;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', result = null;
    function consume(line) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'result') result = event;
      onEvent(event);
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (buffer.length > 512 * 1024) throw new Error('Runner response exceeded the display limit.');
        const lines = buffer.split('\n'); buffer = lines.pop();
        lines.forEach(consume);
        if (done) { consume(buffer); break; }
      }
      if (!result) throw new Error('Runner disconnected before reporting an exit status.');
      return result;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  function create({ openDialog, download, review, readReview, stopped, runScript, runJavaScript, stopTask }) {
    const files = Object.create(null); // transient per-tab project, never automatic disk writes
    const dialog = document.getElementById('projectSandboxDialog');
    const tree = document.getElementById('projectSandboxFiles');
    const editor = document.getElementById('projectSandboxEditor');
    const frame = document.getElementById('projectSandboxPreview');
    const status = document.getElementById('projectSandboxStatus');
    const activity = document.getElementById('projectSandboxActivity');
    const draft = document.getElementById('projectSandboxDraft');
    const draftTitle = document.getElementById('projectSandboxDraftTitle');
    let active = '', timer = null, dismissed = false, executing = false;
    let draftTimer = null, pendingDraft = null;
    function log(text) {
      activity.textContent = (activity.textContent + String(text)).slice(-48 * 1024);
      activity.scrollTop = activity.scrollHeight;
    }
    function reveal() {
      if (dismissed || dialog.open) return;
      // Non-modal while generating: keep chat, Stop, and approvals accessible.
      dialog.classList.add('project-live');
      if (typeof dialog.show === 'function') dialog.show();
      else dialog.setAttribute('open', '');
    }
    function showDraft(name, raw) {
      if (!['write_project_file', 'replace_project_text', 'read_project_file', 'run_shell', 'run_project_script', 'write_workspace_file', 'create_file'].includes(name)) return;
      reveal();
      pendingDraft = { name, raw: String(raw).slice(0, 640 * 1024) };
      if (draftTimer) return;
      draftTimer = setTimeout(() => {
        draftTimer = null;
        if (!pendingDraft) return;
        const { name, raw } = pendingDraft;
        draftTitle.textContent = `${name} · ${partialField(raw, 'filename') || 'receiving arguments'} · unapproved draft`;
        draft.textContent = partialField(raw, name === 'run_shell' ? 'command' : 'content') || raw;
        draft.scrollTop = draft.scrollHeight;
      }, 60);
    }
    async function execute(args) {
      if (executing) return { error: 'A project script is already running or awaiting approval.' };
      const name = args?.filename;
      if (!Object.hasOwn(files, name) || !/\.(py|js|ts)$/i.test(name)) return { error: 'Save a .py, .js or .ts project file first. Only that saved file is copied; no project dependencies.' };
      if (dirty(name)) return { error: 'Save or discard unsaved edits before executing this script.' };
      const file = validateFile(name, files[name]); // immutable snapshot for review
      executing = true;
      reveal();
      log(`\nReview requested: ${name} (local script, not browser sandbox)\n`);
      try {
        const result = await runScript(file);
        log(`\n${result.error ? 'Failed or declined' : 'Finished'}: ${result.result || result.error}\n`);
        status.textContent = result.error ? 'Script failed, declined, or cancelled. See activity.' : 'Script completed. See activity for output.';
        return result;
      } finally { executing = false; }
    }
    function resetPreview() { clearTimeout(timer); frame.srcdoc = ''; }
    function dirty(name = active) { return !!active && active === name && editor.value !== files[active]; }
    function editorInfo() {
      const info = document.getElementById('projectSandboxEditorInfo');
      if (info) info.textContent = active ? `${editor.value.split('\n').length} lines · ${new TextEncoder().encode(editor.value).length} bytes · ${dirty() ? 'Unsaved edits' : 'Saved in tab'}` : 'Tab indents · Ctrl/Cmd+S saves';
    }
    function select(name) {
      if (name !== active && dirty()) { render(); status.textContent = 'Save or discard your unsaved edits before switching files.'; return false; }
      active = name; editor.value = files[name] || ''; render(); return true;
    }
    function render() {
      tree.replaceChildren();
      Object.keys(files).sort().forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn btn-ghost btn-sm'; btn.textContent = name;
        btn.setAttribute('aria-pressed', String(name === active));
        btn.onclick = () => select(name); tree.append(btn);
      });
      editorInfo();
      document.getElementById('projectSandboxFilename').textContent = active || 'No file selected';
      document.getElementById('projectSandboxScript').disabled = !/\.(py|js|ts)$/i.test(active);
      document.getElementById('projectSandboxJS').disabled = !/\.js$/i.test(active);
    }
    function open() { dismissed = false; render(); reveal(); }
    document.getElementById('openProjectSandbox').onclick = open;
    editor.addEventListener('input', editorInfo);
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); document.getElementById('projectSandboxSave').click(); }
      if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); editorInfo(); }
    });
    document.getElementById('projectSandboxDiscard').onclick = () => { editor.value = files[active] || ''; editorInfo(); status.textContent = 'Edits discarded; restored the saved source.'; };
    document.getElementById('projectSandboxCancelTask').onclick = () => stopTask();
    document.getElementById('projectSandboxScript').onclick = async () => {
      if (editor.value !== files[active]) { status.textContent = 'Save your edits in this tab before running.'; return; }
      await execute({ filename: active });
    };
    document.getElementById('projectSandboxJS').onclick = () => {
      if (editor.value !== files[active]) { status.textContent = 'Save your edits in this tab before running.'; return; }
      runJavaScript(files[active]);
    };
    document.getElementById('projectSandboxAdd').onclick = () => {
      try {
        const name = document.getElementById('projectSandboxNewName').value.trim();
        validateFile(name, '');
        if (Object.hasOwn(files, name)) throw new Error('File already exists. Select it to edit.');
        if (Object.keys(files).length >= MAX_FILES) throw new Error('Project limit: 24 files.');
        files[name] = ''; select(name); status.textContent = 'Created in browser memory only.';
      } catch (error) { status.textContent = error.message; }
    };
    document.getElementById('projectSandboxSave').onclick = () => {
      try {
        validateFile(active, editor.value); files[active] = editor.value; editorInfo();
        status.textContent = 'Saved in this tab. Preview is not run automatically.';
      } catch (error) { status.textContent = error.message; }
    };
    document.getElementById('projectSandboxDownload').onclick = () => {
      if (dirty()) { status.textContent = 'Save or discard your edits before downloading.'; return; }
      if (active) download(active, files[active], active.endsWith('.html') ? 'text/html' : 'text/plain');
    };
    document.getElementById('projectSandboxRun').onclick = () => {
      if (dirty()) { status.textContent = 'Save or discard your edits before previewing.'; return; }
      try {
        resetPreview();
        frame.srcdoc = previewDocument(files, active.endsWith('.html') ? active : 'index.html');
        status.textContent = 'Preview running with a restrictive resource policy and no app access; resets after 30 seconds. DOM scripts may navigate the frame or freeze a renderer; do not include private data. Only run trusted code.';
        timer = setTimeout(() => { resetPreview(); status.textContent = 'Preview reset after 30 seconds.'; }, 30_000);
      } catch (error) { status.textContent = error.message; }
    };
    document.getElementById('projectSandboxStop').onclick = () => { resetPreview(); status.textContent = 'Preview stopped.'; };
    dialog.addEventListener('close', () => { resetPreview(); dismissed = true; });
    async function saveReviewed(file) {
      const previous = files[file.filename];
      if (dirty(file.filename)) return { error: 'This file has unsaved editor changes. Ask the user to save or discard them; do not overwrite them.' };
      if (!Object.hasOwn(files, file.filename) && Object.keys(files).length >= MAX_FILES) throw new Error('Project limit: 24 files.');
      if (!await review(file)) return { error: 'User declined this project file. Do not retry unless asked.' };
      if (stopped()) return { error: 'Stopped before saving the project file.' };
      if (files[file.filename] !== previous || dirty(file.filename)) return { error: 'File changed during review. Read the current file and request a fresh review.' };
      if (!Object.hasOwn(files, file.filename) && Object.keys(files).length >= MAX_FILES) throw new Error('Project limit: 24 files.');
      files[file.filename] = file.content;
      const selected = select(file.filename); reveal();
      log(`Saved after approval: ${file.filename}\n`);
      if (selected) status.textContent = 'Approved source saved in browser memory. Review/edit files, then preview or separately approve local execution. Download files to keep them.';
      return { result: `Saved ${file.filename} in browser project after review. Files: ${Object.keys(files).join(', ')}. No automatic execution or disk writes. Website preview requires the user to click Preview; scripts require separate run_project_script approval.` };
    }
    return {
      execute, log, showDraft,
      beginGeneration(model) {
        dismissed = false;
        draft.textContent = ''; draftTitle.textContent = 'Waiting for coding tools';
        log(`\nModel: ${model} · live provider output\n`);
      },
      endGeneration(message) {
        clearTimeout(draftTimer); draftTimer = null; pendingDraft = null;
        draftTitle.textContent = 'Generation ended · drafts are not executable files';
        log(`\n${message}\n`);
      },
      action(name, args, phase) {
        if (!['write_project_file', 'replace_project_text', 'read_project_file', 'run_shell', 'run_project_script', 'write_workspace_file', 'create_file'].includes(name)) return;
        reveal();
        log(`\n${phase}: ${name} ${args?.filename || ''}\n`);
        if (phase === 'Awaiting review') showDraft(name, JSON.stringify(args));
      },
      tools: [{ name: 'write_project_file', icon: 'code-2', description: 'Create or update one virtual browser-project file (HTML, CSS, JavaScript, TypeScript, Python, JSON, Markdown, text or Jac). Show Plan: first. User reviews and approves complete content; then the coding workspace opens. No disk writes or automatic execution. For a website use index.html with styles.css and app.js. Only plain local script/link references are inlined in preview: no modules, imports, npm or fetch in website preview. Python/JavaScript/TypeScript files can separately use run_project_script on a paired local runner after approval. Jac is source-only.', parameters: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' } }, required: ['filename', 'content'] } },
        { name: 'list_project_files', icon: 'files', description: 'List saved virtual project filenames, byte sizes and whether the editor has unsaved changes. No disk access or source contents. Use before modifying an existing project.', parameters: { type: 'object', properties: {} } },
        { name: 'read_project_file', icon: 'file-code-2', description: 'Read one saved virtual project file only after the user explicitly approves sending its full source back to the selected model. Never reads the disk or unsaved editor draft.', parameters: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] } },
        { name: 'replace_project_text', icon: 'pencil', description: 'Precisely edit a saved virtual project file. Show Plan: first. Supply exact search text that occurs once, and replacement text. User reviews the full resulting source before saving. Read the current file first; stale/ambiguous matches and unsaved edits are refused. Never executes code.', parameters: { type: 'object', properties: { filename: { type: 'string' }, search: { type: 'string' }, replacement: { type: 'string' } }, required: ['filename', 'search', 'replacement'] } }
      ],
      list() { return { result: JSON.stringify(Object.keys(files).sort().map(filename => ({ filename, bytes: new TextEncoder().encode(files[filename]).length, unsaved: dirty(filename) }))) }; },
      async read(args) {
        const filename = args?.filename;
        if (!Object.hasOwn(files, filename)) return { error: 'No saved project file with that name.' };
        const file = { filename, content: files[filename] };
        if (!await readReview(file)) return { error: 'User declined sharing this source with the model. Do not retry unless asked.' };
        if (stopped() || files[filename] !== file.content) return { error: 'Stopped or source changed during review. No source returned.' };
        return { result: JSON.stringify(file) };
      },
      async patch(args) {
        try {
          if (!Object.hasOwn(files, args?.filename)) throw new Error('No saved project file with that name. List and read the project first.');
          const content = replaceExact(files[args.filename], args.search, args.replacement);
          return await saveReviewed(validateFile(args.filename, content));
        } catch (error) { return { error: error.message }; }
      },
      async run(args) {
        try {
          const file = validateFile(args?.filename, args?.content);
          return await saveReviewed(file);
        } catch (error) { return { error: error.message }; }
      }
    };
  }
  const api = { create, validateFile, replaceExact, previewDocument, partialField, readRunnerResponse };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EltesProjectSandbox = api;
})(typeof window === 'object' ? window : globalThis);
