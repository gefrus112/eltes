/* Draw the Lab figure for the release notes.
 *
 *   node tools/capture-lab.mjs [width] [height]
 *
 * Writes assets/img/news/lab.jpg. This is not a mockup: the figure is painted
 * from a real 1,500-step run of the shipped model (assets/js/lab.js) — the same
 * training loop, the same seed and the same loss series the page draws. The
 * chart code below mirrors assets/js/lab-page.js so the still matches the page.
 *
 * Requires the optional dev dependency: npm install --no-save @napi-rs/canvas
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const Lab = require(join(root, 'assets/js/lab.js'));

const W = Number(process.argv[2] || 1280);
const H = Number(process.argv[3] || 760);
const STEPS = Number(process.argv[4] || 1500);

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

const INK = '#04060a';
const PANEL = '#070b11';
const LINE = 'rgba(150, 175, 210, 0.13)';
const TEXT = '#e9effb';
const MUTED = '#95a4ba';
const FAINT = '#5d697b';
const EMBER = '#ff9b52';
const EMBER_HI = '#ffc38f';
const VAL = '#46d3ff';

/* ------------------------------- the real run ------------------------------ */

const corpus = Lab.CORPORA.find((c) => c.id === 'eltes');
const model = Lab.createModel({ corpus, seed: 7 });
const series = [];
const started = Date.now();
for (let step = 1; step <= STEPS; step += 1) {
  model.trainStep({ batch: 24, lr: 0.003 });
  if (step % 5 === 0) series.push({ step, train: model.lastLoss, val: null });
  if (step % 50 === 0) {
    const val = model.evaluate();
    const point = series[series.length - 1];
    if (point && point.step === step) point.val = val;
    else series.push({ step, train: model.lastLoss, val });
  }
}
model.evaluate();
const elapsed = (Date.now() - started) / 1000;
const params = Lab.paramCount(model);
const ppl = Math.exp(model.lastValLoss);
const best = series.reduce((acc, p) => (p.val != null && p.val < acc.val ? { val: p.val, step: p.step } : acc), { val: Infinity, step: null });

const prompt = 'Eltes is a ';
const sample = model.sample({ prompt, length: 210, temperature: 0.7, topK: 12 });
console.log(`${STEPS} steps · ${params.toLocaleString()} params · ${elapsed.toFixed(1)} s · train ${model.lastLoss.toFixed(3)} · val ${model.lastValLoss.toFixed(3)}`);
console.log('sample:', JSON.stringify(sample.slice(0, 120)));

/* --------------------------------- helpers -------------------------------- */

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(text, maxWidth, font) {
  ctx.font = font;
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const mono = (size, weight = '500') => `${weight} ${size}px "DejaVu Sans Mono", monospace`;
const sans = (size, weight = '400') => `${weight} ${size}px "DejaVu Sans", "Liberation Sans", sans-serif`;

/* --------------------------------- backdrop -------------------------------- */

ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

const glow = ctx.createRadialGradient(W * 0.16, -80, 0, W * 0.16, -80, 720);
glow.addColorStop(0, 'rgba(255, 138, 58, 0.20)');
glow.addColorStop(1, 'rgba(255, 138, 58, 0)');
ctx.fillStyle = glow;
ctx.fillRect(0, 0, W, H);

const cool = ctx.createRadialGradient(W * 0.95, H * 0.1, 0, W * 0.95, H * 0.1, 520);
cool.addColorStop(0, 'rgba(70, 211, 255, 0.06)');
cool.addColorStop(1, 'rgba(70, 211, 255, 0)');
ctx.fillStyle = cool;
ctx.fillRect(0, 0, W, H);

ctx.fillStyle = 'rgba(200, 220, 255, 0.05)';
for (let y = 24; y < H; y += 32) {
  for (let x = 24; x < W; x += 32) {
    ctx.beginPath();
    ctx.arc(x, y, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------------------------------- header --------------------------------- */

const PAD = 64;

ctx.fillStyle = EMBER;
ctx.font = mono(10.5, '700');
ctx.letterSpacing = '3px';
ctx.fillText('ELTES LAB  ·  ON-DEVICE TRAINING', PAD, 66);
ctx.letterSpacing = '0px';

ctx.fillStyle = TEXT;
ctx.font = sans(31, '600');
ctx.fillText('A language model, trained in this tab.', PAD, 108);

ctx.fillStyle = MUTED;
ctx.font = sans(13.5);
ctx.fillText(
  `Eltes handbook · ${STEPS.toLocaleString()} steps · ${params.toLocaleString()} parameters · best val ${best.val.toFixed(2)} @ ${best.step} · seed 7`,
  PAD,
  134
);

/* -------------------------------- chart panel ------------------------------ */

const panel = { x: PAD, y: 164, w: W - PAD * 2, h: 372 };
ctx.save();
roundRect(panel.x, panel.y, panel.w, panel.h, 16);
ctx.fillStyle = PANEL;
ctx.fill();
ctx.strokeStyle = LINE;
ctx.lineWidth = 1;
ctx.stroke();
ctx.restore();

ctx.fillStyle = TEXT;
ctx.font = sans(12.5, '600');
ctx.fillText('Cross-entropy loss', panel.x + 22, panel.y + 28);
ctx.fillStyle = FAINT;
ctx.font = mono(10);
ctx.textAlign = 'right';
ctx.fillText(`${series.length} points · 90/10 split · x: steps`, panel.x + panel.w - 22, panel.y + 28);
ctx.textAlign = 'left';

const pad = { left: panel.x + 62, right: panel.x + panel.w - 26, top: panel.y + 52, bottom: panel.y + panel.h - 42 };
const plotW = pad.right - pad.left;
const plotH = pad.bottom - pad.top;

let min = Infinity;
let max = -Infinity;
for (const p of series) {
  for (const v of [p.train, p.val]) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
}
const span = max - min;
min = Math.max(0, min - span * 0.14);
max += span * 0.14;

const X = (step) => pad.left + (step / STEPS) * plotW;
const Y = (loss) => pad.top + plotH - ((loss - min) / (max - min)) * plotH;

/* grid */
ctx.strokeStyle = 'rgba(150, 185, 250, 0.09)';
ctx.lineWidth = 1;
ctx.font = mono(9.5);
ctx.fillStyle = 'rgba(150, 168, 196, 0.72)';
ctx.textAlign = 'right';
ctx.textBaseline = 'middle';
for (let i = 0; i <= 4; i += 1) {
  const y = pad.top + (plotH / 4) * i;
  ctx.beginPath();
  ctx.moveTo(pad.left, y + 0.5);
  ctx.lineTo(pad.right, y + 0.5);
  ctx.stroke();
  ctx.fillText((max - ((max - min) / 4) * i).toFixed(2), pad.left - 10, y);
}
ctx.textAlign = 'center';
ctx.textBaseline = 'top';
for (let i = 0; i <= 5; i += 1) {
  const step = Math.round((STEPS / 5) * i);
  const x = X(step);
  ctx.strokeStyle = 'rgba(150, 185, 250, 0.055)';
  ctx.beginPath();
  ctx.moveTo(x + 0.5, pad.top);
  ctx.lineTo(x + 0.5, pad.bottom);
  ctx.stroke();
  ctx.fillStyle = 'rgba(150, 168, 196, 0.6)';
  ctx.fillText(String(step), x, pad.bottom + 9);
}
ctx.textAlign = 'left';

/* area under the training curve */
ctx.beginPath();
let startedPath = false;
for (const p of series) {
  if (p.train == null) continue;
  const x = X(p.step);
  const y = Y(p.train);
  if (!startedPath) { ctx.moveTo(x, y); startedPath = true; } else ctx.lineTo(x, y);
}
ctx.lineTo(X(series[series.length - 1].step), pad.bottom);
ctx.lineTo(X(series[0].step), pad.bottom);
ctx.closePath();
const area = ctx.createLinearGradient(0, pad.top, 0, pad.bottom);
area.addColorStop(0, 'rgba(255, 155, 82, 0.22)');
area.addColorStop(1, 'rgba(255, 155, 82, 0)');
ctx.fillStyle = area;
ctx.fill();

/* curves */
const curve = (key, color, width, dash) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  let began = false;
  for (const p of series) {
    if (p[key] == null) continue;
    const x = X(p.step);
    const y = Y(p[key]);
    if (!began) { ctx.moveTo(x, y); began = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
};
curve('train', EMBER, 2.2);
curve('val', VAL, 1.7, [5, 4]);

if (best.step != null) {
  ctx.save();
  ctx.strokeStyle = VAL;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(X(best.step), Y(best.val), 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(120, 220, 245, 0.95)';
  ctx.font = mono(9.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`best ${best.val.toFixed(2)} @ ${best.step}`, X(best.step) + 10, Y(best.val) - 13);
  ctx.textBaseline = 'top';
  ctx.restore();
}

/* legend */
const legendY = pad.top - 14;
ctx.font = mono(9.5);
let lx = pad.left;
ctx.strokeStyle = EMBER;
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(lx, legendY);
ctx.lineTo(lx + 16, legendY);
ctx.stroke();
ctx.fillStyle = 'rgba(240, 200, 170, 0.85)';
ctx.fillText('training', lx + 22, legendY);
lx += 96;
ctx.strokeStyle = VAL;
ctx.lineWidth = 1.7;
ctx.setLineDash([5, 4]);
ctx.beginPath();
ctx.moveTo(lx, legendY);
ctx.lineTo(lx + 16, legendY);
ctx.stroke();
ctx.setLineDash([]);
ctx.fillStyle = 'rgba(140, 205, 230, 0.85)';
ctx.fillText('validation (text it never trained on)', lx + 22, legendY);

/* ------------------------------- stats strip ------------------------------- */

const stats = [
  ['STEPS', STEPS.toLocaleString()],
  ['TRAIN LOSS', model.lastLoss.toFixed(3)],
  ['VAL LOSS', model.lastValLoss.toFixed(3)],
  ['PERPLEXITY', ppl.toFixed(1)],
  ['SPEED', `${(elapsed * 1000 / STEPS).toFixed(1)} ms`],
  ['VOCAB', String(model.vocab.length)]
];
const statY = panel.y + panel.h + 40;
const colW = (W - PAD * 2) / stats.length;
stats.forEach(([label, value], i) => {
  const x = PAD + i * colW;
  ctx.fillStyle = FAINT;
  ctx.font = mono(9, '700');
  ctx.letterSpacing = '1.6px';
  ctx.fillText(label, x, statY);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = i === 1 ? EMBER_HI : TEXT;
  ctx.font = mono(20, '700');
  ctx.fillText(value, x, statY + 26);
});

/* --------------------------------- sample ---------------------------------- */

const box = { x: PAD, y: statY + 48, w: W - PAD * 2, h: H - (statY + 48) - 26 };
ctx.save();
roundRect(box.x, box.y, box.w, box.h, 14);
ctx.fillStyle = 'rgba(5, 8, 13, 0.9)';
ctx.fill();
ctx.strokeStyle = LINE;
ctx.stroke();
ctx.restore();

ctx.fillStyle = FAINT;
ctx.font = mono(9, '700');
ctx.letterSpacing = '1.6px';
ctx.fillText('SAMPLED FROM THE TRAINED MODEL  ·  temperature 0.7 · top-k 12', box.x + 20, box.y + 24);
ctx.letterSpacing = '0px';

const font = mono(12, '400');
ctx.font = font;
const promptWidth = ctx.measureText(prompt).width;
const full = prompt + sample.replace(/\n/g, ' ');
const lineW = box.w - 40;
const lines = [];
let line = '';
for (const ch of full) {
  if (ctx.measureText(line + ch).width > lineW && line) {
    lines.push(line);
    line = ch;
  } else {
    line += ch;
  }
}
if (line) lines.push(line);

ctx.fillStyle = 'rgba(120, 132, 152, 0.95)';
ctx.fillText(prompt, box.x + 20, box.y + 46);
ctx.fillStyle = '#ecdccd';
let ly = box.y + 46;
lines.forEach((row, i) => {
  if (i === 0) ctx.fillText(row.slice(prompt.length).trimStart(), box.x + 20 + promptWidth, ly);
  else ctx.fillText(row, box.x + 20, ly);
  ly += 18;
});

await mkdir(join(root, 'assets/img/news'), { recursive: true });
await writeFile(join(root, 'assets/img/news/lab.jpg'), canvas.toBuffer('image/jpeg', 92));
console.log('wrote assets/img/news/lab.jpg');
