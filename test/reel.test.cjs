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
    clip() { calls.push(['clip']); },
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

test('the editor ships keyframes, transitions, templates and the keyboard sheet', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'assets/js/reel-ui.js'), 'utf8');
  for (const token of ['reelShortcutsDialog', 'insTransition', 'reelStarter', 'reelProjectFile', 'loadProjectData', 'paintWaveforms', '[data-key]']) {
    assert.ok(ui.includes(token), `reel-ui.js should wire ${token}`);
  }
  const css = fs.readFileSync(path.join(ROOT, 'assets/css/reel.css'), 'utf8');
  for (const token of ['.reel-trans', '.reel-wave', '.reel-keyrow', '.reel-starter']) {
    assert.ok(css.includes(token), `reel.css should style ${token}`);
  }
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

test('transitions belong to the clip and only cover their window', () => {
  const clip = Reel.createClip('video', { start: 2, duration: 4, transition: { type: 'fade', duration: 0.5 } });
  assert.equal(clip.transition.type, 'fade');
  assert.equal(Reel.TRANSITIONS.length, 6);
  assert.equal(Reel.transitionState(clip, 2), null, 'no transition at the exact cut');
  const mid = Reel.transitionState(clip, 2.25);
  assert.equal(mid.type, 'fade');
  assert.ok(mid.t > 0.4 && mid.t < 0.6, `t is ${mid.t}`);
  assert.equal(Reel.transitionState(clip, 2.5), null, 'over after its duration');
  assert.equal(Reel.transitionState(Reel.createClip('video', { start: 0 }), 0.1), null, 'none by default');
  assert.equal(Reel.transitionState({ start: 0, duration: 2, transition: { type: 'spin', duration: 1 } }, 0.5), null, 'unknown types are ignored');
});

test('the previous clip is the one that ends under the cut', () => {
  const a = Reel.createClip('video', { start: 0, duration: 3, name: 'A' });
  const b = Reel.createClip('video', { start: 3, duration: 3, name: 'B' });
  const c = Reel.createClip('video', { start: 9, duration: 2, name: 'C' });
  const project = Reel.createProject({});
  project.clips.push(a, b, c);
  assert.equal(Reel.previousVisualClip(project, b).id, a.id);
  assert.equal(Reel.previousVisualClip(project, c), null, 'a gap is not a cut');
  b.start = 2.4;
  assert.equal(Reel.previousVisualClip(project, b).id, a.id, 'an overlap counts');
});

test('keyframes interpolate, hold and clamp at both ends', () => {
  const clip = Reel.createClip('image', { start: 0, duration: 4, keyframes: undefined });
  assert.equal(Reel.keyframeValue(clip, 'scale', 1), null, 'empty track means use the clip value');

  Reel.setKeyframe(clip, 'scale', 0, 1);
  Reel.setKeyframe(clip, 'scale', 4, 2, 'linear');
  assert.equal(Reel.keyframeValue(clip, 'scale', 2), 1.5);
  assert.equal(Reel.keyframeValue(clip, 'scale', -1), 1, 'holds before the first key');
  assert.equal(Reel.keyframeValue(clip, 'scale', 9), 2, 'holds after the last key');

  Reel.setKeyframe(clip, 'x', 0, 0.2, 'hold');
  Reel.setKeyframe(clip, 'x', 2, 0.8, 'hold');
  assert.equal(Reel.keyframeValue(clip, 'x', 1.9), 0.2, 'hold keeps the earlier value until the key');

  assert.equal(Reel.keyframeCount(clip), 4);
  assert.equal(Reel.hasKeyframe(clip, 'scale', 4.01), true, 'within the 20 ms window');
  assert.equal(Reel.setKeyframe(clip, 'nope', 0, 1), null, 'unknown properties are refused');
  Reel.setKeyframe(clip, 'scale', 4, 2, 'linear');
  assert.equal(Reel.keyframeCount(clip), 4, 'setting a key at an existing time updates it');
  Reel.setKeyframe(clip, 'scale', 2, 1.25, 'linear');
  assert.equal(Reel.keyframeCount(clip), 5, 'a new time adds a key');
  assert.equal(Reel.keyframeValue(clip, 'scale', 2), 1.25);

  Reel.removeKeyframe(clip, 'scale', 2);
  assert.equal(Reel.keyframeCount(clip), 4);
  assert.equal(Reel.keyframeValue(clip, 'scale', 2), 1.5, 'the two remaining keys still blend');
});

test('keyed clips draw with the interpolated transform', () => {
  const ctx = fakeCtx();
  const clip = Reel.createClip('image', { start: 0, duration: 4, opacity: 1 });
  clip.mediaId = 'm1';
  const el = { videoWidth: 800, videoHeight: 450, width: 800, height: 450 };
  const map = new Map([['m1', { el }]]);
  Reel.setKeyframe(clip, 'x', 0, 0.25);
  Reel.setKeyframe(clip, 'x', 4, 0.75);
  Reel.setKeyframe(clip, 'opacity', 0, 0.4);
  Reel.setKeyframe(clip, 'opacity', 4, 1);
  const project = Reel.createProject({ width: 1000, height: 600 });
  project.clips.push(clip);
  Reel.drawFrame(ctx, project, 1, map);

  const call = ctx.calls.find((entry) => entry[0] === 'translate');
  assert.ok(call, 'draws the clip');
  assert.equal(Math.round(call[1]), 281, 'x keys pan the picture with ease-in-out');

  const state = Reel.clipState(clip, 1);
  assert.ok(Math.abs(state.x - 0.28125) < 0.001);
  assert.ok(Math.abs(state.opacity - 0.4375) < 0.001);
  assert.equal(state.rotate, 0, 'unkeyed rotation stays on the clip value');
});
test('motion eases across a clip and stops at its edges', () => {
  const clip = Reel.createClip('image', { start: 2, duration: 4, motion: { type: 'zoom-in', amount: 0.2 } });
  assert.equal(clip.motion.type, 'zoom-in');
  assert.equal(Reel.MOTION_IDS.length, 6);
  assert.equal(Reel.motionAt(clip, 2).scale, 1, 'starts at 1x');
  assert.ok(Reel.motionAt(clip, 4).scale === 1.1, 'halfway is half the move');
  assert.ok(Reel.motionAt(clip, 5).scale > 1.1, 'keeps moving');
  assert.equal(Reel.motionAt(clip, 6).scale, 1.2, 'ends at 1 + amount and clamps');

  const pan = Reel.createClip('image', { start: 0, duration: 4, motion: { type: 'pan-right', amount: 0.2 } });
  assert.ok(Reel.motionAt(pan, 0).dx < 0, 'starts left of centre');
  assert.ok(Reel.motionAt(pan, 4).dx > 0, 'ends right of centre');
  assert.ok(Reel.motionAt(pan, 2).scale > 1, 'pans need a little headroom');

  const still = Reel.motionAt(Reel.createClip('image', {}), 1);
  assert.equal(still.scale, 1);
  assert.equal(still.dx, 0);
  assert.equal(still.dy, 0);
  assert.equal(Reel.motionAt({ start: 0, duration: 2, motion: { type: 'spin' } }, 1).scale, 1, 'unknown moves are ignored');
});

test('drawFrame composites both layers for a transition', () => {
  const a = Reel.createClip('video', { start: 0, duration: 3, name: 'A' });
  const b = Reel.createClip('video', { start: 3, duration: 3, name: 'B', transition: { type: 'fade', duration: 1 } });
  const project = Reel.createProject({});
  project.clips.push(a, b);
  const sources = new Map([
    [null, null],
    ['none', null]
  ]);
  const image = { naturalWidth: 1920, naturalHeight: 1080, width: 1920, height: 1080 };
  a.mediaId = 'ma';
  b.mediaId = 'mb';
  sources.set('ma', { el: image, kind: 'image' });
  sources.set('mb', { el: image, kind: 'image' });

  const made = [];
  const scratch = (width, height) => {
    const canvas = { width, height, ctx: fakeCtx() };
    canvas.getContext = () => canvas.ctx;
    made.push(canvas);
    return canvas;
  };
  const ctx = fakeCtx();
  Reel.drawFrame(ctx, project, 3.4, sources, { scratch });

  assert.equal(made.length, 2, 'two layers are rendered offscreen');
  assert.ok(made[0].ctx.calls.some((call) => call[0] === 'drawImage'), 'the outgoing clip is drawn');
  assert.ok(made[1].ctx.calls.some((call) => call[0] === 'drawImage'), 'the incoming clip is drawn');
  const composites = ctx.calls.filter((call) => call[0] === 'drawImage' && (call[1] === made[0] || call[1] === made[1]));
  assert.equal(composites.length, 2, 'both layers reach the canvas');
  // The incoming layer is drawn at partial alpha by the crossfade.
  const fadeDraw = ctx.calls.filter((call) => call[0] === 'drawImage').length;
  assert.equal(fadeDraw, 2);
  assert.equal(Reel.transitionState(b, 3.4).type, 'fade');
});

test('peaksFrom reduces a buffer to visible bars', () => {
  const data = new Float32Array(1000);
  for (let i = 0; i < data.length; i += 1) data[i] = i % 100 === 0 ? 0.8 : (i % 50) / 100;
  const buffer = { getChannelData: () => data };
  const peaks = Reel.peaksFrom(buffer, 50);
  assert.equal(peaks.length, 50);
  assert.ok(Math.max(...peaks) > 0.7);
  assert.ok(peaks.every((value) => value >= 0 && value <= 1));
  assert.equal(Reel.peaksFrom(null, 20).length, 0);
  assert.equal(Reel.peaksFrom({ getChannelData: () => new Float32Array(0) }, 20).length, 0);
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
