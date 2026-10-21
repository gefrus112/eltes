'use strict';

// The on-device agent: registry shape, planning, tool results and the promise
// that nothing in it can reach the network.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadAgent(hooks) {
  const context = { window: {}, console };
  context.globalThis = context;
  context.setTimeout = setTimeout;
  context.clearTimeout = clearTimeout;
  for (const file of ['assets/js/models.js', 'assets/js/cai.js', 'assets/js/agent.js']) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInNewContext(code, context, { filename: file });
  }
  const agent = context.window.EltesAgent;
  const instance = agent.create(Object.assign({
    cai: context.window.EltesCAI,
    now: () => new Date('2026-10-20T12:00:00Z')
  }, hooks || {}));
  return { agent, instance, cai: context.window.EltesCAI };
}

test('exposes a seven-tool registry with JSON-schema parameters', () => {
  const { instance } = loadAgent();
  const names = instance.tools().map((tool) => tool.name).join(',');
  assert.equal(names, 'calculate,convert_units,percentage,date_math,current_time,search_history');
  for (const def of instance.toolDefs()) {
    assert.ok(def.description.length > 20, `${def.name} has a description`);
    assert.equal(def.parameters.type, 'object');
    assert.ok(def.icon, `${def.name} has an icon`);
  }
});

test('calculate runs through the on-device parser', () => {
  const { instance } = loadAgent();
  const run = instance.runTool('calculate', { expression: '17 * 43' });
  assert.equal(run.error, null);
  assert.equal(run.result.split('\n')[0], '731');
});

test('calculate handles functions and implicit multiplication', () => {
  const { instance } = loadAgent();
  assert.equal(instance.runTool('calculate', { expression: 'sqrt(81) + 2' }).result.split('\n')[0], '11');
  assert.equal(instance.runTool('calculate', { expression: '2pi' }).result.split('\n')[0], '6.2831853072');
});

test('calculate reports a bad expression instead of inventing a number', () => {
  const { instance } = loadAgent();
  const run = instance.runTool('calculate', { expression: '2 + + +' });
  assert.ok(run.error);
  assert.equal(run.result, null);
});

test('convert_units is exact', () => {
  const { instance } = loadAgent();
  const run = instance.runTool('convert_units', { value: 12, from: 'km', to: 'mi' });
  assert.equal(run.result.split('\n')[0], '7.4564543068 mi');
});

test('convert_units refuses to mix kinds', () => {
  const { instance } = loadAgent();
  const run = instance.runTool('convert_units', { value: 5, from: 'km', to: 'kg' });
  assert.match(run.error, /different kinds|unknown unit/i);
});

test('temperatures go through convert_units', () => {
  const { instance } = loadAgent();
  assert.equal(instance.runTool('convert_units', { value: 100, from: 'c', to: 'f' }).result.split('\n')[0], '212 °F');
  assert.equal(instance.runTool('convert_units', { value: 0, from: 'c', to: 'k' }).result.split('\n')[0], '273.15 K');
});

test('percentage covers of, off and change', () => {
  const { instance } = loadAgent();
  assert.equal(instance.runTool('percentage', { mode: 'of', value: 15, base: 240 }).result.split('\n')[0], '36');
  assert.equal(instance.runTool('percentage', { mode: 'off', value: 20, base: 80 }).result.split('\n')[0], '64');
  const change = instance.runTool('percentage', { mode: 'change', from: 40, to: 55 });
  assert.equal(change.result.split('\n')[0], '37.5%');
});

test('percentage change from zero is undefined, not a number', () => {
  const { instance } = loadAgent();
  const run = instance.runTool('percentage', { mode: 'change', from: 0, to: 10 });
  assert.equal(run.value, null);
  assert.match(run.result, /Undefined/);
});

test('date_math counts, names and waits', () => {
  const { instance } = loadAgent();
  assert.match(instance.runTool('date_math', { kind: 'difference', start: '2026-01-01', end: '2026-10-20' }).result, /^292 days between/);
  assert.match(instance.runTool('date_math', { kind: 'weekday', start: '2026-10-20' }).result, /Tuesday/);
  assert.match(instance.runTool('date_math', { kind: 'days_until', start: '2026-12-25' }).result, /^66 days until/);
});

test('date_math rejects a day that does not exist', () => {
  const { instance } = loadAgent();
  assert.ok(instance.runTool('date_math', { kind: 'weekday', start: '2026-02-31' }).error);
});

test('the planner maps plain questions onto tools', () => {
  const { instance } = loadAgent();
  const plan = instance.plan('12 km to miles');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].name, 'convert_units');
  assert.equal(instance.plan('what is 17 * 43')[0].name, 'calculate');
  assert.equal(instance.plan('20% off 80')[0].name, 'percentage');
  assert.equal(instance.plan('days between 2026-01-01 and 2026-10-20')[0].name, 'date_math');
});

test('the planner refuses to guess at a sentence it cannot ground', () => {
  const { instance } = loadAgent();
  assert.deepEqual(instance.plan('write me a poem about the sea').join(','), '');
  assert.deepEqual(instance.plan('what is the capital of France').join(','), '');
});

test('runLocal runs every clause and reports the trace', () => {
  const { instance } = loadAgent();
  const run = instance.runLocal('12 km to miles then 15% of 240');
  assert.equal(run.intent, 'agent');
  assert.equal(run.steps.length, 2);
  assert.equal(run.steps[0].name, 'convert_units');
  assert.equal(run.steps[1].name, 'percentage');
  assert.match(run.text, /7\.4564543068/);
  assert.match(run.text, /On-device agent · 2 tool calls/);
});

test('runLocal carries a result forward when asked to', () => {
  const { instance } = loadAgent();
  const run = instance.runLocal('2 + 3 * 4 then multiply by 3');
  assert.equal(run.steps.length, 2);
  assert.equal(run.steps[1].args.expression, '14 * 3');
  assert.match(run.text, /42/);
});

test('runLocal falls back to the router with no trace', () => {
  const { instance } = loadAgent();
  const run = instance.runLocal('who are you');
  assert.equal(run.steps.length, 0);
  assert.ok(run.intent && run.intent !== 'agent');
  assert.ok(run.text.length > 20);
});

test('runLocal stops at the first failing tool', () => {
  const { instance } = loadAgent();
  const run = instance.runLocal('5 km to kg then 2 + 2');
  assert.equal(run.stopped, true);
  assert.equal(run.steps.length, 1);
  assert.match(run.text, /could not finish/);
});

test('search_history uses the injected hook and says so when absent', () => {
  const without = loadAgent().instance;
  assert.match(without.runTool('search_history', { query: 'rust' }).error, /not connected/);
  const withHook = loadAgent({ searchHistory: (query) => `2 chats match “${query}”` }).instance;
  assert.match(withHook.runTool('search_history', { query: 'rust' }).result, /2 chats match/);
});

test('current_time reads the injected clock', () => {
  const { instance } = loadAgent();
  const run = instance.runTool('current_time', {});
  assert.match(run.result, /ISO: 2026-10-20T12:00:00\.000Z/);
});

test('every trace step has a name, arguments, runtime and result or error', () => {
  const { instance } = loadAgent();
  const run = instance.runLocal('7 * 6 then 100 f to c');
  assert.equal(run.steps.length, 2);
  for (const step of run.steps) {
    assert.ok(step.name && typeof step.args === 'object');
    assert.ok(Number.isFinite(step.runtime) && step.runtime >= 1);
    assert.ok(step.result || step.error);
  }
});

test('the agent cannot reach the network', () => {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/agent.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'import(']) {
    assert.equal(source.includes(forbidden), false, `agent.js must not use ${forbidden}`);
  }
});
