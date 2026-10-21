/* ==========================================================================
   Eltes AI — MCP client
   Speaks the Model Context Protocol over Streamable HTTP so a local server
   (Blender, Roblox Studio, or anything else) can expose tools to the chat.

   Browsers cannot spawn processes, so this client only speaks HTTP. Command
   based servers (stdio) go through mcp/eltes-mcp-bridge.mjs, which is started
   from a terminal or a downloaded script and listens on 127.0.0.1.

   Public surface:
     EltesMCP.create({ storage, fetch, now }) -> client
     client.list()                     configured servers (no live state)
     client.add({ name, url })         -> server
     client.remove(id)
     client.connect(id)                initialize + tools/list
     client.disconnect(id)
     client.tools()                    [{ name: 'server__tool', server, tool }]
     client.call(serverId, toolName, args)
   ========================================================================== */
window.EltesMCP = (function () {
  'use strict';

  const PROTOCOL_VERSION = '2025-06-18';
  const CLIENT_INFO = { name: 'Eltes', version: '3.19.0' };
  const STORAGE_KEY = 'eltes.mcp.v1';
  const TIMEOUT_MS = 12000;

  const PRESETS = [
    {
      id: 'blender',
      name: 'Blender',
      icon: 'box',
      url: 'http://127.0.0.1:9876/mcp',
      port: 9876,
      what: 'Build objects, apply materials, keyframe animation and render stills from chat.',
      command: 'uvx blender-mcp',
      serverCommand: 'uvx blender-mcp',
      install: 'Blender add-on: BlenderMCP (Edit → Preferences → Add-ons → Install) and press "Start MCP server" in the 3D view sidebar.',
      steps: [
        'Install the BlenderMCP add-on in Blender (one .py file, Add-ons → Install).',
        'In Blender, open the sidebar (N) → BlenderMCP → Start MCP server.',
        'Download and run connect-blender (or copy the command) on this machine.',
        'Come back here and press Connect.'
      ]
    },
    {
      id: 'roblox',
      name: 'Roblox Studio',
      icon: 'box',
      url: 'http://127.0.0.1:8410/mcp',
      port: 8410,
      what: 'Create parts and models, insert Luau scripts, animate rigs, add effects and scaffold a playable game.',
      command: 'node mcp/eltes-roblox-bridge.mjs --port 8410',
      install: 'Studio plugin: download EltesRobloxBridge.lua and save it in Studio’s Plugins folder (or paste the installer line in the Command Bar).',
      steps: [
        'Download the bridge script below and run it (double-click on Windows).',
        'Download EltesRobloxBridge.lua and put it in your Roblox Studio Plugins folder.',
        'In Studio turn on Game Settings → Security → Allow HTTP Requests.',
        'Come back here and press Connect.'
      ]
    }
  ];

  const slug = (text) => String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'server';

  function textFromContent(content) {
    if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      else if (block.type === 'resource' && block.resource && typeof block.resource.text === 'string') parts.push(block.resource.text);
      else if (block.type === 'image') parts.push('[image result]');
      else if (block.type === 'resource_link' && block.uri) parts.push(String(block.uri));
    }
    return parts.join('\n').trim();
  }

  function parseBody(contentType, body) {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('text/event-stream')) {
      const messages = [];
      for (const line of String(body || '').split(/\r?\n/)) {
        const match = line.match(/^data:\s?(.*)$/);
        if (!match || !match[1].trim()) continue;
        try { messages.push(JSON.parse(match[1])); } catch (error) { /* keep-alive or partial frame */ }
      }
      if (!messages.length) throw new Error('The server sent an event stream with no JSON-RPC message.');
      return messages[messages.length - 1];
    }
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error('The server did not return JSON. Is that URL an MCP endpoint?');
    }
  }

  function create(options) {
    const config = options || {};
    const storage = config.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const fetchImpl = config.fetch || ((...args) => fetch(...args));
    const timeout = Number(config.timeout) || TIMEOUT_MS;
    let sequence = 0;
    let servers = [];
    const sessions = new Map();

    function load() {
      if (!storage) return [];
      try {
        const raw = storage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const list = parsed && Array.isArray(parsed.servers) ? parsed.servers : [];
        return list
          .filter((server) => server && typeof server.url === 'string' && server.url)
          .map((server) => ({
            id: String(server.id || slug(server.name)),
            name: String(server.name || 'MCP server'),
            url: String(server.url),
            enabled: server.enabled !== false
          }));
      } catch (error) {
        return [];
      }
    }

    function persist() {
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ servers: servers.map(({ id, name, url, enabled }) => ({ id, name, url, enabled })) }));
      } catch (error) { /* storage full or blocked: the session still works */ }
    }

    function stateOf(id) {
      const session = sessions.get(id);
      if (!session) return { status: 'idle', tools: [], error: null };
      return { status: session.status, tools: session.tools, error: session.error };
    }

    function publicServer(server) {
      return Object.assign({}, server, stateOf(server.id));
    }

    servers = load();

    function list() {
      return servers.map(publicServer);
    }

    function get(id) {
      const server = servers.find((entry) => entry.id === id);
      return server ? publicServer(server) : null;
    }

    function add(input) {
      const name = String((input && input.name) || '').trim() || 'MCP server';
      const url = String((input && input.url) || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('The server URL must start with http:// or https://');
      let id = slug(name);
      let suffix = 2;
      while (servers.some((server) => server.id === id)) id = `${slug(name)}-${suffix++}`;
      const server = { id, name, url, enabled: true };
      servers.push(server);
      persist();
      return publicServer(server);
    }

    function remove(id) {
      const before = servers.length;
      servers = servers.filter((server) => server.id !== id);
      sessions.delete(id);
      persist();
      return servers.length !== before;
    }

    function setEnabled(id, enabled) {
      const server = servers.find((entry) => entry.id === id);
      if (!server) return null;
      server.enabled = !!enabled;
      persist();
      return publicServer(server);
    }

    async function rpc(server, method, params, options) {
      const opts = options || {};
      const session = sessions.get(server.id);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => { if (controller) controller.abort(); }, timeout);
      const body = { jsonrpc: '2.0', method };
      if (!opts.notify) body.id = ++sequence;
      if (params !== undefined) body.params = params;
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION
      };
      if (session && session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;

      let response;
      try {
        response = await fetchImpl(server.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined
        });
      } catch (error) {
        clearTimeout(timer);
        if (error && error.name === 'AbortError') throw new Error(`No answer from ${server.name} within ${Math.round(timeout / 1000)}s. Is the bridge running?`);
        throw new Error(`Could not reach ${server.name} at ${server.url}. Start the connection script, then try again.`);
      }
      clearTimeout(timer);

      if (response.status === 401 || response.status === 403) {
        throw new Error(`${server.name} refused the request (${response.status}). Check the server's token settings.`);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`${server.name} answered ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
      }
      if (opts.notify) return null;

      const sessionId = response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('mcp-session-id')
        : null;
      const current = sessions.get(server.id);
      if (sessionId && current) current.sessionId = sessionId;

      const text = await response.text();
      const payload = parseBody(response.headers && response.headers.get ? response.headers.get('content-type') : '', text);
      if (!payload || typeof payload !== 'object') throw new Error(`${server.name} returned an unexpected payload.`);
      if (payload.error) throw new Error(payload.error.message || `JSON-RPC error ${payload.error.code}`);
      return payload.result;
    }

    async function connect(id) {
      const server = servers.find((entry) => entry.id === id);
      if (!server) throw new Error('Unknown MCP server.');
      if (!server.enabled) throw new Error(`${server.name} is turned off.`);
      sessions.set(id, { status: 'connecting', tools: [], error: null, sessionId: null });
      try {
        const init = await rpc(server, 'initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: CLIENT_INFO
        });
        if (!init || !init.protocolVersion) throw new Error(`${server.name} did not complete the MCP handshake.`);
        await rpc(server, 'notifications/initialized', undefined, { notify: true });
        const listed = await rpc(server, 'tools/list', {});
        const tools = Array.isArray(listed && listed.tools) ? listed.tools : [];
        sessions.set(id, {
          status: 'connected',
          tools: tools.map((tool) => ({
            name: String(tool.name || ''),
            description: String(tool.description || ''),
            inputSchema: tool.inputSchema || { type: 'object', properties: {} }
          })).filter((tool) => tool.name),
          error: null,
          sessionId: (sessions.get(id) || {}).sessionId || null,
          serverInfo: init.serverInfo || null
        });
        return publicServer(server);
      } catch (error) {
        sessions.set(id, { status: 'error', tools: [], error: error.message, sessionId: null });
        throw error;
      }
    }

    function disconnect(id) {
      const server = servers.find((entry) => entry.id === id);
      sessions.delete(id);
      return server ? publicServer(server) : null;
    }

    function tools() {
      const out = [];
      for (const server of servers) {
        const state = sessions.get(server.id);
        if (!state || state.status !== 'connected') continue;
        for (const tool of state.tools) {
          out.push({
            name: `${server.id}__${tool.name}`,
            description: tool.description || `${tool.name} on ${server.name}`,
            parameters: tool.inputSchema,
            icon: 'plug',
            server: server.id,
            serverName: server.name,
            tool: tool.name
          });
        }
      }
      return out;
    }

    async function call(serverId, toolName, args) {
      const server = servers.find((entry) => entry.id === serverId);
      if (!server) return { error: 'That MCP server is no longer configured.' };
      const state = sessions.get(server.id);
      if (!state || state.status !== 'connected') return { error: `${server.name} is not connected.` };
      const started = Date.now();
      try {
        const result = await rpc(server, 'tools/call', { name: toolName, arguments: args || {} });
        const text = textFromContent(result && result.content);
        const runtime = Math.max(1, Date.now() - started);
        if (result && result.isError) return { error: text || 'The tool reported an error.', runtime };
        return { result: text || '(the tool returned no text)', runtime };
      } catch (error) {
        return { error: error.message, runtime: Math.max(1, Date.now() - started) };
      }
    }

    return {
      protocolVersion: PROTOCOL_VERSION,
      list,
      get,
      add,
      remove,
      setEnabled,
      connect,
      disconnect,
      tools,
      call,
      storageKey: STORAGE_KEY
    };
  }

  return { create, PRESETS, PROTOCOL_VERSION, parseBody, textFromContent, slug };
})();
