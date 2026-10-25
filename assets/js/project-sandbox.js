/* Browser-only coding workspace. No provider keys, filesystem handles, or shell. */
(function (root) {
  'use strict';
  const MAX_BYTES = 100 * 1024;
  const MAX_FILES = 24;
  function validateFile(filename, content) {
    if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:html|css|js|json|txt|md|jac)$/i.test(filename)) throw new Error('Use a simple top-level source filename, such as index.html or styles.css.');
    if (/(?:secret|credential|private|production|deploy|vercel|firebase|package)/i.test(filename)) throw new Error('Sensitive/configuration filenames are not allowed in this workspace.');
    if (typeof content !== 'string' || new TextEncoder().encode(content).length > MAX_BYTES) throw new Error('Provide complete file content up to 100 KB.');
    return { filename, content };
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
  function create({ openDialog, download, review, stopped }) {
    const files = Object.create(null); // transient per-tab project, never automatic disk writes
    const dialog = document.getElementById('projectSandboxDialog');
    const tree = document.getElementById('projectSandboxFiles');
    const editor = document.getElementById('projectSandboxEditor');
    const frame = document.getElementById('projectSandboxPreview');
    const status = document.getElementById('projectSandboxStatus');
    let active = '', timer = null;
    function resetPreview() { clearTimeout(timer); frame.srcdoc = ''; }
    function select(name) { active = name; editor.value = files[name] || ''; render(); }
    function render() {
      tree.replaceChildren();
      Object.keys(files).sort().forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn btn-ghost btn-sm'; btn.textContent = name;
        btn.setAttribute('aria-pressed', String(name === active));
        btn.onclick = () => select(name); tree.append(btn);
      });
      document.getElementById('projectSandboxFilename').textContent = active || 'No file selected';
    }
    function open() { render(); openDialog(dialog); }
    document.getElementById('openProjectSandbox').onclick = open;
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
        validateFile(active, editor.value); files[active] = editor.value;
        status.textContent = 'Saved in this tab. Preview is not run automatically.';
      } catch (error) { status.textContent = error.message; }
    };
    document.getElementById('projectSandboxDownload').onclick = () => {
      if (active) download(active, files[active], active.endsWith('.html') ? 'text/html' : 'text/plain');
    };
    document.getElementById('projectSandboxRun').onclick = () => {
      try {
        resetPreview();
        frame.srcdoc = previewDocument(files, active.endsWith('.html') ? active : 'index.html');
        status.textContent = 'Preview running with a restrictive resource policy and no app access; resets after 30 seconds. DOM scripts may navigate the frame or freeze a renderer; do not include private data. Only run trusted code.';
        timer = setTimeout(() => { resetPreview(); status.textContent = 'Preview reset after 30 seconds.'; }, 30_000);
      } catch (error) { status.textContent = error.message; }
    };
    document.getElementById('projectSandboxStop').onclick = () => { resetPreview(); status.textContent = 'Preview stopped.'; };
    dialog.addEventListener('close', resetPreview);
    return {
      tools: [{ name: 'write_project_file', icon: 'code-2', description: 'Create or update one virtual browser-project file (HTML, CSS, JavaScript, JSON, Markdown, text or Jac). Show Plan: first. User reviews and approves complete content; then the coding workspace opens. No disk writes or automatic execution. For a website use index.html with styles.css and app.js. Only plain local script/link references are inlined in preview: no modules, imports, npm, fetch, Python or Jac execution.', parameters: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' } }, required: ['filename', 'content'] } }],
      async run(args) {
        try {
          const file = validateFile(args?.filename, args?.content);
          if (!Object.hasOwn(files, file.filename) && Object.keys(files).length >= MAX_FILES) throw new Error('Project limit: 24 files.');
          if (!await review(file)) return { error: 'User declined this project file. Do not retry unless asked.' };
          if (stopped()) return { error: 'Stopped before saving the project file.' };
          files[file.filename] = file.content; select(file.filename); open();
          status.textContent = 'Approved source saved in browser memory. Review/edit files and press Preview to execute. Download files to keep them before closing this tab.';
          return { result: `Saved ${file.filename} in browser project after review. Files: ${Object.keys(files).join(', ')}. Workspace opened; the user must click Preview to execute. Nothing written to disk.` };
        } catch (error) { return { error: error.message }; }
      }
    };
  }
  const api = { create, validateFile, previewDocument };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EltesProjectSandbox = api;
})(typeof window === 'object' ? window : globalThis);
