/* Remote MCP client for Eltes. Connections and bearer tokens are memory-only. */
(function attachMCP(root, factory) {
  const api = factory(root);
  if (root) root.EltesMCP = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis, function createMCPClient(root) {
  'use strict';

  const CLIENT_PROTOCOL = '2025-03-26';
  const connections = new Map();
  let sequence = 0;

  function validateEndpoint(value) {
    let endpoint;
    try { endpoint = new URL(String(value || '').trim()); }
    catch { throw new Error('Enter a valid HTTPS MCP server URL.'); }
    const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLoopback = host === 'localhost' || host.endsWith('.localhost') || host === '::1' ||
      host === '0.0.0.0' || /^127\./.test(host);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || isLoopback) {
      throw new Error('MCP connections require a remote HTTPS URL. Localhost and embedded URL credentials are not allowed.');
    }
    endpoint.hash = '';
    return endpoint.href;
  }

  function extractSessionId(response) {
    try { return response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id') || ''; }
    catch { return ''; }
  }

  function responseError(payload) {
    if (!payload || !payload.error) return null;
    const error = payload.error;
    return new Error(`MCP server error: ${typeof error.message === 'string' ? error.message : `code ${error.code || 'unknown'}`}`);
  }

  async function readSSE(response, expectedId) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('The MCP server returned an unreadable event stream.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    const parseEvent = async () => {
      if (!data.length) return null;
      const raw = data.join('\n');
      data = [];
      let message;
      try { message = JSON.parse(raw); } catch { return null; }
      if (expectedId == null || String(message.id) === String(expectedId)) return message;
      return null;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line === '') {
            const message = await parseEvent();
            if (message) {
              try { await reader.cancel(); } catch { /* Stream is already complete. */ }
              return message;
            }
          } else if (line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''));
          }
        }
        if (done) {
          const message = await parseEvent();
          if (message) return message;
          break;
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* No lock to release. */ }
    }
    if (expectedId == null) return null;
    throw new Error('The MCP event stream closed before returning a response.');
  }

  async function readResponse(response, expectedId) {
    if (response.status === 202 || response.status === 204) return null;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/event-stream')) return readSSE(response, expectedId);
    if (!contentType.includes('json')) {
      const detail = (await response.text().catch(() => '')).slice(0, 240);
      if (expectedId == null) return null;
      throw new Error(`MCP returned an unexpected response${detail ? `: ${detail}` : '.'}`);
    }
    const payload = await response.json();
    if (expectedId != null && String(payload.id) !== String(expectedId)) {
      throw new Error('MCP response ID did not match the request.');
    }
    return payload;
  }

  async function post(connection, packet, expectedId, initializing = false) {
    const fetchImpl = connection.fetchImpl || root.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable in this browser.');
    const headers = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json'
    };
    if (!initializing && connection.protocolVersion) headers['MCP-Protocol-Version'] = connection.protocolVersion;
    if (!initializing && connection.sessionId) headers['Mcp-Session-Id'] = connection.sessionId;
    if (connection.token) headers.Authorization = `Bearer ${connection.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetchImpl(connection.url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers,
        body: JSON.stringify(packet),
        signal: controller.signal
      });
      const sessionId = extractSessionId(response);
      if (sessionId) connection.sessionId = sessionId;
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 260);
        const corsHint = response.status === 404 || response.status === 405
          ? ' The MCP session may have expired; disconnect and reconnect.' : '';
        throw new Error(`MCP server returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}${corsHint}`);
      }
      const payload = await readResponse(response, expectedId);
      const error = responseError(payload);
      if (error) throw error;
      return payload ? payload.result : null;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('MCP request timed out after 35 seconds.');
      if (error instanceof Error && (error.message.startsWith('MCP ') || error.message.startsWith('The MCP '))) throw error;
      throw new Error(`Could not reach the MCP server. Check its URL and CORS settings. ${error?.message || ''}`.trim());
    } finally {
      clearTimeout(timer);
    }
  }

  function toolAlias(serverNumber, rawName, usedNames) {
    const safe = String(rawName || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[-_]+/, '').slice(0, 46) || 'tool';
    const serverLabel = String(serverNumber).replace(/^mcp/, '');
    const base = `mcp${serverLabel}_${safe}`;
    let alias = base.slice(0, 64);
    let suffix = 2;
    while (usedNames.has(alias)) {
      const tail = `_${suffix++}`;
      alias = `${base.slice(0, 64 - tail.length)}${tail}`;
    }
    usedNames.add(alias);
    return alias;
  }

  function publicConnection(connection) {
    return {
      id: connection.id,
      name: connection.name,
      url: connection.url,
      enabled: connection.enabled,
      tools: connection.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        providerName: tool.providerName
      }))
    };
  }

  async function connect({ name, url, token = '', fetch: injectedFetch } = {}) {
    const endpoint = validateEndpoint(url);
    const parsed = new URL(endpoint);
    const connection = {
      id: `mcp${(++sequence).toString(36)}`,
      name: String(name || parsed.hostname).trim().slice(0, 64) || parsed.hostname,
      url: endpoint,
      token: String(token || '').trim(),
      fetchImpl: injectedFetch,
      sessionId: '',
      protocolVersion: CLIENT_PROTOCOL,
      enabled: true,
      tools: []
    };
    const usedNames = new Set();
    const init = await post(connection, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: CLIENT_PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'Eltes', version: '3.3.0' }
      }
    }, 1, true);
    if (!init || typeof init.protocolVersion !== 'string') {
      throw new Error('The server did not return a valid MCP initialize response.');
    }
    connection.protocolVersion = init.protocolVersion;
    await post(connection, { jsonrpc: '2.0', method: 'notifications/initialized' }, null);

    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const result = await post(connection, {
        jsonrpc: '2.0', id: page + 2, method: 'tools/list', params: cursor ? { cursor } : {}
      }, page + 2);
      if (!result || !Array.isArray(result.tools)) throw new Error('The MCP server returned an invalid tools/list response.');
      for (const tool of result.tools) {
        if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) continue;
        const schema = tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema : { type: 'object', properties: {} };
        let schemaSize = 0;
        try { schemaSize = JSON.stringify(schema).length; } catch { schemaSize = 20_000; }
        if (schemaSize > 18_000) continue;
        connection.tools.push({
          name: tool.name.slice(0, 128),
          description: String(tool.description || 'MCP tool').slice(0, 2_000),
          inputSchema: schema,
          providerName: toolAlias(connection.id, tool.name, usedNames)
        });
        if (connection.tools.length >= 100) break;
      }
      if (connection.tools.length >= 100 || !result.nextCursor) break;
      cursor = String(result.nextCursor).slice(0, 512);
    }
    connections.set(connection.id, connection);
    return publicConnection(connection);
  }

  function getConnections() { return Array.from(connections.values(), publicConnection); }
  function getToolDefinitions() {
    const definitions = [];
    connections.forEach((connection) => {
      if (!connection.enabled) return;
      connection.tools.forEach((tool) => definitions.push({
        name: tool.providerName,
        description: `[MCP: ${connection.name}] ${tool.description}`.slice(0, 2_800),
        parameters: tool.inputSchema,
        mcp: true,
        mcpServerId: connection.id,
        mcpServerName: connection.name,
        mcpToolName: tool.name,
        displayName: tool.name
      }));
    });
    return definitions;
  }

  async function callTool(serverId, toolName, args = {}) {
    const connection = connections.get(serverId);
    if (!connection) throw new Error('This MCP connection is no longer active. Reconnect it and retry.');
    const tool = connection.tools.find((item) => item.name === toolName);
    if (!tool) throw new Error('That tool is no longer available on this MCP server.');
    const requestId = Math.floor(Math.random() * 1_000_000_000) + 10;
    const result = await post(connection, {
      jsonrpc: '2.0', id: requestId,
      method: 'tools/call', params: { name: tool.name, arguments: args || {} }
    }, requestId);
    if (!result || typeof result !== 'object') throw new Error('The MCP server returned an empty tool result.');
    const pieces = [];
    if (Array.isArray(result.content)) {
      result.content.forEach((block) => {
        if (block && block.type === 'text' && typeof block.text === 'string') pieces.push(block.text);
        else if (block && block.type) pieces.push(`[${block.type} content returned]`);
      });
    }
    if (result.structuredContent != null) {
      try { pieces.push(JSON.stringify(result.structuredContent)); } catch { pieces.push('[structured result could not be serialized]'); }
    }
    const text = (pieces.join('\n') || (result.isError ? 'MCP tool returned an error.' : 'MCP tool completed with no text output.')).slice(0, 12_000);
    return { text, isError: !!result.isError };
  }

  function setEnabled(serverId, enabled) {
    const connection = connections.get(serverId);
    if (!connection) return false;
    connection.enabled = !!enabled;
    return true;
  }

  function disconnect(serverId) { return connections.delete(serverId); }

  return { connect, getConnections, getToolDefinitions, callTool, setEnabled, disconnect, validateEndpoint };
});
