'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FIXED_NOW = new Date('2026-10-20T12:00:00Z');

function loadAgent(options = {}) {
  const window = {};
  const context = { window, console, Intl, Date, performance: { now: () => 0 } };
  for (const file of ['models.js', 'cai.js', 'agent.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js', file), 'utf8'), context);
  }
  return window.EltesAgent.create(Object.assign({
    cai: window.EltesCAI,
    now: () => FIXED_NOW
  }, options));
}

const agent = loadAgent();

test('exposes the shared tool registry', () => {
  assert.equal(
    agent.tools().join(','),
    'calculate,convert_units,percent,date_math,current_time,search_history'
  );
  const defs = agent.toolDefs();
  assert.equal(defs.length, agent.tools().length);
  for (const def of defs) {
    assert.equal(typeof def.description, 'string');
    assert.equal(def.parameters.type, 'object');
  }
});

test('runs arithmetic through the engine instead of the model', () => {
  const out = agent.runLocal('2 + 3 * 4', {});
  assert.equal(out.intent, 'agent');
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].name, 'calculate');
  assert.equal(out.steps[0].result, '14');
  assert.match(out.text, /\*\*14\*\*/);
});

test('converts units and temperatures', () => {
  const miles = agent.runLocal('12 km to miles', {});
  assert.equal(miles.steps[0].name, 'convert_units');
  assert.equal(miles.steps[0].result, '7.4564543068 miles');

  const celsius = agent.runLocal('100 f to c', {});
  assert.equal(celsius.steps[0].name, 'convert_units');
  assert.equal(celsius.steps[0].result, '37.7777777778 °C');
});

test('rejects incompatible units instead of inventing a number', () => {
  const out = agent.run('convert_units', { value: 3, from: 'kg', to: 'km' });
  assert.equal(out.error, true);
  assert.match(out.result, /not compatible units/i);
});

test('handles percentages in all three modes', () => {
  const share = agent.runLocal('15% of 240', {});
  assert.equal(share.steps[0].name, 'percent');
  assert.equal(share.steps[0].result, '36');

  const discount = agent.runLocal('20% off 80', {});
  assert.equal(discount.steps[0].result, '64');

  const change = agent.runLocal('percentage change from 40 to 55', {});
  assert.equal(change.steps[0].result, '37.5%');
});

test('does calendar arithmetic on ISO dates', () => {
  const between = agent.runLocal('days between 2026-01-01 and 2026-10-20', {});
  assert.equal(between.steps[0].name, 'date_math');
  assert.equal(between.steps[0].result, '292 days');

  const weekday = agent.runLocal('what day is 2026-10-20', {});
  assert.equal(weekday.steps[0].result, 'Tuesday');

  const until = agent.runLocal('days until 2026-12-25', {});
  assert.equal(until.steps[0].result, '66 days');
});

test('chains a follow-up step onto the previous result', () => {
  const out = agent.runLocal('2 + 3 * 4 then multiply by 3', {});
  assert.equal(out.steps.length, 2);
  assert.equal(out.steps[0].result, '14');
  assert.equal(out.steps[1].name, 'calculate');
  assert.equal(out.steps[1].result, '42');
});

test('falls back to the CAI router when no tool applies', () => {
  const out = agent.runLocal('hello there', {});
  assert.equal(out.intent, 'cai');
  assert.equal(out.steps.length, 0);
  assert.equal(out.text, '');
});

test('refuses live questions without fabricating an answer', () => {
  const reply = agent.runLocal('what is the weather in Boston', {});
  assert.equal(reply.intent, 'cai');
  assert.equal(reply.steps.length, 0);
  const routed = agent.runLocal('what is the weather in Boston', {});
  assert.equal(routed.steps.length, 0);
  // The CAI refusal is what the workspace renders for this prompt.
  const cai = loadAgent();
  const refusal = cai.runLocal('what is the weather in Boston', {});
  assert.equal(refusal.steps.length, 0);
});

test('uses the conversation search hook only when one is provided', () => {
  const withHistory = loadAgent({ searchHistory: (query) => `Found a chat about ${query}.` });
  const hit = withHistory.runLocal('what did we say earlier about the proxy', {});
  assert.equal(hit.steps[0].name, 'search_history');
  assert.match(hit.steps[0].result, /Found a chat about/);

  const withoutHistory = agent.runLocal('what did we say earlier about the proxy', {});
  assert.equal(withoutHistory.steps[0].name, 'search_history');
  assert.equal(withoutHistory.steps[0].error, true);
  assert.match(withoutHistory.steps[0].result, /only available inside the Eltes workspace/i);
});

test('records a trace for every tool call', () => {
  const out = agent.runLocal('5 kg in lb', {});
  const step = out.steps[0];
  assert.equal(step.name, 'convert_units');
  assert.equal(step.args.value, 5);
  assert.equal(step.args.from, 'kg');
  assert.equal(step.args.to, 'lb');
  assert.equal(step.error, false);
  assert.equal(typeof step.runtime, 'number');
});

test('the agent never reaches for the network', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/js/agent.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
  assert.doesNotMatch(source, /WebSocket/);
});
