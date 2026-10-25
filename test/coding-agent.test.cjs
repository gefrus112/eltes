'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('agent requires a visible plan before any mutating tool and carries bounded local context', () => {
  const app = read('assets/js/app.js');
  const html = read('app.html');
  assert.match(app, /headed exactly \*\*Plan:\*\*/);
  assert.match(app, /function hasUpfrontPlan\(text\)/);
  const planGate = app.match(/function hasUpfrontPlan\(text\) \{\s*return (\/[^\n]+\/i)\.test/);
  assert.ok(planGate, 'the visible-plan gate must have an inspectable heading pattern');
  const planRegexEnd = planGate[1].lastIndexOf('/');
  const planRegex = new RegExp(planGate[1].slice(1, planRegexEnd), planGate[1].slice(planRegexEnd + 1));
  assert.ok(planRegex.test('Plan: inspect files and verify changes.'));
  assert.ok(planRegex.test('**Plan:** inspect files and verify changes.'));
  assert.match(app, /needsPlan && !hasUpfrontPlan\(assistant\.content\)/);
  assert.match(app, /function normalizeAgentContext\(value\)/);
  assert.match(app, /function recordAgentContext\(chat, action, filename\)/);
  assert.match(app, /Local context hints/);
  assert.match(app, /Never read, reveal, copy, modify, or run commands against \.env files/i);
  assert.match(html, /id="agentChip"/);
});

test('workspace writes are per-file reviewed and protected paths are filtered', () => {
  const app = read('assets/js/app.js');
  const html = read('app.html');
  assert.match(app, /function isProtectedWorkspaceFile\(name\)/);
  assert.match(app, /PROTECTED_WORKSPACE_BASENAMES/);
  assert.match(app, /selectedWorkspaceDirectory\.entries\(\)/);
  assert.match(app, /handle\.createWritable\(\)/);
  assert.match(app, /requestWorkspaceWriteApproval\(fileEntry, previous, content\)/);
  assert.match(html, /Reading only adds contents to your draft/);
  assert.match(html, /id="workspaceWriteBefore"/);
  assert.match(html, /id="workspaceWriteAfter"/);
  assert.match(html, /Approve this file write/);
});

test('JavaScript runner is isolated, network-restricted, time-limited, and opt-in per snippet', () => {
  const app = read('assets/js/app.js');
  const html = read('app.html');
  assert.match(app, /data-run-js/);
  assert.match(app, /showJavaScriptSandbox/);
  assert.match(app, /connect-src 'none'/);
  assert.match(app, /worker-src blob:/);
  assert.match(app, /new Worker\(workerUrl\)/);
  assert.doesNotMatch(app, /new Function\(/);
  assert.match(app, /frame\.srcdoc = `<!doctype html/);
  assert.match(app, /const limitMs = includeTfjs \? 30_000 : 8_000/);
  assert.match(html, /id="jsSandboxFrame"[^>]*sandbox="allow-scripts"/);
  assert.doesNotMatch(html.match(/id="jsSandboxFrame"[^>]*>/)[0], /allow-same-origin/);
  assert.match(html, /Run reviewed code/);
  assert.match(html, /id="jsSandboxTfjs"/);
  assert.match(html, /id="jsSandboxModelFiles"/);
  assert.match(app, /jsSandboxTfjs/);
  assert.match(app, /loadLocalGraphModel/);
  assert.match(app, /loadLocalLayersModel/);
  assert.match(app, /tf\.io\.browserFiles\(modelFiles\)/);
  const tfjs = read('assets/js/vendor/tf.min.js');
  assert.ok(tfjs.length > 1_000_000, 'bundled TensorFlow.js runtime is present');
  assert.match(read('assets/js/vendor/TENSORFLOW-JS-LICENSE.txt'), /Apache License/);
});

test('Jac files and fences are recognized without pretending to execute Jac', () => {
  const app = read('assets/js/app.js');
  const html = read('app.html');
  const highlighter = read('assets/js/highlighter.js');
  assert.match(app, /jaclang:/);
  assert.match(highlighter, /JAC_KEYWORDS/);
  assert.match(html, /\.jac/);
  assert.match(highlighter, /jac|jaclang/i);
  assert.doesNotMatch(app, /runJac|executeJac|JacRuntime/);
});

test('chat workspace uses black surfaces and honors reduced-motion preferences', () => {
  const css = read('assets/css/app.css');
  assert.match(css, /body\.app \.thread \{ background: #000/);
  assert.match(css, /body\.app \.composer \{ background: #080808/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*body\.app/);
});

test('developer workflow instructions preserve native tools, approvals and honest isolation claims', () => {
  const vm = require('node:vm');
  const app = read('assets/js/app.js');
  const start = app.indexOf('  const SYSTEM_PROMPT = [');
  const end = app.indexOf('\n  function recordAgentContext', start);
  const context = vm.createContext({});
  vm.runInContext(app.slice(start, end) + '\nthis.prompt = SYSTEM_PROMPT;', context);
  for (const text of ['inspect, plan, edit, verify, report', '**Plan:**', '**Action:**', '**Result:**', 'native tool calls', 'four provider/tool rounds', 'Never bypass the application approval dialogs', 'not complete network or resource isolation', 'A working directory does not isolate', 'not .studio/', 'not private chain-of-thought', 'untrusted task data']) assert.ok(context.prompt.includes(text), text);
  assert.match(app, /const available = useTools && enabledToolDefs\(\)\.some/);
  assert.match(app, /is_error: !!assistant\.tools\.find/);
});

test('round-limit notice distinguishes successful calls from verification and exposes failures', () => {
  const vm = require('node:vm');
  const app = read('assets/js/app.js');
  const start = app.indexOf('  const MAX_TOOL_ROUNDS = 4;');
  const end = app.indexOf('  async function runTurn', start);
  const context = vm.createContext({});
  vm.runInContext(app.slice(start, end), context);
  const notice = context.toolRoundLimitNotice([{ status: 'done', error: false }, { status: 'done', error: true }, { status: 'running' }]);
  assert.match(notice, /4-round tool limit/);
  assert.match(notice, /1 tool call\(s\) completed/);
  assert.match(notice, /1 failed/);
  assert.match(notice, /does not verify the whole application/);
  assert.match(notice, /no further action runs automatically/);
});
