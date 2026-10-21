const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

let createShellRunner;
test.before(async () => {
  ({ createShellRunner } = await import(pathToFileURL(path.join(__dirname, '../tools/shell-runner.mjs')).href));
});

class MockRequest extends EventEmitter {
  constructor({ method = 'GET', body = '', token = '', origin = 'http://localhost:4173', host = 'localhost:4173', remoteAddress = '127.0.0.1' } = {}) {
    super();
    this.method = method;
    this.headers = { host, origin, authorization: token ? `Bearer ${token}` : '' };
    this.socket = { remoteAddress };
    this.body = body;
  }
  async *[Symbol.asyncIterator]() { if (this.body) yield Buffer.from(this.body); }
}

class MockResponse extends EventEmitter {
  constructor() { super(); this.headers = {}; this.writableEnded = false; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  end(body = '') { this.body = body; this.writableEnded = true; this.emit('finish'); }
}

function payload(response) { return JSON.parse(response.body); }

test('local shell runner stays disabled unless explicitly enabled', () => {
  const runner = createShellRunner({ root: process.cwd(), enabled: false });
  const response = new MockResponse();
  runner.status(new MockRequest(), response);
  assert.equal(response.statusCode, 404);
  assert.equal(payload(response).error, 'The local shell runner is disabled.');
});

test('local shell runner requires a private token, loopback client, and same-origin request', () => {
  const runner = createShellRunner({ root: process.cwd(), enabled: true });
  const noToken = new MockResponse();
  runner.status(new MockRequest(), noToken);
  assert.equal(noToken.statusCode, 401);

  const wrongOrigin = new MockResponse();
  runner.status(new MockRequest({ token: runner.info.token, origin: 'https://attacker.test' }), wrongOrigin);
  assert.equal(wrongOrigin.statusCode, 403);

  const remote = new MockResponse();
  runner.status(new MockRequest({ token: runner.info.token, remoteAddress: '203.0.113.5' }), remote);
  assert.equal(remote.statusCode, 403);

  const allowed = new MockResponse();
  runner.status(new MockRequest({ token: runner.info.token }), allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(payload(allowed).enabled, true);
  assert.equal(payload(allowed).workspace, process.cwd());
});

test('approved local commands run in the fixed workspace with bounded output', async () => {
  const runner = createShellRunner({ root: process.cwd(), enabled: true });
  const command = process.platform === 'win32' ? 'echo runner-ok' : "printf 'runner-ok'";
  const req = new MockRequest({ method: 'POST', token: runner.info.token, body: JSON.stringify({ command }) });
  const res = new MockResponse();
  const completed = new Promise((resolve) => res.once('finish', resolve));
  await runner.execute(req, res);
  await completed;
  const result = payload(res);
  assert.equal(res.statusCode, 200);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /runner-ok/);
  assert.equal(result.workspace, process.cwd());
  assert.equal(result.timedOut, false);
});
