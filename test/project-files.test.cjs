const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
let createProjectFiles;
test.before(async () => { ({ createProjectFiles } = await import('../tools/project-files.mjs')); });
async function fixture(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eltes-files-test-'));
  try { await run(createProjectFiles(path.join(dir, '.studio')), dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
test('persistent project creates nested source, lists recursively and rejects stale writes', () => fixture(async (files, dir) => {
  assert.equal((await files.snapshot('src/main.js')).exists, false);
  await files.write('src/main.js', 'const n = 1;', null);
  const before = await files.snapshot('src/main.js');
  assert.equal(before.content, 'const n = 1;');
  assert.deepEqual((await files.list()).files, ['src/main.js']);
  await files.write('src/main.js', 'const n = 2;', before.version);
  await assert.rejects(files.write('src/main.js', 'stale', before.version), /changed/);
  await assert.rejects(files.write('src/main.js', 'no version', undefined), /changed/);
  assert.equal(await fs.readFile(path.join(dir, '.studio/src/main.js'), 'utf8'), 'const n = 2;');
  assert.deepEqual(await fs.readdir(path.join(dir, '.studio/src')), ['main.js']);
}));
test('project rejects traversal, protected paths, unsupported/binary files and oversized source', () => fixture(async files => {
  for (const name of ['../outside.js', '/tmp/out.js', '.env', 'src/.git/config', 'src/secrets.json', 'src\\a.js', 'CON.js', 'a.exe', 'a//b.js', 'a/../b.js']) await assert.rejects(files.snapshot(name), /path|source\/text/);
  await assert.rejects(files.write('huge.js', '界'.repeat(35000), null), /100 KB/);
  await assert.rejects(files.write('binary.txt', '\0', null), /100 KB/);
}));
test('project refuses file and directory symlinks; list excludes dependency and hidden trees', () => fixture(async (files, dir) => {
  await files.write('ok.js', 'ok', null);
  await fs.writeFile(path.join(dir, 'outside.js'), 'outside');
  await fs.symlink(path.join(dir, 'outside.js'), path.join(dir, '.studio/link.js'));
  await fs.symlink(dir, path.join(dir, '.studio/escape'), 'dir');
  for (const name of ['link.js', 'escape/outside.js']) {
    await assert.rejects(files.snapshot(name), /Symbolic/);
    await assert.rejects(files.write(name, 'bad', null), /Symbolic/);
  }
  await fs.mkdir(path.join(dir, '.studio/node_modules')); await fs.writeFile(path.join(dir, '.studio/node_modules/skip.js'), 'skip');
  await fs.writeFile(path.join(dir, '.studio/.hidden.js'), 'skip');
  assert.deepEqual((await files.list()).files, ['ok.js']);
  assert.equal(await fs.readFile(path.join(dir, 'outside.js'), 'utf8'), 'outside');
}));
