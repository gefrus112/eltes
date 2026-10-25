import { randomBytes, timingSafeEqual } from 'node:crypto';
import { win32, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';
import { createProjectFiles } from './project-files.mjs';

const MAX_BODY_BYTES = 640 * 1024; // Allows JSON escaping of a 100 KB script.
const MAX_COMMAND_CHARS = 4000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function isLoopback(address = '') {
  return address === '::1' || address === '127.0.0.1' || address.startsWith('127.') || address === '::ffff:127.0.0.1';
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === req.headers.host;
  } catch { return false; }
}

function targetsProtectedConfiguration(command) {
  const text = String(command || '').toLowerCase();
  const terms = ['.env', 'secret', 'credential', 'id_rsa', 'id_ed25519', 'vercel.json', 'netlify.toml', 'firebase.json', 'wrangler.toml', 'terraform.tfstate', 'deploy'];
  const protectedPath = terms.some((term) => text.includes(term)) || /\bprod(?:uction)?\b/i.test(text);
  const destructive = /(?:^|[;&|]\s*)git\s+(?:add|commit|push|reset\s+--hard|clean\b)|\brm\s+-[a-z]*r[a-z]*f|\b(?:sudo|shutdown|poweroff|mkfs|npm\s+publish|terraform\s+apply|kubectl\s+(?:apply|delete))\b/i.test(text);
  return protectedPath || destructive;
}

function safeEnvironment(root, { electronNodeMode = false } = {}) {
  const keep = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'NODE_ENV'];
  const env = {};
  keep.forEach((key) => { if (process.env[key]) env[key] = process.env[key]; });
  if (!env.HOME && !env.USERPROFILE) env.HOME = root;
  env.ELTES_SHELL_RUNNER = '1';
  // In the desktop package process.execPath is Electron, not a standalone Node.
  // Preserve Node-mode explicitly without copying the rest of the server env.
  if (electronNodeMode && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Request JSON is invalid.');
    error.status = 400;
    throw error;
  }
}

export function commandShell(command, platform = process.platform, systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  return platform === 'win32'
    ? { shell: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] }
    : { shell: '/bin/bash', args: ['--noprofile', '--norc', '-c', command] };
}

export function createShellRunner({ root = process.cwd(), projectRoot = join(root, '.studio'), enabled = false } = {}) {
  const token = enabled ? randomBytes(32).toString('hex') : '';
  const info = { enabled: !!enabled, root, token };
  const project = createProjectFiles(projectRoot);

  function authorize(req, res) {
    if (!enabled) { json(res, 404, { error: 'The local shell runner is disabled.' }); return false; }
    if (!isLoopback(req.socket?.remoteAddress || '')) { json(res, 403, { error: 'The shell runner accepts loopback connections only.' }); return false; }
    if (!sameOrigin(req)) { json(res, 403, { error: 'The shell runner accepts same-origin requests only.' }); return false; }
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const expectedBytes = Buffer.from(token);
    const suppliedBytes = Buffer.from(supplied);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      json(res, 401, { error: 'The local runner token is missing or invalid.' });
      return false;
    }
    return true;
  }

  function status(req, res) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Use GET.' });
    if (!authorize(req, res)) return;
    json(res, 200, {
      enabled: true,
      workspace: root,
      projectWorkspace: projectRoot,
      shell: process.platform === 'win32' ? 'PowerShell' : 'bash',
      platform: process.platform,
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES
    });
  }

  async function files(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
    if (!authorize(req, res)) return;
    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') throw new Error('Expected an operation object.');
      let result;
      if (body.operation === 'list') result = await project.list(body.directory || '');
      else if (body.operation === 'read') result = await project.snapshot(body.filePath);
      else if (body.operation === 'write') result = await project.write(body.filePath, body.content, body.expectedVersion);
      else return json(res, 400, { error: 'Unknown project operation.' });
      json(res, 200, result);
    } catch (error) { json(res, error.status || 400, { error: error.message }); }
  }

  async function execute(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
    if (!authorize(req, res)) return;
    let payload;
    try { payload = await readJson(req); }
    catch (error) { return json(res, error.status || 400, { error: error.message }); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(res, 400, { error: 'Expected a JSON object.' });
    if (payload.workspace != null && payload.workspace !== 'studio') return json(res, 400, { error: 'Unknown workspace selector.' });
    if (req.aborted || res.destroyed) return;
    const isWindows = process.platform === 'win32';
    let command, shell, args, temporaryDirectory;
    let nodeScript = false;
    if (payload.script != null) {
      const { filename, content } = payload.script || {};
      if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(py|js|ts)$/i.test(filename) ||
          typeof content !== 'string' || Buffer.byteLength(content) > 100 * 1024) {
        return json(res, 400, { error: 'Provide a simple .py, .js or .ts filename and at most 100 KB of source.' });
      }
      if (targetsProtectedConfiguration(filename + '\n' + content)) {
        return json(res, 403, { error: 'Script blocked by Eltes safety boundaries. These text filters are not an OS sandbox.' });
      }
      const extension = filename.split('.').pop().toLowerCase();
      nodeScript = extension === 'js' || extension === 'ts';
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (extension === 'ts' && !(major > 22 || major === 22 && minor >= 18)) {
        return json(res, 400, { error: 'TypeScript scripts require Node.js 22.18+ (24 LTS recommended), with native erasable type syntax. No compiler or packages are installed automatically.' });
      }
      shell = extension === 'py' ? (process.env.ELTES_PYTHON || (isWindows ? 'python' : 'python3')) : process.execPath;
      args = extension === 'py' ? ['-u', filename] : [filename];
      command = `${extension === 'py' ? 'Python (unbuffered)' : 'Node.js'} ${filename}`;
      try {
        temporaryDirectory = mkdtempSync(join(tmpdir(), 'eltes-script-'));
        writeFileSync(join(temporaryDirectory, filename), content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      } catch (error) {
        if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
        return json(res, 500, { error: `Could not prepare script: ${error.message}` });
      }
    } else {
      command = typeof payload.command === 'string' ? payload.command.trim() : '';
      if (!command || command.length > MAX_COMMAND_CHARS || command.includes('\0')) {
        return json(res, 400, { error: `Enter a shell command with 1 to ${MAX_COMMAND_CHARS} characters.` });
      }
      if (targetsProtectedConfiguration(command)) {
        return json(res, 403, { error: 'Blocked by Eltes safety boundaries: commands referencing secrets, .env files, private keys, or production configuration are not allowed.' });
      }
      ({ shell, args } = commandShell(command));
    }
    if (payload.workspace === 'studio' && !temporaryDirectory) {
      try { await project.ensureRoot(); }
      catch (error) { return json(res, error.status || 500, { error: error.message }); }
      if (req.aborted || res.destroyed) return;
    }
    const workspace = temporaryDirectory || (payload.workspace === 'studio' ? projectRoot : root);
    const cleanup = () => {
      if (temporaryDirectory) {
        try { rmSync(temporaryDirectory, { recursive: true, force: true }); } catch { /* OS may still hold a file lock. */ }
      }
    };
    // JSON remains compatible with old clients; new clients opt into live NDJSON.
    const streaming = payload.stream === true;
    const event = (value) => {
      if (streaming && !res.writableEnded && !res.destroyed) res.write(JSON.stringify(value) + '\n');
    };
    if (streaming) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      event({ type: 'start', command, workspace });
    }
    const child = spawn(shell, args, {
      cwd: workspace,
      env: safeEnvironment(root, { electronNodeMode: nodeScript }),
      windowsHide: true,
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let finished = false;
    const kill = () => {
      if (finished) return;
      try {
        if (isWindows && child.pid) {
          const fallback = () => { try { child.kill('SIGKILL'); } catch {} };
          const taskkill = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
          spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
            .on('error', fallback).on('exit', (code) => { if (code !== 0) fallback(); });
        } else if (child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* Process already exited. */ }
    };
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const addOutput = (target, chunk) => {
      const bytes = chunk.length;
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - outputBytes);
      outputBytes += bytes;
      const clipped = decoders[target].write(chunk.subarray(0, remaining));
      if (target === 'stdout') stdout += clipped;
      else stderr += clipped;
      if (clipped) event({ type: target, text: clipped });
      if (outputBytes >= MAX_OUTPUT_BYTES && !outputLimited) {
        outputLimited = true;
        kill();
      }
    };
    child.stdout.on('data', (chunk) => addOutput('stdout', chunk));
    child.stderr.on('data', (chunk) => addOutput('stderr', chunk));

    let clientGone = false;
    req.on('aborted', () => { clientGone = true; kill(); });
    res.on('close', () => { if (!res.writableEnded) { clientGone = true; kill(); } });

    const startedAt = Date.now();
    const timer = setTimeout(() => { timedOut = true; kill(); }, COMMAND_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      finished = true;
      cleanup();
      if (!clientGone && !res.writableEnded) {
        const failure = { error: `Could not start the configured runtime: ${error.message}. Install the required runtime locally.` };
        if (streaming) { event({ type: 'error', ...failure }); res.end(); }
        else json(res, 500, failure);
      }
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      finished = true;
      cleanup();
      if (clientGone || res.writableEnded) return;
      if (!outputLimited) { stdout += decoders.stdout.end(); stderr += decoders.stderr.end(); }
      const result = {
        command,
        workspace,
        exitCode: code,
        signal: signal || null,
        timedOut,
        outputLimited,
        stdout,
        stderr,
        durationMs: Math.min(COMMAND_TIMEOUT_MS, Date.now() - startedAt)
      };
      if (streaming) { event({ type: 'result', ...result }); res.end(); }
      else json(res, 200, result);
    });
  }

  return { info, status, execute, files };
}
