/* Capture a still of the chat embers for the release notes.
 *
 *   node tools/capture-embers.mjs [width] [height] [moves]
 *
 * Writes assets/img/news/embers.jpg, the still used by news.html.
 * The scene is painted by the real effect (assets/js/chat-embers.js) through a
 * minimal DOM shim, and the pointer is actually swept across the pane, so the
 * still always matches what ships. Requires the optional dev dependency:
 *
 *   npm install --no-save @napi-rs/canvas
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = Number(process.argv[2] || 1280);
const H = Number(process.argv[3] || 760);
const MOVES = Number(process.argv[4] || 46);

const canvas = createCanvas(W, H);
canvas.style = {};
canvas.classList = { add() {}, remove() {}, toggle() {} };

const listeners = {};
const host = {
  classList: { add() {}, remove() {}, toggle() {} },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  addEventListener: (type, fn) => {
    (listeners[type] = listeners[type] || []).push(fn);
  }
};
Object.defineProperty(canvas, 'parentElement', { value: host });

const empty = { hidden: false };
let rafCallback = null;
let now = 0;

globalThis.window = {
  innerWidth: W,
  innerHeight: H,
  devicePixelRatio: 1,
  scrollY: 0,
  pageYOffset: 0,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  addEventListener() {},
  requestAnimationFrame: (cb) => {
    rafCallback = cb;
    return 1;
  },
  cancelAnimationFrame() {}
};
globalThis.requestAnimationFrame = (cb) => {
  rafCallback = cb;
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => now };
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.document = {
  hidden: false,
  body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } },
  querySelector: (selector) => {
    if (selector === 'canvas[data-embers]') return canvas;
    if (selector === '#emptyState') return empty;
    return null;
  },
  createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : {}),
  addEventListener() {}
};

await import(join(root, 'assets/js/chat-embers.js'));
const embers = globalThis.window.EltesEmbers;
if (!embers) throw new Error('the embers did not boot');

const emit = (type, event) => (listeners[type] || []).forEach((fn) => fn(event));
const tick = (ms) => {
  now += ms;
  if (rafCallback) {
    const callback = rafCallback;
    rafCallback = null;
    callback(now);
  }
};

// settle the loop
for (let i = 0; i < 6; i += 1) tick(16);

// sweep the pointer through the pane in an arc, pausing to let it burn
for (let i = 0; i < MOVES; i += 1) {
  const p = i / (MOVES - 1);
  const x = W * 0.24 + Math.cos(p * Math.PI * 0.9) * W * 0.18 + p * W * 0.22;
  const y = H * 0.6 - Math.sin(p * Math.PI) * H * 0.22;
  now += 16;
  emit('pointermove', { clientX: x, clientY: y });
  tick(16);
  tick(16);
}
for (let i = 0; i < 20; i += 1) tick(16);

// Composite over the true-black shell, with the same soft top light the app
// uses, so the still reads like the workspace rather than a bare canvas.
const out = createCanvas(W, H);
const ctx = out.getContext('2d');
ctx.fillStyle = '#000000';
ctx.fillRect(0, 0, W, H);
const glow = ctx.createRadialGradient(W / 2, -H * 0.1, 0, W / 2, -H * 0.1, H);
glow.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
ctx.fillStyle = glow;
ctx.fillRect(0, 0, W, H);
ctx.globalCompositeOperation = 'screen';
ctx.drawImage(canvas, 0, 0);
ctx.globalCompositeOperation = 'source-over';

const jpeg = out.toBuffer('image/jpeg', 82);
const target = join(root, 'assets/img/news/embers.jpg');
await writeFile(target, jpeg);
console.log(`wrote assets/img/news/embers.jpg (${Math.round(jpeg.length / 1024)} KB, ${W}x${H}, ${embers.state.frames} frames, ${embers.state.embers} embers)`);
