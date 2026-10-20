/* Eltes Desktop: the harness core, the window policy, the menus, packaging
   config, and a real boot of the packaged layout (site in resources/site,
   server started with ELECTRON_RUN_AS_NODE semantics). */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, mkdtemp, rm, readdir, mkdir, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { get } = require('node:http');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const desktop = join(root, 'desktop');
const core = require(join(desktop, 'shell.js'));
const windowState = require(join(desktop, 'window-state.js'));
const { menuTemplate } = require(join(desktop, 'menu.js'));

const read = (name) => readFile(join(root, name), 'utf8');

function request(url) {
  return new Promise((resolve, reject) => {
    const req = get(url, { timeout: 8000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* -------------------------------- the core -------------------------------- */

test('the desktop core never imports electron', async () => {
  const files = ['shell.js', 'menu.js', 'window-state.js'];
  for (const file of files) {
    const source = await read(`desktop/${file}`);
    assert.ok(!/require\(['"]electron['"]\)/.test(source), `${file} is testable without Electron`);
  }
  /* main.js is the only adapter */
  const main = await read('desktop/main.js');
  assert.match(main, /require\('electron'\)/);
  assert.match(main, /core\.startServer/);
  assert.match(main, /core\.classifyNavigation/);
});

test('CLI flags parse without eating Electron switches', () => {
  const parsed = core.parseCli(['Eltes.exe', '--dev', '--port=9001', '--no-studio', '--reset-window', 'eltes://studio']);
  assert.equal(parsed.dev, true);
  assert.equal(parsed.port, 9001);
  assert.equal(parsed.studio, false);
  assert.equal(parsed.resetWindow, true);
  assert.equal(parsed.url, 'eltes://studio');

  const spaced = core.parseCli(['Eltes', '--port', '8123']);
  assert.equal(spaced.port, 8123);

  const noisy = core.parseCli(['Eltes', '--allow-file-access-from-files', '--no-sandbox', '--lang=en-US', '.']);
  assert.deepEqual(noisy, { dev: false, port: null, studio: true, resetWindow: false, url: null, profile: null });

  assert.equal(core.deepLinkFromArgv(['Eltes', '--dev', 'eltes://lab']), 'eltes://lab');
  assert.equal(core.deepLinkFromArgv(['Eltes', '--dev']), null);
});

test('deep links resolve to real pages and nothing else', () => {
  assert.deepEqual(core.deepLinkTarget('eltes://studio'), { action: 'studio', path: '/' });
  assert.deepEqual(core.deepLinkTarget('eltes://lab'), { action: 'lab', path: '/' });
  assert.deepEqual(core.deepLinkTarget('eltes://chat/abc'), { action: 'chat', path: '/abc' });
  assert.deepEqual(core.deepLinkTarget('eltes://open'), { action: 'open', path: '/' });
  const odd = core.deepLinkTarget('eltes://../etc/passwd');
  assert.ok(odd && typeof odd.action === 'string', 'a malformed host still resolves to an action');
  assert.notEqual(odd.action, '..');
  assert.equal(core.deepLinkTarget('https://eltes.ai'), null);
  assert.equal(core.deepLinkTarget('not a url'), null);
  const weird = core.deepLinkTarget('eltes://javascript:alert(1)');
  assert.ok(weird === null || weird.action === 'open', 'a hostile host is refused or falls back');
  assert.equal(core.deepLinkTarget('eltes://hello').action, 'open', 'unknown hosts fall back to the workspace');
});

test('navigation is locked to the app origin', () => {
  const origin = 'http://127.0.0.1:4173';
  assert.equal(core.classifyNavigation('http://127.0.0.1:4173/app.html', origin), 'allow');
  assert.equal(core.classifyNavigation('http://127.0.0.1:4173/docs.html#lab', origin), 'allow');
  assert.equal(core.classifyNavigation('https://github.com/gefrus112/eltes', origin), 'external');
  assert.equal(core.classifyNavigation('http://127.0.0.1:4999/app.html', origin), 'external', 'a different loopback port is a different origin');
  assert.equal(core.classifyNavigation('file:///etc/passwd', origin), 'block');
  assert.equal(core.classifyNavigation('javascript:alert(1)', origin), 'block');
  assert.equal(core.classifyNavigation('data:text/html,<h1>x</h1>', origin), 'block');
  assert.equal(core.classifyNavigation('mailto:hello@eltes.ai', origin), 'external');
  assert.equal(core.isExternalHttp('https://eltes.ai'), true);
  assert.equal(core.isExternalHttp('file:///tmp/x'), false);
  assert.equal(core.isAppUrl('http://127.0.0.1:4173/train.html', origin), true);
  assert.equal(core.isAppUrl('http://127.0.0.1:4174/train.html', origin), false);
});

test('the site directory resolves for a checkout and for a packaged app', () => {
  assert.equal(
    core.resolveSiteDir({ packaged: false, appDir: join(root, 'desktop') }),
    root
  );
  assert.equal(
    core.resolveSiteDir({ packaged: true, resourcesPath: '/opt/Eltes/resources', appDir: '/opt/Eltes/resources/app.asar' }),
    '/opt/Eltes/resources/site'
  );
  assert.equal(
    core.resolveSiteDir({ packaged: true, resourcesPath: '/x', override: '/tmp/site' }),
    '/tmp/site'
  );
  assert.throws(() => core.resolveSiteDir({ packaged: false }), /appDir/);

  const manifest = core.siteManifest(root);
  assert.equal(manifest.ok, true, manifest.missing.join(', '));
  assert.equal(core.siteManifest(join(root, 'assets')).ok, false, 'a folder without the server is rejected');
});

/* ------------------------------ window policy ----------------------------- */

test('window bounds survive a removed monitor and a bad saved value', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { workArea: { x: 1920, y: 0, width: 1440, height: 900 } }
  ];
  const fresh = core.clampBounds(null, displays);
  assert.equal(fresh.width, core.DEFAULT_WIDTH);
  assert.ok(fresh.x >= 0 && fresh.y >= 0);

  const onSecond = core.clampBounds({ x: 2100, y: 120, width: 1200, height: 800 }, displays);
  assert.equal(onSecond.x, 2100, 'a window on the second display stays there');

  /* the second display is gone: pull it back onto the first */
  const orphaned = core.clampBounds({ x: 2100, y: 120, width: 1200, height: 800 }, [displays[0]]);
  assert.ok(orphaned.x < 1920, `expected the window back on screen, got x=${orphaned.x}`);
  assert.ok(orphaned.x + 96 <= 1920);
  assert.equal(orphaned.width, 1200);

  const tiny = core.clampBounds({ x: 10, y: 10, width: 200, height: 100 }, displays);
  assert.equal(tiny.width, core.MIN_WIDTH);
  assert.equal(tiny.height, core.MIN_HEIGHT);

  const huge = core.clampBounds({ x: 0, y: 0, width: 4000, height: 3000 }, displays);
  assert.equal(huge.width, 1920);
  assert.equal(huge.height, 1080);

  const negative = core.clampBounds({ x: -900, y: -400, width: 1200, height: 800 }, displays);
  assert.ok(negative.x >= -1200 + 96 && negative.y >= 0);

  const noDisplays = core.clampBounds({ x: 10, y: 10, width: 1200, height: 800 }, []);
  assert.equal(noDisplays.width, core.DEFAULT_WIDTH);
});

test('window state is written atomically and can be reset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eltes-window-'));
  try {
    const file = join(dir, 'nested', 'window-state.json');
    const displays = [{ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }];
    assert.deepEqual(windowState.restore(file, displays).restored, false);

    assert.equal(windowState.save(file, { bounds: { x: 40.4, y: 60.6, width: 1280, height: 840 }, maximized: true }), true);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(raw.bounds, { x: 40, y: 61, width: 1280, height: 840 });
    assert.equal(raw.maximized, true);

    const again = windowState.restore(file, displays);
    assert.equal(again.restored, true);
    assert.equal(again.maximized, true);
    assert.deepEqual(again.bounds, raw.bounds);

    const reset = windowState.restore(file, displays, { reset: true });
    assert.equal(reset.restored, false);
    assert.equal(reset.maximized, false);

    await writeFile(file, '{ not json');
    assert.equal(windowState.restore(file, displays).restored, false, 'a corrupt file is ignored');
    assert.equal(windowState.save(file, {}), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* --------------------------------- menus ---------------------------------- */

test('the menu offers the same destinations on every platform', () => {
  const runs = [];
  const actions = new Proxy({}, { get: (_t, name) => () => runs.push(String(name)) });
  const labels = (template) => JSON.stringify(template);

  const mac = menuTemplate({ platform: 'darwin', appName: 'Eltes', actions });
  const win = menuTemplate({ platform: 'win32', appName: 'Eltes', actions });
  const linux = menuTemplate({ platform: 'linux', appName: 'Eltes', actions, dev: true });

  assert.equal(mac[0].label, 'Eltes', 'macOS gets the application menu');
  assert.ok(labels(mac).includes('Quit Eltes'));
  assert.ok(labels(mac).includes('About Eltes'));
  assert.ok(!labels(win).includes('Hide Eltes'), 'no macOS roles on Windows');
  assert.ok(labels(win).includes('Quit Eltes'));

  for (const template of [mac, win, linux]) {
    const text = labels(template);
    for (const run of ['openDocs', 'openLab', 'openNews', 'openGitHub', 'openLogs', 'openStudioFolder', 'openStudio', 'reload', 'newChat']) {
      assert.ok(text.includes(`"id":${JSON.stringify(run)}`), `menu reaches ${run}`);
    }
  }
  assert.ok(!labels(win).includes('toggleDevTools'), 'developer tools stay off in release builds');
  assert.ok(labels(linux).includes('toggleDevTools'), '--dev turns them on');

  /* every click is wired to a real action name */
  const clickable = [];
  const walk = (items) => items.forEach((item) => {
    if (item.submenu) walk(item.submenu);
    if (typeof item.click === 'function') clickable.push(item);
  });
  walk(win);
  for (const item of clickable) item.click();
  assert.ok(runs.length >= 8, `expected actions to run, got ${runs.length}`);
});

/* ------------------------------- packaging -------------------------------- */

test('packaging stages the shell and the site, and the config is complete', async () => {
  const build = await import(pathToFileURL(join(desktop, 'build.mjs')).href);
  const version = build.readVersion();
  assert.match(version, /^\d+\.\d+\.\d+$/);

  for (const file of build.SHELL_FILES) {
    assert.ok(existsSync(join(desktop, file)), `${file} is part of the shell`);
  }
  for (const entry of build.SITE_ENTRIES) {
    assert.ok(existsSync(join(root, entry)), `${entry} is packaged`);
  }
  for (const entry of build.SITE_TOOL_FILES) {
    assert.ok(existsSync(join(root, entry)), `${entry} is packaged`);
  }
  assert.ok(!build.SITE_ENTRIES.includes('test'), 'tests stay out of the installer');
  assert.ok(!build.SITE_ENTRIES.includes('desktop'), 'the shell is packaged separately');
  assert.ok(!build.SITE_ENTRIES.includes('.git'));

  const config = build.electronBuilderConfig({ version, platforms: ['win', 'mac', 'linux'] });
  assert.equal(config.appId, 'ai.eltes.desktop');
  assert.equal(config.productName, 'Eltes');
  assert.equal(config.asar, true);
  assert.equal(config.npmRebuild, false);
  assert.deepEqual(config.extraResources, [{ from: 'site', to: 'site', filter: ['**/*'] }]);
  assert.deepEqual(config.protocols, [{ name: 'Eltes link', schemes: ['eltes'] }]);

  assert.deepEqual(config.win.target.map((t) => t.target), ['nsis', 'portable']);
  assert.deepEqual(config.win.target[0].arch, ['x64', 'arm64']);
  assert.match(config.nsis.artifactName, /Eltes-Setup/);
  assert.match(config.portable.artifactName, /Portable/);
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.win.signAndEditExecutable, false, 'cross-built Windows binaries skip rcedit');

  assert.deepEqual(config.mac.target, ['dmg', 'zip']);
  assert.equal(config.mac.identity, null, 'unsigned unless a certificate is configured');
  assert.equal(config.mac.category, 'public.app-category.productivity');
  assert.equal(config.dmg.contents.length, 2);

  assert.deepEqual(config.linux.target, ['AppImage', 'deb']);
  assert.equal(config.linux.executableName, 'eltes');
  assert.match(config.deb.artifactName, /^eltes_/);

  const single = build.electronBuilderConfig({ version, platforms: ['win'], signing: true });
  assert.equal(single.mac, undefined);
  assert.equal(single.linux, undefined);

  /* rcedit needs Windows or wine; ELTES_WIN_EDIT forces it on for a cross-build */
  const before = process.env.ELTES_WIN_EDIT;
  process.env.ELTES_WIN_EDIT = '1';
  try {
    const edited = build.electronBuilderConfig({ version, platforms: ['win'] });
    if (process.platform !== 'win32') assert.equal(edited.win.signAndEditExecutable, undefined);
  } finally {
    if (before === undefined) delete process.env.ELTES_WIN_EDIT;
    else process.env.ELTES_WIN_EDIT = before;
  }

  assert.deepEqual(build.expectedArtifacts('3.15.0', 'win'), [
    'Eltes-Setup-3.15.0-x64.exe',
    'Eltes-Setup-3.15.0-arm64.exe',
    'Eltes-3.15.0-Portable-x64.exe'
  ]);
  assert.ok(build.expectedArtifacts('3.15.0', 'linux').some((name) => name.endsWith('.AppImage')));
  assert.ok(build.expectedArtifacts('3.15.0', 'darwin').every((name) => name.endsWith('.dmg')));

  /* icons exist in every format the packager needs */
  for (const icon of ['icon.png', 'icon.ico', 'icon.icns', 'icons/256x256.png']) {
    assert.ok(existsSync(join(desktop, 'resources', icon)), icon);
  }
});

/* --------------------------- packaged boot test ---------------------------- */

test('the packaged layout boots its server and serves the app', async () => {
  const build = await import(pathToFileURL(join(desktop, 'build.mjs')).href);
  const staged = build.stage({ version: '0.0.0-test' });
  assert.equal(existsSync(join(staged.siteDir, 'tools', 'local-server.mjs')), true);

  /* simulate resources/site inside an installed app, then start it the way
     main.js does: the site's server, its own cwd, a random free port. */
  const resources = join(staged.siteDir, '..', 'resources');
  await mkdir(join(resources, 'site'), { recursive: true });
  for (const entry of await readdir(staged.siteDir)) {
    const { cpSync } = require('node:fs');
    cpSync(join(staged.siteDir, entry), join(resources, 'site', entry), { recursive: true });
  }
  const siteDir = core.resolveSiteDir({ packaged: true, resourcesPath: resources, appDir: '/nowhere' });
  assert.equal(core.siteManifest(siteDir).ok, true);

  /* occupy the preferred port so the harness has to skip it */
  const { createServer } = require('node:net');
  const blocker = createServer(() => {});
  await new Promise((resolve) => blocker.listen({ port: 4300, host: '127.0.0.1' }, resolve));

  const studioDir = await mkdtemp(join(tmpdir(), 'eltes-studio-'));
  const server = await core.startServer({ siteDir, port: 4300, studioDir, timeout: 30000 });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(server.port, 4300, 'a busy port is skipped instead of failing');
    assert.ok(server.port > 4300);

    const health = await request(`${server.url}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).status, 'ok');

    const page = await request(`${server.url}/app.html`);
    assert.equal(page.status, 200);
    assert.match(page.body, /workspace/);
    assert.match(page.headers['content-type'], /text\/html/);

    const script = await request(`${server.url}/assets/js/app.js`);
    assert.equal(script.status, 200, 'assets are served from the packaged site');

    const studio = await request(`${server.url}/api/studio/session`);
    assert.equal(studio.status, 200);
    assert.equal(JSON.parse(studio.body).ok, true);
    assert.equal(existsSync(studioDir), true, 'the Studio workspace comes from the desktop data dir');

    const logs = server.lines.join('');
    assert.match(logs, /listening at http:\/\/localhost:\d+/);
  } finally {
    await server.stop();
    await rm(studioDir, { recursive: true, force: true });
    await new Promise((resolve) => blocker.close(resolve));
  }

  const stopped = server.child.exitCode != null || server.child.killed || server.child.signalCode != null;
  assert.ok(stopped, 'the server process is stopped with the window');
});

test('a broken install fails with the missing files named', () => {
  assert.equal(core.siteManifest(join(tmpdir(), 'definitely-not-eltes')).ok, false);
  const missing = core.siteManifest(join(tmpdir(), 'definitely-not-eltes')).missing;
  assert.ok(missing.includes('app.html'));
  assert.ok(missing.includes('tools/local-server.mjs'));
});

test('the shell is wired into the app: fallback, preload and docs', async () => {
  const main = await read('desktop/main.js');
  for (const piece of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webviewTag: false', 'setWindowOpenHandler', 'will-navigate', 'windowState.save']) {
    assert.ok(main.includes(piece), `main.js sets ${piece}`);
  }
  const preload = await read('desktop/preload.js');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('EltesDesktop'/);
  assert.ok(!/require\('node:fs'\)|child_process/.test(preload), 'no fs or child_process in the page bridge');

  const fallback = await read('desktop/fallback.html');
  assert.match(fallback, /EltesDesktop/);
  assert.match(fallback, /id="retry"/);
  assert.match(fallback, /bridge\.retry\(\)/);
  assert.match(fallback, /Content-Security-Policy/);

  const readme = await read('desktop/README.md');
  assert.match(readme, /npm run desktop:build/);
  assert.match(readme, /Eltes-Setup/);
  assert.match(readme, /\.dmg/);
  assert.match(readme, /AppImage/);

  const workflow = await read('.github/workflows/desktop.yml');
  for (const runner of ['windows-latest', 'macos-14', 'macos-13', 'ubuntu-latest']) {
    assert.ok(workflow.includes(runner), `CI builds on ${runner}`);
  }
  assert.match(workflow, /desktop:build|build\.mjs/);
});

/* --------------------------- the Electron adapter -------------------------- */

test('the electron entry wires the window, the menu and the server', async () => {
  /* A small Electron stand-in, injected through Module._load, so the real
     desktop/main.js runs under Node. This catches wiring mistakes that a
     pure-unit test of shell.js cannot see. */
  const Module = require('node:module');
  const { EventEmitter } = require('node:events');
  const originalArgv = process.argv.slice();
  const originalLoad = Module._load;

  const calls = { loaded: [], opened: [], menus: [], ipc: new Map(), listeners: new Map() };
  const appEvents = new EventEmitter();

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (fn) => { this.webContents.windowOpenHandler = fn; };
      this.webContents.reload = () => { this.reloaded = true; };
      this.shown = false;
      this.destroyed = false;
      calls.window = this;
    }

    loadURL(url) { calls.loaded.push(url); this.url = url; setTimeout(() => this.emit('ready-to-show'), 0); return Promise.resolve(); }
    loadFile(file) { calls.loaded.push(file); this.url = file; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() { this.shown = true; }
    focus() {}
    isMinimized() { return false; }
    restore() {}
    maximize() { this.maximized = true; }
    isMaximized() { return !!this.maximized; }
    getNormalBounds() { return { x: 10, y: 20, width: 1280, height: 840 }; }
    setTitle() {}
    close() { this.destroy(); }
  }

  const fakeElectron = {
    app: {
      requestSingleInstanceLock: () => true,
      setName() {}, setAppUserModelId() {},
      getVersion: () => '3.15.0',
      getName: () => 'Eltes',
      getPath: (name) => join(tmpdir(), `eltes-app-${name}`),
      getAppPath: () => desktop,
      isPackaged: false,
      whenReady: () => Promise.resolve(),
      on: (event, fn) => { appEvents.on(event, fn); return appEvents; },
      quit: () => { calls.quit = (calls.quit || 0) + 1; },
      setAsDefaultProtocolClient: () => true,
      setAboutPanelOptions() {}
    },
    BrowserWindow: Object.assign(FakeBrowserWindow, {
      getAllWindows: () => (calls.window && !calls.window.destroyed ? [calls.window] : [])
    }),
    Menu: { buildFromTemplate: (template) => { calls.menus.push(template); return template; }, setApplicationMenu() {} },
    dialog: { showMessageBox: async () => ({ response: 0 }), showErrorBox() {} },
    ipcMain: { handle: (channel, fn) => calls.ipc.set(channel, fn) },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }] },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {} } },
    shell: { openExternal: async (url) => { calls.opened.push(url); }, openPath: async () => '' }
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, parent, isMain);
  };
  process.argv = ['electron', join(desktop, 'main.js'), '--port=4555'];
  delete require.cache[require.resolve(join(desktop, 'main.js'))];

  try {
    require(join(desktop, 'main.js'));
    /* let whenReady → boot → startServer → loadURL settle */
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !calls.loaded.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(calls.loaded.length, 'the window loads a URL');
    assert.match(calls.loaded[0], /^http:\/\/127\.0\.0\.1:\d+\/app\.html$/, `loaded ${calls.loaded[0]}`);
    assert.equal(calls.window.options.webPreferences.contextIsolation, true);
    assert.equal(calls.window.options.webPreferences.sandbox, true);
    assert.equal(calls.window.options.backgroundColor, '#04060a');
    assert.ok(calls.menus.length >= 1, 'the menu is installed');

    /* the URL the window loaded really serves the app */
    const base = new URL(calls.loaded[0]).origin;
    const page = await request(`${base}/app.html`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Eltes/);

    /* IPC: info, external links, paths */
    const info = await calls.ipc.get('desktop:info')();
    assert.equal(info.name, 'Eltes');
    assert.equal(info.version, '3.15.0');
    assert.equal(info.packaged, false);
    assert.match(info.server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(await calls.ipc.get('desktop:open-external')({}, 'https://eltes.ai'), undefined);
    assert.deepEqual(calls.opened, ['https://eltes.ai']);
    await calls.ipc.get('desktop:open-external')({}, 'file:///etc/passwd');
    assert.deepEqual(calls.opened, ['https://eltes.ai'], 'non-http URLs are not opened');

    /* the navigation guard denies foreign origins and blocks file: */
    const handler = calls.window.webContents.windowOpenHandler;
    assert.deepEqual(handler({ url: 'https://example.com' }), { action: 'deny' });
    assert.deepEqual(handler({ url: `${base}/docs.html` }), { action: 'deny' });
    assert.deepEqual(calls.opened, ['https://eltes.ai', 'https://example.com']);

    let prevented = false;
    calls.window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'file:///etc/passwd');
    assert.equal(prevented, true, 'an in-window navigation to file: is blocked');

    /* quitting stops the supervised server */
    let blocked = false;
    appEvents.emit('before-quit', { preventDefault: () => { blocked = true; } });
    assert.equal(blocked, true, 'quit waits for the server to stop');
    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(calls.quit >= 1, 'the app quits after the server is gone');
    await assert.rejects(request(`${base}/api/health`), 'the local server is down after quitting');
  } finally {
    Module._load = originalLoad;
    process.argv = originalArgv;
    if (calls.window && !calls.window.destroyed) calls.window.destroy();
    await rm(join(tmpdir(), 'eltes-app-Eltes'), { recursive: true, force: true });
  }
});

/* --------------------------- packaging internals --------------------------- */

test('the shell packs into an asar with main.js as its entry', async (t) => {
  let asar;
  try {
    asar = require('@electron/asar');
  } catch (error) {
    t.skip('@electron/asar is not installed (npm install brings it with electron-builder)');
    return;
  }
  const build = await import(pathToFileURL(join(desktop, 'build.mjs')).href);
  const staged = build.stage({ version: '0.0.0-test' });
  const out = join(await mkdtemp(join(tmpdir(), 'eltes-asar-')), 'app.asar');
  try {
    await asar.createPackage(staged.appDir, out);
    const entries = asar.listPackage(out).map((entry) => entry.replace(/\\/g, '/'));
    assert.ok(entries.includes('/main.js'), 'main.js is packed');
    for (const file of build.SHELL_FILES) assert.ok(entries.includes(`/${file}`), `${file} is packed`);
    assert.ok(entries.includes('/package.json'));
    assert.ok(!entries.some((entry) => entry.startsWith('/site/')), 'the site ships as extraResources, not in the asar');

    const packed = JSON.parse(asar.extractFile(out, 'package.json').toString('utf8'));
    assert.equal(packed.main, 'main.js');
    assert.equal(packed.productName, 'Eltes');
    assert.equal(packed.version, '0.0.0-test');

    const extracted = asar.extractFile(out, 'main.js');
    const original = await readFile(join(desktop, 'main.js'));
    assert.equal(extracted.length, original.length, 'main.js survives packing intact');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the generated build config satisfies electron-builder’s schema', async (t) => {
  let schema;
  let Ajv;
  try {
    schema = JSON.parse(await readFile(join(root, 'node_modules', 'app-builder-lib', 'scheme.json'), 'utf8'));
    Ajv = require(join(root, 'node_modules', 'ajv', 'dist', 'ajv.js'));
  } catch (error) {
    t.skip('electron-builder is not installed');
    return;
  }
  const build = await import(pathToFileURL(join(desktop, 'build.mjs')).href);
  const config = build.electronBuilderConfig({ version: build.readVersion(), platforms: ['win', 'mac', 'linux'] });
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  const validate = ajv.compile(schema);
  const ok = validate(config);
  assert.equal(ok, true, `electron-builder rejected the config: ${JSON.stringify((validate.errors || []).slice(0, 5))}`);
});
