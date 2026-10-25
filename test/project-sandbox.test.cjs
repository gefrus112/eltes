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
