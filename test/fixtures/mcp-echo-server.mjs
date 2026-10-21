#!/usr/bin/env node
// Minimal MCP server over stdio, used by test/mcp.test.cjs to exercise the
// stdio → HTTP bridge without depending on an external package.

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch (error) { continue; }
    if (message.id === undefined || message.id === null) continue;
    const reply = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
    if (message.method === 'initialize') {
      reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '0.0.1' } });
    } else if (message.method === 'tools/list') {
      reply({ tools: [{ name: 'echo', description: 'Echo a message back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
    } else if (message.method === 'tools/call') {
      reply({ content: [{ type: 'text', text: `echo: ${(message.params && message.params.arguments && message.params.arguments.text) || ''}` }] });
    } else {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } })}\n`);
    }
  }
});
