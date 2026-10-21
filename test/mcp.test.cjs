'use strict';

// MCP: the browser-side client (handshake, SSE, tool namespacing, guardrails)
// and the two bridges that let Blender and Roblox Studio answer over HTTP.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function loadMCP() {
  const context = { window: {}, console, setTimeout, clearTimeout, URL, AbortController };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/js/mcp.js'), 'utf8'), context, { filename: 'mcp.js' });
  return context.window.EltesMCP;
}

function memoryStorage(seed) {
  const map = new Map();
  if (seed) map.set('eltes.mcp.v1', JSON.stringify(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    raw: map
  };
}

function reply(payload, options) {
  const opts = options || {};
  const headers = Object.assign(
    { 'content-type': opts.sse ? 'text/event-stream' : 'application/json' },
    opts.headers || {}
  );
  const body = opts.sse
    ? `event: message\ndata: ${JSON.stringify(payload)}\n\n`
    : JSON.stringify(payload);
  return {
    ok: opts.status ? opts.status < 400 : true,
    status: opts.status || 200,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    text: async () => body
  };
}

function scriptedFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: (init && init.headers) || {} });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    const outcome = typeof step === 'function' ? step(body, calls.length) : step;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  fn.calls = calls;
  return fn;
}

const handshake = [
  reply({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'test' } } }),
  reply(null, { status: 202 }),
  reply({
    jsonrpc: '2.0',
    id: 2,
    result: {
      tools: [
        { name: 'create_object', description: 'Add an object', inputSchema: { type: 'object', properties: {} } },
        { name: 'render', description: 'Render a frame', inputSchema: { type: 'object', properties: {} } }
      ]
    }
  })
];

test('servers are saved, listed and removed in this browser only', () => {
  const MCP = loadMCP();
  const storage = memoryStorage();
  const client = MCP.create({ storage, fetch: scriptedFetch([reply({})]) });
  const server = client.add({ name: 'Blender', url: 'http://127.0.0.1:9876/mcp' });
  assert.equal(server.id, 'blender');
  assert.equal(client.list().length, 1);
  const saved = JSON.parse(storage.raw.get('eltes.mcp.v1'));
  assert.equal(saved.servers[0].url, 'http://127.0.0.1:9876/mcp');
  assert.equal(saved.servers[0].enabled, true);
  assert.equal(client.remove(server.id), true);
  assert.equal(client.list().length, 0);
});

test('a URL without a scheme is refused', () => {
  const MCP = loadMCP();
  const client = MCP.create({ storage: memoryStorage(), fetch: scriptedFetch([reply({})]) });
  assert.throws(() => client.add({ name: 'Bad', url: '127.0.0.1:9876' }), /http/);
});

test('two servers with the same name get distinct ids', () => {
  const MCP = loadMCP();
  const client = MCP.create({ storage: memoryStorage(), fetch: scriptedFetch([reply({})]) });
  client.add({ name: 'Blender', url: 'http://127.0.0.1:9876/mcp' });
  const second = client.add({ name: 'Blender', url: 'http://127.0.0.1:9877/mcp' });
  assert.equal(second.id, 'blender-2');
});

test('connect performs initialize, the initialized notification, then tools/list', async () => {
  const MCP = loadMCP();
  const fetch = scriptedFetch(handshake);
  const client = MCP.create({ storage: memoryStorage(), fetch, timeout: 1000 });
  const server = client.add({ name: 'Blender', url: 'http://127.0.0.1:9876/mcp' });
  const connected = await client.connect(server.id);
  assert.equal(connected.status, 'connected');
  assert.equal(fetch.calls[0].body.method, 'initialize');
  assert.equal(fetch.calls[0].body.params.clientInfo.name, 'Eltes');
  assert.equal(fetch.calls[1].body.method, 'notifications/initialized');
  assert.equal(fetch.calls[1].body.id, undefined, 'the notification carries no id');
  assert.equal(fetch.calls[2].body.method, 'tools/list');
  assert.equal(connected.tools.length, 2);
});

test('an event-stream answer is parsed as JSON-RPC', async () => {
  const MCP = loadMCP();
  const fetch = scriptedFetch([
    reply({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }),
    reply(null, { status: 202 }),
    reply({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'render' }] } }, { sse: true })
  ]);
  const client = MCP.create({ storage: memoryStorage(), fetch, timeout: 1000 });
  const server = client.add({ name: 'Blender', url: 'http://127.0.0.1:9876/mcp' });
  const connected = await client.connect(server.id);
  assert.deepEqual(connected.tools.map((tool) => tool.name), ['render']);
});

test('tools are namespaced by server so two servers can share a name', async () => {
  const MCP = loadMCP();
  const client = MCP.create({ storage: memoryStorage(), fetch: scriptedFetch(handshake), timeout: 1000 });
  const server = client.add({ name: 'Blender', url: 'http://127.0.0.1:9876/mcp' });
  await client.connect(server.id);
  const names = client.tools().map((tool) => tool.name);
  assert.deepEqual(names, ['blender__create_object', 'blender__render']);
  assert.equal(client.tools()[0].serverName, 'Blender');
});

test('a tool result joins text blocks, and isError becomes an error', async () => {
  const MCP = loadMCP();
  const fetch = scriptedFetch(handshake.concat([
    reply({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'created Cube' }, { type: 'text', text: '3 vertices' }] } }),
    reply({ jsonrpc: '2.0', id: 4, result: { isError: true, content: [{ type: 'text', text: 'Blender said no' }] } })
  ]));
  const client = MCP.create({ storage: memoryStorage(), fetch, timeout: 1000 });
  const server = client.add({ name: 'Blender', url: 'http://127.0.0.1:9876/mcp' });
  await client.connect(server.id);
  const ok = await client.call(server.id, 'create_object', { name: 'Cube' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.result, 'created Cube\n3 vertices');
  const failed = await client.call(server.id, 'create_object', {});
  assert.match(failed.error, /Blender said no/);
});

test('a disabled server is never contacted', async () => {
  const MCP = loadMCP();
  const fetch = scriptedFetch(handshake);
  const client = MCP.create({ storage: memoryStorage(), fetch, timeout: 1000 });
  const server = client.add({ name: 'Blender', url: 'http://127.0.0.1:9876/mcp' });
  client.setEnabled(server.id, false);
  await assert.rejects(() => client.connect(server.id), /turned off/);
  assert.equal(fetch.calls.length, 0);
});

test('an unreachable bridge explains what to do', async () => {
  const MCP = loadMCP();
  const fetch = scriptedFetch([new TypeError('Failed to fetch')]);
  const client = MCP.create({ storage: memoryStorage(), fetch, timeout: 1000 });
  const server = client.add({ name: 'Roblox Studio', url: 'http://127.0.0.1:8410/mcp' });
  await assert.rejects(() => client.connect(server.id), /Could not reach Roblox Studio/);
  assert.equal(client.list()[0].status, 'error');
});

test('a server that skips the handshake is reported, not trusted', async () => {
  const MCP = loadMCP();
  const fetch = scriptedFetch([reply({ jsonrpc: '2.0', id: 1, result: {} })]);
  const client = MCP.create({ storage: memoryStorage(), fetch, timeout: 1000 });
  const server = client.add({ name: 'Odd', url: 'http://127.0.0.1:9000/mcp' });
  await assert.rejects(() => client.connect(server.id), /did not complete/);
});

test('an HTTP error keeps the status code and the body', async () => {
  const MCP = loadMCP();
  const fetch = scriptedFetch([{ ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => 'boom' }]);
  const client = MCP.create({ storage: memoryStorage(), fetch, timeout: 1000 });
  const server = client.add({ name: 'Broken', url: 'http://127.0.0.1:9999/mcp' });
  await assert.rejects(() => client.connect(server.id), /500.*boom/s);
});

/* --------------------------------- bridges ------------------------------- */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitFor(url, attempts) {
  for (let i = 0; i < (attempts || 60); i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${url} never came up`);
}

test('the stdio bridge forwards MCP to a child process over HTTP', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [
    path.join(ROOT, 'mcp/eltes-mcp-bridge.mjs'),
    '--name', 'echo', '--port', String(port), '--',
    process.execPath, path.join(ROOT, 'test/fixtures/mcp-echo-server.mjs')
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitFor(`http://127.0.0.1:${port}/health`);
    const base = `http://127.0.0.1:${port}/mcp`;
    const init = await (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) })).json();
    assert.equal(init.result.serverInfo.name, 'echo');
    const listed = await (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })).json();
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['echo']);
    const called = await (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } }) })).json();
    assert.equal(called.result.content[0].text, 'echo: hi');
  } finally {
    child.kill('SIGKILL');
  }
});

test('the Roblox bridge exposes game tools and waits for the Studio plugin', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp/eltes-roblox-bridge.mjs'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  const rpc = async (id, method, params) => (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  })).json();
  try {
    await waitFor(`${base}/health`);
    const init = await rpc(1, 'initialize', {});
    assert.equal(init.result.serverInfo.name, 'eltes-roblox');
    const listed = await rpc(2, 'tools/list');
    const names = listed.result.tools.map((tool) => tool.name);
    for (const name of ['create_part', 'build_model', 'insert_script', 'animate_rig', 'add_effect', 'scaffold_game', 'scene_report']) {
      assert.ok(names.includes(name), `${name} is offered`);
    }

    // Without a plugin polling, the tool call must fail with instructions.
    const offline = await rpc(3, 'tools/call', { name: 'scene_report', arguments: {} });
    assert.equal(offline.result.isError, true);
    assert.match(offline.result.content[0].text, /not connected/i);

    // Simulate the Studio plugin: long-poll for work, then report the result.
    const plugin = (async () => {
      const next = await (await fetch(`${base}/next`)).json();
      await fetch(`${base}/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: next.id, ok: true, output: `Created ${next.args.name || 'Part'}` })
      });
      return next;
    })();
    const live = await rpc(4, 'tools/call', { name: 'create_part', arguments: { name: 'Beacon', position: { x: 0, y: 5, z: 0 } } });
    const command = await plugin;
    assert.equal(command.op, 'create_part');
    assert.equal(command.args.name, 'Beacon');
    assert.equal(live.result.isError, false);
    assert.match(live.result.content[0].text, /Created Beacon/);
  } finally {
    child.kill('SIGKILL');
  }
});

test('the MCP client stays out of the page until it is asked', () => {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/mcp.js'), 'utf8');
  assert.equal(/eval\(|new Function/.test(source), false, 'no dynamic evaluation');
  assert.equal(source.includes('localStorage.setItem'), false, 'storage is injected, not global');
});
