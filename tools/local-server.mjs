import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import auth from '../api/auth.js';
import chat from '../api/chat.js';
import keyCheck from '../api/key-check.js';
import health from '../api/health.js';
import search from '../api/search.js';
import email from '../api/email.js';
import { serveMedia } from './media-response.mjs';
import { createShellRunner } from './shell-runner.mjs';
import {
  WORKSPACE_DIR, createStudio, ensureWorkspace, previewMime, resolvePreviewFile, seedWorkspace
} from './studio.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const routes = { '/api/auth': auth, '/api/chat': chat, '/api/key-check': keyCheck, '/api/health': health, '/api/search': search };
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};

/* ------------------------------- studio ---------------------------------- */
const studioEnabled = process.env.ELTES_STUDIO !== '0';
const studioAllowShell = process.env.ELTES_STUDIO_SHELL === '1';
const studioToken = process.env.ELTES_STUDIO_TOKEN || randomBytes(16).toString('hex');
/* A packaged desktop app keeps its Studio workspace in the user's data folder
   (resources/ may be read-only), so the path can be redirected. */
const workspace = process.env.ELTES_STUDIO_DIR ? resolve(process.env.ELTES_STUDIO_DIR) : resolve(root, WORKSPACE_DIR);
const shellRunner = createShellRunner({ root, projectRoot: workspace, enabled: process.env.ELTES_ENABLE_SHELL === '1' });
const studio = studioEnabled
  ? createStudio({
    workspace,
    token: studioToken,
    allowShell: studioAllowShell,
    maxRunMs: Math.min(Math.max(Number(process.env.ELTES_STUDIO_TIMEOUT) || 60_000, 1000), 600_000)
  })
  : null;

async function servePreview(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  const rel = pathname.replace(/^\/preview\/?/, '');
  const file = await resolvePreviewFile(workspace, rel);
  if (!file) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(`<!doctype html><meta charset="utf-8"><title>Not in the workspace</title>
      <body style="font:15px/1.6 ui-sans-serif,system-ui;background:#05070c;color:#9dadc9;padding:40px">
      <h1 style="color:#e9effb;font-size:20px">Nothing at <code>${rel ? `/${rel.replace(/[<>&]/g, '')}` : '/'}</code></h1>
      <p>Create the file in the Studio file list, then reload this preview.</p>
      <p style="color:#6b7b99">Files live in <code>.studio/</code> beside the app.</p></body>`);
    return;
  }
  try {
    const data = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', previewMime(file));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'HEAD') return res.end();
    res.end(data);
  } catch {
    res.statusCode = 500;
    res.end('Could not read workspace file');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/api/shell/status') {
    shellRunner.status(req, res);
    return;
  }
  if (pathname === '/api/shell/files') {
    await shellRunner.files(req, res);
    return;
  }
  if (pathname === '/api/shell') {
    try { await shellRunner.execute(req, res); }
    catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: 'The local shell runner failed.' }));
      }
    }
    return;
  }

  if (studio && (pathname === '/preview' || pathname.startsWith('/preview/'))) {
    await servePreview(req, res, pathname);
    return;
  }

  if (studio && (pathname === '/api/studio' || pathname.startsWith('/api/studio/'))) {
    try {
      const handled = await studio.handle(req, res, url);
      if (handled) return;
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Studio backend error' }));
      }
      return;
    }
  }

  if (pathname === '/api/email' || pathname.startsWith('/api/email/')) {
    try { await email(req, res, url); }
    catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: false, error: 'The mail backend failed. Check the server log.' }));
      }
    }
    return;
  }

  if (routes[pathname]) {
    try { await routes[pathname](req, res); }
    catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: 'Local backend error.' }));
      }
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { res.statusCode = 400; res.end('Bad request'); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) { res.statusCode = 403; res.end('Forbidden'); return; }
  if (file === workspace || file.startsWith(workspace + sep)) { res.statusCode = 404; res.end('Not found'); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    res.statusCode = 200;
    res.setHeader('Content-Type', mime[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (['.mp4', '.webm'].includes(extname(file).toLowerCase())) return serveMedia(req, res, file, info.size);
    if (req.method === 'HEAD') { res.setHeader('Content-Length', info.size); return res.end(); }
    const data = await readFile(file);
    res.setHeader('Content-Length', data.length);
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  }
});

server.requestTimeout = 65000;
server.listen(port, host, async () => {
  console.log(`Eltes local server listening at http://localhost:${port}`);
  console.log('Local API routes: /api/health, /api/key-check, /api/chat, /api/search, /api/email, /api/shell');
  if (shellRunner.info.enabled) {
    console.log('Opt-in chat shell runner: enabled; token is shown below. Only direct loopback connections can use the shell endpoint.');
    console.log(`Chat shell token: ${shellRunner.info.token}`);
    console.log(`Chat shell workspace: ${shellRunner.info.root}`);
  } else console.log('Chat shell runner: disabled (set ELTES_ENABLE_SHELL=1 to enable).');
  try {
    const mailStatus = email.mailer.status();
    console.log(mailStatus.configured
      ? `Mail: ${mailStatus.provider} configured · from ${mailStatus.from}`
      : `Mail: outbox only (${mailStatus.problems[0] || 'no provider'}) · ${mailStatus.outboxDir}`);
  } catch { /* the status line is a nicety, never fatal */ }
  console.log('API keys are used per request and are not persisted by this server.');
  if (!studio) {
    console.log('Studio disabled (ELTES_STUDIO=0).');
    return;
  }
  try {
    await ensureWorkspace(workspace);
    const seeded = await seedWorkspace(workspace);
    console.log(`Studio workspace: ${workspace}${seeded.created ? ' (starter files created)' : ''}`);
    console.log(`Studio preview:   http://localhost:${port}/preview/index.html`);
    console.log(`Studio shell:     ${studioAllowShell ? 'enabled' : 'disabled'} · working directory=${WORKSPACE_DIR} (not an OS sandbox)`);
    if (studioAllowShell) {
      console.log('Studio is a local development tool with shell access. Keep it on a trusted network.');
    }
  } catch (error) {
    console.log(`Studio workspace could not be prepared: ${error.message}`);
  }
});

function shutdown() {
  try { studio?.close(); } catch { /* noop */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
