#!/usr/bin/env node
/* ==========================================================================
   Eltes — Roblox Studio MCP bridge

   Roblox has no official MCP server, so this bridge is the missing half:
   it speaks MCP to Eltes over HTTP and hands the actual scene edits to the
   EltesRobloxBridge Studio plugin, which runs them in the open place.

   It cannot touch a live game server. It can only edit a place open in
   Studio, on this machine, while the plugin is running.

   Usage:
     node eltes-roblox-bridge.mjs --port 8410
     node eltes-roblox-bridge.mjs --port 8410 --token secret   # optional

   Eltes: Settings → MCP → http://127.0.0.1:8410/mcp
   ========================================================================== */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

function parseArgs(argv) {
  const out = { port: 8410, host: '127.0.0.1', token: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') out.port = Number(argv[++i]) || 8410;
    else if (argv[i] === '--host') out.host = argv[++i] || '127.0.0.1';
    else if (argv[i] === '--token') out.token = argv[++i] || null;
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));
const vectors = { x: 'number', y: 'number', z: 'number' };
const partSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    className: { type: 'string', description: 'Part, WedgePart, Sphere, Cylinder, MeshPart…' },
    position: Object.assign({ type: 'object', properties: vectors }, { description: 'Studs' }),
    size: { type: 'object', properties: vectors },
    color: { type: 'string', description: '#rrggbb or a BrickColor name' },
    material: { type: 'string' },
    anchored: { type: 'boolean' },
    transparency: { type: 'number' }
  }
};

const TOOLS = [
  {
    name: 'scene_report',
    description: 'Summarise the open place: part count, script count, workspace children and the current selection. Call this first.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_part',
    description: 'Create one part in Workspace with position, size, colour, material and anchoring.',
    inputSchema: Object.assign({ type: 'object', properties: partSchema.properties, required: ['position'] })
  },
  {
    name: 'build_model',
    description: 'Create a model from a list of parts in one undo step. Use for buildings, props, vehicles and level pieces.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Model name, e.g. "Lighthouse"' },
        parts: { type: 'array', items: partSchema, description: 'Parts to create inside the model' },
        position: Object.assign({ type: 'object', properties: vectors }, { description: 'Optional model offset' })
      },
      required: ['parts']
    }
  },
  {
    name: 'insert_script',
    description: 'Insert a Luau script into the place. Server scripts go to ServerScriptService, client scripts to StarterPlayerScripts, modules to ReplicatedStorage.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        source: { type: 'string', description: 'Luau source' },
        kind: { type: 'string', enum: ['server', 'client', 'module'], description: 'Where it belongs' }
      },
      required: ['name', 'source']
    }
  },
  {
    name: 'animate_rig',
    description: 'Build a KeyframeSequence from poses, register it as a local animation on the rig and add an Animation instance so it can be previewed with Play.',
    inputSchema: {
      type: 'object',
      properties: {
        rig: { type: 'string', description: 'Model name of the rig, e.g. "Dummy" (defaults to the selection)' },
        looped: { type: 'boolean' },
        keyframes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              time: { type: 'number', description: 'Seconds' },
              joints: { type: 'object', description: 'Joint name → [rx, ry, rz] degrees, e.g. {"RightUpperArm":[45,0,0]}' }
            },
            required: ['time', 'joints']
          }
        }
      },
      required: ['keyframes']
    }
  },
  {
    name: 'add_effect',
    description: 'Attach a visual effect to a part or model: particles, beam, trail, fire, sparkles or smoke.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['particles', 'beam', 'trail', 'fire', 'sparkles', 'smoke'] },
        target: { type: 'string', description: 'Part or model name in Workspace' },
        color: { type: 'string', description: '#rrggbb' },
        texture: { type: 'string', description: 'Optional rbxassetid:// texture' }
      },
      required: ['kind', 'target']
    }
  },
  {
    name: 'scaffold_game',
    description: 'Scaffold a playable game: folders, spawn, baseplate, a round/score loop server script and a HUD. Genres: obby, tycoon, arena.',
    inputSchema: {
      type: 'object',
      properties: {
        genre: { type: 'string', enum: ['obby', 'tycoon', 'arena'] },
        name: { type: 'string' },
        rounds: { type: 'number', description: 'Round length in seconds for arena (default 90)' }
      },
      required: ['genre']
    }
  },
  {
    name: 'set_properties',
    description: 'Set properties on an existing instance, addressed by its full path or name, e.g. {"Anchored": true, "Color": "#39dca2"}.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        properties: { type: 'object' },
        children: { type: 'boolean', description: 'Also apply to descendants' }
      },
      required: ['target', 'properties']
    }
  }
];

/* --------------------------------- queue --------------------------------- */

const queue = [];
const waiting = [];
const pending = new Map();
let lastPoll = 0;

function dispatch(command) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(command.id);
      const index = queue.findIndex((entry) => entry.id === command.id);
      if (index >= 0) queue.splice(index, 1);
      resolve({ ok: false, output: 'The Studio plugin did not pick this up within 25 seconds. Is it running, with HTTP requests allowed?' });
    }, 25000);
    command.timer = timer;
    command.resolve = resolve;
    pending.set(command.id, command);
    queue.push(command);
    flush();
  });
}

function flush() {
  while (queue.length && waiting.length) {
    const command = queue.shift();
    const entry = waiting.shift();
    const res = entry && entry.res ? entry.res : entry;
    const payload = JSON.stringify({ id: command.id, op: command.op, args: command.args });
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, CORS));
    res.end(payload);
  }
}

/* --------------------------------- server -------------------------------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization',
  'Access-Control-Max-Age': '600'
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, CORS));
  res.end(body);
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function textResult(id, text, isError) {
  return rpcResult(id, { content: [{ type: 'text', text }], isError: !!isError });
}

function authenticate(req) {
  return !options.token || req.headers.authorization === `Bearer ${options.token}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(raw));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${options.host}:${options.port}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  if (url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      plugin: Date.now() - lastPoll < 15000 ? 'connected' : 'not polling',
      queued: queue.length,
      tools: TOOLS.map((tool) => tool.name)
    });
    return;
  }

  /* ---------------------------- Studio plugin ---------------------------- */
  if (url.pathname === '/next') {
    lastPoll = Date.now();
    if (queue.length) {
      const command = queue.shift();
      const payload = JSON.stringify({ id: command.id, op: command.op, args: command.args });
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, CORS));
      res.end(payload);
      return;
    }
    const entry = { res };
    waiting.push(entry);
    setTimeout(() => {
      const index = waiting.indexOf(entry);
      if (index >= 0) { waiting.splice(index, 1); res.writeHead(204, CORS); res.end(); }
    }, 20000);
    return;
  }

  if (url.pathname === '/result' && req.method === 'POST') {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch (error) { json(res, 400, { error: 'bad json' }); return; }
    const command = pending.get(payload && payload.id);
    if (command) {
      pending.delete(payload.id);
      clearTimeout(command.timer);
      command.resolve({ ok: payload.ok !== false, output: String(payload.output || '') });
    }
    json(res, 200, { ok: true });
    return;
  }

  /* -------------------------------- MCP ---------------------------------- */
  if (url.pathname !== '/mcp') { json(res, 404, { error: 'Use POST /mcp' }); return; }
  if (!authenticate(req)) { json(res, 401, { error: 'Wrong or missing bearer token.' }); return; }
  if (req.method !== 'POST') { json(res, 405, { error: 'POST only' }); return; }

  const raw = await readBody(req);
  let message;
  try { message = JSON.parse(raw); } catch (error) { json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  const { id, method, params } = message || {};

  if (method === 'initialize') {
    json(res, 200, rpcResult(id, {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'eltes-roblox', version: '1.0.0' }
    }));
    return;
  }
  if (method === 'notifications/initialized' || (method && method.startsWith('notifications/'))) {
    res.writeHead(202, CORS); res.end(); return;
  }
  if (method === 'ping') { json(res, 200, rpcResult(id, {})); return; }
  if (method === 'tools/list') { json(res, 200, rpcResult(id, { tools: TOOLS })); return; }
  if (method === 'tools/call') {
    const name = params && params.name;
    if (!TOOLS.some((tool) => tool.name === name)) {
      json(res, 200, textResult(id, `Unknown tool: ${name}`, true));
      return;
    }
    if (Date.now() - lastPoll > 15000) {
      json(res, 200, textResult(id, 'Roblox Studio is not connected. Open your place, make sure the EltesRobloxBridge plugin is enabled, and turn on Game Settings → Security → Allow HTTP Requests.', true));
      return;
    }
    const command = { id: randomUUID(), op: name, args: (params && params.arguments) || {} };
    const outcome = await dispatch(command);
    json(res, 200, textResult(id, outcome.output || (outcome.ok ? 'Done.' : 'The plugin reported a failure.'), !outcome.ok));
    return;
  }

  json(res, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
});

server.listen(options.port, options.host, () => {
  console.log('Eltes Roblox bridge');
  console.log(`  MCP endpoint: http://${options.host}:${options.port}/mcp`);
  console.log(`  plugin polls: http://${options.host}:${options.port}/next`);
  if (options.token) console.log('  bearer token required');
  console.log('  Leave this window open, then connect in Eltes → Settings → MCP.');
  console.log('  Waiting for Roblox Studio…');
});
