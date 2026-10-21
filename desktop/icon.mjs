#!/usr/bin/env node
/* Draw the Eltes app icon and write every format the desktop builds need.

     node desktop/icon.mjs

   Writes into desktop/resources/:
     icon.png            1024×1024, used by the Linux window
     icons/<size>.png    the Linux icon set
     icon.ico            16…256, PNG-compressed, for Windows
     icon.icns           32…1024, PNG-compressed, for macOS

   The mark is the same green cloud as the site, drawn from the same path, on a
   near-black rounded tile with an ember accent. Regenerate after brand changes;
   the binaries are committed so packaging never needs a canvas library.

   Requires: npm install --no-save @napi-rs/canvas
*/

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'desktop', 'resources');

let createCanvas;
try {
  ({ createCanvas } = await import('@napi-rs/canvas'));
} catch (error) {
  console.error('Missing @napi-rs/canvas. Run: npm install --no-save @napi-rs/canvas');
  process.exit(1);
}

/* ------------------------------- the artwork ------------------------------ */

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* The 24×24 cloud from the site's logo, absolute coordinates. */
function cloudPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(7, 18.6);
  ctx.bezierCurveTo(4.5, 18.6, 2.6, 16.7, 2.6, 14.3);
  ctx.bezierCurveTo(2.6, 12.1, 4.3, 10.3, 6.5, 10.1);
  ctx.bezierCurveTo(7, 6.9, 9.3, 4.7, 12, 4.7);
  ctx.bezierCurveTo(14.8, 4.7, 17.1, 6.8, 17.4, 9.6);
  ctx.bezierCurveTo(19.4, 9.8, 20.8, 11.5, 20.8, 13.5);
  ctx.bezierCurveTo(20.8, 16, 18.9, 17.9, 16.4, 17.9);
  ctx.lineTo(7, 17.9);
  ctx.closePath();
}

function draw(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size;
  const detail = s >= 32;

  /* tile */
  const radius = s * 0.225;
  roundedRect(ctx, 0, 0, s, s, radius);
  const base = ctx.createLinearGradient(0, 0, s * 0.45, s);
  base.addColorStop(0, '#0b1513');
  base.addColorStop(0.55, '#060c0b');
  base.addColorStop(1, '#030706');
  ctx.fillStyle = base;
  ctx.fill();

  /* keep everything inside the rounded tile */
  ctx.save();
  roundedRect(ctx, 0, 0, s, s, radius);
  ctx.clip();

  const glow = ctx.createRadialGradient(s * 0.22, s * 0.12, 0, s * 0.22, s * 0.12, s * 0.86);
  glow.addColorStop(0, 'rgba(57, 220, 162, 0.30)');
  glow.addColorStop(0.42, 'rgba(57, 220, 162, 0.08)');
  glow.addColorStop(1, 'rgba(57, 220, 162, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, s, s);

  /* the cloud, scaled to 64% of the tile */
  const k = (s * 0.64) / 18.2;
  const cx = (2.6 + 20.8) / 2;
  const cy = (4.7 + 18.6) / 2;
  ctx.save();
  ctx.translate(s / 2 - cx * k, s * 0.487 - cy * k);
  ctx.scale(k, k);

  ctx.save();
  ctx.shadowColor = 'rgba(57, 220, 162, 0.45)';
  ctx.shadowBlur = Math.max(2, s * 0.09);
  cloudPath(ctx);
  const cloud = ctx.createLinearGradient(2.6, 4.7, 20.8, 18.6);
  cloud.addColorStop(0, '#6cf5c5');
  cloud.addColorStop(0.55, '#39dca2');
  cloud.addColorStop(1, '#22bd8a');
  ctx.fillStyle = cloud;
  ctx.fill();
  ctx.restore();

  if (detail) {
    ctx.strokeStyle = '#04101a';
    ctx.fillStyle = '#04101a';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.05, 1.55);
    ctx.beginPath();
    ctx.moveTo(8.5, 13.1);
    ctx.bezierCurveTo(9.1, 13.8, 10.2, 13.8, 10.8, 13.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(15, 12.9, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(10.5, 16.2);
    ctx.bezierCurveTo(11.3, 17.1, 12.6, 17.1, 13.4, 16.2);
    ctx.stroke();
  }
  ctx.restore();

  /* the ember that follows the pointer in the chat */
  const ex = s * 0.795;
  const ey = s * 0.805;
  const er = Math.max(1.2, s * 0.052);
  const emberGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 4.6);
  emberGlow.addColorStop(0, 'rgba(255, 155, 82, 0.55)');
  emberGlow.addColorStop(1, 'rgba(255, 155, 82, 0)');
  ctx.fillStyle = emberGlow;
  ctx.beginPath();
  ctx.arc(ex, ey, er * 4.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffb072';
  ctx.beginPath();
  ctx.arc(ex, ey, er, 0, Math.PI * 2);
  ctx.fill();

  /* inner edge light */
  roundedRect(ctx, s * 0.012, s * 0.012, s * 0.976, s * 0.976, radius * 0.94);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = Math.max(1, s * 0.006);
  ctx.stroke();

  ctx.restore();
  return canvas;
}

/* -------------------------------- containers ------------------------------ */

function writeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4); // color planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

/* ICNS type codes: PNG payloads, from the smallest to the largest. */
const ICNS_TYPES = [
  ['ic11', 32], // 16x16@2x
  ['ic12', 64], // 32x32@2x
  ['ic07', 128], // 128x128
  ['ic13', 256], // 128x128@2x
  ['ic08', 256], // 256x256
  ['ic14', 512], // 256x256@2x
  ['ic09', 512], // 512x512
  ['ic10', 1024] // 512x512@2x
];

function writeIcns(bySize) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const png = bySize.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/* ---------------------------------- write --------------------------------- */

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const bySize = new Map();
for (const size of sizes) bySize.set(size, draw(size).toBuffer('image/png'));

await mkdir(join(outDir, 'icons'), { recursive: true });

await writeFile(join(outDir, 'icon.png'), bySize.get(1024));
await writeFile(join(outDir, 'icon.ico'), writeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: bySize.get(size) }))));
await writeFile(join(outDir, 'icon.icns'), writeIcns(bySize));

for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  await writeFile(join(outDir, 'icons', `${size}x${size}.png`), bySize.get(size));
}

const summary = ['icon.png', 'icon.ico', 'icon.icns', 'icons/16x16.png', 'icons/32x32.png', 'icons/48x48.png', 'icons/64x64.png', 'icons/128x128.png', 'icons/256x256.png', 'icons/512x512.png'];
console.log(`wrote ${summary.length} files to desktop/resources`);
for (const name of summary) console.log(`  ${name}`);
