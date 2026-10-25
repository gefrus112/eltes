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
  assert.match(app, /requiresPlan && !hasUpfrontPlan\(assistant\.content\)/);
  assert.match(app, /function normalizeAgentContext\(value\)/);
  assert.match(app, /function recordAgentContext\(chat, action, filename\)/);
  assert.match(app, /Local context notes for this conversation/);
  assert.match(app, /never open, read, reveal, copy, modify, or execute commands targeting \.env files/i);
  assert.match(html, /id="agentInstructionsBtn"/);
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
  assert.match(app, /}, 8000\)/);
  assert.match(html, /id="jsSandboxFrame"[^>]*sandbox="allow-scripts"/);
  assert.doesNotMatch(html.match(/id="jsSandboxFrame"[^>]*>/)[0], /allow-same-origin/);
  assert.match(html, /Run reviewed code/);
});

test('chat workspace uses black surfaces and honors reduced-motion preferences', () => {
  const css = read('assets/css/app.css');
  assert.match(css, /body\.app \.thread \{ background: #000/);
  assert.match(css, /body\.app \.composer \{ background: #080808/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*body\.app/);
});
