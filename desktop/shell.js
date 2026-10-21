/* ==========================================================================
   Eltes Desktop — harness core
   --------------------------------------------------------------------------
   Everything the desktop shell needs that does not depend on Electron lives
   here, so it can be tested with plain Node:

     • which directory holds the site (packaged vs. a git checkout)
     • a free port and a supervised local-server child process
     • health polling, log capture and clean shutdown
     • the navigation policy (the app may only stay on its own origin)
     • CLI flags, deep links and window bounds

   desktop/main.js is a thin Electron adapter over these functions. Nothing in
   this file may import 'electron'.
   ========================================================================== */

'use strict';

const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { get } = require('node:http');
const {
  appendFileSync, existsSync, mkdirSync, renameSync, statSync
} = require('node:fs');
const { join, resolve } = require('node:path');

const APP_NAME = 'Eltes';
const APP_ID = 'ai.eltes.desktop';
const PROTOCOL = 'eltes';
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const PORT_TRIES = 32;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 840;
const MIN_WIDTH = 960;
const MIN_HEIGHT = 620;

/* --------------------------------- paths --------------------------------- */

/* In a packaged app the site is unpacked beside app.asar at resources/site;
   in a checkout it is the repository root, one level above desktop/. */
function resolveSiteDir(options = {}) {
  const { packaged, appDir, resourcesPath, override } = options;
  if (override && String(override).trim()) return resolve(String(override).trim());
  if (packaged && resourcesPath) return join(resourcesPath, 'site');
  if (!appDir) throw new Error('resolveSiteDir needs appDir in development.');
  return resolve(appDir, '..');
}

function siteManifest(siteDir) {
  const required = [
    'app.html', 'index.html', 'train.html',
    'assets/js/app.js', 'assets/css/app.css',
    'api/health.js', 'api/chat.js', 'lib/http.cjs',
    'tools/local-server.mjs', 'tools/studio.mjs'
  ];
  const missing = required.filter((rel) => !existsSync(join(siteDir, rel)));
  return { ok: missing.length === 0, missing, siteDir };
}

/* ---------------------------------- CLI ---------------------------------- */

function parseCli(argv = []) {
  const args = argv.slice(1);
  const out = { dev: false, port: null, studio: true, resetWindow: false, url: null, profile: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    if (arg === '--dev' || arg === '--enable-logging') out.dev = true;
    else if (arg === '--no-studio') out.studio = false;
    else if (arg === '--reset-window') out.resetWindow = true;
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice(7)) || null;
    else if (arg === '--port' && args[i + 1]) { out.port = Number(args[i + 1]) || null; i += 1; }
    else if (arg.startsWith('--profile=')) out.profile = arg.slice(10) || null;
    else if (new RegExp(`^${PROTOCOL}://`, 'i').test(arg)) out.url = arg;
    /* Electron injects its own switches (--allow-file-access-from-files and
       friends) plus the app path; ignore anything we do not recognise. */
  }
  return out;
}

function deepLinkFromArgv(argv = []) {
  return argv.map(String).find((arg) => new RegExp(`^${PROTOCOL}://`, 'i').test(arg)) || null;
}

function deepLinkTarget(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL}:`) return null;
    const allowed = new Set(['open', 'chat', 'studio', 'lab']);
    const host = parsed.hostname || 'open';
    return { action: allowed.has(host) ? host : 'open', path: parsed.pathname || '/' };
  } catch (error) {
    return null;
  }
}

/* ---------------------------------- ports -------------------------------- */

function probePort(port, host) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolvePromise(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function findAvailablePort(preferred = DEFAULT_PORT, host = HOST, tries = PORT_TRIES) {
  if (!Number.isFinite(preferred) || preferred <= 0) return 0;
  for (let offset = 0; offset < tries; offset += 1) {
    const candidate = preferred + offset;
    /* eslint-disable no-await-in-loop */
    if (await probePort(candidate, host)) return candidate;
  }
  return 0; // let the OS choose
}

/* --------------------------------- server -------------------------------- */

function requestHealth(base, timeoutMs = 1200) {
  return new Promise((resolvePromise, reject) => {
    const req = get(`${base}/api/health`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) body = body.slice(0, 64 * 1024); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`health answered ${res.statusCode}`));
          return;
        }
        try {
          const payload = JSON.parse(body);
          if (payload && payload.status === 'ok') resolvePromise(payload);
          else reject(new Error('health answered without status ok'));
        } catch (error) {
          reject(new Error('health answered with invalid JSON'));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('health request timed out')); });
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(base, options = {}) {
  const timeout = options.timeout == null ? 20000 : options.timeout;
  const interval = options.interval == null ? 120 : options.interval;
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    if (options.onExit && options.onExit()) throw new Error('the server process exited before it was ready');
    try {
      return await requestHealth(base, Math.min(1500, Math.max(300, deadline - Date.now())));
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`no healthy response after ${timeout} ms (${lastError ? lastError.message : 'no attempt'})`);
}

/**
 * Start tools/local-server.mjs as a child process and wait until /api/health is
 * green. In a packaged app, execPath is the Eltes binary and ELECTRON_RUN_AS_NODE
 * makes it behave like Node, so the desktop build never needs a Node install.
 */
async function startServer(options = {}) {
  const siteDir = options.siteDir;
  if (!siteDir) throw new Error('startServer needs a siteDir.');
  const serverPath = join(siteDir, 'tools', 'local-server.mjs');
  if (!existsSync(serverPath)) throw new Error(`The local server is missing from ${siteDir}.`);

  const host = options.host || HOST;
  const wanted = options.port == null ? DEFAULT_PORT : Number(options.port);
  const port = await findAvailablePort(wanted > 0 ? wanted : DEFAULT_PORT, host);
  const url = `http://${host}:${port}`;

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(port),
    HOST: host,
    NODE_ENV: 'production',
    ...(options.studioDir ? { ELTES_STUDIO_DIR: options.studioDir } : {}),
    ...(options.mailDir ? { ELTES_MAIL_DIR: options.mailDir } : {}),
    ...(options.studioToken ? { ELTES_STUDIO_TOKEN: options.studioToken } : {}),
    ...(options.studio === false ? { ELTES_STUDIO: '0' } : {}),
    ...(options.env || {})
  };

  const spawnImpl = options.spawnImpl || spawn;
  const child = spawnImpl(options.execPath || process.execPath, [serverPath], {
    cwd: siteDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  const lines = [];
  const record = (chunk) => {
    const text = String(chunk);
    lines.push(text);
    while (lines.join('').length > 64 * 1024 && lines.length > 1) lines.shift();
    if (options.onLog) {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) options.onLog(line.trim());
      }
    }
  };
  if (child.stdout) child.stdout.on('data', record);
  if (child.stderr) child.stderr.on('data', record);

  let exit = null;
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  child.once('error', (error) => { exit = { code: null, signal: null, error }; });

  try {
    await waitForHealth(url, {
      timeout: options.timeout == null ? 20000 : options.timeout,
      interval: options.interval,
      onExit: () => exit && !exit.error
    });
  } catch (error) {
    await stopServer(child);
    const tail = lines.join('').trim().split(/\r?\n/).slice(-12).join('\n');
    throw new Error(`${error.message}\n${tail ? `server output:\n${tail}` : 'the server printed nothing'}`);
  }

  return {
    child,
    port,
    url,
    host,
    lines,
    get exit() { return exit; },
    stop: () => stopServer(child)
  };
}

function stopServer(child, timeout = 3000) {
  return new Promise((resolvePromise) => {
    if (!child || child.exitCode != null) { resolvePromise(); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolvePromise(); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (error) { /* already gone */ }
      finish();
    }, timeout);
    timer.unref?.();
    child.once('exit', finish);
    try {
      if (!child.kill()) finish();
    } catch (error) {
      finish();
    }
  });
}

/* ---------------------------------- logs --------------------------------- */

function createLog(dir, options = {}) {
  const maxBytes = options.maxBytes || 1_500_000;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'desktop.log');
  try {
    if (existsSync(file) && statSync(file).size > maxBytes) {
      renameSync(file, join(dir, 'desktop.previous.log'));
    }
  } catch (error) { /* a locked log must never stop the app */ }
  const write = (message) => {
    try {
      appendFileSync(file, `[${new Date().toISOString()}] ${String(message).replace(/\r?\n/g, '\n    ')}\n`);
    } catch (error) { /* disk full or read-only: keep running */ }
  };
  write(`${APP_NAME} ${options.version || ''} starting · ${process.platform} ${process.arch} · electron ${process.versions.electron || 'n/a'} · node ${process.versions.node}`);
  return { file, dir, write };
}

/* ------------------------------- navigation ------------------------------ */

function classifyNavigation(target, appOrigin) {
  let url;
  try {
    url = new URL(String(target));
  } catch (error) {
    return 'block';
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.origin === appOrigin ? 'allow' : 'external';
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') return 'external';
  /* file:, data:, javascript:, blob: and anything else never navigate the shell */
  return 'block';
}

function isExternalHttp(target) {
  try {
    const url = new URL(String(target));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isAppUrl(target, appOrigin) {
  try {
    return new URL(String(target)).origin === appOrigin;
  } catch (error) {
    return false;
  }
}

/* --------------------------------- window -------------------------------- */

function intersects(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function defaultBounds(displays) {
  const display = (displays && displays[0]) || { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  const area = display.workArea;
  const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, area.width - 80));
  const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, area.height - 80));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  };
}

/**
 * Keep a remembered window usable: inside a display that still exists, big
 * enough to work in, and never fully off-screen after a monitor was removed.
 */
function clampBounds(bounds, displays) {
  if (!Array.isArray(displays) || !displays.length) return defaultBounds(displays);
  const saved = bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)
    ? {
      x: Math.round(bounds.x || 0),
      y: Math.round(bounds.y || 0),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    }
    : null;
  if (!saved) return defaultBounds(displays);

  const ranked = displays
    .map((display) => ({ display, overlap: intersects(saved, display.workArea) }))
    .sort((a, b) => b.overlap - a.overlap);
  const target = ranked[0] && ranked[0].overlap > 0 ? ranked[0].display : displays[0];
  const area = target.workArea;

  const width = Math.min(Math.max(saved.width, MIN_WIDTH), area.width);
  const height = Math.min(Math.max(saved.height, MIN_HEIGHT), area.height);
  const minVisible = 96;
  const x = Math.min(Math.max(saved.x, area.x - width + minVisible), area.x + area.width - minVisible);
  const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - minVisible);

  return { x: Math.round(x), y: Math.round(y), width, height };
}

/* --------------------------------- exports ------------------------------- */

module.exports = {
  APP_NAME,
  APP_ID,
  PROTOCOL,
  HOST,
  DEFAULT_PORT,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  MIN_WIDTH,
  MIN_HEIGHT,
  resolveSiteDir,
  siteManifest,
  parseCli,
  deepLinkFromArgv,
  deepLinkTarget,
  probePort,
  findAvailablePort,
  requestHealth,
  waitForHealth,
  startServer,
  stopServer,
  createLog,
  classifyNavigation,
  isExternalHttp,
  isAppUrl,
  defaultBounds,
  clampBounds
};
