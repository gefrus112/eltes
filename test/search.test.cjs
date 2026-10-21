'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const search = require('../api/search.js');
const { PROVIDERS, FRESHNESS, normalizeFreshness, buildRequest, normalize, safeUrl, normalizeQuery, normalizeCount } = require('../lib/search.cjs');

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

const KEY_HEADER = 'x-eltes-search-key';
const originalAllowedOrigins = process.env.ELTES_ALLOWED_ORIGINS;
test.beforeEach(() => { process.env.ELTES_ALLOWED_ORIGINS = 'https://app.example.test'; });
test.after(() => {
  if (originalAllowedOrigins === undefined) delete process.env.ELTES_ALLOWED_ORIGINS;
  else process.env.ELTES_ALLOWED_ORIGINS = originalAllowedOrigins;
});

const withFetch = async (impl, run) => {
  const originalFetch = global.fetch;
  global.fetch = impl;
  try { return await run(); } finally { global.fetch = originalFetch; }
};

test('every frontend search provider is on the fixed backend allowlist', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/search.js'), 'utf8'), { window });
  const ids = Object.keys(window.EltesSearch.PROVIDERS);
  assert.deepEqual(ids.sort(), Object.keys(PROVIDERS).sort());
});

test('search rejects an unknown provider without making an upstream request', async () => {
  let called = false;
  const res = new MockResponse();
  await withFetch(async () => { called = true; throw new Error('should not run'); }, async () => {
    await search(request({ body: { provider: 'not-real', query: 'hello' }, headers: { [KEY_HEADER]: 'test-key' } }), res);
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
  assert.match(res.json.error, /allowlist/i);
});

test('search requires a key and a valid query', async () => {
  const noKey = new MockResponse();
  await search(request({ body: { provider: 'brave', query: 'hello' } }), noKey);
  assert.equal(noKey.statusCode, 400);
  assert.match(noKey.json.error, /key/i);

  const emptyQuery = new MockResponse();
  await search(request({ body: { provider: 'brave', query: '   ' }, headers: { [KEY_HEADER]: 'k' } }), emptyQuery);
  assert.equal(emptyQuery.statusCode, 400);

  const longQuery = new MockResponse();
  await search(request({ body: { provider: 'brave', query: 'x'.repeat(401) }, headers: { [KEY_HEADER]: 'k' } }), longQuery);
  assert.equal(longQuery.statusCode, 400);
});

test('Brave search normalizes results, strips markup and never returns the key', async () => {
  let calledUrl = '';
  let calledHeaders = {};
  const res = new MockResponse();
  await withFetch(async (url, options) => {
    calledUrl = String(url);
    calledHeaders = options.headers;
    return new Response(JSON.stringify({
      web: {
        results: [
          { title: 'Eltes <strong>AI</strong>', url: 'https://example.com/eltes', description: 'A <b>local-first</b> workspace &amp; agent.' },
          { title: 'Duplicate', url: 'https://example.com/eltes', description: 'dupe' },
          { title: 'Unsafe', url: 'javascript:alert(1)', description: 'nope' }
        ]
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    await search(request({ body: { provider: 'brave', query: 'eltes ai', count: 5 }, headers: { [KEY_HEADER]: 'secret-key' } }), res);
  });

  assert.equal(res.statusCode, 200);
  assert.match(calledUrl, /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/);
  assert.match(calledUrl, /q=eltes\+ai/);
  assert.equal(calledHeaders['x-subscription-token'], 'secret-key');
  const body = res.json;
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].url, 'https://example.com/eltes');
  assert.equal(body.results[0].title, 'Eltes AI');
  assert.equal(body.results[0].snippet, 'A local-first workspace & agent.');
  assert.equal(body.results[0].domain, 'example.com');
  assert.doesNotMatch(res.text, /secret-key/);
});

test('Tavily returns a synthesized answer alongside its sources', async () => {
  const res = new MockResponse();
  await withFetch(async (url, options) => {
    assert.equal(String(url), PROVIDERS.tavily.endpoint);
    assert.equal(options.headers.authorization, 'Bearer tvly-test');
    const sent = JSON.parse(options.body);
    assert.equal(sent.query, 'deepseek v4');
    assert.equal(sent.include_answer, true);
    return new Response(JSON.stringify({
      answer: 'DeepSeek V4 launched in 2026.',
      results: [{ title: 'DeepSeek', url: 'https://deepseek.com/news', content: 'Release notes for V4.' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, async () => {
    await search(request({ body: { provider: 'tavily', query: 'deepseek v4' }, headers: { [KEY_HEADER]: 'tvly-test' } }), res);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.answer, 'DeepSeek V4 launched in 2026.');
  assert.equal(res.json.results[0].domain, 'deepseek.com');
});

test('Serper and Exa map their payloads to the same result shape', async () => {
  const serperRes = new MockResponse();
  await withFetch(async () => new Response(JSON.stringify({
    answerBox: { answer: '42 is the answer.' },
    organic: [{ title: 'Answer site', link: 'https://answer.example/page', snippet: 'Because it is.' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    await search(request({ body: { provider: 'serper', query: 'answer' }, headers: { [KEY_HEADER]: 's' } }), serperRes);
  });
  assert.equal(serperRes.json.answer, '42 is the answer.');
  assert.equal(serperRes.json.results[0].url, 'https://answer.example/page');

  const exaRes = new MockResponse();
  await withFetch(async () => new Response(JSON.stringify({
    results: [{ title: 'Exa hit', url: 'https://exa.example/a', text: 'Extracted page text.', publishedDate: '2026-01-01' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    await search(request({ body: { provider: 'exa', query: 'neural search' }, headers: { [KEY_HEADER]: 'e' } }), exaRes);
  });
  assert.equal(exaRes.json.results[0].title, 'Exa hit');
  assert.equal(exaRes.json.results[0].snippet, 'Extracted page text.');
});

test('upstream failures surface as readable errors without leaking the key', async () => {
  const res = new MockResponse();
  await withFetch(async () => new Response('nope', { status: 401 }), async () => {
    await search(request({ body: { provider: 'brave', query: 'x' }, headers: { [KEY_HEADER]: 'secret' } }), res);
  });
  assert.equal(res.statusCode, 401);
  assert.match(res.json.error, /rejected this search key/i);
  assert.doesNotMatch(res.text, /secret/);
});

test('network failure returns 502 and a timeout returns 504', async () => {
  const failed = new MockResponse();
  await withFetch(async () => { throw new Error('offline'); }, async () => {
    await search(request({ body: { provider: 'brave', query: 'x' }, headers: { [KEY_HEADER]: 'k' } }), failed);
  });
  assert.equal(failed.statusCode, 502);

  const aborted = new MockResponse();
  await withFetch(async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }, async () => {
    await search(request({ body: { provider: 'brave', query: 'x' }, headers: { [KEY_HEADER]: 'k' } }), aborted);
  });
  assert.equal(aborted.statusCode, 504);
});

test('CORS preflight advertises the search key header and rejects unknown origins', async () => {
  const ok = new MockResponse();
  await search(request({ method: 'OPTIONS' }), ok);
  assert.equal(ok.statusCode, 204);
  assert.match(ok.headers['access-control-allow-headers'], /X-Eltes-Search-Key/i);

  const denied = new MockResponse();
  await search(request({ origin: 'https://evil.example', body: { provider: 'brave', query: 'x' } }), denied);
  assert.equal(denied.statusCode, 403);
});

test('helper guards clamp input and refuse non-http links', () => {
  assert.equal(normalizeQuery('  hello   world  '), 'hello world');
  assert.equal(normalizeQuery('bad\u0000query'), '');
  assert.equal(normalizeCount(999), 10);
  assert.equal(normalizeCount(0), 6);
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('file:///etc/passwd'), '');
  assert.equal(safeUrl('https://user:pass@example.com'), '');
  assert.equal(safeUrl('https://example.com/a#frag'), 'https://example.com/a');

  const built = buildRequest('brave', 'test query', 3, 'k');
  assert.match(built.url, /count=3/);
  assert.doesNotMatch(built.url, /k=/);

  const normalized = normalize('brave', {
    web: { results: [{ title: '', url: 'https://ok.example/', description: '' }] }
  }, 5);
  assert.equal(normalized.results[0].title, 'ok.example');
});

test('freshness filters map to each provider and unknown values fall back to any time', () => {
  assert.deepEqual(Object.keys(FRESHNESS), ['any', 'day', 'week', 'month', 'year']);
  assert.equal(normalizeFreshness('week'), 'week');
  assert.equal(normalizeFreshness('decade'), 'any');

  const brave = buildRequest('brave', 'q', 5, 'k', 'day');
  assert.match(brave.url, /freshness=pd/);
  assert.doesNotMatch(buildRequest('brave', 'q', 5, 'k', 'any').url, /freshness=/);

  const serper = JSON.parse(buildRequest('serper', 'q', 5, 'k', 'month').init.body);
  assert.equal(serper.tbs, 'qdr:m');

  const tavily = JSON.parse(buildRequest('tavily', 'q', 5, 'k', 'week').init.body);
  assert.equal(tavily.days, 7);
  assert.equal(JSON.parse(buildRequest('tavily', 'q', 5, 'k', 'any').init.body).days, undefined);

  const exa = JSON.parse(buildRequest('exa', 'q', 5, 'k', 'year', Date.parse('2026-10-20T00:00:00Z')).init.body);
  assert.equal(exa.startPublishedDate, '2025-10-20');
  assert.equal(JSON.parse(buildRequest('exa', 'q', 5, 'k', 'any').init.body).startPublishedDate, undefined);
});

test('the search route forwards a clamped freshness filter and echoes it back', async () => {
  let sent = null;
  const res = new MockResponse();
  await withFetch(async (url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ organic: [{ title: 'One', link: 'https://example.com/a', snippet: 'A' }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }, async () => {
    await search(request({ body: { provider: 'serper', query: 'releases', freshness: 'week' }, headers: { [KEY_HEADER]: 'k' } }), res);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.tbs, 'qdr:w');
  assert.equal(res.json.freshness, 'week');
  assert.equal(res.json.results.length, 1);
});
