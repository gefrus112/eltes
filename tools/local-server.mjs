import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import chat from '../api/chat.js';
import keyCheck from '../api/key-check.js';
import health from '../api/health.js';
import auth from '../api/auth.js';
import { createShellRunner } from './shell-runner.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const shellRunner = createShellRunner({ root, enabled: process.env.ELTES_ENABLE_SHELL === '1' });
const routes = { '/api/chat': chat, '/api/key-check': keyCheck, '/api/health': health, '/api/auth': auth };
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/api/shell/status' || pathname === '/api/shell') {
    try {
      if (pathname.endsWith('/status')) shellRunner.status(req, res);
      else await shellRunner.execute(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: 'Local shell runner error.' }));
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
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    res.statusCode = 200;
    res.setHeader('Content-Type', mime[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') return res.end();
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
server.listen(port, host, () => {
  console.log(`Eltes local server listening at http://localhost:${port}`);
  console.log('Local API routes: /api/health, /api/key-check, /api/chat, /api/auth, /api/shell/status, /api/shell');
  console.log('API keys are used per request and are not persisted by this server.');
  if (shellRunner.info.enabled) {
    console.warn('WARNING: Local shell execution is enabled. Commands run with this user account after per-command approval in the browser.');
    console.log(`One-time browser pairing token: ${shellRunner.info.token}`);
    console.log('Keep this token private. Restart the server to revoke it.');
  }
});
