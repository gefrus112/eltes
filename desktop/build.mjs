#!/usr/bin/env node
/* ==========================================================================
   Eltes Desktop — packaging harness
   --------------------------------------------------------------------------
   Builds the real installers:

     Windows  Eltes-Setup-<version>-x64.exe      NSIS installer (x64, arm64)
              Eltes-<version>-Portable-x64.exe    single portable .exe
     macOS    Eltes-<version>-<arch>.dmg          drag-to-Applications
              Eltes-<version>-mac-<arch>.zip      zipped .app
     Linux    Eltes-<version>-linux-<arch>.AppImage
              eltes_<version>_<arch>.deb

   The site is staged into desktop/.build/site and shipped as an Electron
   extraResource, so a packaged app has no server to install and no Node
   runtime to find: main.js starts tools/local-server.mjs with
   ELECTRON_RUN_AS_NODE using its own binary.

   Usage
     node desktop/build.mjs --stage-only     assemble desktop/.build and stop
     node desktop/build.mjs --dir            unpacked app for this platform
     node desktop/build.mjs --target=win     installer for one platform
     node desktop/build.mjs --all            every target for this platform
     node desktop/build.mjs --target=mac --arch=arm64

   Requires (dev only): npm install  → electron, electron-builder
   ========================================================================== */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');
export const BUILD_DIR = join(here, '.build');
export const APP_DIR = join(BUILD_DIR, 'app');
export const SITE_OUT = join(BUILD_DIR, 'site');

/* The shell itself, exactly the files Electron needs in the asar. */
export const SHELL_FILES = [
  'main.js', 'preload.js', 'shell.js', 'menu.js', 'window-state.js', 'fallback.html'
];

/* The site the desktop app serves. Everything else in the repository (tests,
   tools, docs screenshots, git) stays out of the installer. */
export const SITE_ENTRIES = [
  'index.html', 'app.html', 'auth.html', 'docs.html', 'news.html',
  'studio.html', 'train.html', '404.html', 'site.webmanifest',
  'LICENSE', 'NOTICE.md',
  'assets', 'api', 'lib'
];

export const SITE_TOOL_FILES = ['tools/local-server.mjs', 'tools/studio.mjs'];
export const OPTIONAL_SITE_ENTRIES = ['downloads'];

export function readVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return pkg.version || '0.0.0';
}

export function electronVersion() {
  const candidates = [
    join(ROOT, 'node_modules', 'electron', 'package.json'),
    join(ROOT, 'node_modules', 'electron-builder', 'node_modules', 'electron', 'package.json')
  ];
  for (const file of candidates) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).version;
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const pinned = (pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron);
  if (pinned) return String(pinned).replace(/^[^\d]*/, '');
  throw new Error('Electron is not installed. Run: npm install');
}

/* --------------------------------- staging -------------------------------- */

function copyEntry(from, to) {
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    filter: (src) => !/(?:^|\/)(?:\.DS_Store|node_modules|\.git)$/.test(src)
  });
}

export function stage(options = {}) {
  const version = options.version || readVersion();
  const log = options.log || (() => {});

  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(APP_DIR, { recursive: true });
  mkdirSync(SITE_OUT, { recursive: true });
  mkdirSync(join(APP_DIR, 'resources'), { recursive: true });

  /* 1. the shell */
  for (const file of SHELL_FILES) {
    const from = join(here, file);
    if (!existsSync(from)) throw new Error(`Shell file missing: ${file}`);
    cpSync(from, join(APP_DIR, file));
  }
  cpSync(join(here, 'resources', 'icon.png'), join(APP_DIR, 'resources', 'icon.png'));
  cpSync(join(here, 'resources', 'icons'), join(APP_DIR, 'resources', 'icons'), { recursive: true });

  /* 2. the site */
  const copied = [];
  for (const entry of SITE_ENTRIES) {
    const from = join(ROOT, entry);
    if (!existsSync(from)) {
      if (entry === 'assets' || entry === 'api' || entry === 'lib') throw new Error(`The site is missing ${entry}`);
      continue;
    }
    copyEntry(from, join(SITE_OUT, entry));
    copied.push(entry);
  }
  for (const entry of SITE_TOOL_FILES) {
    const from = join(ROOT, entry);
    if (!existsSync(from)) throw new Error(`The site is missing ${entry}`);
    const dest = join(SITE_OUT, entry);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(from, dest);
    copied.push(entry);
  }
  for (const entry of OPTIONAL_SITE_ENTRIES) {
    const from = join(ROOT, entry);
    if (existsSync(from)) {
      copyEntry(from, join(SITE_OUT, entry));
      copied.push(entry);
    }
  }

  /* 3. a package.json for Electron, not for the website */
  const pkg = {
    name: 'eltes-desktop',
    productName: 'Eltes',
    version,
    description: 'Eltes — a local-first AI workspace, on the desktop.',
    author: { name: 'Eltes', email: 'hello@eltes.ai' },
    homepage: 'https://github.com/gefrus112/eltes',
    license: 'UNLICENSED',
    private: true,
    main: 'main.js',
    devDependencies: { electron: electronVersion() }
  };
  writeFileSync(join(APP_DIR, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  const bytes = directorySize(APP_DIR) + directorySize(SITE_OUT);
  const files = countFiles(SITE_OUT);
  log(`staged ${copied.length} site entries · ${files} files · ${(bytes / 1048576).toFixed(1)} MB`);

  return { version, appDir: APP_DIR, siteDir: SITE_OUT, entries: copied, bytes, files };
}

function walk(dir, onFile) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, onFile);
    else onFile(full, info);
  }
}

export function directorySize(dir) {
  let total = 0;
  if (!existsSync(dir)) return 0;
  walk(dir, (_file, info) => { total += info.size; });
  return total;
}

export function countFiles(dir) {
  let total = 0;
  if (!existsSync(dir)) return 0;
  walk(dir, () => { total += 1; });
  return total;
}

/* Filenames and hashes matter for a reproducible installer manifest. */
export function siteDigest(dir) {
  const hash = createHash('sha256');
  const files = [];
  walk(dir, (file) => files.push(file));
  files.sort();
  for (const file of files) {
    hash.update(relative(dir, file));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

/* ------------------------------- build config ----------------------------- */

const TARGETS = {
  win: {
    label: 'Windows',
    build: (version, opts) => ({
      target: [
        { target: 'nsis', arch: opts.archs.win || ['x64', 'arm64'] },
        { target: 'portable', arch: opts.archs.win || ['x64'] }
      ],
      icon: join(APP_DIR, 'resources', 'icon.ico')
    })
  },
  mac: {
    label: 'macOS',
    build: () => ({
      target: ['dmg', 'zip'],
      icon: join(APP_DIR, 'resources', 'icon.icns'),
      category: 'public.app-category.productivity',
      darkModeSupport: true,
      /* unsigned by default; set CSC_LINK / CSC_NAME to sign and notarise */
      hardenedRuntime: false,
      gatekeeperAssess: false,
      identity: undefined,
      notarize: false,
      extendInfo: {
        NSHumanReadableCopyright: `Copyright © ${new Date().getFullYear()} Eltes`,
        LSApplicationCategoryType: 'public.app-category.productivity'
      }
    })
  },
  linux: {
    label: 'Linux',
    build: () => ({
      target: ['AppImage', 'deb'],
      icon: join(APP_DIR, 'resources', 'icons'),
      category: 'Utility',
      executableName: 'eltes',
      synopsis: 'Local-first AI workspace',
      description: 'Eltes runs a local workspace, on-device models and Studio inside this app.',
      desktop: { entry: { Name: 'Eltes', Comment: 'Local-first AI workspace', Categories: 'Utility;Development;' } }
    })
  }
};

export function electronBuilderConfig(options = {}) {
  const version = options.version || readVersion();
  const opts = {
    archs: options.archs || {},
    signing: !!(options.signing || process.env.CSC_LINK || process.env.CSC_NAME),
    output: options.output || join(BUILD_DIR, 'dist')
  };
  const platformKeys = (options.platforms || Object.keys(TARGETS)).filter((key) => TARGETS[key]);

  const config = {
    appId: 'ai.eltes.desktop',
    productName: 'Eltes',
    copyright: `Copyright © ${new Date().getFullYear()} Eltes`,
    electronVersion: electronVersion(),
    directories: {
      app: APP_DIR,
      output: opts.output,
      buildResources: join(APP_DIR, 'resources')
    },
    files: [
      'main.js', 'preload.js', 'shell.js', 'menu.js', 'window-state.js',
      'fallback.html', 'package.json',
      { from: 'resources/icon.png', to: 'resources/icon.png' }
    ],
    extraResources: [{ from: 'site', to: 'site', filter: ['**/*'] }],
    asar: true,
    compression: options.fast ? 'normal' : 'maximum',
    npmRebuild: false,
    buildDependenciesFromSource: false,
    removePackageScripts: true,
    publish: null,
    protocols: [{ name: 'Eltes link', schemes: ['eltes'] }],
    artifactName: 'Eltes-${version}-${os}-${arch}.${ext}'
  };

  for (const key of platformKeys) {
    config[key] = TARGETS[key].build(version, opts);
  }

  if (config.win) {
    config.nsis = {
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Eltes',
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      artifactName: 'Eltes-Setup-${version}-${arch}.${ext}',
      installerIcon: join(APP_DIR, 'resources', 'icon.ico'),
      uninstallerIcon: join(APP_DIR, 'resources', 'icon.ico'),
      installerHeaderIcon: join(APP_DIR, 'resources', 'icon.ico')
    };
    config.portable = {
      artifactName: 'Eltes-${version}-Portable-${arch}.${ext}',
      requestExecutionLevel: 'user'
    };
    if (process.platform !== 'win32' && !process.env.ELTES_WIN_EDIT) {
      /* rcedit needs Windows or wine; without it the .exe still builds */
      config.win.signAndEditExecutable = false;
    }
  }
  if (config.mac) {
    if (!opts.signing) config.mac.identity = null;
    config.mac.artifactName = 'Eltes-${version}-${arch}.${ext}';
    config.dmg = {
      title: 'Eltes ${version}',
      icon: join(APP_DIR, 'resources', 'icon.icns'),
      artifactName: 'Eltes-${version}-${arch}.${ext}',
      contents: [
        { x: 140, y: 220, type: 'file' },
        { x: 400, y: 220, type: 'link', path: '/Applications' }
      ]
    };
  }
  if (config.linux) {
    config.linux.artifactName = 'Eltes-${version}-linux-${arch}.${ext}';
    config.deb = { artifactName: 'eltes_${version}_${arch}.${ext}', maintainer: 'Eltes <hello@eltes.ai>' };
    config.appImage = { artifactName: 'Eltes-${version}-linux-${arch}.${ext}' };
  }

  return config;
}

export function expectedArtifacts(version, platform) {
  const map = {
    win: [
      `Eltes-Setup-${version}-x64.exe`,
      `Eltes-Setup-${version}-arm64.exe`,
      `Eltes-${version}-Portable-x64.exe`
    ],
    darwin: [`Eltes-${version}-arm64.dmg`, `Eltes-${version}-x64.dmg`],
    mac: [`Eltes-${version}-arm64.dmg`, `Eltes-${version}-x64.dmg`],
    linux: [`Eltes-${version}-linux-x86_64.AppImage`, `eltes_${version}_amd64.deb`]
  };
  return map[platform] || [];
}

/* -------------------------------- runner ---------------------------------- */

function electronBuilderCli() {
  try {
    const pkg = require.resolve('electron-builder/package.json');
    const cli = join(dirname(pkg), 'out', 'cli', 'cli.js');
    if (existsSync(cli)) return cli;
  } catch (error) {
    /* fall through to the local install */
  }
  const bin = join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  return existsSync(bin) ? bin : null;
}

function platformKey(name) {
  if (name === 'win' || name === 'windows' || name === 'win32') return 'win';
  if (name === 'mac' || name === 'darwin') return 'mac';
  if (name === 'linux') return 'linux';
  return name;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const fallbackKey = platformKey(process.platform);
  const out = { target: null, archs: {}, dir: false, stageOnly: false, fast: false };
  for (const arg of args) {
    if (arg === '--stage-only') out.stageOnly = true;
    else if (arg === '--dir') out.dir = true;
    else if (arg === '--fast') out.fast = true;
    else if (arg.startsWith('--target=')) out.target = arg.slice(9);
    else if (arg === '--all') out.target = 'all';
    else if (arg.startsWith('--arch=')) {
      const [first, second] = arg.slice(7).split(':');
      if (second) out.archs[platformKey(first)] = [second];
      else out.archs[platformKey(out.target || fallbackKey)] = [first];
    } else if (arg.startsWith('--archs=')) {
      out.archs[platformKey(out.target || fallbackKey)] = arg.slice(8).split(',').filter(Boolean);
    }
  }
  return out;
}

function platformFor(target) {
  if (!target || target === 'all') {
    if (process.platform === 'win32') return ['win'];
    if (process.platform === 'darwin') return ['mac'];
    return ['linux'];
  }
  if (target === 'win' || target === 'windows') return ['win'];
  if (target === 'mac' || target === 'darwin') return ['mac'];
  if (target === 'linux') return ['linux'];
  throw new Error(`Unknown target "${target}". Use win, mac, linux or all.`);
}

async function run() {
  const args = parseArgs(process.argv);
  const version = readVersion();
  console.log(`Eltes Desktop ${version} · node ${process.version} · ${process.platform}-${process.arch}`);

  if (!existsSync(join(here, 'resources', 'icon.ico'))) {
    console.error('Missing desktop/resources. Run: node desktop/icon.mjs');
    process.exit(1);
  }

  const staged = stage({ version, log: (line) => console.log(`  ${line}`) });
  console.log(`  site digest ${siteDigest(staged.siteDir).slice(0, 16)}`);
  if (args.stageOnly) {
    console.log(`staged into ${relative(ROOT, BUILD_DIR)}`);
    return;
  }

  const cli = electronBuilderCli();
  if (!cli) {
    console.error('electron-builder is not installed. Run: npm install');
    process.exit(1);
  }

  const platforms = platformFor(args.target);
  const config = electronBuilderConfig({ version, platforms, archs: args.archs, fast: args.fast });
  const configFile = join(BUILD_DIR, 'electron-builder.json');
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  const flags = ['--config', configFile, '--publish', 'never'];
  if (args.dir) flags.push('--dir');
  for (const platform of platforms) {
    flags.push(`--${platform}`);
    const archs = args.archs[platform];
    if (archs && archs.length) flags.push(...archs.map((arch) => `--${arch}`));
  }

  console.log(`  ${join(ROOT, 'node_modules', '.bin', 'electron-builder')} ${flags.join(' ')}`);
  const code = await new Promise((resolveCode) => {
    const child = spawn(process.execPath, [cli, ...flags], {
      cwd: BUILD_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        /* Electron and the helper binaries are cached by electron-builder's own
           defaults (or ELECTRON_CACHE / ELECTRON_BUILDER_CACHE in CI), so a
           rebuild does not download them again. */
        CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_LINK ? 'true' : 'false'
      }
    });
    child.on('exit', (exitCode) => resolveCode(exitCode || 0));
    child.on('error', (error) => { console.error(error); resolveCode(1); });
  });
  if (code !== 0) process.exit(code);

  const outDir = config.directories.output;
  if (existsSync(outDir)) {
    console.log('\nArtifacts:');
    const seen = [];
    walk(outDir, (file) => { if (/\.(exe|dmg|zip|AppImage|deb|snap)$/.test(file)) seen.push(file); });
    seen.sort();
    for (const file of seen) {
      const size = statSync(file).size;
      console.log(`  ${relative(ROOT, file)}  ·  ${(size / 1048576).toFixed(1)} MB`);
    }
    if (!seen.length) console.log('  (none — check the electron-builder output above)');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
