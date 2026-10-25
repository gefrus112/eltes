/* Optional real-Chromium regression. Start the local server with both shells OFF.
 * Uses a private, ephemeral test HTTP server for provider fixtures and real runner
 * execution. No paid provider API calls. Dependencies: see check-browser-sandbox.cjs.
 */
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const browserRequire = process.env.ELTES_BROWSER_MODULES
  ? createRequire(path.resolve(process.env.ELTES_BROWSER_MODULES, '..', 'package.json')) : require;
const { chromium } = browserRequire('playwright-core');
const binary = browserRequire('@sparticuz/chromium').default;
const upstream = process.env.ELTES_TEST_URL || 'http://127.0.0.1:4173';

(async () => {
  const { createShellRunner } = await import('../tools/shell-runner.mjs');
  const runner = createShellRunner({ root: process.cwd(), enabled: true });
  let releaseDraft, protocol = 'openai', requests = [], executions = 0;
  const plan = 'Plan: create hello.py in the virtual workspace, review its source, then run the approved local script and check its exit code.\n';
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/shell') { executions++; return await runner.execute(req, res); }
      if (req.url === '/api/shell/status') return runner.status(req, res);
      if (req.url === '/test-provider/chat/completions' || req.url === '/api/chat') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
        const index = requests.length;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        const event = data => res.write('data: ' + JSON.stringify(data) + '\n\n');
        const text = text => protocol === 'openai'
          ? event({ choices: [{ delta: { content: text } }] })
          : event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
        const tool = (name, args, first) => protocol === 'openai'
          ? event({ choices: [{ delta: { tool_calls: [{ index: 0, ...(first ? { id: `call-${index}`, type: 'function' } : {}), function: { ...(first ? { name } : {}), arguments: args } }] } }] })
          : (first && event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: `call-${index}`, name, input: {} } }),
            event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: args } }));
        if (index === 1) {
          text(plan);
          tool('write_project_file', '{"filename":"hello.py","content":"print(\\"live', true);
          // Hold the actual HTTP stream open until the browser verifies a draft.
          await new Promise(resolve => { releaseDraft = resolve; res.once('close', resolve); });
          if (res.destroyed) return;
          tool('write_project_file', ' Python 42\\")"}', false);
        } else if (index === 2) {
          text('Plan: run the reviewed hello.py with the paired local runner and inspect stdout.\n');
          tool('run_project_script', '{"filename":"hello.py"}', true);
        } else text('Script completed. Review its actual output in the activity panel.');
        res.end(); return;
      }
      const response = await fetch(upstream + req.url);
      res.statusCode = response.status;
      res.setHeader('content-type', response.headers.get('content-type') || 'text/plain');
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: await binary.executablePath(), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { if (window === top) localStorage.setItem('eltes.setup.v1', '1'); });
    async function configure(provider) {
      protocol = provider; requests = [];
      await page.goto(origin + '/app.html'); await page.waitForFunction(() => !!window.Eltes);
      await page.evaluate(({ token, provider }) => {
        const s = window.Eltes.state;
        s.shellToken = token; s.shellRunnerInfo = { workspace: 'Test runner' };
        s.settings.tools = true; s.settings.stream = true;
        s.settings.backendUrl = location.origin; s.settings.backendDisabled = false;
        s.settings.customBaseUrl = location.origin + '/test-provider'; s.settings.customModel = 'fixture';
        s.settings.keys.anthropic = 'fixture-not-a-real-key';
        // Keep independent fixture turns; never rely on provider credentials.
        s.chats = []; s.activeId = null;
        window.Eltes.selectModel(provider === 'openai' ? 'custom-endpoint' : 'claude-sonnet-4');
        document.querySelectorAll('dialog[open]').forEach(d => d.close());
      }, { token: runner.info.token, provider });
    }
    for (const provider of ['openai', 'anthropic']) {
      await configure(provider);
      await page.locator('#input').fill('Create and execute a Python script.'); await page.locator('#sendBtn').click();
      await page.waitForFunction(() => document.querySelector('#projectSandboxDraft').textContent.includes('print("live'));
      assert.equal(await page.locator('#projectSandboxFiles button').count(), 0, 'Unapproved streamed draft is not a saved file');
      assert.equal(await page.locator('#artifactApprovalDialog').isVisible(), false, 'Stream is still incomplete');
      assert.equal(await page.locator('#projectSandboxDialog').evaluate(d => d.matches(':modal')), false);
      releaseDraft();
      await page.locator('#approveArtifactBtn').click();
      await page.locator('#shellCommandApprovalDialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#shellApprovalSource').textContent(), 'print("live Python 42")');
      const before = executions;
      if (provider === 'anthropic') await page.locator('#denyShellCommandBtn').click();
      else await page.locator('#approveShellCommandBtn').click();
      await page.waitForFunction(() => !window.Eltes.state.sending);
      assert.equal(requests.length, 3, 'Tool results returned to the selected provider');
      if (provider === 'openai') {
        assert.equal(executions, before + 1);
        assert.match(await page.locator('#projectSandboxActivity').textContent(), /live Python 42/);
        assert.ok(requests[2].messages.some(m => m.role === 'tool' && m.content.includes('Exit code: 0')));
      } else {
        assert.equal(executions, before, 'Decline makes no execution request');
        assert.ok(requests[2].messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.is_error === true && /declined/.test(b.content))));
      }
    }
    async function addFile(filename, content) {
      await page.locator('#projectSandboxNewName').fill(filename); await page.locator('#projectSandboxAdd').click();
      await page.locator('#projectSandboxEditor').fill(content); await page.locator('#projectSandboxSave').click();
    }
    await addFile('typed.ts', 'const answer: number = 42; console.log("TypeScript", answer);');
    await page.locator('#projectSandboxScript').click(); await page.locator('#approveShellCommandBtn').click();
    await page.waitForFunction(() => document.querySelector('#projectSandboxActivity').textContent.includes('TypeScript 42'));
    await page.waitForFunction(() => /Script completed/.test(document.querySelector('#projectSandboxStatus').textContent));
    await addFile('wait.js', 'console.log("RUNNING-NOW"); setTimeout(() => console.log("TOO-LATE"), 20000);');
    await page.locator('#projectSandboxScript').click(); await page.locator('#approveShellCommandBtn').click();
    await page.waitForFunction(() => document.querySelector('#projectSandboxActivity').textContent.includes('RUNNING-NOW'));
    assert.ok(!/Script completed/.test(await page.locator('#projectSandboxStatus').textContent()), 'Output is visible before script completion');
    await page.locator('#projectSandboxCancelTask').click();
    await page.waitForFunction(() => document.querySelector('#projectSandboxActivity').textContent.includes('Execution cancelled'));
    assert.ok(!(await page.locator('#projectSandboxActivity').textContent()).includes('TOO-LATE'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('#projectSandboxDialog').evaluate(d => d.getBoundingClientRect().right <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('PASS: OpenAI + Claude real streamed draft protocols; pre-approval isolation; real Python tool loop; denied execution; TypeScript execution; live JS output and cancellation; mobile panel; no page errors. Provider responses are test fixtures.');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
