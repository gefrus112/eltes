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
  write(body) { this.body = (this.body || '') + body; this.emit('chunk', body); }
  end(body = '') { this.body = (this.body || '') + body; this.writableEnded = true; this.emit('finish'); }
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

test('local runner refuses explicit secret, environment-file, and production-config command targets', async () => {
  const runner = createShellRunner({ root: process.cwd(), enabled: true });
  for (const command of ['cat .env', 'cat secrets.json', 'cat vercel.json', 'npm run production', 'git push origin main', 'rm -rf build']) {
    const req = new MockRequest({ method: 'POST', token: runner.info.token, body: JSON.stringify({ command }) });
    const res = new MockResponse();
    await runner.execute(req, res);
    assert.equal(res.statusCode, 403, `${command} should be blocked before execution`);
    assert.match(payload(res).error, /safety boundaries/);
  }
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

async function executeScript(script, stream = true) {
  const runner = createShellRunner({ root: process.cwd(), enabled: true });
  const req = new MockRequest({ method: 'POST', token: runner.info.token, body: JSON.stringify({ script, stream }) });
  const res = new MockResponse();
  const completed = new Promise(resolve => res.once('finish', resolve));
  await runner.execute(req, res); await completed;
  return { res, events: stream && res.statusCode === 200 ? res.body.trim().split('\n').map(JSON.parse) : [] };
}

test('local script execution validates types, paths, size, and protected content', async () => {
  for (const script of [
    { filename: '../oops.py', content: 'print(1)' },
    { filename: 'x.py;echo', content: 'print(1)' },
    { filename: 'x.jac', content: '' },
    { filename: 'x.js', content: '界'.repeat(35_000) },
    { filename: 'x.js', content: null }
  ]) assert.equal((await executeScript(script)).res.statusCode, 400);
  assert.equal((await executeScript({ filename: 'x.py', content: 'open(".env")' })).res.statusCode, 403);
});

test('JavaScript script output streams before exit, distinguishes stderr, and cleans its temporary source', async () => {
  const runner = createShellRunner({ root: process.cwd(), enabled: true });
  const req = new MockRequest({ method: 'POST', token: runner.info.token, body: JSON.stringify({ stream: true, script: {
    filename: 'main.js', content: 'console.log("first"); console.error("warning"); setTimeout(() => console.log("last"), 150);'
  } }) });
  const res = new MockResponse();
  let early = false;
  res.on('chunk', raw => { if (JSON.parse(raw).type === 'stdout') { assert.equal(res.writableEnded, false); early = true; } });
  const completed = new Promise(resolve => res.once('finish', resolve));
  await runner.execute(req, res); await completed;
  const events = res.body.trim().split('\n').map(JSON.parse);
  const result = events.at(-1);
  assert.equal(res.headers['content-type'], 'application/x-ndjson; charset=utf-8');
  assert.equal(events[0].type, 'start');
  assert.ok(early);
  assert.ok(events.some(e => e.type === 'stderr' && e.text.includes('warning')));
  assert.equal(result.type, 'result'); assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'first\nlast\n');
  assert.notEqual(result.workspace, process.cwd());
  assert.equal(require('node:fs').existsSync(result.workspace), false);
});

test('Python executes a real script when the local interpreter is installed', async t => {
  const python = process.env.ELTES_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  if (require('node:child_process').spawnSync(python, ['--version']).status !== 0) return t.skip('Python not installed');
  const { events } = await executeScript({ filename: 'hello.py', content: 'print("Python result:", 6 * 7)' });
  assert.equal(events.at(-1).exitCode, 0);
  assert.match(events.at(-1).stdout, /Python result: 42/);
});

test('TypeScript executes erasable types on supported Node or returns an actionable version error', async () => {
  const { res, events } = await executeScript({ filename: 'hello.ts', content: 'const n: number = 42; console.log(n);' });
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || major === 22 && minor >= 18) {
    assert.equal(events.at(-1).exitCode, 0);
    assert.equal(events.at(-1).stdout, '42\n');
  } else { assert.equal(res.statusCode, 400); assert.match(payload(res).error, /22.18/); }
});

test('failed scripts report nonzero exit codes; runaway output is bounded', async () => {
  const failure = await executeScript({ filename: 'fail.js', content: 'console.error("expected failure"); process.exit(3);' });
  assert.equal(failure.events.at(-1).exitCode, 3);
  assert.match(failure.events.at(-1).stderr, /expected failure/);
  const flood = await executeScript({ filename: 'flood.js', content: 'while (true) console.log("x".repeat(1024));' });
  assert.equal(flood.events.at(-1).outputLimited, true);
  assert.ok(Buffer.byteLength(flood.events.at(-1).stdout) <= 32 * 1024);
});

test('disconnect cancels an executing script and removes its temporary directory', async () => {
  const fs = require('node:fs');
  const runner = createShellRunner({ root: process.cwd(), enabled: true });
  const req = new MockRequest({ method: 'POST', token: runner.info.token, body: JSON.stringify({ stream: true, script: {
    filename: 'wait.js', content: 'console.log("started"); setInterval(() => {}, 1000);'
  } }) });
  const res = new MockResponse();
  let workspace;
  const started = new Promise(resolve => res.on('chunk', raw => {
    const event = JSON.parse(raw);
    if (event.type === 'start') workspace = event.workspace;
    if (event.type === 'stdout') resolve();
  }));
  await runner.execute(req, res); await started;
  assert.ok(fs.existsSync(workspace));
  res.emit('close');
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const check = () => {
      if (!fs.existsSync(workspace)) return resolve();
      if (Date.now() > deadline) return reject(new Error('Temporary script not cleaned after cancellation'));
      setTimeout(check, 20);
    };
    check();
  });
  assert.equal(res.writableEnded, false, 'No result sent to disconnected client');
});

test('script timeout terminates an infinite loop and reports the actual deadline', { timeout: 35000 }, async () => {
  const { events } = await executeScript({ filename: 'loop.js', content: 'while (true) {}' });
  assert.equal(events.at(-1).timedOut, true);
  assert.notEqual(events.at(-1).exitCode, 0);
  assert.equal(require('node:fs').existsSync(events.at(-1).workspace), false);
});

test('desktop subprocesses retain Node mode without inheriting server secrets', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../tools/shell-runner.mjs'), 'utf8');
  const start = source.indexOf('function safeEnvironment(');
  const end = source.indexOf('\nasync function readJson', start);
  const desktop = vm.createContext({ process: { versions: { electron: '44.0.0' }, env: { PATH: '/bin', PRIVATE_SERVER_TOKEN: 'test-only', NODE_OPTIONS: '--require=untrusted' } } });
  vm.runInContext(source.slice(start, end), desktop);
  const env = desktop.safeEnvironment('/workspace', { electronNodeMode: true });
  assert.equal(desktop.safeEnvironment('/workspace').ELECTRON_RUN_AS_NODE, undefined, 'Shell/Python runs must not force Electron launches into Node mode');
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.PRIVATE_SERVER_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  const node = vm.createContext({ process: { versions: { node: '22.22.0' }, env: { ELECTRON_RUN_AS_NODE: '0' } } });
  vm.runInContext(source.slice(start, end), node);
  assert.equal(node.safeEnvironment('/workspace', { electronNodeMode: true }).ELECTRON_RUN_AS_NODE, undefined);
  assert.match(source, /nodeScript = extension === 'js' \|\| extension === 'ts'/);
  assert.match(source, /safeEnvironment\(root, \{ electronNodeMode: nodeScript \}\)/);
});
