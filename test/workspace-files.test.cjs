const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('file browsing is limited to a user-selected read-only folder and reviewed draft content', () => {
  const html = read('app.html');
  const app = read('assets/js/app.js');
  const docs = read('docs.html');
  assert.match(html, /id="workspaceFilesDialog"/);
  assert.match(html, /id="chooseWorkspaceFolderBtn"/);
  assert.match(html, /nothing is sent to a model until you press Send/i);
  assert.match(app, /showDirectoryPicker\(\{ mode: 'read' \}\)/);
  assert.match(app, /for await \(const \[name, handle\] of selectedWorkspaceDirectory\.entries\(\)\)/);
  assert.match(app, /found\.length >= 80/);
  assert.match(app, /await attachFiles\(\[file\]\)/);
  assert.match(app, /Folder disconnected\. Access is cleared for this tab\./);
  assert.match(docs, /not recursive and does not grant access to the rest of the device/);
  assert.doesNotMatch(app, /localStorage\.(setItem|getItem).*WorkspaceDirectory|sessionStorage\.(setItem|getItem).*WorkspaceDirectory/i);
});

test('terminal guidance does not claim hosted-PWA access or attachment to an existing session', () => {
  const html = read('app.html');
  const docs = read('docs.html');
  assert.match(html, /does not attach to or read an existing terminal session/i);
  assert.match(docs, /does not attach to or read an existing Terminal session/i);
  assert.match(docs, /installed hosted PWA uses the same origin as the website and cannot run Chromebook terminal commands itself/i);
  assert.match(html, /python3 --version/);
  assert.match(html, /not an interactive Python session/);
  assert.match(docs, /Python commands work only if Python is installed in the same Linux environment/);
});
