/* The galaxy backdrop: markup, renderer contract, performance guards. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = (name) => readFile(join(root, name), 'utf8');

const PAGES = ['index.html', 'docs.html', 'news.html', 'auth.html'];

test('every page mounts the galaxy behind its content', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    assert.match(html, /<body class="galaxy-page[^"]*">/, `${page}: body class`);
    assert.ok(
      html.includes('<div class="galaxy" aria-hidden="true">'),
      `${page}: container is decorative and hidden from assistive tech`
    );
    assert.ok(html.includes('data-galaxy-backdrop'), `${page}: static backdrop layer`);
    assert.ok(html.includes('class="galaxy-canvas" data-galaxy='), `${page}: animated layer with intensity`);
    assert.ok(html.includes('assets/css/galaxy.css'), `${page}: stylesheet`);
    assert.ok(html.includes('assets/js/galaxy.js'), `${page}: renderer`);

    // the renderer starts before the rest of the page scripts
    const galaxy = html.indexOf('assets/js/galaxy.js');
    const firstOther = Math.min(
      ...[html.indexOf('assets/js/icons.js'), html.indexOf('assets/js/site.js')]
        .filter((i) => i > -1)
    );
    assert.ok(galaxy < firstOther, `${page}: galaxy boots first`);
  }
});

test('the app and studio keep their own full-screen surfaces', async () => {
  // The chat shell and Studio are working tools; a moving background there
  // would compete with the editor and terminal, so they stay clean.
  for (const page of ['app.html', 'studio.html']) {
    const html = await read(page);
    assert.ok(!html.includes('data-galaxy'), `${page} does not mount the galaxy`);
    assert.ok(!html.includes('assets/js/galaxy.js'), `${page} does not load the renderer`);
  }
});

test('the renderer is self-contained and cheap', async () => {
  const js = await read('assets/js/galaxy.js');

  // no network, no libraries
  assert.doesNotMatch(js, /import\s|require\(|fetch\(|XMLHttpRequest/, 'no dependencies or requests');

  // guards that keep it light
  assert.match(js, /const mobile = width < 720;/, 'mobile budget');
  assert.match(js, /const dpr = clamp\(window\.devicePixelRatio \|\| 1, 1, mobile \? 1\.4 : 1\.75\);/, 'DPR cap');
  assert.match(js, /const FPS_CAP =/, 'frame budget');
  assert.match(js, /document\.hidden/, 'pauses in a hidden tab');
  assert.match(js, /prefers-reduced-motion/, 'honours reduced motion');
  assert.match(js, /const backdropCanvas = document\.querySelector\('canvas\[data-galaxy-backdrop\]'\)/, 'static layer is painted once');
  assert.match(js, /if \(backdrop && !backdropCanvas\)/, 'no per-frame repaint when the static layer exists');
  assert.match(js, /window\.EltesGalaxy =/, 'exposes a handle for tests');

  // the scene itself: a band, a spiral, a cluster and coloured nebulae
  assert.match(js, /function spiralSprite\(/, 'a real spiral galaxy is painted');
  assert.match(js, /function clusterSprite\(/, 'a globular cluster is painted');
  assert.match(js, /function nebulaKnot\(/, 'emission nebulae are painted');
  assert.match(js, /function heroStar\(/, 'bright stars get diffraction spikes');
  assert.match(js, /Math\.min\(state\.dpr, 1\.4\)/, 'the backdrop renders at a cheaper scale');
  assert.match(js, /drawImage\(backdrop, 0, 0, backdropCanvas\.width, backdropCanvas\.height\)/, 'the backdrop still fills its layer');
});

test('the sky is painted in black and spectrally, not navy', async () => {
  const css = await read('assets/css/galaxy.css');
  assert.match(css, /--space-0: #000003;/, 'true-black base');
  assert.match(css, /radial-gradient\(64% 40% at 58% 74%, rgba\(255, 218, 178/, 'warm band in the fallback');
  assert.doesNotMatch(css, /#0a1630|#0a1a2c/, 'no navy sky');

  // the slow drift and the grain, plus their reduced-motion escape
  assert.match(css, /@keyframes galaxy-drift/, 'the sky drifts');
  assert.match(css, /animation: none; transform: none;/, 'drift stops for reduced motion');
  assert.match(css, /feTurbulence/, 'film grain hides banding');
});

test('the chat shell is black, and blue is gone', async () => {
  const html = await read('app.html');
  assert.match(html, /<body class="app" data-theme="black">/, 'Obsidian is the default');
  assert.match(html, /<option value="black">Obsidian/, 'Obsidian is selectable');
  assert.match(html, /<option value="grey">Graphite/, 'Graphite stays');
  assert.doesNotMatch(html, /Midnight|value="blue"/, 'no blue theme in the settings');

  const js = await read('assets/js/app.js');
  assert.match(js, /const THEMES = \{ black: 'Obsidian', grey: 'Graphite' \};/, 'two black/grey themes');
  assert.doesNotMatch(js, /blue: 'Midnight'/, 'Midnight is removed');
  assert.match(js, /theme: 'black',/, 'black is the default setting');

  const css = await read('assets/css/app.css');
  assert.doesNotMatch(css, /#030814|rgba\(46, 104, 255/, 'the navy shell background is gone');
  assert.match(css, /--ink-0: #000000;/, 'true-black surfaces');
  assert.match(css, /body\.app\[data-theme="grey"\]/, 'Graphite still overrides the base');
});

test('the galaxy keeps its look without JavaScript or motion', async () => {
  const css = await read('assets/css/galaxy.css');

  // a painted fallback for the no-JS case
  assert.match(css, /\.galaxy \{[\s\S]*?radial-gradient\(64% 40% at 58% 74%/, 'fallback nebula painted in CSS');
  assert.match(css, /prefers-reduced-motion: reduce/, 'reduced-motion branch');
  assert.match(css, /forced-colors: active/, 'forced-colours branch');
  assert.match(css, /body\.galaxy-page \.nav\.scrolled/, 'scrolled nav still readable over the sky');
  assert.match(css, /body\.galaxy-page \.section-head h2/, 'section headings keep contrast');
  assert.match(css, /outline: 2px solid rgba\(122, 168, 255, 0\.85\)/, 'focus ring stays visible');

  // themed surfaces are translucent, so the sky is never cut off mid-page
  assert.doesNotMatch(css, /\.footer \{[^}]*background: #0/, 'no opaque footer');
});

test('the release notes show the real galaxy capture', async () => {
  const { stat } = require('node:fs/promises');
  const news = await read('news.html');
  assert.match(news, /<img src="assets\/img\/news\/galaxy\.jpg"/, 'the capture is displayed');
  assert.match(news, /id="r311"/, 'its release entry exists');
  assert.match(news, /docs\.html#look/, 'it links to the design notes');
  const jpg = await stat(join(root, 'assets/img/news/galaxy.jpg'));
  assert.ok(jpg.size > 15000 && jpg.size < 400000, `capture is a reasonable size (${jpg.size})`);

  // docs describe the renderer, its limits and how to tune it
  const docs = await read('docs.html');
  assert.match(docs, /<section id="look">/);
  for (const phrase of ['data-galaxy', 'prefers-reduced-motion', 'visibilitychange', 'canvas[data-galaxy-backdrop]']) {
    assert.ok(docs.includes(phrase), `docs mention ${phrase}`);
  }

  // the capture tool is documented and present
  const tool = await read('tools/capture-galaxy.mjs');
  assert.match(tool, /assets\/img\/news\/galaxy\.jpg/);
  assert.match(JSON.parse(await read('package.json')).description.length > 0 ? 'ok' : '', /ok/);
});

test('the empty chat has a warm, pointer-driven effect', async () => {
  const { stat } = require('node:fs/promises');
  const html = await read('app.html');
  assert.match(html, /<canvas class="ember-field" data-embers aria-hidden="true"><\/canvas>/, 'the canvas is mounted');
  assert.match(html, /assets\/js\/chat-embers\.js/, 'the module loads');
  assert.ok(!html.includes('data-galaxy'), 'the chat keeps its own clean shell');

  const js = await read('assets/js/chat-embers.js');
  assert.match(js, /const FPS_CAP =/, 'frame budget');
  assert.match(js, /DPR_CAP = 1\.75/, 'pixel-ratio cap');
  assert.match(js, /prefers-reduced-motion/, 'honours the system setting');
  assert.match(js, /reduce-motion/, 'honours Settings → Reduce motion');
  assert.match(js, /MutationObserver\(sync\)\.observe\(empty/, 'stops when a chat starts');
  assert.match(js, /document\.hidden/, 'pauses in a hidden tab');
  assert.match(js, /function drawStill\(/, 'a still frame exists for reduced motion');
  assert.match(js, /function drawOrbits\(/, 'sparks orbit the pointer');
  assert.match(js, /function spawnStreak\(/, 'heat wisps rise');
  assert.match(js, /window\.EltesEmbers =/, 'exposes a handle for tests');
  assert.doesNotMatch(js, /import\s|require\(|fetch\(|XMLHttpRequest/, 'no dependencies or requests');

  const css = await read('assets/css/app.css');
  assert.match(css, /\.ember-field \{[\s\S]*?mix-blend-mode: screen/, 'the effect only adds light');
  assert.match(css, /\.ember-field\.is-on/, 'it fades in with the empty state');

  // the capture that ships with the release notes is real
  const jpg = await stat(join(root, 'assets/img/news/embers.jpg'));
  assert.ok(jpg.size > 4000, 'embers.jpg is a real capture');
  assert.match(await read('tools/capture-embers.mjs'), /assets\/img\/news\/embers\.jpg/);
});

test('validators know about the new stylesheet', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts['validate:css'], /assets\/css\/galaxy\.css/);
});
