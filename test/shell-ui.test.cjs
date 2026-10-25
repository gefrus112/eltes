const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('browser exposes pairing controls and a visible exact-command approval gate', () => {
  const html = read('app.html');
  const app = read('assets/js/app.js');
  assert.match(html, /id="localShellBtn"/);
  assert.match(html, /id="localShellToken"/);
  assert.match(html, /id="shellCommandApprovalDialog"/);
  assert.match(html, /id="shellApprovalCommand"/);
  assert.match(html, /This is not a sandbox/);
  assert.match(app, /SHELL_TOOL_DEF/);
  assert.match(app, /requestShellApproval\(command, script, controller\.signal, workspace\)/);
  assert.match(app, /Authorization: `Bearer \$\{state\.shellToken\}`/);
  assert.match(app, /\? \[SHELL_TOOL_DEF, PROJECT_SCRIPT_TOOL_DEF, \.\.\.LOCAL_PROJECT\.tools\] : \[\]/);
  assert.doesNotMatch(app, /localStorage\.(setItem|getItem).*shellToken|sessionStorage\.(setItem|getItem).*shellToken/i);
});

test('local runner is guarded by token, loopback, same origin, and disabled-by-default opt-in', () => {
  const runner = read('tools/shell-runner.mjs');
  const server = read('tools/local-server.mjs');
  assert.match(runner, /enabled = false/);
  assert.match(runner, /isLoopback\(req\.socket/);
  assert.match(runner, /sameOrigin\(req\)/);
  assert.match(runner, /timingSafeEqual/);
  assert.match(runner, /MAX_COMMAND_CHARS = 4000/);
  assert.match(runner, /MAX_OUTPUT_BYTES = 32 \* 1024/);
  assert.match(runner, /COMMAND_TIMEOUT_MS = 30_000/);
  assert.match(server, /process\.env\.ELTES_ENABLE_SHELL === '1'/);
  assert.match(read('tools/windows/eltes.bat'), /--shell/);
  assert.match(read('tools/windows/Start-Eltes.ps1'), /-EnableShell/);
  assert.match(read('tools/build-windows.sh'), /tools\/shell-runner\.mjs/);
  assert.match(read('tools/windows/README-WINDOWS.txt'), /not a filesystem sandbox/);
});
