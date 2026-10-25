const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('landing hero copy rotates accessibly and respects reduced motion', () => {
  const page = read('index.html');
  const script = read('assets/js/hero-text.js');
  const styles = read('assets/css/landing.css');

  assert.match(page, /class="visually-hidden">Keep your flow\.<\/span>/);
  assert.match(page, /id="heroRotatingLine"/);
  assert.match(page, /assets\/js\/hero-text\.js/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /Build with focus\./);
  assert.match(styles, /\.hero-word-live\.is-changing/);
  assert.match(styles, /\.hero-word-live \{ transition: none; \}/);
});

test('chat composer supports per-chat prompt history and safe text attachments', () => {
  const page = read('app.html');
  const script = read('assets/js/app.js');
  const docs = read('docs.html');

  assert.match(page, /browse this chat.s recent prompts/);
  assert.match(script, /function browsePromptHistory\(direction\)/);
  assert.match(script, /message\.role === 'user'/);
  assert.match(script, /e\.key === 'ArrowUp'/);
  assert.match(script, /e\.key === 'ArrowDown'/);
  assert.match(script, /file\.size > 400 \* 1024/);
  assert.match(script, /bytes > 800 \* 1024/);
  assert.match(docs, /browse prompts from this chat/);
  assert.match(docs, /inserted into the draft/);
});
