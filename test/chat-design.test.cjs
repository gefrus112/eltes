const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const D = require('../assets/js/chat-design.js');

test('CTab provides distinct inspired layouts and a safe default', () => {
  for (const preset of ['eltes', 'claude', 'gemini', 'chatgpt', 'kimi', 'notebook']) {
    const d = D.normalize({ preset });
    assert.equal(d.preset, preset); assert.match(d.accent, /^#[a-f0-9]{6}$/);
  }
  assert.equal(D.normalize(null).preset, 'eltes');
  assert.equal(D.normalize({ preset: '__proto__' }).preset, 'eltes');
  assert.equal(D.normalize({ preset: 'kimi' }).font, 'mono');
  assert.equal(D.normalize({ preset: 'claude' }).font, 'serif');
  assert.equal(D.normalize({ preset: 'gemini' }).layout, 'cards');
});

test('custom designs clamp numbers and never accept arbitrary CSS, paths or fonts', () => {
  const d = D.normalize({ preset: 'chatgpt', accent: 'red; background:url(https://example.com)', font: 'url(x)', layout: '<script>', size: Infinity, width: -999, radius: 300, arbitraryCSS: 'body{}' });
  assert.equal(d.accent, D.PRESETS.chatgpt.accent);
  assert.equal(d.font, 'system'); assert.equal(d.layout, 'bubbles');
  assert.equal(d.width, 680); assert.equal(d.radius, 28); assert.equal(d.size, 15);
  assert.equal(d.arbitraryCSS, undefined);
  assert.equal(D.normalize({ width: 9999, size: 100 }).width, 1200);
  assert.equal(D.normalize({ width: 9999, size: 100 }).size, 20);
});

test('accent foreground remains readable even for extreme user-selected colors', () => {
  for (const accent of ['#000000', '#ffffff', '#ff0000', '#0000ff', '#45ba88', '#777777', '#123456']) {
    const vars = D.variables({ accent });
    const l1 = D.luminance(accent), l2 = D.luminance(vars['--ctab-on-accent']);
    assert.ok((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05) >= 4.5, accent);
  }
});

test('design application only touches known datasets and safe style values', () => {
  const properties = {};
  const body = { dataset: {}, style: { setProperty: (k, v) => { properties[k] = v; } } };
  const result = D.apply({ preset: 'kimi', width: 1000 }, body);
  assert.deepEqual(body.dataset, { chatDesign: 'kimi', chatLayout: 'flat' });
  assert.equal(properties['--ctab-width'], '1000px'); assert.equal(result.font, 'mono');
  assert.doesNotMatch(Object.values(properties).join(' '), /url\(|script|@import/);
  const html = fs.readFileSync(require.resolve('../app.html'), 'utf8');
  assert.match(html, /data-tab="ctab"/); assert.match(html, /id="resetChatDesign"/);
  assert.ok(html.indexOf('assets/js/chat-design.js') < html.indexOf('assets/js/app.js'));
});
