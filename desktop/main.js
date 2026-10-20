/* ==========================================================================
   Eltes Desktop — Electron main process
   --------------------------------------------------------------------------
   The shell is deliberately thin. It starts the same local server the browser
   build uses (tools/local-server.mjs) on a free loopback port, opens one
   hardened window on it, and keeps the OS integration: menu, window state,
   single instance, deep links and logs.

   All decisions that can be tested without Electron live in shell.js,
   menu.js and window-state.js. Keep it that way.
   ========================================================================== */

'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } = require('electron');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');
const core = require('./shell');
const { menuTemplate } = require('./menu');
const windowState = require('./window-state');

const cli = core.parseCli(process.argv);
const lock = app.requestSingleInstanceLock();

const state = {
  server: null,
  window: null,
  mode: null,
  appOrigin: null,
  lastError: null,
  studioDir: null,
  log: null,
  shuttingDown: false,
  quitting: false
};

if (!lock) {
  app.quit();
} else {
  start();
}

function start() {
  app.setName(core.APP_NAME);
  if (process.platform === 'win32') app.setAppUserModelId(core.APP_ID);

  const userData = app.getPath('userData');
  state.studioDir = join(userData, 'studio');
  state.log = core.createLog(join(userData, 'logs'), { version: app.getVersion() });

  registerProtocol();
  registerIpc();

  app.on('second-instance', (_event, argv) => {
    const link = core.deepLinkFromArgv(argv);
    focusWindow();
    if (link) handleDeepLink(link);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('window-all-closed', () => {
    /* macOS apps stay alive with no window; ask to reopen instead of quitting */
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
    else focusWindow();
  });

  app.on('before-quit', (event) => {
    if (state.shuttingDown || !state.server) return;
    event.preventDefault();
    state.shuttingDown = true;
    const server = state.server;
    state.server = null;
    server.stop().finally(() => app.quit());
  });

  app.whenReady().then(onReady).catch((error) => {
    if (state.log) state.log.write(`startup failed: ${error.stack || error.message}`);
    dialog.showErrorBox('Eltes could not start', String(error && error.message ? error.message : error));
    app.quit();
  });
}

/* ------------------------------- lifecycle -------------------------------- */

async function onReady() {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: core.APP_NAME,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: 'Eltes — a local-first AI workspace',
      credits: 'The local server runs inside this app. Keys and chats stay on this machine.'
    });
  }

  installPermissions();
  installMenu();
  await boot();
}

async function boot() {
  state.lastError = null;
  if (state.server) {
    await state.server.stop();
    state.server = null;
  }

  try {
    const siteDir = core.resolveSiteDir({
      packaged: app.isPackaged,
      appDir: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      override: process.env.ELTES_SITE_DIR
    });
    const manifest = core.siteManifest(siteDir);
    if (!manifest.ok) throw new Error(`The bundled site is incomplete: ${manifest.missing.join(', ')}`);

    state.server = await core.startServer({
      siteDir,
      execPath: process.execPath,
      port: cli.port,
      studio: cli.studio,
      studioDir: state.studioDir,
      studioToken: randomBytes(16).toString('hex'),
      onLog: (line) => state.log.write(`[server] ${line}`)
    });
    state.appOrigin = state.server.url;
    state.log.write(`server ready at ${state.server.url} · site ${siteDir}`);
    openWindow('app');
  } catch (error) {
    state.lastError = String((error && error.message) || error);
    state.log.write(`server did not start: ${state.lastError}`);
    openWindow('fallback');
  }
}

function openWindow(mode) {
  if (state.window && !state.window.isDestroyed()) state.window.destroy();
  state.mode = mode;

  const stateFile = join(app.getPath('userData'), 'window-state.json');
  const restored = windowState.restore(stateFile, screen.getAllDisplays(), { reset: cli.resetWindow });
  const bounds = restored.bounds;

  const win = new BrowserWindow({
    ...bounds,
    minWidth: core.MIN_WIDTH,
    minHeight: core.MIN_HEIGHT,
    show: false,
    backgroundColor: '#04060a',
    title: core.APP_NAME,
    icon: process.platform === 'linux' ? join(__dirname, 'resources', 'icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
      devTools: cli.dev,
      backgroundThrottling: true
    }
  });
  state.window = win;

  if (restored.maximized) win.maximize();

  win.once('ready-to-show', () => {
    win.show();
    if (process.platform === 'darwin' && !win.isMaximized()) win.focus();
  });

  win.on('close', () => {
    try {
      windowState.save(stateFile, { bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    } catch (error) { /* never block a close on a state write */ }
  });

  win.on('closed', () => {
    if (state.window === win) state.window = null;
  });

  win.on('page-title-updated', (event, title) => {
    event.preventDefault();
    win.setTitle(!title || title.includes(core.APP_NAME) ? (title || core.APP_NAME) : `${core.APP_NAME} — ${title}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (core.classifyNavigation(url, state.appOrigin) === 'external') shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const kind = core.classifyNavigation(url, state.appOrigin);
    if (kind === 'allow') return;
    event.preventDefault();
    if (kind === 'external') shell.openExternal(url);
  });

  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    /* -3 is ERR_ABORTED, which happens on normal in-app navigation */
    if (!isMainFrame || code === -3 || state.shuttingDown) return;
    state.log.write(`did-fail-load ${code} ${description} ${failedUrl}`);
    if (state.mode === 'app' && state.server) {
      /* the page itself failed: reload once, then show the recovery screen */
      state.lastError = `${description} (${code})`;
      setTimeout(() => {
        if (state.window && !state.window.isDestroyed() && state.mode === 'app') {
          state.window.loadFile(join(__dirname, 'fallback.html'));
          state.mode = 'fallback';
        }
      }, 400);
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    state.log.write(`renderer gone: ${details.reason} (${details.exitCode})`);
  });

  if (mode === 'fallback') {
    win.loadFile(join(__dirname, 'fallback.html'));
  } else {
    win.loadURL(pageUrl(cli.url ? linkPath(cli.url) : '/app.html'));
  }

  return win;
}

/* --------------------------------- pages ---------------------------------- */

function pageUrl(path) {
  return `${state.server.url}${path.startsWith('/') ? path : `/${path}`}`;
}

function linkPath(link) {
  const target = core.deepLinkTarget(link);
  if (!target) return '/app.html';
  if (target.action === 'studio') return '/studio.html';
  if (target.action === 'lab') return '/train.html';
  if (target.action === 'chat') return '/app.html';
  return '/app.html';
}

function handleDeepLink(link) {
  if (!state.server || !state.window || state.window.isDestroyed()) return;
  const path = linkPath(link);
  state.window.loadURL(pageUrl(path));
  if (state.window.isMinimized()) state.window.restore();
  state.window.show();
  state.window.focus();
}

function navigate(path) {
  if (!state.server || !state.window || state.window.isDestroyed()) return;
  state.window.loadURL(pageUrl(path));
  state.window.show();
  state.window.focus();
}

function focusWindow() {
  const win = state.window;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* -------------------------------- protocol -------------------------------- */

function registerProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(core.PROTOCOL, process.execPath, [process.argv[1]]);
    } else {
      app.setAsDefaultProtocolClient(core.PROTOCOL);
    }
  } catch (error) {
    if (state.log) state.log.write(`protocol registration failed: ${error.message}`);
  }
}

/* ------------------------------- permissions ------------------------------ */

function installPermissions() {
  const allowed = new Set(['clipboard-sanitized-write', 'clipboard-read']);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details && details.requestingUrl ? safeOrigin(details.requestingUrl) : safeOrigin(webContents.getURL());
    callback(!!origin && origin === state.appOrigin && allowed.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
    requestingOrigin === state.appOrigin && allowed.has(permission)
  ));

  /* Nothing in the app needs a device, a screen capture or geolocation. */
  session.defaultSession.setDevicePermissionHandler(() => false);
}

function safeOrigin(url) {
  try {
    return new URL(String(url)).origin;
  } catch (error) {
    return null;
  }
}

/* ---------------------------------- menu ---------------------------------- */

function installMenu() {
  const actions = {
    newChat: () => navigate('/app.html?new=1'),
    openWorkspace: () => navigate('/app.html'),
    openStudio: () => navigate('/studio.html'),
    openDocs: () => navigate('/docs.html'),
    openLab: () => navigate('/train.html'),
    openNews: () => navigate('/news.html'),
    openGitHub: () => shell.openExternal('https://github.com/gefrus112/eltes'),
    openIssues: () => shell.openExternal('https://github.com/gefrus112/eltes/issues'),
    openLogs: () => shell.openPath(state.log ? state.log.dir : app.getPath('userData')),
    openStudioFolder: () => shell.openPath(state.studioDir || app.getPath('userData')),
    reload: () => { if (state.window && !state.window.isDestroyed()) state.window.webContents.reload(); },
    showAbout: () => showAbout()
  };

  const template = menuTemplate({
    platform: process.platform,
    appName: core.APP_NAME,
    dev: cli.dev,
    actions
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  const versions = process.versions;
  dialog.showMessageBox({
    type: 'info',
    title: `About ${core.APP_NAME}`,
    message: `${core.APP_NAME} ${app.getVersion()}`,
    detail: [
      'A local-first AI workspace. The site and its API run inside this app.',
      state.server ? `Local server: ${state.server.url}` : 'Local server: not running',
      `Electron ${versions.electron} · Chromium ${versions.chrome} · Node ${versions.node}`,
      `Data: ${app.getPath('userData')}`
    ].join('\n'),
    buttons: ['Close'],
    noLink: true
  }).catch(() => {});
}

/* ----------------------------------- ipc ---------------------------------- */

function registerIpc() {
  const handle = (channel, fn) => {
    try { ipcMain.handle(channel, fn); } catch (error) { /* duplicate registration in tests */ }
  };

  handle('desktop:info', () => ({
    name: core.APP_NAME,
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron || null,
    chrome: process.versions.chrome || null,
    node: process.versions.node,
    server: state.server ? { url: state.server.url, port: state.server.port } : null,
    error: state.lastError,
    paths: {
      userData: app.getPath('userData'),
      logs: state.log ? state.log.file : null,
      studio: state.studioDir
    }
  }));

  handle('desktop:open-external', (_event, url) => {
    if (core.isExternalHttp(url)) return shell.openExternal(String(url));
    return false;
  });

  handle('desktop:open-path', (_event, which) => {
    if (which === 'logs' && state.log) return shell.openPath(state.log.dir);
    if (which === 'studio' && state.studioDir) return shell.openPath(state.studioDir);
    return false;
  });

  handle('desktop:retry', async () => {
    await boot();
    return {
      ok: state.mode === 'app',
      url: state.server ? state.server.url : null,
      error: state.lastError
    };
  });
}
