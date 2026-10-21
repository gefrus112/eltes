const test = require('node:test');
const assert = require('node:assert/strict');
const MCP = require('../assets/js/mcp.js');

function jsonResponse(payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...extraHeaders }
  });
}

function makeServer({ mismatchToolResponse = false, streamList = false } = {}) {
  const requests = [];
  const fetch = async (url, options) => {
    const packet = JSON.parse(options.body);
    requests.push({ url, options, packet });
    if (packet.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0', id: packet.id,
        result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      }, { 'mcp-session-id': 'session-fixture' });
    }
    if (packet.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (packet.method === 'tools/list') {
      const payload = {
        jsonrpc: '2.0', id: packet.id,
        result: { tools: [{ name: 'lookup', description: 'Look up a record', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] }
      };
      if (streamList) return new Response(`data: ${JSON.stringify(payload)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return jsonResponse(payload);
    }
    if (packet.method === 'tools/call') {
      return jsonResponse({
        jsonrpc: '2.0', id: mismatchToolResponse ? packet.id + 1 : packet.id,
        result: { content: [{ type: 'text', text: `Found ${packet.params.arguments.query}` }] }
      });
    }
    throw new Error(`Unexpected MCP method ${packet.method}`);
  };
  return { fetch, requests };
}

test('MCP endpoint validation requires remote HTTPS without embedded credentials', () => {
  assert.equal(MCP.validateEndpoint('https://mcp.example.test/server#fragment'), 'https://mcp.example.test/server');
  for (const endpoint of [
    'http://mcp.example.test',
    'https://localhost/mcp',
    'https://127.0.0.1/mcp',
    'https://user:secret@mcp.example.test/mcp'
  ]) assert.throws(() => MCP.validateEndpoint(endpoint), /HTTPS|credentials/);
});

test('MCP client initializes, lists tools, preserves session headers, and checks tool response IDs', async () => {
  const server = makeServer();
  const connection = await MCP.connect({ name: 'Fixture server', url: 'https://mcp.example.test/api', token: 'memory-token', fetch: server.fetch });
  assert.equal(connection.name, 'Fixture server');
  assert.equal(connection.tools.length, 1);
  assert.equal(connection.tools[0].name, 'lookup');

  const definition = MCP.getToolDefinitions()[0];
  assert.equal(definition.mcp, true);
  assert.equal(definition.mcpServerId, connection.id);
  assert.match(definition.name, /^mcp1_lookup$/);

  const result = await MCP.callTool(connection.id, 'lookup', { query: 'MCP' });
  assert.equal(result.text, 'Found MCP');
  assert.equal(result.isError, false);
  const call = server.requests.find((request) => request.packet.method === 'tools/call');
  assert.equal(typeof call.packet.id, 'number');

  const listRequest = server.requests.find((request) => request.packet.method === 'tools/list');
  assert.equal(listRequest.options.headers['MCP-Protocol-Version'], '2025-03-26');
  assert.equal(listRequest.options.headers['Mcp-Session-Id'], 'session-fixture');
  assert.equal(listRequest.options.headers.Authorization, 'Bearer memory-token');
  assert.equal(server.requests.some((request) => request.packet.method === 'notifications/initialized'), true);
  assert.equal(MCP.disconnect(connection.id), true);
  assert.deepEqual(MCP.getConnections(), []);
});

test('MCP client reads matching responses from Streamable HTTP SSE bodies', async () => {
  const server = makeServer({ streamList: true });
  const connection = await MCP.connect({ url: 'https://mcp.example.test/api', fetch: server.fetch });
  assert.equal(connection.tools[0].name, 'lookup');
  MCP.disconnect(connection.id);
});

test('MCP client rejects mismatched JSON-RPC response IDs for tool calls', async () => {
  const server = makeServer({ mismatchToolResponse: true });
  const connection = await MCP.connect({ url: 'https://mcp.example.test/api', fetch: server.fetch });
  await assert.rejects(MCP.callTool(connection.id, 'lookup', { query: 'bad id' }), /response ID did not match/);
  MCP.disconnect(connection.id);
});
