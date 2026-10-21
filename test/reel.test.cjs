'use strict';
/* Eltes Reel — model, timeline maths, rendering and export helpers.
   The editor is a browser module, so it is loaded into a `vm` context with a
   minimal `window` (no DOM) and exercised through its public surface. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadReel() {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/reel.js'), 'utf8');
  const sandbox = { window: {}, console, Math, Number, Date, JSON, String, Object, Array, Map, Set };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'reel.js' });
  return sandbox.window.EltesReel;
}

const Reel = loadReel();

function fakeCtx() {
  const calls = [];
  const gradient = { addColorStop() {} };
  return {
    calls,
    filter: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    lineWidth: 1,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    clearRect() { calls.push(['clearRect']); },
    fillRect(x, y, w, h) { calls.push(['fillRect', x, y, w, h]); },
    strokeRect() {},
    beginPath() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    translate(x, y) { calls.push(['translate', x, y]); },
    scale() {},
    rotate() {},
    drawImage(image, x, y, w, h) { calls.push(['drawImage', image, x, y, w, h]); },
    fillText(text) { calls.push(['fillText', text]); },
    strokeText() {},
    measureText(text) { return { width: String(text).length * 9 }; },
    createRadialGradient() { return gradient; },
    createLinearGradient() { return gradient; },
    createPattern() { return {}; },
    setLineDash() {}
  };
}

test('a new project is empty, 1080p and 30 fps', () => {
  const project = Reel.createProject({});
  assert.equal(project.width, 1920);
  assert.equal(project.height, 1080);
  assert.equal(project.fps, 30);
  assert.equal(project.clips.length, 0);
  assert.equal(project.music.length, 0);
  assert.equal(Reel.projectLength(project), 1, 'an empty edit still has a second to stand on');
});

test('project length follows the furthest clip or music track', () => {
  const project = Reel.createProject({});
  project.clips.push(Reel.createClip('video', { start: 2, duration: 3 }));
  project.music.push(Reel.createMusic('m1', 'bed', { start: 0, duration: 8 }));
  assert.equal(Reel.projectLength(project), 8);
  project.clips.push(Reel.createClip('image', { start: 9, duration: 2 }));
  assert.equal(Reel.projectLength(project), 11);
});

test('clipsAt returns what is on screen, pictures before text', () => {
  const project = Reel.createProject({});
  project.clips.push(Reel.createTextClip('caption', { start: 0, duration: 4 }));
  project.clips.push(Reel.createClip('video', { start: 0, duration: 4 }));
  const visible = Reel.clipsAt(project, 1);
  assert.equal(visible.length, 2);
  assert.equal(visible[0].kind, 'video');
  assert.equal(visible[1].kind, 'text');
  assert.equal(Reel.clipsAt(project, 5).length, 0);
});

test('text presets carry their look and animation', () => {
  const clip = Reel.createTextClip('title', { start: 1 });
  assert.equal(clip.kind, 'text');
  assert.equal(clip.start, 1);
  assert.equal(clip.text.value, 'MAKE IT LOUD');
  assert.equal(clip.text.uppercase, true);
  assert.equal(clip.animation.in, 'pop');
  assert.ok(clip.text.size > 0.05, 'a title is larger than body copy');
});

test('splitting keeps the source in-point on the right half', () => {
  const project = Reel.createProject({});
  const clip = Reel.createClip('video', { start: 2, duration: 6, in: 1.5 });
  project.clips.push(clip);
  const right = Reel.splitClip(project, clip.id, 5);
  assert.equal(project.clips.length, 2);
  assert.equal(clip.duration, 3);
  assert.equal(right.start, 5);
  assert.equal(right.duration, 3);
  assert.equal(right.in, 4.5, '3 s of the source played before the cut');
  assert.equal(right.animation.in, 'none', 'the second half does not re-animate in');
  assert.notEqual(right.id, clip.id);
});

test('splitting outside a clip does nothing', () => {
  const project = Reel.createProject({});
  const clip = Reel.createClip('video', { start: 2, duration: 3 });
  project.clips.push(clip);
  assert.equal(Reel.splitClip(project, clip.id, 1), null);
  assert.equal(Reel.splitClip(project, clip.id, 5.2), null);
  assert.equal(project.clips.length, 1);
});

test('snapping prefers the nearest cut and can be switched off', () => {
  const points = [0, 4, 9];
  assert.equal(Reel.snapTime(4.05, points, 0.12, true), 4);
  assert.equal(Reel.snapTime(4.05, points, 0.12, false), 4.05);
  assert.equal(Reel.snapTime(-3, points, 0.12, true), 0, 'time never goes negative');
});

test('effectFilter writes CSS filters only for values that changed', () => {
  assert.equal(Reel.effectFilter({}), 'none');
  assert.equal(Reel.effectFilter({ contrast: 1.2 }), 'contrast(1.2)');
  const full = Reel.effectFilter({ brightness: 0.9, saturation: 1.4, hue: 12, blur: 2 });
  assert.match(full, /brightness\(0\.9\)/);
  assert.match(full, /saturation\(1\.4\)/);
  assert.match(full, /hue\(12deg\)/);
  assert.match(full, /blur\(2px\)/);
});

test('animations fade, lift and reveal over their own windows', () => {
  const clip = Reel.createClip('text', { start: 2, duration: 4, animation: { in: 'fade', out: 'fade', inDur: 1, outDur: 1 } });
  assert.ok(Reel.animationAt(clip, 2).alpha < 0.01, 'starts invisible');
  assert.ok(Reel.animationAt(clip, 2.5).alpha > 0.8, 'mostly in by half-way');
  assert.equal(Reel.animationAt(clip, 3).alpha, 1);
  assert.ok(Reel.animationAt(clip, 5.95).alpha < 0.2, 'fades out at the end');

  const rise = Reel.createClip('text', { start: 0, duration: 3, animation: { in: 'rise', out: 'none', inDur: 1, outDur: 0 } });
  assert.ok(Reel.animationAt(rise, 0).dy > 0.03, 'starts below its mark');
  assert.ok(Reel.animationAt(rise, 1).dy < 0.001, 'lands on its mark');

  const typed = Reel.createClip('text', { start: 0, duration: 3, animation: { in: 'type', out: 'none', inDur: 2, outDur: 0 } });
  assert.equal(Reel.animationAt(typed, 0).reveal, 0);
  assert.ok(Reel.animationAt(typed, 1).reveal > 0.8 && Reel.animationAt(typed, 1).reveal < 0.95);
  assert.equal(Reel.animationAt(typed, 2).reveal, 1);
});

test('fitRect covers or contains without cropping the maths', () => {
  const cover = Reel.fitRect(1920, 1080, 1080, 1920, 'cover');
  assert.ok(cover.w >= 1080 && cover.h >= 1920);
  const contain = Reel.fitRect(1920, 1080, 1080, 1920, 'contain');
  assert.equal(Math.round(contain.w), 1080);
  assert.equal(Math.round(contain.h), 608);
  assert.equal(Math.round(contain.x), 0);
});

test('wrapText breaks on words, never mid-word', () => {
  const measure = (text) => String(text).length * 10;
  const lines = Reel.wrapText('one two three four five', 90, measure);
  assert.deepEqual(Array.from(lines), ['one two', 'three', 'four five']);
  assert.equal(Reel.wrapText('', 100, measure).length, 0);
});

test('drawFrame paints the background, the picture and the words', () => {
  const ctx = fakeCtx();
  const project = Reel.createProject({ background: '#101010' });
  const video = { videoWidth: 1920, videoHeight: 1080, readyState: 4 };
  const clip = Reel.createClip('video', { start: 0, duration: 4 });
  clip.mediaId = 'm1';
  project.clips.push(clip);
  project.clips.push(Reel.createTextClip('title', { start: 0, duration: 4 }));
  const sources = new Map([['m1', { el: video, kind: 'video' }]]);

  Reel.drawFrame(ctx, project, 1, sources, {});
  const kinds = ctx.calls.map((call) => call[0]);
  assert.ok(kinds.includes('drawImage'), 'the video frame is drawn');
  const image = ctx.calls.find((call) => call[0] === 'drawImage');
  assert.equal(image[1], video);
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && call[1] === 'MAKE IT LOUD'));
});

test('missing media becomes a placeholder instead of a crash', () => {
  const ctx = fakeCtx();
  const project = Reel.createProject({});
  const clip = Reel.createClip('video', { start: 0, duration: 2, name: 'beach.mp4' });
  clip.mediaId = 'gone';
  project.clips.push(clip);
  Reel.drawFrame(ctx, project, 0.5, new Map(), {});
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && /Missing media/.test(call[1])));
});

test('a text clip honours its colour, alignment and typewriter reveal', () => {
  const ctx = fakeCtx();
  const project = Reel.createProject({});
  const clip = Reel.createTextClip('mono', { start: 0, duration: 4, animation: { in: 'type', out: 'none', inDur: 2, outDur: 0 } });
  clip.text.value = 'abcdefghij';
  project.clips.push(clip);
  Reel.drawFrame(ctx, project, 0.5, new Map(), {});
  const painted = ctx.calls.filter((call) => call[0] === 'fillText').map((call) => call[1]).join('');
  assert.ok(painted.length > 0 && painted.length < 10, `partially revealed, got "${painted}"`);
});

test('export picks the first format the browser can actually record', () => {
  const tested = [];
  const mime = Reel.pickMime(['video/mp4', 'video/webm;codecs=vp9,opus'], (type) => {
    tested.push(type);
    return type === 'video/webm;codecs=vp9,opus';
  });
  assert.equal(mime, 'video/webm;codecs=vp9,opus');
  assert.deepEqual(tested, ['video/mp4', 'video/webm;codecs=vp9,opus']);
  assert.equal(Reel.pickMime(['video/mp4'], () => false), '');
  assert.equal(Reel.extensionFor('video/webm;codecs=vp9,opus'), 'webm');
  assert.equal(Reel.extensionFor('video/mp4'), 'mp4');
});

test('the clock and file names survive real input', () => {
  assert.equal(Reel.formatTime(0), '0:00.0');
  assert.equal(Reel.formatTime(7.45), '0:07.4');
  assert.equal(Reel.formatTime(61.2), '1:01.2');
  assert.equal(Reel.parseClock('1:02.5'), 62.5);
  assert.equal(Reel.parseClock('nope'), null);
  assert.equal(Reel.sanitizeName('  my / reel: 01  '), 'my - reel- 01');
  assert.equal(Reel.sanitizeName(''), 'reel');
});

test('music fades are real numbers between 0 and 1', () => {
  const track = Reel.createMusic('m', 'bed', { start: 2, duration: 6, volume: 0.8, fadeIn: 1, fadeOut: 2 });
  assert.equal(Reel.musicEnd(track), 8);
  assert.equal(track.volume, 0.8);
  assert.ok(track.fadeIn < track.duration);
});

test('Studio ships the tab, the styles and the scripts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'studio.html'), 'utf8');
  assert.match(html, /id="btnTools"/);
  assert.match(html, /Other tools/);
  assert.match(html, /assets\/css\/reel\.css/);
  for (const script of ['assets/js/reel.js', 'assets/js/reel-ui.js', 'assets/js/studio-tools.js']) {
    assert.match(html, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(fs.existsSync(path.join(ROOT, script)), `${script} exists`);
  }
  const tabbar = html.indexOf('id="btnTools"');
  assert.ok(tabbar > 0 && tabbar < html.indexOf('id="tabs"'), 'the tools tab is pinned before #tabs');
  assert.match(html, /data-tools-open/, 'the empty state links to the tools screen');
  const css = fs.readFileSync(path.join(ROOT, 'assets/css/reel.css'), 'utf8');
  assert.match(css, /\.reel-timeline/);
  assert.match(css, /\.tools-screen/);
  assert.match(css, /\.reel-narrow\s*\{\s*display: none/, 'drawer buttons stay hidden on wide screens');
  assert.match(css, /\.reel-side\.open[\s\S]*position: absolute/, 'the side pane becomes a drawer on narrow screens');

  const tools = fs.readFileSync(path.join(ROOT, 'assets/js/studio-tools.js'), 'utf8');
  assert.match(tools, /EltesReelUI\.mount/);
  assert.match(tools, /onExit/);
  assert.equal(/fetch\(|XMLHttpRequest|sendBeacon/.test(tools), false, 'the tools screen makes no network calls');

  const ui = fs.readFileSync(path.join(ROOT, 'assets/js/reel-ui.js'), 'utf8');
  assert.match(ui, /sound inside video clips is not/, 'the export dialog states what is not captured');
});

test('Reel never uploads anything', () => {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/reel-ui.js'), 'utf8');
  assert.equal(/fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(source), false, 'no network calls');
  assert.equal(/eval\(|new Function/.test(source), false, 'no dynamic evaluation');
});
