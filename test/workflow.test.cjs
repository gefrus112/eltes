/* Docs + Studio workflow contract — the guide and the written steps must agree. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = (name) => readFile(join(root, name), 'utf8');

test('docs describe the full build-a-website workflow', async () => {
  const docs = await read('docs.html');
  assert.match(docs, /<section id="workflow">/);
  assert.match(docs, /Workflow: build a website/);
  assert.match(docs, /href="#workflow"/, 'sidebar link exists');

  const steps = [...docs.matchAll(/<span class="ws-num">(\d)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ['1', '2', '3', '4', '5', '6']);

  for (const phrase of [
    'Open the workspace',
    'Start the terminal',
    'Create the files',
    'Preview while you edit',
    'Open the page on its own',
    'Build, then preview the build'
  ]) {
    assert.ok(docs.includes(phrase), `step "${phrase}" is written down`);
  }

  assert.match(docs, /npm run build/);
  assert.match(docs, /\/preview\/dist\/index\.html/);
  assert.match(docs, /href="studio\.html"/);
  assert.match(docs, /Ctrl<\/kbd>\/<kbd>⌘<\/kbd>\+<kbd>S/);
});

test('docs workflow links the guide to the same five actions', async () => {
  const [docs, studio] = await Promise.all([read('docs.html'), read('studio.html')]);
  const guideSteps = [...studio.matchAll(/data-wf-step="([a-z]+)"/g)].map((m) => m[1]);
  const guideActions = [...studio.matchAll(/data-wf-action="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(guideSteps, ['scaffold', 'terminal', 'create', 'preview', 'open']);
  assert.deepEqual(guideActions, ['scaffold', 'terminal', 'create', 'preview', 'open']);
  assert.match(docs, /<strong>Guide<\/strong>/);
});

test('the guide and docs cover the starter build script', async () => {
  const [docs, studioHtml, studioJs] = await Promise.all([
    read('docs.html'), read('studio.html'), read('assets/js/studio.js')
  ]);
  assert.match(studioHtml, /build\.mjs/);
  assert.match(docs, /build\.mjs/);

  // The scaffold must create a valid package.json (".studio" is not a legal
  // npm name) and a dependency-free build script that writes dist/.
  assert.match(studioJs, /"name": "eltes-starter-site"/);
  assert.match(studioJs, /"build": "node build\.mjs"/);
  assert.match(studioJs, /await mkdir\('dist'/);
  assert.match(studioJs, /await rm\('dist'/);

  // Every workflow step is marked by a real action, not a timer.
  for (const step of ['scaffold', 'terminal', 'create', 'preview', 'open']) {
    assert.match(studioJs, new RegExp(`markWorkflow\\('${step}'\\)`), `${step} is marked`);
  }
});

test('README points at Studio and the workflow', async () => {
  const readme = await read('README.md');
  assert.match(readme, /studio\.html/);
  assert.match(readme, /npm run build|terminal/);
  assert.match(readme, /\.studio\//);
});
