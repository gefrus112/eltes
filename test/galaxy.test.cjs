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
});

test('the galaxy keeps its look without JavaScript or motion', async () => {
  const css = await read('assets/css/galaxy.css');

  // a painted fallback for the no-JS case
  assert.match(css, /\.galaxy \{[\s\S]*?radial-gradient\(58% 42% at 32% 24%/, 'fallback nebula painted in CSS');
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

test('validators know about the new stylesheet', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts['validate:css'], /assets\/css\/galaxy\.css/);
});
