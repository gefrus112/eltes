/* Studio backend — path jail, workspace files, shell execution, preview map. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

let Studio;

test.before(async () => {
  Studio = await import('../tools/studio.mjs');
});

async function tempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'eltes-studio-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('normalizePath keeps safe relative paths and rejects escapes', () => {
  const { normalizePath } = Studio;
  assert.equal(normalizePath('index.html'), 'index.html');
  assert.equal(normalizePath('./a.css'), 'a.css');
  // any parent segment is refused, even when it would resolve back inside
  assert.equal(normalizePath('dir/../a.css'), null);
  assert.equal(normalizePath('deep/nested/file.js'), 'deep/nested/file.js');
  assert.equal(normalizePath('/leading/slash'), null);
  assert.equal(normalizePath('../outside.txt'), null);
  assert.equal(normalizePath('dir/../../escape'), null);
  assert.equal(normalizePath('C:\\Windows\\system32'), null);
  assert.equal(normalizePath('~/.bashrc'), null);
  assert.equal(normalizePath(''), null);
  assert.equal(normalizePath('.'), null);
  assert.equal(normalizePath(null), null);
});

test('resolveInside never leaves the workspace', () => {
  const { resolveInside } = Studio;
  const root = '/tmp/eltes-root';
  assert.equal(resolveInside(root, 'a/b.html'), join(root, 'a/b.html'));
  assert.equal(resolveInside(root, '..'), null);
  assert.equal(resolveInside(root, 'a/../../b'), null);
  assert.equal(resolveInside(root, '/etc/passwd'), null);
  assert.equal(resolveInside(root, '', { allowRoot: true }), root);
  assert.equal(resolveInside(root, ''), null);
});

test('seedWorkspace writes starter files once', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    const first = await Studio.seedWorkspace(dir);
    assert.equal(first.created, true);
    for (const name of ['index.html', 'styles.css', 'app.js', 'notes.md', 'README.txt']) {
      assert.ok(existsSync(join(dir, name)), `${name} exists`);
    }
    const index = await readFile(join(dir, 'index.html'), 'utf8');
    assert.match(index, /Eltes Studio/);

    await writeFile(join(dir, 'index.html'), 'custom', 'utf8');
    const second = await Studio.seedWorkspace(dir);
    assert.equal(second.created, false);
    assert.equal(await readFile(join(dir, 'index.html'), 'utf8'), 'custom');
  } finally {
    await cleanup();
  }
});

test('file API round-trips text and refuses binaries or escapes', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    const written = await Studio.writeProjectFile(dir, 'pages/about.html', '<h1>About</h1>');
    assert.equal(written.ok, true);
    const read = await Studio.readProjectFile(dir, 'pages/about.html');
    assert.equal(read.content, '<h1>About</h1>');

    const missing = await Studio.readProjectFile(dir, 'nope.html');
    assert.equal(missing.status, 404);

    const escape = await Studio.writeProjectFile(dir, '../evil.txt', 'x');
    assert.equal(escape.status, 400);

    const binary = await Studio.writeProjectFile(dir, 'shot.png', 'x');
    assert.equal(binary.ok, true);
    const refused = await Studio.readProjectFile(dir, 'shot.png');
    assert.equal(refused.status, 415);

    const deleted = await Studio.deleteProjectFile(dir, 'pages/about.html');
    assert.equal(deleted.ok, true);
    assert.equal(existsSync(join(dir, 'pages/about.html')), false);
  } finally {
    await cleanup();
  }
});

test('listTree marks text files and skips heavy folders', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    await writeFile(join(dir, 'index.html'), '<h1>x</h1>', 'utf8');
    await writeFile(join(dir, 'logo.svg'), '<svg/>', 'utf8');
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'assets/app.js'), '1', 'utf8');
    await mkdir(join(dir, 'node_modules/pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules/pkg/index.js'), '1', 'utf8');

    const tree = await Studio.listTree(dir);
    const byPath = Object.fromEntries(tree.map((entry) => [entry.path, entry]));
    assert.equal(byPath['index.html'].text, true);
    assert.equal(byPath['logo.svg'].text, true);
    assert.equal(byPath['assets/app.js'].text, true);
    assert.ok(byPath.assets.dir);
    assert.ok(byPath.node_modules.skipped);
    assert.equal(byPath['node_modules/pkg/index.js'], undefined);
    assert.ok(Number.isFinite(byPath['index.html'].mtime));
  } finally {
    await cleanup();
  }
});

test('runCommand streams stdout and reports the exit code', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    let out = '';
    let err = '';
    const handle = Studio.runCommand({
      root: dir,
      cmd: 'echo hello && echo oops >&2 && pwd',
      onData: (kind, text) => { if (kind === 'out') out += text; else err += text; }
    });
    const result = await handle.done;
    assert.equal(result.code, 0);
    assert.match(out, /hello/);
    assert.match(out, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(err, /oops/);
    assert.equal(result.error, null);
  } finally {
    await cleanup();
  }
});

test('runCommand stays inside the workspace and validates input', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    assert.equal(Studio.runCommand({ root: dir, cmd: '' }).error, 'Empty command');
    assert.equal(Studio.runCommand({ root: dir, cmd: 'x'.repeat(5000) }).status, 413);
    const escaped = Studio.runCommand({ root: dir, cmd: 'ls', cwd: '../..' });
    assert.equal(escaped.status, 400);

    let out = '';
    const handle = Studio.runCommand({
      root: dir,
      cmd: 'pwd',
      cwd: 'nested',
      onData: (kind, text) => { if (kind === 'out') out += text; }
    });
    // the nested dir does not exist yet, so the shell must fail, not wander
    const result = await handle.done;
    assert.notEqual(result.code, 0);
    assert.equal(out.trim(), '');

    await mkdir(join(dir, 'nested'), { recursive: true });
    let inner = '';
    const inside = Studio.runCommand({
      root: dir,
      cmd: 'pwd',
      cwd: 'nested',
      onData: (kind, text) => { if (kind === 'out') inner += text; }
    });
    await inside.done;
    assert.equal(inner.trim(), join(dir, 'nested'));
  } finally {
    await cleanup();
  }
});

test('runCommand kills a command that runs too long', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    const started = Date.now();
    let err = '';
    const handle = Studio.runCommand({
      root: dir,
      cmd: 'sleep 5; echo late',
      timeoutMs: 300,
      onData: (kind, text) => { if (kind === 'err') err += text; }
    });
    const result = await handle.done;
    assert.ok(Date.now() - started < 3000, 'killed promptly');
    assert.equal(result.killed, true);
    assert.match(err, /stopped after/);
  } finally {
    await cleanup();
  }
});

test('preview resolves html, nested files and directory indexes', async () => {
  const { dir, cleanup } = await tempWorkspace();
  try {
    await writeFile(join(dir, 'index.html'), '<h1>home</h1>', 'utf8');
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs/index.html'), '<h1>docs</h1>', 'utf8');
    await writeFile(join(dir, 'docs/page.html'), '<h1>page</h1>', 'utf8');

    assert.equal(await Studio.resolvePreviewFile(dir, ''), join(dir, 'index.html'));
    assert.equal(await Studio.resolvePreviewFile(dir, 'index.html'), join(dir, 'index.html'));
    assert.equal(await Studio.resolvePreviewFile(dir, 'docs/'), join(dir, 'docs/index.html'));
    assert.equal(await Studio.resolvePreviewFile(dir, 'docs/page.html'), join(dir, 'docs/page.html'));
    assert.equal(await Studio.resolvePreviewFile(dir, '../package.json'), null);
    assert.equal(await Studio.resolvePreviewFile(dir, 'missing.html'), null);
    assert.equal(await Studio.resolvePreviewFile(dir, 'docs'), join(dir, 'docs/index.html'));
  } finally {
    await cleanup();
  }
});

test('previewMime serves the right content types', () => {
  const { previewMime } = Studio;
  assert.match(previewMime('/x/index.html'), /text\/html/);
  assert.match(previewMime('/x/app.css'), /text\/css/);
  assert.match(previewMime('/x/app.js'), /javascript/);
  assert.match(previewMime('/x/data.json'), /application\/json/);
  assert.equal(previewMime('/x/shot.png'), 'image/png');
  assert.equal(previewMime('/x/blob.bin'), 'application/octet-stream');
});
