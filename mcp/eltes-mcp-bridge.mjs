#!/usr/bin/env node
/* ==========================================================================
   Eltes — MCP stdio ⇄ HTTP bridge

   Browsers cannot start processes, and most MCP servers speak stdio. This
   bridge starts the server as a child process, forwards JSON-RPC from the
   browser over HTTP, and writes the answers back. It binds to 127.0.0.1
   only, so nothing is reachable from your network.

   Usage:
     node eltes-mcp-bridge.mjs --name blender --port 9876 -- uvx blender-mcp

     node eltes-mcp-bridge.mjs --name files --port 9880 -- npx -y @modelcontextprotocol/server-filesystem ~/Projects

   Then add http://127.0.0.1:9876/mcp in Eltes → Settings → MCP.
   ========================================================================== */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import process from 'node:process';

function parseArgs(argv) {
  const out = { name: 'mcp', port: 9876, host: '127.0.0.1', command: [], token: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { out.command = argv.slice(i + 1); break; }
    if (arg === '--name') { out.name = argv[++i]; continue; }
    if (arg === '--port') { out.port = Number(argv[++i]) || 9876; continue; }
    if (arg === '--host') { out.host = argv[++i] || '127.0.0.1'; continue; }
    if (arg === '--token') { out.token = argv[++i] || null; continue; }
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));
if (!options.command.length) {
  console.error('No command to run.');
  console.error('Example: node eltes-mcp-bridge.mjs --name blender --port 9876 -- uvx blender-mcp');
  process.exit(1);
}

const [program, ...rest] = options.command;
const child = spawn(program, rest, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
const pending = new Map();
let buffer = '';
let nextUpstreamId = 1;
let closed = false;

child.on('error', (error) => {
  console.error(`Could not start ${program}: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code) => {
  closed = true;
  console.error(`${options.name} exited with code ${code}`);
  for (const [, entry] of pending) entry.reject(new Error(`${options.name} exited (code ${code}).`));
  pending.clear();
  process.exit(code == null ? 0 : code);
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch (error) { continue; }
    const id = message && message.id;
    const entry = pending.get(id);
    if (entry) { pending.delete(id); entry.resolve(message); }
  }
});

function sendUpstream(message) {
  if (closed) return Promise.reject(new Error('The MCP server is not running.'));
  return new Promise((resolve, reject) => {
    const id = message.id;
    if (id !== undefined && id !== null) {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`No answer from ${options.name} within 60s.`));
      }, 60000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
    }
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) { if (id != null) pending.delete(id); reject(error); }
      else if (id === undefined || id === null) resolve(null);
    });
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization',
  'Access-Control-Expose-Headers': 'mcp-session-id',
  'Access-Control-Max-Age': '600'
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, CORS));
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${options.host}:${options.port}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (url.pathname === '/health') {
    json(res, 200, { ok: !closed, name: options.name, command: options.command.join(' ') });
    return;
  }
  if (url.pathname !== '/mcp') { json(res, 404, { error: 'POST /mcp' }); return; }
  if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
    json(res, 401, { error: 'Missing or wrong bearer token.' });
    return;
  }
  if (req.method === 'GET') {
    // No server-initiated stream: the client polls instead.
    json(res, 405, { error: 'This bridge answers POST only. MCP servers that need a GET stream are not supported.' });
    return;
  }

  let raw = '';
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 4 * 1024 * 1024) req.destroy(); });
  req.on('end', async () => {
    let message;
    try { message = JSON.parse(raw); } catch (error) { json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }); return; }
    const upstream = Object.assign({}, message, { id: message.id !== undefined ? (nextUpstreamId++) : undefined });
    const requestId = message.id;
    try {
      const answer = await sendUpstream(upstream);
      if (requestId === undefined || requestId === null) { res.writeHead(202, CORS); res.end(); return; }
      json(res, 200, Object.assign({}, answer, { id: requestId }));
    } catch (error) {
      json(res, 200, { jsonrpc: '2.0', id: requestId === undefined ? null : requestId, error: { code: -32000, message: error.message } });
    }
  });
});

server.listen(options.port, options.host, () => {
  console.log(`Eltes MCP bridge: ${options.name}`);
  console.log(`  command: ${options.command.join(' ')}`);
  console.log(`  endpoint: http://${options.host}:${options.port}/mcp`);
  console.log('  Add that URL in Eltes → Settings → MCP. Leave this window open.');
});
