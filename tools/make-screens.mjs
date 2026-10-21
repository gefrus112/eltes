#!/usr/bin/env node
/**
 * Eltes — README screen previews
 * ---------------------------------------------------------------------------
 * The sandbox has no browser, so these are not captures. They are vector
 * previews drawn from the app's real layout, icon paths and colour tokens.
 * Run `node tools/make-screens.mjs` to regenerate assets/img/screens/*.svg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets/img/screens');

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const C = {
  black: '#000000',
  ink: '#08080a',
  panel: '#05060a',
  line: '#ffffff13',
  line2: '#ffffff21',
  text: '#f2f3f5',
  text2: '#a6a8ae',
  text3: '#787a80',
  text4: '#4e5055',
  green: '#39dca2',
  greenText: '#66e0b4',
  blue: '#4785ff',
  blue2: '#2a63ee',
  warn: '#ffc266'
};

/* ------------------------------- primitives ------------------------------ */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function rect(x, y, w, h, o = {}) {
  const r = o.r ? ` rx="${o.r}"` : '';
  const fill = o.fill || 'none';
  const stroke = o.stroke ? ` stroke="${o.stroke}"` : '';
  const sw = o.sw ? ` stroke-width="${o.sw}"` : '';
  const op = o.opacity != null ? ` opacity="${o.opacity}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r} fill="${fill}"${stroke}${sw}${op} />`;
}

function line(x1, y1, x2, y2, o = {}) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke || C.line}" stroke-width="${o.sw || 1}" opacity="${o.opacity ?? 1}" />`;
}

function circle(cx, cy, r, o = {}) {
  const stroke = o.stroke ? ` stroke="${o.stroke}"` : '';
  const sw = o.sw ? ` stroke-width="${o.sw}"` : '';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill || 'none'}"${stroke}${sw} />`;
}

function text(x, y, str, o = {}) {
  const size = o.size || 12;
  const weight = o.weight || 400;
  const anchor = o.anchor || 'start';
  const family = o.mono ? MONO : FONT;
  const ls = o.ls ? ` letter-spacing="${o.ls}"` : '';
  const op = o.opacity != null ? ` opacity="${o.opacity}"` : '';
  return `<text x="${x}" y="${y}" fill="${o.fill || C.text}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${ls}${op}>${esc(str)}</text>`;
}

/** Width estimate used for pills and chips (no text metrics in a static SVG). */
const tw = (str, size, mono = false) => str.length * size * (mono ? 0.6 : 0.555);

let ICONS = {};
function loadIcons() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/icons.js'), 'utf8');
  const m = src.match(/const PATHS = (\{[\s\S]*?\});\n/);
  if (!m) throw new Error('icon table not found');
  ICONS = JSON.parse(m[1]);
}

function icon(name, x, y, size, color = C.text2, sw = 1.7) {
  const body = ICONS[name] || ICONS['circle-help'];
  const scale = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" `
    + `stroke-width="${(sw / scale).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round">`
    + `${body.replace(/currentColor/g, color)}</g>`;
}

/** The Eltes cloud mark: one eye closed, one open. */
function mark(x, y, size = 20) {
  const s = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${s})">`
    + '<path d="M7 18.6c-2.5 0-4.4-1.9-4.4-4.3 0-2.2 1.7-4 3.9-4.2C7 6.9 9.3 4.7 12 4.7c2.8 0 5.1 2.1 5.4 4.9 2 .2 3.4 1.9 3.4 3.9 0 2.5-1.9 4.4-4.4 4.4H7Z" fill="#39dca2" />'
    + '<path d="M8.5 13.1c.6.7 1.7.7 2.3 0" fill="none" stroke="#04101a" stroke-width="1.5" stroke-linecap="round" />'
    + '<circle cx="15" cy="12.9" r="1.5" fill="#04101a" />'
    + '<path d="M10.5 16.2c.8.9 2.1.9 2.9 0" fill="none" stroke="#04101a" stroke-width="1.5" stroke-linecap="round" />'
    + '</g>';
}

function pill(x, y, label, o = {}) {
  const size = o.size || 10;
  const pad = o.pad ?? 9;
  const h = o.h || 20;
  const w = o.w || Math.round(tw(label, size) + pad * 2);
  return rect(x, y, w, h, { r: h / 2, fill: o.fill || '#ffffff0d', stroke: o.stroke || C.line })
    + text(x + w / 2, y + h / 2 + size * 0.35, label, { size, fill: o.color || C.text3, anchor: 'middle', ls: o.ls || 0, weight: o.weight || 500 });
}

function button(x, y, w, h, label, o = {}) {
  const size = o.size || 12.5;
  const primary = o.kind === 'primary';
  const fill = primary ? 'url(#btnBlue)' : o.kind === 'solid' ? '#ffffff0d' : '#ffffff08';
  const stroke = primary ? '#96beff4d' : (o.stroke || C.line2);
  const color = primary ? '#ffffff' : (o.color || C.text);
  const iconName = o.icon;
  const gap = 6;
  const iw = iconName ? 13 : 0;
  const labelW = tw(label, size) + iw + (iconName ? gap : 0);
  const start = x + (w - labelW) / 2;
  let out = rect(x, y, w, h, { r: o.r || 8, fill, stroke, sw: 1 });
  if (iconName) out += icon(iconName, start, y + (h - 13) / 2, 13, color, 1.7);
  out += text(start + iw + (iconName ? gap : 0), y + h / 2 + size * 0.35, label, { size, weight: 500, fill: color });
  return out;
}

function kbd(x, y, label, o = {}) {
  const size = o.size || 9.5;
  const w = o.w || Math.max(18, Math.round(tw(label, size, true) + 10));
  const h = o.h || 18;
  return rect(x, y, w, h, { r: 4, fill: '#ffffff0a', stroke: C.line2 })
    + text(x + w / 2, y + h / 2 + size * 0.34, label, { size, fill: C.text3, anchor: 'middle', mono: true });
}

function svg(w, h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">\n`
    + `<defs>${defs}</defs>\n${body}\n</svg>\n`;
}

const DEFS = `
  <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#bcc0c8" /><stop offset="0.45" stop-color="#858b95" /><stop offset="1" stop-color="#a6abb4" />
  </linearGradient>
  <linearGradient id="btnBlue" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4785ff" /><stop offset="1" stop-color="#2a63ee" />
  </linearGradient>
  <linearGradient id="heroLine" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#eff5ff" /><stop offset="0.36" stop-color="#a9c8ff" />
    <stop offset="0.67" stop-color="#78a6ff" /><stop offset="1" stop-color="#80e2c0" />
  </linearGradient>
  <radialGradient id="shellGlow" cx="0.5" cy="0" r="0.75">
    <stop offset="0" stop-color="#b4b8c1" stop-opacity="0.16" /><stop offset="1" stop-color="#b4b8c1" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="nebulaA" cx="0.18" cy="0.12" r="0.55">
    <stop offset="0" stop-color="#2b6bff" stop-opacity="0.22" /><stop offset="1" stop-color="#2b6bff" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="nebulaB" cx="0.84" cy="0.05" r="0.5">
    <stop offset="0" stop-color="#39dca2" stop-opacity="0.13" /><stop offset="1" stop-color="#39dca2" stop-opacity="0" />
  </radialGradient>
  <radialGradient id="nebulaC" cx="0.5" cy="0.98" r="0.6">
    <stop offset="0" stop-color="#7b5cff" stop-opacity="0.16" /><stop offset="1" stop-color="#7b5cff" stop-opacity="0" />
  </radialGradient>
  <linearGradient id="fadeDown" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000000" stop-opacity="0" /><stop offset="1" stop-color="#000000" stop-opacity="0.35" />
  </linearGradient>
`;

/* =============================== chat view =============================== */

function chatScreen() {
  const b = [];
  const W = 1440;
  const H = 900;

  b.push(rect(0, 0, W, H, { fill: C.black }));
  b.push(rect(0, 0, W, H, { fill: 'url(#shellGlow)' }));

  /* ------------------------------- sidebar ------------------------------- */
  b.push(rect(0, 0, 272, H, { fill: '#030304' }));
  b.push(line(272, 0, 272, H, { stroke: C.line }));
  b.push(mark(16, 19, 20));
  b.push(text(44, 37, 'Eltes', { size: 16, weight: 600, ls: '-0.02em' }));
  b.push(text(99, 36, 'AI AGENT', { size: 8.5, fill: C.text4, ls: '0.1em', weight: 600 }));
  b.push(button(232, 15, 28, 28, '', { r: 7, icon: 'panel-left', stroke: C.line, size: 0 }));

  b.push(rect(10, 66, 252, 32, { r: 8, fill: '#ffffff07', stroke: C.line }));
  b.push(icon('search', 22, 74, 14, C.text3));
  b.push(text(44, 86, 'Search chats', { size: 12, fill: C.text3 }));
  b.push(kbd(224, 73, '⌘K'));

  b.push(rect(10, 106, 252, 34, { r: 8, fill: '#ffffff0b', stroke: C.line }));
  b.push(icon('plus', 22, 115, 15, C.text2));
  b.push(text(44, 128, 'New chat', { size: 13, weight: 500, fill: C.text }));
  b.push(kbd(222, 114, '⌘⇧O', { w: 30 }));

  b.push(text(16, 166, 'TODAY', { size: 8.5, weight: 600, fill: C.text4, ls: '0.14em' }));

  const chats = [
    ['Neon hoverboard in Studio', true],
    ['Race scaffold, three laps', false],
    ['Low-poly planet in Blender', false]
  ];
  chats.forEach(([label, active], i) => {
    const y = 176 + i * 36;
    if (active) {
      b.push(rect(8, y, 256, 34, { r: 7, fill: '#ffffff0a' }));
      b.push(rect(8, y + 6, 2, 22, { r: 1, fill: '#c9ccd3' }));
    }
    b.push(icon('message-square', 20, y + 10, 14, active ? C.text2 : C.text4));
    b.push(text(42, y + 22, label, { size: 12.5, fill: active ? '#e6e8eb' : C.text3, weight: active ? 500 : 400 }));
  });

  b.push(text(16, 302, 'YESTERDAY', { size: 8.5, weight: 600, fill: C.text4, ls: '0.14em' }));
  [
    'Explain MCP in one page',
    '12 km in miles, exactly',
    'Critique my landing page'
  ].forEach((label, i) => {
    const y = 312 + i * 36;
    b.push(icon('message-square', 20, y + 10, 14, C.text4));
    b.push(text(42, y + 22, label, { size: 12.5, fill: C.text3 }));
  });

  b.push(text(16, 792, 'Local storage', { size: 10, fill: C.text4 }));
  b.push(text(256, 792, '8%', { size: 10, fill: C.text4, anchor: 'end' }));
  b.push(rect(16, 800, 240, 3, { r: 2, fill: '#ffffff0d' }));
  b.push(rect(16, 800, 20, 3, { r: 2, fill: '#8f949d' }));

  b.push(rect(10, 814, 252, 56, { r: 10, fill: '#ffffff06', stroke: C.line }));
  b.push(circle(36, 842, 13, { fill: '#ffffff12', stroke: C.line2 }));
  b.push(text(36, 846, 'L', { size: 11, fill: C.text2, anchor: 'middle', weight: 600 }));
  b.push(text(58, 838, 'Local workspace', { size: 12.5, weight: 500 }));
  b.push(circle(61, 851, 2.5, { fill: C.green }));
  b.push(text(68, 855, 'No keys connected', { size: 10.5, fill: C.text4 }));
  b.push(icon('settings', 232, 834, 16, C.text4));

  /* -------------------------------- topbar -------------------------------- */
  b.push(rect(273, 0, W - 273, 58, { fill: '#03060b' }));
  b.push(line(273, 58, W, 58, { stroke: C.line }));
  b.push(icon('panel-left', 285, 20, 17, C.text3));

  b.push(rect(313, 12, 236, 34, { r: 8, fill: '#ffffff05', stroke: C.line }));
  b.push(mark(325, 21, 15));
  b.push(text(347, 33, 'Eltes CAI-1', { size: 12.5, weight: 500 }));
  b.push(pill(429, 20, 'On-device', { size: 9, h: 18, pad: 8, fill: '#ffffff09', color: C.text3 }));
  b.push(icon('chevron-down', 524, 23, 13, C.text4));

  b.push(rect(560, 15, 96, 28, { r: 14, fill: '#ffffff05', stroke: C.line }));
  b.push(icon('key-round', 572, 22, 13, C.text4));
  b.push(text(590, 33, 'No keys', { size: 11.5, fill: C.text3 }));

  ['search', 'download', 'terminal', 'book-open'].forEach((name, i) => {
    b.push(icon(name, 1176 + i * 38, 21, 16, C.text4));
  });
  b.push(line(1332, 19, 1332, 39, { stroke: C.line }));
  b.push(icon('settings', 1348, 21, 17, C.text3));

  /* -------------------------------- thread -------------------------------- */
  const L = 451;
  const R = 1261;

  b.push(rect(R - 578, 92, 578, 60, { r: 13, fill: '#191a1e', stroke: '#ffffff14' }));
  b.push(text(R - 562, 116, 'Build a neon hoverboard in Roblox Studio — model it,', { size: 14, fill: '#dfe2e6' }));
  b.push(text(R - 562, 138, 'add a light trail, then scaffold a playable race.', { size: 14, fill: '#dfe2e6' }));

  b.push(mark(L, 176, 15));
  b.push(text(L + 23, 188, 'Eltes CAI-1', { size: 11.5, weight: 600, fill: '#d8dbe0' }));
  b.push(text(L + 112, 188, '· 2 servers · 8 tools', { size: 10.5, fill: C.text4 }));
  b.push(text(R, 188, '4.1 s', { size: 10, fill: C.text4, anchor: 'end', mono: true }));

  const tools = [
    ['roblox__build_model', 'DONE', 'model NeonHoverboard  ·  14 parts  ·  Workspace'],
    ['roblox__add_effect', 'DONE', 'Trail + PointLight  ·  ThrusterA → ThrusterB'],
    ['roblox__scaffold_game', 'DONE', 'RaceServer.luau  ·  3 checkpoints  ·  3 laps']
  ];
  tools.forEach(([name, state, detail], i) => {
    const y = 198 + i * 64;
    b.push(rect(L, y, R - L, 56, { r: 10, fill: '#050b14', stroke: C.line }));
    b.push(line(L, y + 28, R, y + 28, { stroke: '#ffffff09' }));
    b.push(rect(L + 11, y + 5, 19, 19, { r: 5, fill: '#ffffff12', stroke: C.line2 }));
    b.push(icon('box', L + 14, y + 8, 13, C.text2, 1.6));
    b.push(text(L + 39, y + 19, name, { size: 10.5, mono: true, fill: '#b2b6bd' }));
    b.push(icon('check', R - 76, y + 8, 10, C.greenText, 2.4));
    b.push(text(R - 62, y + 18, state, { size: 9, fill: C.greenText, ls: '0.06em', weight: 600 }));
    b.push(text(L + 14, y + 45, detail, { size: 10.5, mono: true, fill: '#878b93' }));
  });

  const answer = [
    'Done — NeonHoverboard is in Workspace with a cyan trail, two lit thrusters and a',
    'three-lap race at Workspace.RaceCourse. Press Play to test: LapService scores each',
    'checkpoint, and the board respawns if it flips.'
  ];
  answer.forEach((s, i) => b.push(text(L, 428 + i * 23, s, { size: 13.5, fill: '#cfd3d9' })));

  b.push(rect(L, 496, R - L, 104, { r: 10, fill: '#05070d', stroke: C.line }));
  b.push(text(L + 14, 516, 'RaceServer.luau · inserted', { size: 9, fill: C.text4, mono: true, ls: '0.08em' }));
  b.push(pill(R - 54, 506, 'lua', { size: 8.5, h: 17, pad: 8, color: C.text4 }));
  ['local trail = Instance.new("Trail")',
    'trail.Attachment0 = left.Thruster',
    'trail.Color = ColorSequence.new(Color3.fromRGB(0, 255, 214))',
    'trail.MaxLength = 12'].forEach((code, i) => {
    b.push(text(L + 14, 538 + i * 18, code, { size: 10.5, mono: true, fill: '#c3c8d0' }));
  });

  b.push(icon('plug', L, 622, 12, C.text4));
  b.push(text(L + 18, 632, '2 MCP servers connected — Blender (14 tools), Roblox Studio (8 tools)', { size: 10.5, fill: C.text4 }));

  /* ------------------------------- composer ------------------------------- */
  b.push(rect(0, 736, W, 164, { fill: 'url(#fadeDown)' }));
  b.push(rect(L, 752, R - L, 106, { r: 14, fill: '#05060a', stroke: '#ffffff17' }));
  b.push(text(L + 16, 782, 'Now animate the rig so it leans into turns', { size: 14, fill: '#8c9099' }));
  b.push(text(L + 16, 800, 'and add a second colour for boosts', { size: 14, fill: '#8c9099' }));

  const barY = 812;
  b.push(rect(L + 10, barY, 118, 27, { r: 7, fill: '#ffffff09', stroke: C.line }));
  b.push(mark(L + 18, barY + 7, 13));
  b.push(text(L + 37, barY + 17, 'Eltes CAI-1', { size: 11, weight: 500, fill: C.text2 }));
  b.push(icon('chevron-down', L + 104, barY + 9, 11, C.text4));

  b.push(rect(L + 135, barY, 74, 27, { r: 7, fill: '#ffffff10', stroke: C.line2 }));
  b.push(icon('wrench', L + 143, barY + 7, 13, C.text2));
  b.push(text(L + 161, barY + 18, 'Agent', { size: 11, weight: 500, fill: C.text2 }));

  b.push(rect(L + 215, barY, 88, 27, { r: 7, fill: '#ffffff10', stroke: C.line2 }));
  b.push(icon('plug', L + 223, barY + 7, 13, C.text2));
  b.push(text(L + 241, barY + 18, 'MCP · 8', { size: 11, weight: 500, fill: C.text }));

  b.push(rect(L + 309, barY, 62, 27, { r: 7, fill: 'transparent', stroke: 'transparent' }));
  b.push(icon('globe', L + 315, barY + 7, 13, C.text3));
  b.push(text(L + 332, barY + 18, 'Web', { size: 11, fill: C.text3 }));

  b.push(icon('paperclip', L + 381, barY + 7, 13, C.text3));

  b.push(kbd(R - 126, barY + 5, '↵', { w: 18 }));
  b.push(text(R - 102, barY + 18, 'send', { size: 10, fill: C.text4 }));
  b.push(rect(R - 43, barY - 3, 33, 33, { r: 9, fill: 'url(#silver)', stroke: '#ffffff4d' }));
  b.push(icon('arrow-up', R - 34, barY + 6, 15, '#ffffff', 2.2));

  b.push(icon('lock', 622, 874, 11, C.text4));
  b.push(text(638, 882, 'Keys and history stay in this browser; hosted calls go direct or through a proxy you configure.', { size: 10.5, fill: C.text4 }));

  return svg(W, H, b.join('\n'), DEFS);
}

/* ============================== settings · MCP ============================== */

function mcpScreen() {
  const b = [];
  const W = 1280;
  const H = 860;
  const D = { x: 145, y: 50, w: 990, h: 760 };

  b.push(rect(0, 0, W, H, { fill: '#050506' }));
  b.push(rect(0, 0, W, H, { fill: 'url(#shellGlow)', opacity: 0.5 }));
  // the workspace behind the dialog, dimmed
  b.push(rect(0, 0, 272, H, { fill: '#030304' }));
  b.push(line(272, 0, 272, H, { stroke: C.line }));
  b.push(mark(16, 19, 20));
  b.push(text(44, 37, 'Eltes', { size: 16, weight: 600, opacity: 0.5 }));
  b.push(rect(313, 12, 236, 34, { r: 8, fill: '#ffffff05', stroke: C.line }));
  b.push(mark(325, 21, 15));
  b.push(text(347, 33, 'Eltes CAI-1', { size: 12.5, weight: 500, opacity: 0.45 }));
  b.push(rect(0, 0, W, H, { fill: '#000000', opacity: 0.58 }));

  b.push(rect(D.x, D.y, D.w, D.h, { r: 16, fill: C.ink, stroke: C.line2, sw: 1 }));
  b.push(rect(D.x, D.y, D.w, 64, { r: 16, fill: '#ffffff05' }));
  b.push(line(D.x, D.y + 64, D.x + D.w, D.y + 64, { stroke: C.line }));
  b.push(mark(D.x + 22, D.y + 22, 20));
  b.push(text(D.x + 52, D.y + 31, 'Settings', { size: 15, weight: 600 }));
  b.push(text(D.x + 52, D.y + 47, 'Saved locally · Eltes CAI-1', { size: 11, fill: C.text3 }));
  b.push(icon('x', D.x + D.w - 36, D.y + 23, 17, C.text3));

  /* nav */
  const navW = 196;
  b.push(rect(D.x, D.y + 65, navW, D.h - 65, { fill: '#ffffff03' }));
  b.push(line(D.x + navW, D.y + 65, D.x + navW, D.y + D.h, { stroke: C.line }));

  const nav = [
    ['General', 'sliders-horizontal'],
    ['API keys', 'key-round'],
    ['MCP', 'plug'],
    ['Models', 'layers'],
    ['Account', 'user'],
    ['Data', 'hard-drive'],
    ['About', 'info']
  ];
  nav.forEach(([label, ic], i) => {
    const y = D.y + 76 + i * 36;
    const active = label === 'MCP';
    if (active) {
      b.push(rect(D.x + 10, y, navW - 20, 34, { r: 7, fill: '#ffffff12' }));
      b.push(rect(D.x + 10, y, 2, 34, { r: 1, fill: '#bcbfc7' }));
    }
    b.push(icon(ic, D.x + 22, y + 9, 16, active ? C.text : C.text3));
    b.push(text(D.x + 47, y + 22, label, { size: 12.5, fill: active ? '#e8eaee' : C.text2, weight: active ? 500 : 400 }));
  });
  b.push(text(D.x + 20, D.y + D.h - 58, 'Eltes v3.19.0 · BYOK', { size: 10, fill: C.text4 }));
  b.push(text(D.x + 20, D.y + D.h - 44, 'Optional proxy. No telemetry.', { size: 10, fill: C.text4 }));
  b.push(text(D.x + 20, D.y + D.h - 30, 'What’s new →', { size: 10, fill: C.text3 }));

  /* panel */
  const P = D.x + navW + 22;
  const PW = D.w - navW - 44;
  let y = D.y + 84;

  b.push(text(P, y, 'Model Context Protocol', { size: 13.5, weight: 600 }));
  y += 18;
  [
    'MCP lets Eltes call tools that live in other programs on this machine — Blender,',
    'Roblox Studio, or any server you run. Eltes speaks HTTP only; command-based',
    'servers go through a small bridge you start once and leave open.'
  ].forEach((s) => { b.push(text(P, y, s, { size: 12, fill: C.text3 })); y += 17; });

  y += 8;
  const card = (top, opts) => {
    const h = opts.h;
    b.push(rect(P, top, PW, h, { r: 12, fill: '#ffffff06', stroke: C.line }));
    b.push(rect(P + 13, top + 12, 30, 30, { r: 9, fill: '#7aa6ff1f' }));
    b.push(icon('box', P + 20, top + 19, 16, C.text, 1.7));
    b.push(text(P + 53, top + 25, opts.name, { size: 13, weight: 600 }));
    b.push(text(P + 53, top + 42, opts.what, { size: 10.5, fill: C.text3 }));
    b.push(button(P + PW - 103, top + 13, 90, 30, 'Reconnect', { size: 12 }));
    opts.steps.forEach((s, i) => {
      const sy = top + 66 + i * 16;
      b.push(text(P + 22, sy, String(i + 1) + '.', { size: 10.5, fill: C.text4, mono: true }));
      b.push(text(P + 36, sy, s, { size: 10.5, fill: C.text3 }));
    });
    const fy = top + h - 38;
    let fx = P + 13;
    opts.buttons.forEach((label, i) => {
      const w = Math.round(tw(label, 11) + 26);
      b.push(button(fx, fy, w, 26, label, { size: 11, r: 7, icon: i === 0 ? 'copy' : 'download' }));
      fx += w + 6;
    });
    b.push(circle(P + PW - 13 - tw(opts.status, 10) - 10, fy + 13, 3, { fill: C.green }));
    b.push(text(P + PW - 13, fy + 17, opts.status, { size: 10, fill: C.greenText, anchor: 'end', ls: '0.04em' }));
  };

  card(y, {
    h: 172,
    name: 'Blender',
    what: 'Build objects, apply materials, keyframe animation and render stills from chat.',
    steps: [
      'Install the BlenderMCP add-on in Blender (one .py file, Add-ons → Install).',
      'In Blender, open the sidebar (N) → BlenderMCP → Start MCP server.',
      'Download and run connect-blender (or copy the command) on this machine.',
      'Come back here and press Connect.'
    ],
    buttons: ['Copy command', '.bat', '.sh'],
    status: 'CONNECTED · 14 TOOLS'
  });
  y += 172 + 10;
  card(y, {
    h: 172,
    name: 'Roblox Studio',
    what: 'Parts, model builds, Luau scripts, rig animation, effects and a playable game scaffold.',
    steps: [
      'Download the bridge script below and run it (double-click on Windows).',
      'Download EltesRobloxBridge.lua and put it in your Studio Plugins folder.',
      'In Studio turn on Game Settings → Security → Allow HTTP Requests.',
      'Come back here and press Connect.'
    ],
    buttons: ['Copy command', '.bat', '.sh', 'Studio plugin'],
    status: 'CONNECTED · 8 TOOLS'
  });
  y += 172 + 28;

  b.push(line(P, y - 14, P + PW, y - 14, { stroke: C.line }));
  b.push(text(P, y, 'Your servers', { size: 13.5, weight: 600 }));
  y += 18;
  b.push(text(P, y, 'Saved in this browser only. Nothing connects until you press Connect.', { size: 12, fill: C.text3 }));
  y += 8;

  const rows = [
    ['Blender', 'http://127.0.0.1:9876/mcp', 'connected · 14 tools'],
    ['Roblox Studio', 'http://127.0.0.1:8410/mcp', 'connected · 8 tools']
  ];
  rows.forEach(([name, url, status]) => {
    b.push(line(P, y, P + PW, y, { stroke: C.line }));
    b.push(rect(P + 2, y + 8, 24, 24, { r: 7, fill: '#ffffff0a' }));
    b.push(icon('server', P + 6, y + 12, 15, C.text2));
    b.push(text(P + 36, y + 20, name, { size: 12.5, weight: 500 }));
    b.push(text(P + 36, y + 33, url, { size: 10.5, fill: C.text4, mono: true }));
    b.push(circle(P + PW - 162 - tw(status, 10) - status.length * 0.4 - 10, y + 21, 3, { fill: C.green }));
    b.push(text(P + PW - 162, y + 24, status, { size: 10, fill: C.greenText, anchor: 'end', ls: '0.04em' }));
    b.push(button(P + PW - 150, y + 8, 78, 26, 'Disconnect', { size: 11, r: 7 }));
    b.push(icon('x', P + PW - 44, y + 14, 14, C.text4));
    y += 42;
  });

  y += 6;
  b.push(rect(P, y, 160, 30, { r: 8, fill: '#ffffff08', stroke: C.line }));
  b.push(text(P + 10, y + 19, 'Name, e.g. Files', { size: 11.5, fill: C.text4 }));
  b.push(rect(P + 168, y, PW - 168 - 52, 30, { r: 8, fill: '#ffffff08', stroke: C.line }));
  b.push(text(P + 178, y + 19, 'http://127.0.0.1:9876/mcp', { size: 11.5, fill: C.text3, mono: true }));
  b.push(button(P + PW - 44, y, 44, 30, 'Add', { size: 11.5, r: 8 }));
  y += 40;

  b.push(icon('shield', P, y, 11, C.text4));
  b.push(text(P + 17, y + 9, 'A connected server can run code on this machine. Connect only servers you trust, and keep the bridge on 127.0.0.1. ', { size: 10.5, fill: C.text4 }));
  b.push(text(P + PW, y + 9, 'Read the MCP docs.', { size: 10.5, fill: '#c9ccd3', anchor: 'end' }));

  return svg(W, H, b.join('\n'), DEFS);
}

/* ================================ landing ================================ */

function landingScreen() {
  const b = [];
  const W = 1440;
  const H = 900;

  b.push(rect(0, 0, W, H, { fill: '#000003' }));
  b.push(rect(0, 0, W, H, { fill: 'url(#nebulaA)' }));
  b.push(rect(0, 0, W, H, { fill: 'url(#nebulaB)' }));
  b.push(rect(0, 0, W, H, { fill: 'url(#nebulaC)' }));
  // star field
  const stars = [[120,120],[210,300],[330,90],[420,220],[520,60],[660,150],[780,80],[900,190],[1010,70],[1120,160],[1240,110],[1330,250],[180,520],[300,610],[520,700],[1240,560],[1350,700],[90,760],[700,640],[960,700]];
  stars.forEach(([x, y], i) => b.push(circle(x, y, i % 3 === 0 ? 1.4 : 0.9, { fill: '#ffffff', opacity: i % 2 ? 0.35 : 0.6 })));

  /* nav */
  b.push(rect(0, 0, W, 68, { fill: '#00000399' }));
  b.push(line(0, 68, W, 68, { stroke: C.line }));
  b.push(mark(140, 24, 20));
  b.push(text(168, 39, 'Eltes', { size: 16, weight: 600 }));
  b.push(text(208, 38, 'AI agent', { size: 9.5, fill: C.text4, ls: '0.06em' }));

  const links = [['Models', 300], ['Search', 366], ['Studio', 428], ['Features', 492], ['Pricing', 566], ['Downloads', 628], ['Docs', 712], ['News', 760]];
  links.forEach(([label, x]) => b.push(text(x, 39, label, { size: 13, fill: '#9aa4b5' })));

  b.push(icon('github', 1020, 26, 17, '#8d97a8'));
  b.push(rect(1052, 20, 74, 32, { r: 9, fill: '#ffffff08', stroke: C.line2 }));
  b.push(text(1089, 40, 'Sign in', { size: 12.5, fill: C.text, anchor: 'middle' }));
  b.push(rect(1138, 20, 162, 32, { r: 9, fill: 'url(#btnBlue)', stroke: '#96beff4d' }));
  b.push(text(1219, 40, 'Create account  →', { size: 12.5, fill: '#ffffff', anchor: 'middle', weight: 500 }));

  /* hero */
  b.push(rect(494, 182, 4, 4, { r: 1, fill: '#6e89b3' }));
  b.push(rect(501, 178, 4, 8, { r: 1, fill: '#6e89b3' }));
  b.push(rect(508, 174, 4, 12, { r: 1, fill: '#80e2c0' }));
  b.push(text(524, 186, 'REAL-TIME WEB SEARCH · 65 MODELS · ONE THREAD', { size: 10, fill: '#91a8ce', ls: '0.16em', weight: 600, mono: true }));

  b.push(text(720, 282, 'Ask the web.', { size: 82, weight: 570, anchor: 'middle', ls: '-0.065em', fill: '#f4f7fb' }));
  b.push(text(720, 362, 'Keep the receipts.', { size: 82, weight: 570, anchor: 'middle', ls: '-0.065em', fill: 'url(#heroLine)' }));

  b.push(text(720, 414, 'Live web search with numbered citations, built into a workspace that moves between', { size: 16, fill: '#aab9d1', anchor: 'middle' }));
  b.push(text(720, 438, 'Claude, ChatGPT, Gemini, DeepSeek and 60+ more models without losing the thread.', { size: 16, fill: '#aab9d1', anchor: 'middle' }));

  b.push(rect(516, 478, 214, 50, { r: 13, fill: 'url(#btnBlue)', stroke: '#96beff4d' }));
  b.push(text(610, 509, 'Open the workspace', { size: 14.5, fill: '#ffffff', anchor: 'middle', weight: 550 }));
  b.push(icon('arrow-right', 690, 496, 16, '#ffffff', 2));
  b.push(rect(746, 478, 202, 50, { r: 13, fill: '#ffffff08', stroke: C.line2 }));
  b.push(text(836, 509, 'See how search works', { size: 14.5, fill: C.text, anchor: 'middle', weight: 500 }));
  b.push(icon('arrow-down', 918, 497, 15, C.text2));

  const stats = [['65', 'MODELS', 450], ['14', 'PROVIDERS', 630], ['4', 'SEARCH BACKENDS', 810], ['0', 'DEMO REPLIES', 990]];
  stats.forEach(([n, label, x]) => {
    b.push(text(x, 592, n, { size: 27, weight: 550, anchor: 'middle', fill: '#eef3fb' }));
    b.push(text(x, 610, label, { size: 9, anchor: 'middle', fill: C.text4, ls: '0.12em', weight: 600 }));
  });

  const note = [[388, 'globe', 'Live sources, not guesses', '#71829e'], [575, 'key-round', 'Bring your own key', '#71829e'],
    [722, 'shield-check', 'Local history by default', '#71829e'], [894, 'sparkles', 'New: effects drawn in code', '#a3c2fb']];
  note.forEach(([x, ic, label, color]) => {
    b.push(icon(ic, x, 641, 13, '#6e89b3'));
    b.push(text(x + 19, 651, label, { size: 11.5, fill: color }));
  });

  /* showcase shell */
  const S = { x: 160, y: 686, w: 1120, h: 340 };
  b.push(rect(S.x, S.y, S.w, S.h, { r: 16, fill: '#05070d', stroke: C.line2 }));
  b.push(rect(S.x, S.y, S.w, 46, { r: 16, fill: '#ffffff05' }));
  b.push(line(S.x, S.y + 46, S.x + S.w, S.y + 46, { stroke: C.line }));
  b.push(mark(S.x + 18, S.y + 13, 20));
  b.push(text(S.x + 46, S.y + 28, 'Eltes', { size: 13.5, weight: 600 }));
  b.push(text(S.x + 92, S.y + 28, '/', { size: 13, fill: C.text4 }));
  b.push(text(S.x + 104, S.y + 28, 'Model workspace', { size: 12.5, fill: C.text2 }));
  b.push(circle(S.x + 764, S.y + 23, 3, { fill: '#7aa6ff' }));
  b.push(text(S.x + 774, S.y + 27, 'Local-first · BYOK · Web search', { size: 10.5, fill: C.text3 }));
  b.push(pill(S.x + S.w - 96, S.y + 13, 'Preview', { size: 9.5, h: 20, pad: 10, color: C.text3 }));

  const models = [
    ['Claude Sonnet 4.5', 'Anthropic', '200K', true],
    ['GPT-5', 'OpenAI', '400K', false],
    ['Gemini 2.5 Pro', 'Google', '1M', false],
    ['DeepSeek V3.2', 'DeepSeek', '128K', false]
  ];
  models.forEach(([name, provider, ctx, on], i) => {
    const y = S.y + 62 + i * 56;
    b.push(rect(S.x + 18, y, 360, 48, { r: 10, fill: on ? '#ffffff0d' : '#ffffff04', stroke: on ? C.line2 : C.line }));
    b.push(rect(S.x + 30, y + 10, 28, 28, { r: 8, fill: '#ffffff09', stroke: C.line }));
    b.push(text(S.x + 34, y + 29, name.slice(0, 1), { size: 12, weight: 600, fill: C.text2 }));
    b.push(text(S.x + 70, y + 22, name, { size: 12.5, weight: 500, fill: on ? C.text : C.text2 }));
    b.push(text(S.x + 70, y + 37, provider + ' · ' + ctx + ' context', { size: 10, fill: C.text4 }));
    if (on) b.push(circle(S.x + 358, y + 16, 2.5, { fill: C.green }));
  });

  b.push(rect(S.x + 394, S.y + 62, S.x + S.w - 412 - S.x, 220, { r: 12, fill: '#ffffff04', stroke: C.line }));
  b.push(text(S.x + 414, S.y + 90, 'Selected model', { size: 10, fill: C.text4, ls: '0.1em', weight: 600 }));
  b.push(text(S.x + 414, S.y + 116, 'Claude Sonnet 4.5', { size: 17, weight: 600 }));
  b.push(text(S.x + 414, S.y + 138, 'Anthropic · 200K context · vision · tools', { size: 11, fill: C.text3 }));
  b.push(text(S.x + 414, S.y + 176, 'Each row is a real catalogue entry. Choosing one only changes the selection —', { size: 11, fill: C.text3 }));
  b.push(text(S.x + 414, S.y + 194, 'nothing is sent until you write a message and connect a key.', { size: 11, fill: C.text3 }));
  b.push(rect(S.x + 414, S.y + 216, 132, 30, { r: 8, fill: '#ffffff0a', stroke: C.line }));
  b.push(text(S.x + 480, S.y + 235, 'Why this model?', { size: 11, fill: C.text2, anchor: 'middle' }));

  return svg(W, H, b.join('\n'), DEFS);
}

/* ================================= docs ================================= */

function docsScreen() {
  const b = [];
  const W = 1280;
  const H = 860;

  b.push(rect(0, 0, W, H, { fill: '#030405' }));
  b.push(rect(0, 0, W, H, { fill: 'url(#shellGlow)', opacity: 0.45 }));

  b.push(rect(0, 0, W, 62, { fill: '#030405cc' }));
  b.push(line(0, 62, W, 62, { stroke: C.line }));
  b.push(mark(48, 21, 20));
  b.push(text(76, 36, 'Eltes', { size: 15, weight: 600 }));
  b.push(text(114, 35, 'Docs', { size: 10, fill: C.text4, ls: '0.08em' }));
  b.push(text(950, 36, 'Guide', { size: 12.5, fill: C.text3 }));
  b.push(text(1005, 36, 'Commands', { size: 12.5, fill: C.text3 }));
  b.push(text(1080, 36, 'Self-host', { size: 12.5, fill: C.text3 }));
  b.push(rect(1155, 16, 82, 30, { r: 8, fill: '#ffffff08', stroke: C.line2 }));
  b.push(text(1196, 35, 'Open app', { size: 11.5, fill: C.text, anchor: 'middle' }));

  /* sidebar */
  b.push(rect(0, 63, 260, H - 63, { fill: '#ffffff02' }));
  b.push(line(260, 63, 260, H, { stroke: C.line }));
  b.push(text(28, 104, 'GETTING STARTED', { size: 8.5, weight: 600, fill: C.text4, ls: '0.14em' }));
  ['Overview', 'Quick start', 'Keys & models'].forEach((s, i) => b.push(text(28, 132 + i * 26, s, { size: 12, fill: C.text3 })));
  b.push(text(28, 232, 'WORKSPACE', { size: 8.5, weight: 600, fill: C.text4, ls: '0.14em' }));
  [['Chat & slash commands', 260], ['Agent mode', 286], ['MCP servers', 312], ['Studio', 338]].forEach(([s, y], i) => {
    const active = i === 2;
    if (active) b.push(rect(16, y - 15, 228, 30, { r: 7, fill: '#ffffff0b' }));
    b.push(text(28, y, s, { size: 12.5, fill: active ? C.text : C.text3, weight: active ? 500 : 400 }));
    if (active) b.push(rect(16, y - 9, 2, 18, { r: 1, fill: '#c9ccd3' }));
  });
  b.push(text(28, 392, 'CAI ENGINE', { size: 8.5, weight: 600, fill: C.text4, ls: '0.14em' }));
  ['What runs locally', 'Tools', 'Limits'].forEach((s, i) => b.push(text(28, 420 + i * 26, s, { size: 12, fill: C.text3 })));

  /* content */
  const X = 312;
  const RW = 900;
  b.push(text(X, 110, 'Docs / Workspace', { size: 10.5, fill: C.text4, mono: true }));
  b.push(text(X, 156, 'MCP servers', { size: 34, weight: 600, ls: '-0.03em' }));
  b.push(text(X, 190, 'Connect Eltes to tools that live in other programs — Blender, Roblox Studio, or anything', { size: 13.5, fill: C.text3 }));
  b.push(text(X, 210, 'that speaks the Model Context Protocol. You start the server; Eltes only talks to it.', { size: 13.5, fill: C.text3 }));

  b.push(text(X, 252, 'The four pieces', { size: 15, weight: 600 }));
  const rows = [
    ['assets/js/mcp.js', 'Client: initialize → tools/list → tools/call over Streamable HTTP.'],
    ['mcp/eltes-mcp-bridge.mjs', 'stdio ⇄ HTTP bridge for command servers such as Blender.'],
    ['mcp/eltes-roblox-bridge.mjs', 'MCP server for Roblox with a command queue on port 8410.'],
    ['mcp/EltesRobloxBridge.lua', 'Studio plugin: applies each edit inside an undo recording.']
  ];
  let y = 272;
  rows.forEach(([file, role], i) => {
    b.push(rect(X, y, RW, 34, { r: 7, fill: i % 2 ? '#ffffff03' : '#ffffff06', stroke: C.line }));
    b.push(text(X + 12, y + 22, file, { size: 10.5, mono: true, fill: '#cfd3d9' }));
    b.push(text(X + 246, y + 22, role, { size: 11.5, fill: C.text3 }));
    y += 38;
  });

  b.push(text(X, y + 32, 'Add a server in four steps', { size: 15, weight: 600 }));
  const steps = [
    'Press Add & connect on a preset. Eltes saves the URL and downloads a .bat or .sh connector.',
    'Run the connector from a terminal (or double-click it). It starts the bridge on 127.0.0.1.',
    'Start the app side: BlenderMCP in Blender, or EltesRobloxBridge in Studio with HTTP requests on.',
    'Press Connect in Settings → MCP. Tools appear as server__tool in the trace and in the composer chip.'
  ];
  steps.forEach((s, i) => {
    const sy = y + 66 + i * 30;
    b.push(circle(X + 11, sy - 4, 9, { fill: '#ffffff0a', stroke: C.line2 }));
    b.push(text(X + 11, sy, String(i + 1), { size: 10, fill: C.text2, anchor: 'middle', mono: true }));
    b.push(text(X + 32, sy, s, { size: 12, fill: C.text3 }));
  });

  const codeY = y + 208;
  b.push(rect(X, codeY, RW, 76, { r: 10, fill: '#05070d', stroke: C.line }));
  b.push(text(X + 14, codeY + 20, 'terminal', { size: 9, fill: C.text4, ls: '0.12em', weight: 600 }));
  b.push(text(X + 14, codeY + 42, '$', { size: 11.5, fill: C.text4, mono: true }));
  b.push(text(X + 28, codeY + 42, 'node mcp/eltes-roblox-bridge.mjs --port 8410', { size: 11.5, fill: '#d7dbe2', mono: true }));
  b.push(text(X + 14, codeY + 62, 'bridge listening on http://127.0.0.1:8410/mcp · plugin polls /next', { size: 10.5, fill: C.greenText, mono: true }));

  const callY = codeY + 96;
  b.push(rect(X, callY, RW, 62, { r: 10, fill: '#ffc2660d', stroke: '#ffc26633' }));
  b.push(icon('shield', X + 14, callY + 14, 15, C.warn));
  b.push(text(X + 38, callY + 24, 'A connected server can run code on this machine', { size: 12, weight: 600, fill: '#f0d7ad' }));
  b.push(text(X + 38, callY + 42, 'Keep bridges on 127.0.0.1, use --token when you can, and connect only servers you trust.', { size: 11.5, fill: '#9c8f7a' }));

  return svg(W, H, b.join('\n'), DEFS);
}

/* --------------------------------- write --------------------------------- */

loadIcons();
for (const name of ['box', 'sliders-horizontal', 'user', 'server', 'check', 'wrench', 'plug', 'globe', 'paperclip',
  'arrow-up', 'chevron-down', 'panel-left', 'search', 'download', 'terminal', 'book-open', 'settings', 'key-round',
  'message-square', 'plus', 'lock', 'x', 'shield', 'sparkles', 'arrow-right', 'arrow-down', 'github', 'shield-check',
  'copy', 'layers', 'hard-drive', 'info']) {
  if (!ICONS[name]) throw new Error('missing icon: ' + name);
}
fs.mkdirSync(OUT, { recursive: true });
const screens = {
  'workspace.svg': chatScreen(),
  'mcp-settings.svg': mcpScreen(),
  'landing.svg': landingScreen(),
  'docs-mcp.svg': docsScreen()
};
for (const [name, data] of Object.entries(screens)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`${name.padEnd(18)} ${(data.length / 1024).toFixed(1)} kB`);
}
