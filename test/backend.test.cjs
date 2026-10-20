'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const health = require('../api/health.js');
const keyCheck = require('../api/key-check.js');
const chat = require('../api/chat.js');
const { PROVIDERS, modelAllowed } = require('../lib/providers.cjs');

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 200;
    this.headersSent = false;
    this.writableEnded = false;
    this.destroyed = false;
    this.chunks = [];
  }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  flushHeaders() { this.headersSent = true; }
  write(chunk) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); return true; }
  end(chunk) {
    if (chunk) this.chunks.push(Buffer.from(chunk));
    this.headersSent = true;
    this.writableEnded = true;
  }
  get text() { return Buffer.concat(this.chunks).toString('utf8'); }
  get json() { return JSON.parse(this.text || '{}'); }
}
function request({ method = 'POST', origin = 'https://app.example.test', body = {}, headers = {} } = {}) {
  return { method, body, headers: { host: 'api.example.test', origin, ...headers } };
}
const originalAllowedOrigins = process.env.ELTES_ALLOWED_ORIGINS;
test.beforeEach(() => { process.env.ELTES_ALLOWED_ORIGINS = 'https://app.example.test'; });
test.after(() => {
  if (originalAllowedOrigins === undefined) delete process.env.ELTES_ALLOWED_ORIGINS;
  else process.env.ELTES_ALLOWED_ORIGINS = originalAllowedOrigins;
});

test('every hosted catalogue model is represented by the fixed backend allowlist', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/models.js'), 'utf8'), { window });
  const models = window.EltesModels.MODELS;
  const unsupported = models.filter((model) => !model.local && model.provider !== 'custom' &&
    (!PROVIDERS[model.provider] || !modelAllowed(model.provider, model.apiId)));
  assert.equal(unsupported.length, 0);
});

test('health route returns a no-store health response and permits configured origin', () => {
  const res = new MockResponse();
  health(request({ method: 'GET' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], 'https://app.example.test');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.json.service, 'eltes-byok-proxy');
});

test('key check sends key only as an upstream header and never returns it', async () => {
  const originalFetch = global.fetch;
  let calledUrl;
  let calledHeaders;
  global.fetch = async (url, options) => {
    calledUrl = String(url);
    calledHeaders = options.headers;
    return new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = new MockResponse();
    await keyCheck(request({ body: { provider: 'openai' }, headers: { 'x-eltes-provider-key': 'secret-test-key' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.valid, true);
    assert.equal(calledUrl, 'https://api.openai.com/v1/models');
    assert.equal(calledHeaders.authorization, 'Bearer secret-test-key');
    assert.equal(calledUrl.includes('secret-test-key'), false);
    assert.equal(res.text.includes('secret-test-key'), false);
  } finally { global.fetch = originalFetch; }
});

test('chat route fixes upstream host, strips proxy metadata, and relays SSE bytes', async () => {
  const originalFetch = global.fetch;
  let calledUrl;
  let calledHeaders;
  let upstreamBody;
  global.fetch = async (url, options) => {
    calledUrl = String(url);
    calledHeaders = options.headers;
    upstreamBody = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n', {
      status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' }
    });
  };
  try {
    const res = new MockResponse();
    await chat(request({
      body: { provider: 'openai', model: 'gpt-4.1', stream: true, messages: [{ role: 'user', content: 'Hello' }] },
      headers: { 'x-eltes-provider-key': 'secret-test-key' }
    }), res);
    assert.equal(calledUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calledHeaders.authorization, 'Bearer secret-test-key');
    assert.equal(upstreamBody.provider, undefined);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    assert.match(res.text, /hello/);
    assert.equal(res.text.includes('secret-test-key'), false);
  } finally { global.fetch = originalFetch; }
});

test('chat rejects unlisted model/provider pairs without making an upstream request', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('must not fetch'); };
  try {
    const res = new MockResponse();
    await chat(request({ body: { provider: 'openai', model: 'unlisted-model', messages: [] }, headers: { 'x-eltes-provider-key': 'secret' } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.json.error, /allowlist/);
  } finally { global.fetch = originalFetch; }
});

test('disallowed browser origin is rejected', async () => {
  const res = new MockResponse();
  await chat(request({ origin: 'https://attacker.example', body: {}, headers: { 'x-eltes-provider-key': 'secret' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.json.error, 'Origin is not allowed.');
});
