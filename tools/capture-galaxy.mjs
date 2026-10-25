/* Capture a still of the site's galaxy for the release notes.
 *
 *   node tools/capture-galaxy.mjs [width] [height] [seconds]
 *
 * Writes assets/img/news/galaxy.jpg, the still used by news.html.
 * The canvas is painted by the real renderer (assets/js/galaxy.js) through a
 * minimal DOM shim, so the still always matches what ships. Requires the
 * optional dev dependency @napi-rs/canvas:
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
const AT = Number(process.argv[4] || 26);

const backdropCanvas = createCanvas(W, H);
const canvas = createCanvas(W, H);
for (const c of [backdropCanvas, canvas]) c.style = {};

const nodes = { 'canvas[data-galaxy]': canvas, 'canvas[data-galaxy-backdrop]': backdropCanvas };

globalThis.window = {
  innerWidth: W,
  innerHeight: H,
  devicePixelRatio: 1,
  scrollY: 0,
  pageYOffset: 0,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  addEventListener() {},
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {}
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.document = {
  hidden: false,
  documentElement: { clientWidth: W, clientHeight: H },
  querySelector: (selector) => nodes[selector] || null,
  createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : {}),
  addEventListener() {}
};

canvas.dataset = { galaxy: '1.1' };
for (const layer of [canvas, backdropCanvas]) {
  Object.defineProperty(layer, 'parentElement', { value: { classList: { add() {} } } });
}

await import(join(root, 'assets/js/galaxy.js'));
const galaxy = globalThis.window.EltesGalaxy;
if (!galaxy) throw new Error('the galaxy did not boot');

galaxy.stop();
galaxy.frame(AT);

const out = createCanvas(W, H);
const ctx = out.getContext('2d');
ctx.fillStyle = '#010208';
ctx.fillRect(0, 0, W, H);
ctx.drawImage(backdropCanvas, 0, 0);
ctx.drawImage(canvas, 0, 0);

const jpeg = out.toBuffer('image/jpeg', 78);
const target = join(root, 'assets/img/news/galaxy.jpg');
await writeFile(target, jpeg);
console.log(`wrote assets/img/news/galaxy.jpg (${Math.round(jpeg.length / 1024)} KB, ${W}x${H}, t=${AT}s)`);
