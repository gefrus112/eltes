/* ==========================================================================
   Eltes Studio — local coding environment backend
   --------------------------------------------------------------------------
   Runs ONLY inside tools/local-server.mjs (npm start). It is deliberately not
   part of /api, so a Vercel deployment can never expose a shell. It gives the
   Studio page three things a static site cannot have:

     • a jailed workspace on disk          (.studio/)
     • file read / write / delete          (/api/studio/file)
     • a real Linux shell with streaming   (/api/studio/run)
     • a live preview origin               (/preview/*)
     • a change watcher for auto-reload    (/api/studio/watch)

   Every mutating call needs the per-process token that /api/studio/session
   hands to the page. Because no CORS headers are ever sent, another origin
   cannot read that token nor send the custom header it requires.
   ========================================================================== */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export const WORKSPACE_DIR = '.studio';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 512 * 1024;
export const MAX_COMMAND_CHARS = 4000;
export const MAX_TREE_DEPTH = 6;
export const DEFAULT_RUN_MS = 60_000;

const IGNORED_DIRS = new Set(['node_modules', '.git', '.cache', '.next', 'dist', 'build', 'coverage']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.zip', '.pdf']);

/* The Studio terminal is a real shell. On macOS and Linux that is bash (or
   sh). On Windows there is no /bin/bash, so it is cmd.exe unless
   ELTES_SHELL points at Git Bash, WSL or another shell. */
function pickShell() {
  const override = String(process.env.ELTES_SHELL || '').trim();
  if (override) return override;
  if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
  return existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

export const SHELL = pickShell();

/** Arguments that run one command string in that shell. */
export function shellArgs(command) {
  const cmd = String(command);
  if (/cmd(\.exe)?$/i.test(SHELL)) return ['/d', '/s', '/c', cmd];
  if (/powershell(\.exe)?$/i.test(SHELL) || /pwsh(\.exe)?$/i.test(SHELL)) {
    return ['-NoProfile', '-NonInteractive', '-Command', cmd];
  }
  return ['-c', cmd];
}

/* Windows has no POSIX process groups: kill the whole tree with taskkill. */
function killTree(child, signal = 'SIGKILL') {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    } catch { /* fall through */ }
  }
  try { process.kill(-child.pid, signal); } catch { /* already gone */ }
  try { child.kill(signal); } catch { /* already gone */ }
}

/* --------------------------------- paths --------------------------------- */

/** Normalise a workspace-relative path. Returns null for anything unsafe. */
export function normalizePath(input) {
  if (typeof input !== 'string') return null;
  const raw = input.replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.startsWith('~')) return null;
  const parts = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..' || segment.includes('\0')) return null;
    parts.push(segment);
  }
  if (!parts.length) return null;
  const joined = parts.join('/');
  return joined.length > 240 ? null : joined;
}

/** Resolve a relative path inside root, or null when it would escape. */
export function resolveInside(root, rel, { allowRoot = false } = {}) {
  if ((rel === '' || rel === '.' || rel === undefined) && allowRoot) return root;
  const norm = normalizePath(rel);
  if (!norm) return null;
  const full = resolve(root, norm);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export function isTextPath(rel) {
  const lower = String(rel || '').toLowerCase();
  const base = lower.split('/').pop() || '';
  if (base === '.gitignore' || base === '.env.example' || base === 'license') return true;
  return !BINARY_EXT.has(extname(lower));
}

/* ------------------------------- workspace ------------------------------- */

export async function ensureWorkspace(root) {
  await mkdir(root, { recursive: true });
  return root;
}

/** List the workspace tree, breadth-first, skipping heavy folders. */
export async function listTree(root, rel = '', depth = 0) {
  const dir = resolveInside(root, rel, { allowRoot: true });
  if (!dir) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const out = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        out.push({ path: childRel, name: entry.name, dir: true, skipped: true });
        continue;
      }
      out.push({ path: childRel, name: entry.name, dir: true });
      if (depth + 1 < MAX_TREE_DEPTH) out.push(...await listTree(root, childRel, depth + 1));
    } else if (entry.isFile()) {
      let size = 0;
      let mtime = 0;
      try {
        const info = await stat(resolve(dir, entry.name));
        size = info.size;
        mtime = Math.round(info.mtimeMs);
      } catch { /* race with delete */ }
      out.push({ path: childRel, name: entry.name, dir: false, size, mtime, text: isTextPath(childRel) });
    }
  }
  return out;
}

export async function readProjectFile(root, rel) {
  const file = resolveInside(root, rel);
  if (!file) return { error: 'Invalid path', status: 400 };
  if (!isTextPath(rel)) return { error: 'Binary files cannot be opened in the editor', status: 415 };
  try {
    const info = await stat(file);
    if (!info.isFile()) return { error: 'Not a file', status: 400 };
    if (info.size > MAX_FILE_BYTES) return { error: 'File is larger than 2 MB', status: 413 };
    return { content: await readFile(file, 'utf8'), size: info.size };
  } catch {
    return { error: 'File not found', status: 404 };
  }
}

export async function writeProjectFile(root, rel, content) {
  const file = resolveInside(root, rel);
  if (!file) return { error: 'Invalid path', status: 400 };
  if (typeof content !== 'string') return { error: 'Content must be text', status: 400 };
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return { error: 'File is larger than 2 MB', status: 413 };
  try {
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, content, 'utf8');
    return { ok: true, path: rel, bytes: Buffer.byteLength(content, 'utf8') };
  } catch {
    return { error: 'Could not write file', status: 500 };
  }
}

export async function deleteProjectFile(root, rel) {
  const file = resolveInside(root, rel);
  if (!file) return { error: 'Invalid path', status: 400 };
  try {
    await rm(file, { recursive: true, force: false });
    return { ok: true, path: rel };
  } catch {
    return { error: 'Could not delete', status: 404 };
  }
}

/* -------------------------------- starter -------------------------------- */

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
    <p>Edit this file, save with <kbd>⌘S</kbd>, and the preview reloads. Run commands in the terminal below — the preview follows the files on disk.</p>
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
  'notes.md': `# Workspace notes

- Everything here lives in \`.studio/\` next to the app.
- The preview on the right is served from \`/preview/\`, so relative links,
  modules and assets behave exactly like a normal site.
- The terminal is a real shell in this folder: \`ls\`, \`git\`, \`npm install\`,
  \`npm run build\` all work.
`,
  'README.txt': `Eltes Studio workspace

The files in this folder are served at /preview/ by the local server.
Create another .html file and open it in the preview to test it.
`
};

export async function seedWorkspace(root) {
  await ensureWorkspace(root);
  const existing = await readdir(root).catch(() => []);
  if (existing.length) return { created: false };
  for (const [name, body] of Object.entries(STARTER)) {
    await writeFile(resolve(root, name), body, 'utf8');
  }
  return { created: true, files: Object.keys(STARTER) };
}

/* --------------------------------- shell --------------------------------- */

/**
 * Start a command inside the workspace. Returns a handle with a `done`
 * promise. Output is streamed through onData(kind, text) where kind is
 * 'out' or 'err'. Never throws for user mistakes — returns { error }.
 */
export function runCommand({ root, cmd, cwd = '', timeoutMs = DEFAULT_RUN_MS, onData = () => {}, env = {} }) {
  if (typeof cmd !== 'string' || !cmd.trim()) return { error: 'Empty command', status: 400 };
  if (cmd.length > MAX_COMMAND_CHARS) return { error: `Command is longer than ${MAX_COMMAND_CHARS} characters`, status: 413 };
  if (cmd.includes('\0')) return { error: 'Invalid command', status: 400 };
  const dir = resolveInside(root, cwd || '', { allowRoot: true });
  if (!dir) return { error: 'Invalid working directory', status: 400 };

  const started = Date.now();
  let bytes = 0;
  let killed = false;
  let child;
  try {
    child = spawn(SHELL, shellArgs(cmd), {
      cwd: dir,
      env: {
        ...process.env,
        ...env,
        TERM: 'xterm-256color',
        COLORTERM: '',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ELTES_STUDIO: '1'
      },
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    return { error: `Could not start shell: ${error.message}`, status: 500 };
  }

  const kill = (signal = 'SIGKILL') => {
    if (killed) return;
    killed = true;
    killTree(child, signal);
  };

  const timer = timeoutMs > 0 ? setTimeout(() => {
    onData('err', `\n[eltes] stopped after ${Math.round(timeoutMs / 1000)}s\n`);
    kill();
  }, timeoutMs) : null;

  const push = (kind) => (chunk) => {
    if (killed) return;
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT_BYTES) {
      onData('err', `\n[eltes] output limit reached (${Math.round(MAX_OUTPUT_BYTES / 1024)} KB)\n`);
      kill();
      return;
    }
    onData(kind, chunk.toString('utf8'));
  };
  child.stdout.on('data', push('out'));
  child.stderr.on('data', push('err'));

  const done = new Promise((resolveDone) => {
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolveDone({ code: null, signal: null, ms: Date.now() - started, error: error.message, killed });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolveDone({ code, signal, ms: Date.now() - started, error: null, killed });
    });
  });

  return { child, kill, done, pid: child.pid, started };
}

/* -------------------------------- preview -------------------------------- */

const PREVIEW_MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

export function previewMime(file) {
  return PREVIEW_MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Resolve /preview/<rel> to a file inside the workspace, following dirs to index.html. */
export async function resolvePreviewFile(root, relPath) {
  let rel = String(relPath || '').replace(/^\/+/, '');
  try { rel = decodeURIComponent(rel); } catch { return null; }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = resolveInside(root, rel);
  if (!file) return null;
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      const index = resolve(file, 'index.html');
      if (existsSync(index)) return index;
      return null;
    }
    return info.isFile() ? file : null;
  } catch {
    return null;
  }
}

/* ---------------------------- request handling ---------------------------- */

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req, limit = MAX_FILE_BYTES + 4096) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sse(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return {
    send(event, data) {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!res.writableEnded) res.end();
    }
  };
}

/**
 * Build the /api/studio + /preview handler.
 * Returns null when studio is disabled, so the server can skip it entirely.
 */
export function createStudio({ workspace, token, allowShell = true, maxRunMs = DEFAULT_RUN_MS }) {
  const watchers = new Set();

  const authorized = (req) => {
    const given = req.headers['x-studio-token'];
    if (!given || typeof given !== 'string') return false;
    if (given.length !== token.length) return false;
    let diff = 0;
    for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ given.charCodeAt(i);
    return diff === 0;
  };

  async function handle(req, res, url) {
    const pathname = url.pathname;
    const isPreview = pathname === '/preview' || pathname.startsWith('/preview/');
    if (!isPreview && !pathname.startsWith('/api/studio')) return false;

    if (isPreview) {
      return false; // served by the static branch with previewMime()
    }

    const route = pathname.slice('/api/studio'.length) || '/';

    try {
      if (route === '/session') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' }), true;
        return json(res, 200, {
          ok: true,
          token,
          shell: SHELL,
          platform: process.platform,
          workspace: workspace,
          allowShell,
          maxRunMs,
          node: process.version
        }), true;
      }

      if (!authorized(req)) return json(res, 401, { error: 'Studio token missing or wrong' }), true;

      if (route === '/tree') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' }), true;
        const files = await listTree(workspace);
        return json(res, 200, { ok: true, files, root: workspace }), true;
      }

      if (route === '/file') {
        const rel = url.searchParams.get('path') || '';
        if (req.method === 'GET') {
          const out = await readProjectFile(workspace, rel);
          return json(res, out.error ? out.status : 200, out.error ? { error: out.error } : out), true;
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          let content;
          try { content = await readBody(req); }
          catch (error) { return json(res, error.status || 400, { error: error.message }), true; }
          const out = await writeProjectFile(workspace, rel, content);
          return json(res, out.error ? out.status : 200, out), true;
        }
        if (req.method === 'DELETE') {
          const out = await deleteProjectFile(workspace, rel);
          return json(res, out.error ? out.status : 200, out), true;
        }
        return json(res, 405, { error: 'Method not allowed' }), true;
      }

      if (route === '/run') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }), true;
        if (!allowShell) return json(res, 403, { error: 'Shell is disabled (ELTES_STUDIO_SHELL=0)' }), true;
        let payload;
        try { payload = JSON.parse(await readBody(req, 32 * 1024) || '{}'); }
        catch { return json(res, 400, { error: 'Invalid JSON body' }), true; }

        const stream = sse(res);
        const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || maxRunMs, 1000), 10 * 60_000);
        const started = runCommand({
          root: workspace,
          cmd: payload.cmd,
          cwd: payload.cwd,
          timeoutMs,
          onData: (kind, text) => stream.send(kind, { text })
        });

        if (started.error) {
          stream.send('error', { error: started.error });
          stream.send('exit', { code: null, ms: 0, error: started.error });
          stream.end();
          return true;
        }

        stream.send('start', { pid: started.pid, cwd: payload.cwd || '', shell: SHELL });
        req.on('close', () => { if (!res.writableEnded) started.kill(); });
        started.done.then((result) => {
          stream.send('exit', result);
          stream.end();
        });
        return true;
      }

      if (route === '/watch') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' }), true;
        const stream = sse(res);
        let pending = new Set();
        let timer = null;
        let watcher;
        try {
          watcher = watch(workspace, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            const name = String(filename);
            if (name.includes('node_modules') || name.startsWith('.git')) return;
            pending.add(name);
            if (timer) return;
            timer = setTimeout(() => {
              timer = null;
              const paths = [...pending];
              pending = new Set();
              stream.send('change', { paths });
            }, 140);
          });
        } catch (error) {
          stream.send('error', { error: `Watch unavailable: ${error.message}` });
          stream.end();
          return true;
        }
        watcher.on('error', () => { /* a deleted directory can break a watcher; the client reconnects */ });
        watchers.add(watcher);
        stream.send('ready', { root: workspace });
        const heartbeat = setInterval(() => stream.send('ping', { t: Date.now() }), 25_000);
        req.on('close', () => {
          clearInterval(heartbeat);
          if (timer) clearTimeout(timer);
          watchers.delete(watcher);
          try { watcher.close(); } catch { /* already closed */ }
          stream.end();
        });
        return true;
      }

      return json(res, 404, { error: 'Unknown studio route' }), true;
    } catch (error) {
      if (!res.headersSent) return json(res, 500, { error: 'Studio error' }), true;
      try { res.end(); } catch { /* closed */ }
      return true;
    }
  }

  return {
    handle,
    close() {
      for (const watcher of watchers) { try { watcher.close(); } catch { /* noop */ } }
      watchers.clear();
    }
  };
}
