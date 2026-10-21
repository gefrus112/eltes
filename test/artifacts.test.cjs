const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Artifacts = require('../assets/js/artifacts.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('file artifact builder accepts safe names and returns a text download without writing or executing it', () => {
  const artifact = Artifacts.prepare({ filename: 'site-index.html', content: '<h1>Hello</h1>' });
  assert.deepEqual(artifact, {
    filename: 'site-index.html',
    content: '<h1>Hello</h1>',
    size: 14,
    mime: 'text/html'
  });
  assert.throws(() => Artifacts.prepare({ filename: '../startup.sh', content: 'echo unsafe' }), /filename/);
  assert.throws(() => Artifacts.prepare({ filename: 'folder\\app.js', content: 'alert(1)' }), /filename/);
  assert.throws(() => Artifacts.prepare({ filename: 'CON.txt', content: 'reserved' }), /filename/);
  assert.throws(() => Artifacts.prepare({ filename: 'large.txt', content: 'x'.repeat(Artifacts.MAX_FILE_BYTES + 1) }), /100 KiB/);
  assert.doesNotMatch(read('assets/js/artifacts.js'), /child_process|execSync|spawn\(/);
});

test('agent only stores an approved artifact and exposes a download control', () => {
  const app = read('assets/js/app.js');
  const page = read('app.html');
  const docs = read('docs.html');
  assert.match(app, /requestArtifactApproval\(file\)/);
  assert.match(app, /artifact: file/);
  assert.match(app, /data-download-artifact/);
  assert.match(app, /download\(artifactTool\.artifact\.filename, artifactTool\.artifact\.content/);
  assert.match(page, /id="artifactApprovalDialog"/);
  assert.match(page, /id="approveArtifactBtn"/);
  assert.match(docs, /Commands are never run by the browser/);
  assert.match(docs, /inspect and run suggested terminal commands yourself/);
});
