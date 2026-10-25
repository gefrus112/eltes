/* Real local file/command and WebGL tests; provider messages are fixtures only.
 * Requires the optional browser dependencies used by check-browser-sandbox.cjs.
 */
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const req = process.env.ELTES_BROWSER_MODULES ? createRequire(path.resolve(process.env.ELTES_BROWSER_MODULES, '..', 'package.json')) : require;
const { chromium } = req('playwright-core');
const binary = req('@sparticuz/chromium').default;
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eltes-runtime-browser-'));
  const { createShellRunner } = await import('../tools/shell-runner.mjs');
  const runner = createShellRunner({ root, enabled: true });
  let calls = 0;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/api/shell/files') return await runner.files(request, response);
      if (request.url === '/api/shell') return await runner.execute(request, response);
      if (request.url === '/api/shell/status') return runner.status(request, response);
      if (request.url === '/fixture/chat/completions') {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks)); calls++;
        if (calls === 3) assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('first')));
        const actions = [
          ['write_file', { filePath: 'src/main.js', content: 'console.log("first");' }],
          ['read_file', { filePath: 'src/main.js', startLine: 1, lineCount: 1 }],
          ['patch_file', { filePath: 'src/main.js', searchString: 'first', replaceString: 'VERIFIED-LOCAL' }],
          ['execute_bash_command', { command: 'node src/main.js' }]
        ];
        const [name, args] = actions[calls - 1];
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Plan: review source in .studio, make the small approved change, and check the actual command output.\n', tool_calls: [{ id: `test-${calls}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })); return;
      }
      const res = await fetch((process.env.ELTES_TEST_URL || 'http://127.0.0.1:4173') + request.url);
      response.statusCode = res.status; response.setHeader('Content-Type', res.headers.get('content-type') || 'text/plain'); response.end(Buffer.from(await res.arrayBuffer()));
    } catch (error) { response.statusCode = 500; response.end(error.message); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ executablePath: await binary.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    const errors = []; const external = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { if (window === top) localStorage.setItem('eltes.setup.v1', '1'); });
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`); await page.waitForFunction(() => !!window.Eltes);
    await page.evaluate(token => {
      const s = window.Eltes.state; s.shellToken = token; s.shellRunnerInfo = { workspace: 'fixture', projectWorkspace: 'fixture/.studio' };
      s.settings.customBaseUrl = location.origin + '/fixture'; s.settings.customModel = 'fixture'; s.settings.tools = true; s.settings.stream = false; s.settings.backendDisabled = true;
      window.Eltes.selectModel('custom-endpoint');
    }, runner.info.token);
    await page.locator('#input').fill('Write, inspect, patch and test a local script.'); await page.locator('#sendBtn').click();
    await page.locator('#artifactApprovalDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#artifactApprovalTitle').textContent(), /persistent/);
    await assert.rejects(fs.stat(path.join(root, '.studio/src/main.js')), { code: 'ENOENT' });
    await page.locator('#approveArtifactBtn').click();
    await page.waitForFunction(() => document.querySelector('#artifactApprovalDialog').open && document.querySelector('#artifactApprovalTitle').textContent.includes('Share local'));
    await page.locator('#approveArtifactBtn').click();
    await page.waitForFunction(() => document.querySelector('#artifactApprovalDialog').open && document.querySelector('#artifactApprovalContent').textContent.includes('VERIFIED-LOCAL'));
    await page.locator('#approveArtifactBtn').click();
    await page.locator('#shellCommandApprovalDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#shellApprovalWorkspace').textContent(), /studio/);
    await page.locator('#approveShellCommandBtn').click(); await page.waitForFunction(() => !window.Eltes.state.sending);
    assert.equal(calls, 4); assert.equal(await fs.readFile(path.join(root, '.studio/src/main.js'), 'utf8'), 'console.log("VERIFIED-LOCAL");');
    await page.waitForFunction(() => document.querySelector('.agent-terminal-state').textContent.includes('Exit code: 0'));
    assert.match(await page.locator('.agent-terminal pre').textContent(), /VERIFIED-LOCAL/);
    await page.locator('.agent-terminal summary').click(); assert.equal(await page.locator('.agent-terminal').getAttribute('open'), null);
    await page.locator('.agent-terminal summary').press('Enter'); assert.notEqual(await page.locator('.agent-terminal').getAttribute('open'), null);
    // The 3D starter is reviewed and does not execute until Preview is clicked.
    await page.locator('#projectSandboxThreeStarter').click(); await page.locator('#approveArtifactBtn').click();
    assert.equal(await page.locator('#projectSandboxPreview').getAttribute('srcdoc'), null);
    page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(page.url()).origin) external.push(request.url()); });
    await page.locator('#projectSandboxRun').click();
    const frame = page.frameLocator('#projectSandboxPreview');
    await frame.locator('canvas').waitFor();
    assert.equal(await frame.locator('#motion').textContent(), 'Play animation');
    assert.equal(await frame.locator('body').evaluate(() => THREE.REVISION), '180');
    assert.equal(await frame.locator('body').evaluate(() => { try { localStorage.getItem('x'); return false; } catch { return true; } }), true);
    assert.equal(await frame.locator('canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'); return !!gl && gl.getParameter(gl.CURRENT_PROGRAM) !== null; }), true, 'Actual WebGL draw');
    assert.equal(await frame.locator('body').evaluate(() => ELTES_PREVIEW.theme), 'black');
    await frame.locator('#motion').click(); assert.equal(await frame.locator('#motion').textContent(), 'Pause animation');
    await page.locator('#projectSandboxStop').click(); assert.equal(await page.locator('#projectSandboxPreview').getAttribute('srcdoc'), '');
    await page.evaluate(() => { window.Eltes.state.settings.theme = 'grey'; window.Eltes.applyTheme('grey'); });
    await page.locator('#projectSandboxRun').click(); await frame.locator('canvas').waitFor();
    assert.equal(await frame.locator('body').evaluate(() => ELTES_PREVIEW.theme), 'grey');
    assert.equal(await frame.locator('canvas').evaluate(canvas => Math.round(canvas.getContext('webgl2').getParameter(3106)[0] * 255)), 26);
    await page.locator('#projectSandboxStop').click();
    const starter = await page.locator('#projectSandboxEditor').inputValue();
    await page.locator('#projectSandboxEditor').fill(starter.replace('const scene = new THREE.Scene();', 'throw new Error("WebGL disabled for test");\nconst scene = new THREE.Scene();'));
    await page.locator('#projectSandboxSave').click(); await page.locator('#projectSandboxRun').click();
    await frame.locator('#fallback').filter({ hasText: '3D unavailable' }).waitFor();
    assert.equal(await frame.locator('#motion').isDisabled(), true);
    const safety = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host); const ui = EltesAgentUI.create(host);
      const card = ui.begin('<img src=x onerror=alert(1)>');
      card.event({ type: 'stdout', text: '<script>alert(1)</script>' + 'x'.repeat(100000) });
      const bytes = host.querySelector('pre').textContent.length; const markup = host.querySelectorAll('img, script').length;
      for (let i = 0; i < 15; i++) ui.begin('bounded run');
      const count = host.children.length; host.remove(); return { bytes, markup, count };
    });
    assert.equal(safety.bytes, 48 * 1024); assert.equal(safety.markup, 0); assert.equal(safety.count, 12);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    console.log('PASS: real persistent write/read/patch/command loop with approval; .studio cwd; collapsible live cards; four-round limit; actual offline Three.js WebGL render; both themes; reduced motion; opaque origin; GPU fallback; no external requests.');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
