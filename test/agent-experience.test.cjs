const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('per-chat agent instructions are bounded, saved locally, and included in hosted model prompts', () => {
  const page = read('app.html');
  const app = read('assets/js/app.js');
  const docs = read('docs.html');

  assert.match(page, /id="agentInstructionsBtn"/);
  assert.match(page, /id="agentInstructionsInput"[^>]*maxlength="2000"/);
  assert.match(page, /not applied to the on-device Eltes CAI helper/);
  assert.match(app, /instructions: typeof c\.instructions === 'string' \? c\.instructions\.slice\(0, 2000\)/);
  assert.match(app, /chat\.instructions = \$\('#agentInstructionsInput'\)\.value\.trim\(\)\.slice\(0, 2000\)/);
  assert.match(app, /function systemPromptFor\(chat\)/);
  assert.match(app, /content: systemPrompt/);
  assert.match(app, /system: systemPrompt \|\| SYSTEM_PROMPT/);
  assert.match(docs, /per-chat preferences for hosted models/);
});

test('long conversations expose a jump-to-latest control only when scrolled away', () => {
  const page = read('app.html');
  const app = read('assets/js/app.js');
  const styles = read('assets/css/app.css');
  const docs = read('docs.html');

  assert.match(page, /id="jumpToLatest"[^>]*hidden/);
  assert.match(app, /function updateJumpToLatest\(\)/);
  assert.match(app, /button\.hidden = !hasConversation \|\| !overflow \|\| !awayFromLatest/);
  assert.match(app, /els\.thread\.scrollTo\(\{ top: els\.thread\.scrollHeight, behavior:/);
  assert.match(styles, /\.jump-latest\[hidden\] \{ display: none; \}/);
  assert.match(docs, /use <strong>Latest<\/strong> to jump back/);
});
