/* "Other tools" deep links — studio.html?tools=reel and friends.
   The overlay is a browser module, so it is loaded in a `vm` with a window
   stub; only the URL parsing is exercised, which is the part that decides
   whether the video editor is one click from the rest of the site. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadTools() {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/studio-tools.js'), 'utf8');
  const sandbox = {
    window: {},
    document: {
      readyState: 'complete',
      getElementById: () => null,
      addEventListener: () => {},
      querySelectorAll: () => []
    },
    console,
    URLSearchParams
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'studio-tools.js' });
  return sandbox.window.EltesTools;
}

const Tools = loadTools();

test('a query string opens the tool it names', () => {
  assert.equal(Tools.toolFromLocation('?tools=reel', ''), 'reel');
  assert.equal(Tools.toolFromLocation('?tool=reel', ''), 'reel');
  assert.equal(Tools.toolFromLocation('?tools=frame&x=1', '#nope'), 'frame');
  assert.equal(Tools.toolFromLocation('?tools=Palette', ''), 'palette', 'case is ignored');
  assert.equal(Tools.toolFromLocation('?tools=hub', ''), 'hub');
});

test('a hash also works, in both spellings', () => {
  assert.equal(Tools.toolFromLocation('', '#reel'), 'reel');
  assert.equal(Tools.toolFromLocation('', '#tools=reel'), 'reel');
  assert.equal(Tools.toolFromLocation('?', '#frame'), 'frame');
});

test('an unknown or missing target opens nothing', () => {
  assert.equal(Tools.toolFromLocation('', ''), '');
  assert.equal(Tools.toolFromLocation('?tools=settings', ''), '');
  assert.equal(Tools.toolFromLocation('', '#downloads'), '');
  assert.equal(Tools.toolFromLocation('?tool=', '#'), '');
});

test('the tool list still ships all three cards', () => {
  assert.equal(Tools.TOOLS.map((tool) => tool.id).join(','), 'reel,frame,palette');
});

test('Studio pins a Video editor tab next to Other tools', () => {
  const html = fs.readFileSync(path.join(ROOT, 'studio.html'), 'utf8');
  assert.match(html, /id="btnReel"[\s\S]*Video editor/, 'the tab is labelled plainly');
  assert.match(html, /id="btnTools"/, 'Other tools stays');
  assert.match(html, /data-tools-open="reel"/, 'the empty editor links straight at Reel');
  const js = fs.readFileSync(path.join(ROOT, 'assets/js/studio-tools.js'), 'utf8');
  assert.match(js, /getElementById\('btnReel'\)/, 'the tab is wired');
  assert.match(js, /function syncTabs/, 'both tabs reflect where you are');
});
