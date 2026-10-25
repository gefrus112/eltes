const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { starter } = require('../assets/js/three-preview.js');
test('3D starter is transparent local source, no CDN, with lifecycle and accessibility guards', () => {
  const html = starter();
  assert.ok(Buffer.byteLength(html) < 100 * 1024);
  assert.match(html, /THREE.Scene/); assert.match(html, /PerspectiveCamera/);
  assert.match(html, /resize/); assert.match(html, /reducedMotion/);
  assert.match(html, /visibilitychange/); assert.match(html, /geometry.dispose/);
  assert.match(html, /3D unavailable/); assert.match(html, /webglcontextlost/);
  assert.doesNotMatch(html, /https?:\/\/|<script src=/);
  assert.match(fs.readFileSync(require.resolve('../assets/js/vendor/THREE-LICENSE.txt'), 'utf8'), /MIT License/);
});
