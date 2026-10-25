const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('new workspaces get a dismissible setup guide with local and hosted starting paths', () => {
  const html = read('app.html');
  const app = read('assets/js/app.js');
  assert.match(html, /id="welcomeSetupDialog"/);
  assert.match(html, /id="setupChooseLocalBtn"/);
  assert.match(html, /id="setupConnectProviderBtn"/);
  assert.match(html, /id="finishWelcomeSetupBtn"/);
  assert.match(html, /id="setupOpenFilesBtn"/);
  assert.match(html, /id="setupOpenTerminalBtn"/);
  assert.match(html, /Installing Eltes does not grant blanket access to your computer/);
  assert.match(app, /WELCOME_SETUP_KEY = 'eltes\.setup\.v1'/);
  assert.match(app, /\$\('#workspaceFilesBtn'\)\.click\(\)/);
  assert.match(app, /\$\('#localShellBtn'\)\.click\(\)/);
  assert.match(app, /!state\.chats\.length && !wanted && !setupSeen/);
  assert.match(app, /selectModel\('eltes-cai-1'\)/);
  assert.match(app, /label: 'Quick setup'/);
});

test('quick setup uses the existing Eltes icon and offers a browser-native PWA install', () => {
  const html = read('app.html');
  const app = read('assets/js/app.js');
  assert.match(html, /class="welcome-cloud-mark"[\s\S]*?fill="#39dca2"/);
  assert.match(html, /id="setupInstallPwaBtn"/);
  assert.match(html, /Chrome.?s Install page as app option/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /installPromptEvent\.prompt\(\)/);
  assert.match(app, /appinstalled/);
  assert.match(app, /Installation grants no computer access by itself/);
  assert.match(app, /POST_INSTALL_SETUP_KEY = 'eltes\.pwa\.local-access-setup\.v1'/);
  assert.match(app, /setTimeout\(openWelcomeSetup, 450\)/);
  assert.match(app, /appinstalled'[\s\S]*?openWelcomeSetup\(\)/);
});
