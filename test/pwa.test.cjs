const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Chromebook download card exposes Chrome PWA installation and browser fallback instructions', () => {
  const page = read('index.html');
  const docs = read('docs.html');
  assert.match(page, /Chromebook · ChromeOS/);
  assert.match(page, /id="installPwaBtn"/);
  assert.match(page, /Install page as app/);
  assert.match(docs, /Install on a Chromebook/);
  assert.match(docs, /cannot run Chromebook terminal commands itself/);
});

test('PWA manifest supports standalone ChromeOS installation and launcher shortcuts', () => {
  const manifest = JSON.parse(read('site.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './app.html');
  for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some((icon) => icon.sizes === size));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === './app.html'));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === './video.html'));
  assert.match(read('.github/workflows/pages.yml'), /site\.webmanifest/);
  assert.match(read('tools/build-windows.sh'), /site\.webmanifest/);
});

test('install CTA uses the browser PWA prompt only when available', () => {
  const site = read('assets/js/site.js');
  assert.match(site, /beforeinstallprompt/);
  assert.match(site, /installPrompt\.prompt\(\)/);
  assert.match(site, /appinstalled/);
});
