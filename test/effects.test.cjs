/* Effects library, its documentation and the release-notes page. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const vm = require('node:vm');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = (name) => readFile(join(root, name), 'utf8');

async function loadEffects() {
  const before = global.window;
  global.window = {};
  try {
    delete require.cache[require.resolve(join(root, 'assets/js/studio-effects.js'))];
    require(join(root, 'assets/js/studio-effects.js'));
    return global.window.EltesEffects;
  } finally {
    global.window = before;
  }
}

test('the effects library ships six self-contained recipes', async () => {
  const effects = await loadEffects();
  assert.ok(effects && Array.isArray(effects.items), 'window.EltesEffects.items exists');

  const items = effects.items;
  assert.equal(items.length, 6);
  assert.deepEqual(
    items.map((item) => item.id),
    ['gradient-mesh', 'particles', 'aurora', 'halftone', 'orb', 'poster']
  );

  for (const item of items) {
    assert.match(item.code, /^<!doctype html>/i, `${item.id} is a whole document`);
    assert.match(item.code, /<style>|<script>|<svg/i, `${item.id} actually draws something`);
    assert.ok(item.name && item.blurb && item.tag, `${item.id} has card text`);
    assert.match(item.swatch, /gradient|#/, `${item.id} has a swatch`);
    // dependency-free: nothing is fetched from a CDN or the network
    assert.doesNotMatch(item.code, /(src|href)=["'](https?:)?\/\//i, `${item.id} loads no remote asset`);
    assert.doesNotMatch(item.code, /@import|url\(["']?https?:/i, `${item.id} imports nothing remote`);
  }

  const methods = items.map((item) => item.tag).join(' ');
  assert.match(methods, /CSS/);
  assert.match(methods, /Canvas/);
  assert.match(methods, /SVG/);
});

test('every recipe respects reduced motion or is static', async () => {
  const { items } = await loadEffects();
  for (const item of items) {
    const animates = /@keyframes|requestAnimationFrame/.test(item.code);
    if (!animates) continue;
    assert.match(
      item.code,
      /prefers-reduced-motion/,
      `${item.id} animates, so it must honour reduced motion`
    );
  }
});

test('Studio writes an effect into effects/ and previews it', async () => {
  const js = await read('assets/js/studio.js');
  const html = await read('studio.html');

  assert.match(html, /id="btnEffects"/, 'header button');
  assert.match(html, /id="effectsDialog"/, 'dialog');
  assert.match(html, /id="effectGrid"/, 'grid target');
  assert.match(html, /assets\/js\/studio-effects\.js/, 'recipe script loads');
  // the effects script must come before studio.js, which renders the grid
  assert.ok(
    html.indexOf('studio-effects.js') < html.indexOf('assets/js/studio.js'),
    'recipes load before the Studio client'
  );

  assert.match(js, /const path = `effects\/\$\{item\.id\}\.html`;/, 'path is effects/<id>.html');
  for (const step of ['writeWorkspaceFile(path, item.code)', 'await refreshTree()', 'await openFile(path)',
    'setPreviewPath(path)', 'reloadPreview()', "markWorkflow('create')", "markWorkflow('preview')"]) {
    assert.ok(js.includes(step), `createEffect runs ${step}`);
  }
  assert.match(js, /function renderEffects\(\)/, 'grid is rendered from the catalogue');
  assert.match(js, /bindEffects\(\)/, 'effects UI is bound');
  assert.match(js, /createEffect\b[\s\S]*window\.EltesStudio/, 'createEffect is exported for tests');
});

test('the docs have a real section for code-generated imagery', async () => {
  const docs = await read('docs.html');

  assert.match(docs, /<section id="effects">/, 'section anchor exists');
  assert.match(docs, /href="#effects"[\s\S]{0,80}Images &amp; effects/, 'sidebar link');
  assert.match(docs, /href="#effects">Images &amp; effects</, 'table of contents link');
  assert.match(docs, /Images &amp; effects from code/, 'heading');

  // the guide the Studio dialog points at must exist
  assert.match(docs, /<section id="effects">[\s\S]*href="#effects"/, 'self anchor');
  const studio = await read('studio.html');
  assert.match(studio, /href="docs\.html#effects"/, 'Studio links to it');
  assert.match(docs, /id="effects"/);

  for (const phrase of [
    'feTurbulence', 'feDisplacementMap', 'mix-blend-mode', 'mask-image',
    'devicePixelRatio', 'prefers-reduced-motion', 'isolation: isolate',
    'effects/gradient-mesh.html', 'npm run build', '/preview/dist/'
  ]) {
    assert.ok(docs.includes(phrase), `docs cover ${phrase}`);
  }

  // the six recipes are documented, not just linked
  for (const name of ['gradient-mesh', 'particles', 'aurora', 'halftone', 'orb', 'poster']) {
    assert.ok(docs.includes(`effects/${name}.html`), `docs list effects/${name}.html`);
  }
});

test('the starter build copies subfolders so effects ship', async () => {
  const js = await read('assets/js/studio.js');
  assert.match(js, /async function walk\(dir, out = \[\]\)/, 'walks nested folders');
  assert.match(js, /entry\.isDirectory\(\)/, 'recurses into directories');
  assert.match(js, /\.\(html\|css\|js\|svg\|json\)\$/, 'copies the asset types effects use');
  assert.match(js, /await mkdir\(dirname\(join\('dist', file\)\)/, 'recreates nested folders in dist/');

  // Run the scaffolded script for real: nested pages copy, node_modules and
  // dot-folders stay out, and the output keeps its folder structure.
  const start = js.indexOf("'build.mjs': `");
  assert.ok(start > 0, 'scaffold template found');
  let i = start + "'build.mjs': `".length;
  let raw = '';
  while (i < js.length) {
    const ch = js[i];
    if (ch === '\\') { raw += ch + js[i + 1]; i += 2; continue; }
    if (ch === '`') break;
    raw += ch;
    i += 1;
  }
  const script = vm.runInNewContext('`' + raw + '`');
  const includeLine = script.split('\n').find((line) => line.includes('const include'));
  assert.ok(includeLine, 'the script filters by extension');
  // one backslash before the dot; two would match a literal backslash instead
  assert.ok(includeLine.includes('\\.(html|css|js|svg|json)$'), `escaped dot: ${includeLine}`);
  assert.ok(!includeLine.includes('\\\\.'), `no double escape: ${includeLine}`);

  const dir = await mkdtemp(join(tmpdir(), 'eltes-build-'));
  try {
    await mkdir(join(dir, 'effects'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'x'), { recursive: true });
    await mkdir(join(dir, '.cache'), { recursive: true });
    await writeFile(join(dir, 'build.mjs'), script);
    await writeFile(join(dir, 'index.html'), '<h1>home</h1>');
    await writeFile(join(dir, 'styles.css'), 'body{}');
    await writeFile(join(dir, 'effects', 'mesh.html'), '<h1>mesh</h1>');
    await writeFile(join(dir, 'node_modules', 'x', 'index.html'), 'no');
    await writeFile(join(dir, '.cache', 'a.html'), 'no');

    const { execFile } = require('node:child_process');
    const stdout = await new Promise((resolve, reject) => {
      execFile(process.execPath, ['build.mjs'], { cwd: dir }, (error, out, err) => {
        if (error) reject(new Error(err || error.message));
        else resolve(out);
      });
    });
    assert.match(stdout, /built 3 files/);
    assert.ok(existsSync(join(dir, 'dist', 'index.html')));
    assert.ok(existsSync(join(dir, 'dist', 'styles.css')));
    assert.ok(existsSync(join(dir, 'dist', 'effects', 'mesh.html')), 'nested page keeps its folder');
    assert.ok(!existsSync(join(dir, 'dist', 'node_modules')), 'dependencies are not shipped');
    assert.ok(!existsSync(join(dir, 'dist', '.cache')), 'dot-folders are not shipped');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the news page shows screenshots of the current project', async () => {
  const news = await read('news.html');

  const shots = [...news.matchAll(/<img src="(assets\/img\/news\/[^"]+)"/g)].map((m) => m[1]);
  assert.equal(shots.length, 7, 'seven screenshots');
  const svgShots = shots.filter((src) => src.endsWith('.svg'));
  assert.equal(svgShots.length, 4, 'four drawn screenshots');
  for (const src of svgShots) {
    const info = await stat(join(root, src));
    assert.ok(info.size > 4000, `${src} is a real drawing`);
    const svg = await read(src);
    assert.match(svg, /<svg[^>]+role="img"/, `${src} is labelled`);
    assert.match(svg, /aria-label="[^"]{20,}"/, `${src} has a description`);
  }

  // the galaxy capture is a real image too
  const galaxy = await stat(join(root, 'assets/img/news/galaxy.jpg'));
  assert.ok(galaxy.size > 15000, 'galaxy.jpg is a real capture');
  assert.match(news, /<img src="assets\/img\/news\/galaxy\.jpg"/);

  // …and so is the embers capture
  const embers = await stat(join(root, 'assets/img/news/embers.jpg'));
  assert.ok(embers.size > 4000, 'embers.jpg is a real capture');
  assert.match(news, /<img src="assets\/img\/news\/embers\.jpg"/);

  // …and the Lab figure is a real run, not a placeholder
  const lab = await stat(join(root, 'assets/img/news/lab.jpg'));
  assert.ok(lab.size > 20000, 'lab.jpg is a real figure');
  assert.match(news, /<img src="assets\/img\/news\/lab\.jpg"/);
  assert.match(news, /href="train\.html"/);

  // each release entry is present and linked to a page that exists
  for (const id of ['r315', 'r314', 'r313', 'r312', 'r311', 'r310', 'r39', 'r38', 'r371']) {
    assert.match(news, new RegExp(`id="${id}"`), `${id} entry`);
  }
  assert.match(news, /docs\.html#look/);
  assert.match(news, /docs\.html#effects/);
  assert.match(news, /docs\.html#workflow/);
  assert.match(news, /docs\.html#studio/);
  assert.match(news, /docs\.html#settings/);
  assert.match(news, /href="studio\.html"/);
  assert.match(news, /href="app\.html"/);

  // the page is reachable from the rest of the site
  for (const page of ['index.html', 'docs.html']) {
    const html = await read(page);
    assert.match(html, /href="news\.html"/, `${page} links to the news page`);
  }
  const studio = await read('studio.html');
  assert.match(studio, /href="news\.html"/, 'Studio links to the release notes');
});

test('version is bumped and the new stylesheet is validated', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.version, '3.15.0');
  assert.match(pkg.scripts['validate:html'], /news\.html/);
  assert.match(pkg.scripts['validate:css'], /news\.css/);
  await read('assets/css/news.css');

  const docs = await read('docs.html');
  assert.match(docs, /v3\.15\.0/);
});
