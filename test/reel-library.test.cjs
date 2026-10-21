'use strict';
/* Eltes Reel — the look library, the title library, the starters and the free
   music bench. All four are plain data plus arithmetic, so they run in a `vm`
   with no DOM and no audio context. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function load(files) {
  const sandbox = {
    window: {},
    console,
    Math,
    Number,
    Date,
    JSON,
    String,
    Object,
    Array,
    Map,
    Set,
    Float32Array,
    Uint8Array,
    DataView,
    ArrayBuffer
  };
  vm.createContext(sandbox);
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(source, sandbox, { filename: file });
  }
  return sandbox.window;
}

const win = load(['assets/js/reel.js', 'assets/js/reel-library.js', 'assets/js/reel-music.js']);
const Reel = win.EltesReel;
const Library = win.EltesReelLibrary;
const Music = win.EltesReelMusic;

test('the look library is 400 unique, named looks in ten families', () => {
  assert.equal(Library.EFFECT_FAMILIES.length, 10);
  assert.equal(Library.EFFECT_LIBRARY.length, 400);
  const ids = new Set();
  const names = new Set();
  for (const look of Library.EFFECT_LIBRARY) {
    assert.match(look.id, /^[a-z]+-\d+$/);
    assert.ok(look.name && look.name.trim().length > 3, look.id);
    assert.ok(look.familyName, look.id);
    ids.add(look.id);
    names.add(look.name);
    // Recipes only ever ask the canvas for something it can draw.
    const f = look.filter;
    assert.ok(f.brightness >= 0.4 && f.brightness <= 1.8, `${look.id} brightness`);
    assert.ok(f.contrast >= 0.4 && f.contrast <= 2.1, `${look.id} contrast`);
    assert.ok(f.saturation >= 0 && f.saturation <= 2.5, `${look.id} saturation`);
    assert.ok(Math.abs(f.hue) <= 180, `${look.id} hue`);
    assert.ok(f.blur >= 0 && f.blur <= 12, `${look.id} blur`);
    assert.ok(f.sepia >= 0 && f.sepia <= 1, `${look.id} sepia`);
    for (const key of ['vignette', 'grain', 'leak', 'scanline']) {
      assert.ok(look.overlay[key] >= 0 && look.overlay[key] <= 1, `${look.id} ${key}`);
    }
  }
  assert.equal(ids.size, 400, 'every look id is unique');
  assert.equal(names.size, 400, 'every look has its own card title');
  assert.equal(Library.effectById('cinema-01') || Library.effectById('cinema-1') ? 1 : 0, 1);
  assert.equal(Library.effectById('nope'), null);
});

test('every look reaches the canvas through Reel.look', () => {
  assert.equal(Reel.looks().length, 408, 'the eight built-ins come first');
  const library = Reel.look('neon-17');
  assert.equal(library.id, 'neon-17');
  const builtIn = Reel.look('noir');
  assert.equal(builtIn.name, 'Noir');
  assert.equal(Reel.look('missing'), null);
  assert.equal(Reel.effectFilter(library.filter).includes('brightness'), true);
});

test('the title library is 200 unique, editable titles in ten families', () => {
  assert.equal(Library.TITLE_LIBRARY.length, 200);
  const animations = ['pop', 'rise', 'drop', 'fade', 'blur', 'type'];
  const names = new Set();
  for (const title of Library.TITLE_LIBRARY) {
    assert.ok(title.name && title.name.trim(), title.id);
    assert.ok(title.familyName, title.id);
    assert.ok(title.sample, title.id);
    names.add(title.name);
    assert.ok(title.x >= 0 && title.x <= 1, `${title.id} x`);
    assert.ok(title.y >= 0 && title.y <= 1, `${title.id} y`);
    assert.ok(animations.includes(title.animation.in), `${title.id} animation`);
    assert.ok(title.text && title.text.value, `${title.id} text`);
    assert.ok(['Inter', 'JetBrains Mono'].includes(title.text.font), `${title.id} font`);
    assert.ok(title.text.size >= 0.02 && title.text.size <= 0.22, `${title.id} size`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(title.text.color), `${title.id} colour`);
  }
  assert.equal(names.size, 200, 'every title has its own name');
});

test('a library title becomes an editable text clip', () => {
  assert.equal(Reel.titles().length, 205, 'the five built-ins come first');
  const preset = Reel.titlePreset('neon-4');
  assert.ok(preset);
  const clip = Reel.createTextClip(preset, { start: 3, duration: 2.5 });
  assert.equal(clip.kind, 'text');
  assert.equal(clip.start, 3);
  assert.equal(clip.duration, 2.5);
  assert.equal(clip.text.value, preset.sample);
  assert.equal(clip.text.color, preset.text.color);
  assert.equal(clip.animation.in, preset.animation.in);
  assert.equal(clip.name, preset.name);
  assert.notEqual(clip.id, Reel.createTextClip(preset, {}).id, 'each clip is its own object');
  // The old string ids still resolve, so projects and templates do not break.
  assert.equal(Reel.createTextClip('caption', {}).text.value, 'A caption that reads on any background');
});

test('eighteen starters build into ordinary clips', () => {
  assert.equal(Reel.templates().length, 18);
  const trackIds = new Set(Music.TRACKS.map((track) => track.id));
  for (const template of Reel.templates()) {
    assert.ok(template.name && template.blurb, template.id);
    assert.ok(trackIds.has(template.music), `${template.id} music`);
    const built = Reel.template(template.id);
    assert.ok(built, template.id);
    assert.equal(built.width, template.width);
    assert.equal(built.height, template.height);
    assert.ok(built.clips.length >= 1, template.id);
    assert.ok(built.duration > 0, template.id);
    for (const clip of built.clips) {
      assert.ok(['video', 'image', 'text'].includes(clip.kind), clip.kind);
      assert.ok(clip.duration > 0, `${template.id} ${clip.kind} duration`);
      assert.ok(clip.start >= 0, `${template.id} start`);
      assert.ok(Reel.MOTION_IDS.includes(clip.motion.type), `${template.id} motion ${clip.motion.type}`);
      assert.ok(Reel.TRANSITIONS.some((entry) => entry.id === clip.transition.type), `${template.id} transition`);
      if (clip.kind === 'text') assert.ok(String(clip.text.value).trim().length > 0, `${template.id} words`);
    }
  }
  assert.equal(Reel.template('not-a-template'), null);
});

test('every starter is editable: placeholders take media and carry no file', () => {
  const built = Reel.template('vlog-intro');
  const slots = built.clips.filter((clip) => clip.kind === 'image');
  assert.ok(slots.length >= 2);
  for (const slot of slots) {
    assert.equal(slot.mediaId, null, 'a slot is a placeholder, not an embedded file');
    assert.equal(slot.slot, true);
  }
});

test('twelve free tracks, rendered from arithmetic', () => {
  assert.equal(Music.TRACKS.length, 12);
  const ids = new Set();
  for (const track of Music.TRACKS) {
    ids.add(track.id);
    assert.ok(track.name && track.desc, track.id);
    assert.ok(track.bpm >= 40 && track.bpm <= 200, `${track.id} bpm`);
    assert.ok(track.bars >= 4 && track.bars <= 16, `${track.id} bars`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(track.color), `${track.id} colour`);
    assert.equal(Music.durationOf(track), Math.round(track.bars * (60 / track.bpm) * 4 * 10) / 10);
    assert.ok(Music.durationOf(track) >= 8, `${track.id} long enough to edit to`);
  }
  assert.equal(ids.size, 12);
  assert.equal(Music.trackById('missing'), null);
});

test('the rendered bed is audible, finite and normalised', () => {
  for (const id of ['lofi-morning', 'hype-drop']) {
    const rendered = Music.renderSamples(id);
    assert.ok(rendered.samples instanceof Float32Array);
    assert.equal(rendered.sampleRate, 22050);
    assert.ok(rendered.samples.length > 22050 * 8, `${id} is longer than eight seconds`);
    let peak = 0;
    let energy = 0;
    let bad = 0;
    for (let i = 0; i < rendered.samples.length; i += 7) {
      const value = rendered.samples[i];
      if (!Number.isFinite(value)) bad += 1;
      else {
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }
    }
    assert.equal(bad, 0, `${id} has no NaN samples`);
    assert.ok(peak > 0.2, `${id} is audible (peak ${peak})`);
    assert.ok(peak <= 1, `${id} never clips`);
    assert.ok(Math.sqrt(energy / Math.ceil(rendered.samples.length / 7)) > 0.01, `${id} has body`);
  }
});

test('wavBytes writes a real 16-bit mono PCM header', () => {
  const rendered = Music.renderSamples('soft-piano');
  const bytes = Music.wavBytes('soft-piano');
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, 44 + rendered.samples.length * 2);
  const text = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(12, 4), 'fmt ');
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint16(34, true), 16, '16-bit');
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint32(40, true), rendered.samples.length * 2);
  assert.equal(Music.wavBytes('missing'), null);
});

test('clip speed changes re-time the clip and move the source with it', () => {
  const clip = Reel.createClip('video', { start: 2, duration: 4, in: 1 });
  assert.equal(Reel.clipSpeed(clip), 1);
  assert.equal(Reel.sourceTime(clip, 3), 2, 'one second in at 1x is one second of source');
  clip.speed = 2;
  assert.equal(Reel.clipSpeed(clip), 2);
  assert.equal(Reel.sourceTime(clip, 3), 3, 'at 2x two seconds of source have played');
  clip.speed = 40;
  assert.equal(Reel.clipSpeed(clip), Reel.SPEED_MAX, 'clamped to what a video element accepts');
  clip.speed = 0;
  assert.equal(Reel.clipSpeed(clip), Reel.SPEED_MIN);
});

test('splitting a sped-up clip keeps the source in-point', () => {
  const project = Reel.createProject({});
  const clip = Reel.createClip('video', { start: 0, duration: 6, in: 2, speed: 2 });
  project.clips.push(clip);
  const right = Reel.splitClip(project, clip.id, 2.5);
  assert.equal(right.in, 2 + 2.5 * 2, 'five seconds of source were consumed before the cut');
  assert.equal(right.speed, 2, 'the speed carries to the second half');
});

test('Studio loads the two libraries before the editor UI', () => {
  const html = fs.readFileSync(path.join(ROOT, 'studio.html'), 'utf8');
  const index = (src) => html.indexOf(`assets/js/${src}`);
  assert.ok(index('reel.js') > 0);
  assert.ok(index('reel-library.js') > index('reel.js'), 'the look library loads after the editor core');
  assert.ok(index('reel-music.js') > index('reel-library.js'), 'the music bench loads after the look library');
  assert.ok(index('reel-ui.js') > index('reel-music.js'), 'the UI loads last');
  const ui = fs.readFileSync(path.join(ROOT, 'assets/js/reel-ui.js'), 'utf8');
  for (const token of ['reelLooks', 'reelTitles', 'reelTemplates', 'reelBench', 'data-look', 'data-title-family', 'tune-add', 'freeze']) {
    assert.ok(ui.includes(token), `reel-ui.js should wire ${token}`);
  }
  const css = fs.readFileSync(path.join(ROOT, 'assets/css/reel.css'), 'utf8');
  for (const selector of ['.reel-look-art', '.reel-title-art', '.reel-template', '.reel-tune', '.reel-speed-row']) {
    assert.ok(css.includes(selector), `reel.css should style ${selector}`);
  }
});

test('the libraries make no network calls and load no external assets', () => {
  for (const file of ['assets/js/reel-library.js', 'assets/js/reel-music.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(/fetch\(|XMLHttpRequest|new Audio\(|WebSocket|sendBeacon|AudioContext/.test(source), false, `${file} stays offline and silent`);
    assert.equal(/https?:\/\//.test(source), false, `${file} links nothing external`);
  }
});
