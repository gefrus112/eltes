import { randomBytes, timingSafeEqual } from 'node:crypto';
import { win32 } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';

const MAX_BODY_BYTES = 12 * 1024;
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

function safeEnvironment(root) {
  const keep = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'NODE_ENV'];
  const env = {};
  keep.forEach((key) => { if (process.env[key]) env[key] = process.env[key]; });
  if (!env.HOME && !env.USERPROFILE) env.HOME = root;
  env.ELTES_SHELL_RUNNER = '1';
  return env;
}

async function readJson(req) {
  let raw = '';
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    raw += chunk.toString('utf8');
  }
  try { return JSON.parse(raw); }
  catch {
    const error = new Error('Request JSON is invalid.');
    error.status = 400;
    throw error;
  }
}

export function createShellRunner({ root, enabled = false } = {}) {
  const token = enabled ? randomBytes(32).toString('hex') : '';
  const info = { enabled: !!enabled, root, token };

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
      platform: process.platform,
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES
    });
  }

  async function execute(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
    if (!authorize(req, res)) return;
    let payload;
    try { payload = await readJson(req); }
    catch (error) { return json(res, error.status || 400, { error: error.message }); }
    const command = typeof payload.command === 'string' ? payload.command.trim() : '';
    if (!command || command.length > MAX_COMMAND_CHARS || command.includes('\0')) {
      return json(res, 400, { error: `Enter a shell command with 1 to ${MAX_COMMAND_CHARS} characters.` });
    }
    if (targetsProtectedConfiguration(command)) {
      return json(res, 403, { error: 'Blocked by Eltes safety boundaries: commands referencing secrets, .env files, private keys, or production configuration are not allowed.' });
    }

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const args = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];
    const child = spawn(shell, args, {
      cwd: root,
      env: safeEnvironment(root),
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
      if (!clientGone && !res.writableEnded) json(res, 500, { error: `Could not start the configured shell: ${error.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      finished = true;
      if (clientGone || res.writableEnded) return;
      if (!outputLimited) { stdout += decoders.stdout.end(); stderr += decoders.stderr.end(); }
      json(res, 200, {
        command,
        workspace: root,
        exitCode: code,
        signal: signal || null,
        timedOut,
        outputLimited,
        stdout,
        stderr,
        durationMs: Math.min(COMMAND_TIMEOUT_MS, Date.now() - startedAt)
      });
    });
  }

  return { info, status, execute };
}
