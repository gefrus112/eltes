# Eltes Desktop

The desktop harness. It wraps the same static site the browser build serves in a
native window — **Windows `.exe`, macOS `.dmg`, Linux `.AppImage`/`.deb`** — with
no server to install, no Node runtime to find, and no browser tabs.

The window is Electron. Everything else is the existing app: `desktop/main.js`
starts `tools/local-server.mjs` on a free loopback port using its own binary
(`ELECTRON_RUN_AS_NODE=1`), then loads `app.html` from that origin. The on-device
models, Studio, the terminal, the local API and your keys all behave exactly as
they do under `npm start`.

```
desktop/
  main.js            Electron adapter: window, menu, IPC, protocol, lifecycle
  shell.js           platform-free core: site lookup, ports, server supervision,
                     health wait, navigation policy, bounds (unit tested)
  window-state.js    remembered window position, clamped to real displays
  menu.js            the application menu as data (unit tested)
  preload.js         the only page↔shell bridge, context-isolated
  fallback.html      recovery screen when the local server will not start
  build.mjs          packaging harness: stages the app + site, drives electron-builder
  icon.mjs           draws the icon in .png/.ico/.icns from the site's cloud mark
  resources/         committed icon binaries (regenerate with npm run desktop:icons)
  .build/            staging + artifacts (gitignored)
```

## Run it in development

```bash
npm install                 # electron + electron-builder
npm run desktop            # electron desktop/main.js
npm run desktop:dev        # same, with developer tools and verbose logs
```

`npm run desktop` runs against the checkout: the site directory is resolved to
the repository root, and Studio writes to the normal `.studio/` folder. Flags:

| Flag | Effect |
| --- | --- |
| `--dev` | developer tools, extra logging |
| `--port=4173` | preferred port (the harness skips to the next free one) |
| `--no-studio` | start without the Studio backend and terminal |
| `--reset-window` | ignore the remembered window position |
| `eltes://studio` | deep link, also accepted on a second launch |

## Build the installers

```bash
npm run desktop:icons      # only after changing the brand mark
npm run desktop:stage      # assemble desktop/.build and stop — fastest sanity check
npm run desktop:dir        # unpacked app for this platform, no installer
npm run desktop:build      # every installer for this platform
npm run desktop:win        # Windows: NSIS installer + portable .exe
npm run desktop:mac        # macOS: .dmg + .zip
npm run desktop:linux      # Linux: .AppImage + .deb
```

Artifacts land in `desktop/.build/dist/`:

| Platform | File | What it is |
| --- | --- | --- |
| Windows | `Eltes-Setup-<version>-x64.exe` | NSIS installer: per-user, choose the folder, desktop and Start-menu shortcuts |
| Windows | `Eltes-<version>-Portable-x64.exe` | one file, no install; runs from a USB stick |
| macOS | `Eltes-<version>-arm64.dmg` / `-x64.dmg` | drag to Applications |
| macOS | `Eltes-<version>-mac-<arch>.zip` | zipped `.app` for MDM or manual copy |
| Linux | `Eltes-<version>-linux-x86_64.AppImage` | single executable, `chmod +x` and run |
| Linux | `eltes_<version>_amd64.deb` | Debian/Ubuntu package, installs a menu entry |

Build each platform **on that platform** — that is what CI does. Windows targets
can be cross-built from macOS/Linux, but the `.exe` resource editor (`rcedit`)
needs Wine; without it the build still completes with default metadata, or set
`ELTES_WIN_EDIT=1` when Wine is present. macOS targets can only be built on macOS.

Signing is optional and off by default:

```bash
# macOS: Developer ID + notarisation
export CSC_LINK=/path/to/certificate.p12 CSC_KEY_PASSWORD=… APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…
npm run desktop:mac

# Windows: Authenticode
export CSC_LINK=/path/to/certificate.pfx CSC_KEY_PASSWORD=…
npm run desktop:win
```

Unsigned builds work but show the usual OS warnings: SmartScreen ("More info →
Run anyway") on Windows, and right-click → Open on macOS. The macOS build is
ad-hoc signed by default so Apple silicon will launch it.

## What the shell does and does not do

- **One window, hardened.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, `webviewTag: false`, devtools only with `--dev`.
- **Navigation is locked to the app's own origin.** Anything else opens in your
  real browser. `file:`, `data:` and `javascript:` URLs are refused outright.
- **Permissions** are denied except clipboard read/write, and only on the app
  origin.
- **The local server binds to `127.0.0.1`**, never `0.0.0.0`. The port is chosen
  at launch, so two Eltes windows or a dev server never collide.
- **Data lives with the app**, not in the install directory:
  - Windows `%APPDATA%\Eltes`
  - macOS `~/Library/Application Support/Eltes`
  - Linux `~/.config/Eltes`

  `studio/` is the Studio workspace (redirected with `ELTES_STUDIO_DIR`),
  `logs/desktop.log` is the shell + server log (rotated once at 1.5 MB), and
  `window-state.json` remembers the window. Chats, settings and keys stay in
  Chromium's profile inside that folder, exactly like the browser build.
- **No new network surface.** The shell adds no telemetry and no update pings;
  the only requests are the ones the app already makes to providers you connect.

If the server cannot start, the window shows a recovery screen with the error,
the data folder and the log path, plus **Try again** — the shell does not quit
silently.

## CI

`.github/workflows/desktop.yml` builds all three platforms on their own runners
(`windows-latest`, `macos-14` arm64, `macos-13` x64, `ubuntu-latest`) on a tag or
from the Actions tab, and attaches the installers to the GitHub release for that
tag. Nothing is published anywhere else.

## Tests

`test/desktop.test.cjs` covers the parts that can be proven without a display:
flag parsing, deep links, navigation policy, window clamping across removed
monitors, atomic window state, the menu on each platform, packaging config
(validated against electron-builder's own schema in review), and a **real boot of
the packaged layout** — the site copied to `resources/site`, the server started
through the same code path as production, health checked, `app.html` and its
assets fetched, Studio session opened, process stopped.
