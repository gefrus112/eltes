'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateFile } = require('../assets/js/project-sandbox.js');
const app = fs.readFileSync(require.resolve('../assets/js/app.js'), 'utf8');

test('virtual project accepts plain source files and bounds UTF-8 content', () => {
  for (const filename of ['index.html', 'app.js', 'styles.css', 'notes.md', 'agent.jac']) {
    assert.deepEqual(validateFile(filename, 'hello'), { filename, content: 'hello' });
  }
  for (const filename of ['../outside.js', '/tmp/a.js', '.env', 'production.json', 'credentials.json', 'nested/a.js', 'x\\a.js', 'package.json', 'vercel.json']) {
    assert.throws(() => validateFile(filename, 'no'));
  }
  assert.throws(() => validateFile('a.js', '界'.repeat(35_000)), /100 KB/);
  assert.throws(() => validateFile('a.js', null));
});

function extractFunction(name) {
  const start = app.indexOf(`  function ${name}(`);
  const end = app.indexOf('\n  }', start);
  assert.ok(start > 0 && end > start);
  return app.slice(start, end + 4);
}
test('visible plan headings actually match, not merely their source spelling', () => {
  const context = vm.createContext({});
  vm.runInContext(extractFunction('hasUpfrontPlan'), context);
  for (const text of ['Plan: write index.html', '**Plan:** write index.html', '**Plan**: write index.html', '## Plan: inspect']) assert.equal(context.hasUpfrontPlan(text), true);
  for (const text of ['', 'I have a plan', 'No action needed']) assert.equal(context.hasUpfrontPlan(text), false);
});

test('protected path checks execute for secret and deployment filenames', () => {
  const context = vm.createContext({});
  const start = app.indexOf('  const PROTECTED_WORKSPACE_BASENAMES');
  const end = app.indexOf('  let selectedWorkspaceDirectory', start);
  vm.runInContext(app.slice(start, end), context);
  for (const file of ['.env', '.env.local', 'x/private.key', 'C:\\keys\\id_rsa', 'credentials.json', 'production.yaml', 'vercel.json']) assert.equal(context.isProtectedWorkspaceFile(file), true, file);
  for (const file of ['index.html', 'main.js', 'README.md', 'agent.jac']) assert.equal(context.isProtectedWorkspaceFile(file), false, file);
});

test('project writes require model-visible planning and individual review before saving', () => {
  const source = fs.readFileSync(require.resolve('../assets/js/project-sandbox.js'), 'utf8');
  assert.match(app, /call\.name === 'write_project_file'/);
  assert.match(source, /if \(!await review\(file\)\)/);
  assert.ok(source.indexOf('if (!await review(file))') < source.indexOf('files[file.filename] = file.content'));
  assert.match(source, /if \(stopped\(\)\)/);
  assert.match(source, /connect-src 'none'/);
  const html = fs.readFileSync(require.resolve('../app.html'), 'utf8');
  const frame = html.match(/<iframe id="projectSandboxPreview"[^>]*>/)[0];
  assert.match(frame, /sandbox="allow-scripts"/);
  assert.doesNotMatch(frame, /allow-same-origin|allow-popups|allow-top-navigation/);
});

test('declining a workspace write never opens a writable handle', async () => {
  let writes = 0;
  const handle = { kind: 'file', getFile: async () => ({ size: 3, text: async () => 'old' }), createWritable: async () => { writes++; throw new Error('Must never run'); } };
  const context = vm.createContext({
    TextEncoder, selectedWorkspaceDirectory: {}, workspaceFileEntries: [{ name: 'a.js', handle }],
    activeChat: () => ({}), isProtectedWorkspaceFile: () => false,
    requestWorkspaceWriteApproval: async () => false, state: { stopped: false }
  });
  const start = app.indexOf('  async function writeWorkspaceFile(');
  const end = app.indexOf('\n  function isProtectedShellCommand', start);
  vm.runInContext(app.slice(start, end), context);
  const result = await context.writeWorkspaceFile({ filename: 'a.js', content: 'new' });
  assert.match(result.error, /declined/);
  assert.equal(writes, 0);
});

test('project supports Python and TypeScript files but never executable paths', () => {
  for (const filename of ['main.py', 'main.ts', 'HELLO.PY']) assert.equal(validateFile(filename, 'code').filename, filename);
  for (const filename of ['../main.py', 'nested/main.ts', 'main.py;echo']) assert.throws(() => validateFile(filename, 'code'));
});

test('streamed drafts decode partial escaped JSON without inventing missing source', () => {
  const { partialField } = require('../assets/js/project-sandbox.js');
  const raw = JSON.stringify({ filename: 'main.py', content: 'print("hello")\n# 界\\path\t' });
  assert.equal(partialField(raw, 'filename'), 'main.py');
  assert.equal(partialField(raw, 'content'), 'print("hello")\n# 界\\path\t');
  assert.equal(partialField('{"content":"first\\nsecond\\u00', 'content'), 'first\nsecond');
  assert.equal(partialField('{"filename":', 'filename'), '');
  assert.equal(partialField('{"content":"<script>alert(1)</script>', 'content'), '<script>alert(1)</script>');
});

test('runner client decodes arbitrarily chunked UTF-8 NDJSON and requires final status', async () => {
  const { readRunnerResponse } = require('../assets/js/project-sandbox.js');
  const raw = [
    { type: 'start', command: 'test' }, { type: 'stdout', text: '界\n' },
    { type: 'stderr', text: 'warning' }, { type: 'result', exitCode: 0, stdout: '界\n' }
  ].map(JSON.stringify).join('\n');
  const bytes = new TextEncoder().encode(raw);
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } }), { headers: { 'content-type': 'application/x-ndjson' } });
  const events = [];
  assert.equal((await readRunnerResponse(response, event => events.push(event))).exitCode, 0);
  assert.equal(events[1].text, '界\n');
  for (const [body, pattern] of [
    ['{"type":"stdout","text":"incomplete"}\n', /disconnected/],
    ['{"type":"error","error":"missing runtime"}\n', /missing runtime/]
  ]) await assert.rejects(readRunnerResponse(new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }), () => {}), pattern);
  await assert.rejects(readRunnerResponse(new Response('{"error":"disabled"}', { status: 404 }), () => {}), /disabled/);
});

test('denied project drafts never become runnable; execution receives only a saved immutable snapshot', async () => {
  const { create } = require('../assets/js/project-sandbox.js');
  const nodes = new Map();
  const node = () => ({ textContent: '', value: '', classList: { add() {} }, setAttribute() {}, addEventListener() {}, replaceChildren() {}, append() {}, show() { this.open = true; } });
  const original = global.document;
  global.document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node };
  let approved = false, executed;
  try {
    const project = create({ download() {}, review: async () => approved, stopped: () => false,
      runScript: async file => { executed = file; return { result: '42' }; }, runJavaScript() {}, stopTask() {} });
    assert.match((await project.run({ filename: 'main.py', content: 'print(42)' })).error, /declined/);
    assert.match((await project.execute({ filename: 'main.py' })).error, /Save/);
    assert.equal(executed, undefined);
    approved = true;
    await project.run({ filename: 'main.py', content: 'print(42)' });
    assert.equal((await project.execute({ filename: 'main.py' })).result, '42');
    assert.deepEqual(executed, { filename: 'main.py', content: 'print(42)' });
    nodes.get('projectSandboxEditor').value = 'print(99)';
    assert.deepEqual(executed, { filename: 'main.py', content: 'print(42)' });
    await nodes.get('projectSandboxScript').onclick();
    assert.match(nodes.get('projectSandboxStatus').textContent, /Save your edits/);
  } finally { global.document = original; }
});

test('denied local execution never makes a network request', async () => {
  let fetches = 0;
  const context = vm.createContext({
    AbortController, clearTimeout, setTimeout,
    state: { shellToken: 'fixture', shellRunnerInfo: { workspace: '/test' }, sending: false },
    PROJECT: { log() {} }, isProtectedShellCommand: () => false,
    requestShellApproval: async () => false,
    fetch: () => { fetches++; throw new Error('Must not fetch'); }
  });
  const start = app.indexOf('  let activeLocalExecution = null;');
  const end = app.indexOf('  function renderLocalShellStatus', start);
  vm.runInContext(app.slice(start, end), context);
  const out = await context.runApprovedLocalShell({}, { filename: 'test.py', content: 'print(1)' });
  assert.match(out.error, /declined/);
  assert.equal(fetches, 0);
});

test('precise replacements reject stale or ambiguous source and preserve unrelated text', () => {
  const { replaceExact } = require('../assets/js/project-sandbox.js');
  assert.equal(replaceExact('before\nconst n = 1;\nafter', 'const n = 1;', 'const n = 2;'), 'before\nconst n = 2;\nafter');
  assert.equal(replaceExact('ab', 'a', ''), 'b');
  assert.throws(() => replaceExact('aaa', 'aa', 'x'), /ambiguous/);
  assert.throws(() => replaceExact('code', '', 'x'), /nonempty/);
  assert.throws(() => replaceExact('code', 'absent', 'x'), /not found/);
});

test('project reads need consent, patches need review, unsaved and racing edits are preserved', async () => {
  const { create } = require('../assets/js/project-sandbox.js');
  const nodes = new Map();
  const node = () => ({ textContent: '', value: '', classList: { add() {} }, setAttribute() {}, addEventListener() {}, replaceChildren() {}, append() {}, show() { this.open = true; } });
  const original = global.document;
  global.document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node };
  let allowedRead = false, allowedWrite = true, reviewHook = () => {}, reviews = 0;
  try {
    const project = create({ download() {}, review: async () => { reviews++; reviewHook(); return allowedWrite; },
      readReview: async () => allowedRead, stopped: () => false, runScript() {}, runJavaScript() {}, stopTask() {} });
    await project.run({ filename: 'main.js', content: 'const n = 1;' });
    assert.match((await project.read({ filename: 'main.js' })).error, /declined/);
    allowedRead = true;
    assert.equal(JSON.parse((await project.read({ filename: 'main.js' })).result).content, 'const n = 1;');
    allowedWrite = false;
    assert.match((await project.patch({ filename: 'main.js', search: 'n = 1', replacement: 'n = 2' })).error, /declined/);
    assert.equal(JSON.parse((await project.read({ filename: 'main.js' })).result).content, 'const n = 1;');
    allowedWrite = true;
    nodes.get('projectSandboxEditor').value = 'unsaved work';
    const before = reviews;
    assert.match((await project.patch({ filename: 'main.js', search: 'n = 1', replacement: 'n = 2' })).error, /unsaved/);
    assert.equal(reviews, before, 'Dirty file blocked before approval');
    assert.equal(JSON.parse(project.list().result)[0].unsaved, true);
    assert.match((await project.execute({ filename: 'main.js' })).error, /unsaved/);
    nodes.get('projectSandboxRun').onclick();
    assert.match(nodes.get('projectSandboxStatus').textContent, /before previewing/);
    nodes.get('projectSandboxDownload').onclick();
    assert.match(nodes.get('projectSandboxStatus').textContent, /before downloading/);
    await project.run({ filename: 'other.js', content: 'other file' });
    assert.equal(nodes.get('projectSandboxEditor').value, 'unsaved work', 'Adding another file does not discard active edits');
    nodes.get('projectSandboxDiscard').onclick();
    reviewHook = () => { nodes.get('projectSandboxEditor').value = 'changed during review'; };
    assert.match((await project.patch({ filename: 'main.js', search: 'n = 1', replacement: 'n = 2' })).error, /during review/);
    reviewHook = () => {};
    nodes.get('projectSandboxDiscard').onclick();
    assert.ok((await project.patch({ filename: 'main.js', search: 'n = 1', replacement: 'n = 2' })).result);
    assert.equal(JSON.parse((await project.read({ filename: 'main.js' })).result).content, 'const n = 2;');
  } finally { global.document = original; }
});
