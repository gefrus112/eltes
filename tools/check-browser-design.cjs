/* Optional Chromium tests for CTab and reviewed project edits. Same dependencies
 * and ELTES_BROWSER_MODULES/ELTES_TEST_URL as check-browser-sandbox.cjs.
 * Provider responses below are deterministic test fixtures, not paid API calls. */
const path = require('node:path');
const { createRequire } = require('node:module');
const req = process.env.ELTES_BROWSER_MODULES ? createRequire(path.resolve(process.env.ELTES_BROWSER_MODULES, '..', 'package.json')) : require;
const { chromium } = req('playwright-core');
const binary = req('@sparticuz/chromium').default;
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: await binary.executablePath(), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { if (window === top) localStorage.setItem('eltes.setup.v1', '1'); });
    await page.goto((process.env.ELTES_TEST_URL || 'http://127.0.0.1:4173') + '/app.html');
    await page.waitForFunction(() => !!window.Eltes);
    await page.evaluate(() => {
      const s = window.Eltes.state;
      s.settings.keys = { anthropic: 'fixture-only' };
      s.chats = [{ id: 'design-test', title: 'Design test', model: 'eltes-cai-1', messages: [
        { id: 'u', role: 'user', content: 'Build a little website.', ts: Date.now() },
        { id: 'a', role: 'assistant', content: '## Plan\nReview the files, then preview the result.\n```js\nconsole.log(42);\n```', ts: Date.now(), tools: [] }
      ] }];
      s.activeId = 'design-test'; window.Eltes.renderAll(); window.Eltes.persistNow(); window.Eltes.openSettings('ctab');
    });
    const original = await page.evaluate(() => JSON.stringify({ chats: window.Eltes.state.chats, keys: window.Eltes.state.settings.keys, model: window.Eltes.state.settings.model }));
    for (const id of ['eltes', 'claude', 'gemini', 'chatgpt', 'kimi', 'notebook']) {
      await page.locator(`[data-design="${id}"]`).click();
      assert.equal(await page.locator('body').getAttribute('data-chat-design'), id);
      assert.equal(await page.locator(`[data-design="${id}"]`).getAttribute('aria-pressed'), 'true');
      const actual = await page.locator('.msg.ai .prose').evaluate(el => getComputedStyle(el).fontFamily);
      if (id === 'claude') assert.match(actual, /Georgia/);
      if (id === 'kimi') assert.match(actual, /monospace/);
    }
    await page.locator('#chatThemeSelect').selectOption('grey');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.thread')).backgroundColor === 'rgb(16, 17, 19)');
    await page.locator('#chatDesignAccent').fill('#000000');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ctab-sample-send')).color === 'rgb(255, 255, 255)');
    await page.locator('#chatDesignWidth').fill('1100');
    await page.locator('#chatDesignSize').fill('18');
    await page.locator('#chatDesignRadius').fill('6');
    await page.locator('#chatDesignSpacing').selectOption('compact');
    assert.equal(await page.locator('.thread-inner').evaluate(el => getComputedStyle(el).maxWidth), '1100px');
    assert.equal(await page.locator('.prose').evaluate(el => getComputedStyle(el).fontSize), '18px');
    assert.equal(await page.evaluate(() => JSON.stringify({ chats: window.Eltes.state.chats, keys: window.Eltes.state.settings.keys, model: window.Eltes.state.settings.model })), original);
    await page.reload(); await page.waitForFunction(() => !!window.Eltes);
    assert.equal(await page.locator('body').getAttribute('data-chat-design'), 'notebook');
    assert.equal(await page.locator('.prose').evaluate(el => getComputedStyle(el).fontSize), '18px');
    await page.evaluate(() => window.Eltes.openSettings('ctab'));
    await page.locator('[data-design="claude"]').click();
    if (process.env.ELTES_DESIGN_SCREENSHOT) await page.screenshot({ path: process.env.ELTES_DESIGN_SCREENSHOT });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.dlg.settings').getBoundingClientRect().right <= innerWidth);
    assert.ok(await page.locator('#settingsPanel').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.locator('#resetChatDesign').click();
    assert.equal(await page.locator('body').getAttribute('data-theme'), 'black');
    assert.equal(await page.locator('body').getAttribute('data-chat-design'), 'eltes');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.thread')).backgroundColor === 'rgb(0, 0, 0)');
    await page.locator('#settingsDialog [data-close]').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#openProjectSandbox').click();
    async function add(filename, source) {
      await page.locator('#projectSandboxNewName').fill(filename); await page.locator('#projectSandboxAdd').click();
      await page.locator('#projectSandboxEditor').fill(source); await page.locator('#projectSandboxSave').click();
    }
    await add('main.js', 'const answer = 1;'); await add('other.js', 'other source');
    await page.locator('#projectSandboxFiles button', { hasText: 'main.js' }).click();
    await page.locator('#projectSandboxEditor').fill('unsaved');
    await page.locator('#projectSandboxFiles button', { hasText: 'other.js' }).click();
    assert.equal(await page.locator('#projectSandboxEditor').inputValue(), 'unsaved');
    assert.match(await page.locator('#projectSandboxStatus').textContent(), /Save or discard/);
    await page.locator('#projectSandboxDiscard').click();
    await page.locator('#projectSandboxEditor').focus();
    await page.locator('#projectSandboxEditor').press('End');
    await page.locator('#projectSandboxEditor').press('Tab');
    assert.equal(await page.locator('#projectSandboxEditor').inputValue(), 'const answer = 1;  ');
    await page.locator('#projectSandboxEditor').press('Control+s');
    assert.match(await page.locator('#projectSandboxEditorInfo').textContent(), /Saved in tab/);
    await page.locator('#projectSandboxEditor').press('Escape');
    await page.locator('#projectSandboxEditor').press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'projectSandboxSave');
    await page.locator('#projectSandboxEditor').focus();
    await page.locator('#projectSandboxEditor').press('Tab');
    assert.equal(await page.locator('#projectSandboxEditor').inputValue(), 'const answer = 1;    ');
    await page.locator('#projectSandboxDiscard').click();
    await page.locator('#projectSandboxDialog [data-close]').click();
    let calls = 0;
    const tool = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    await page.route('**/test-design-provider/chat/completions', async route => {
      calls++;
      const body = route.request().postDataJSON();
      if (calls === 2) assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('const answer = 1;')));
      const message = calls === 1 ? { role: 'assistant', content: 'Plan: read main.js with approval, precisely change the answer, and review the full source.', tool_calls: [tool('list', 'list_project_files', {}), tool('read', 'read_project_file', { filename: 'main.js' })] }
        : calls === 2 ? { role: 'assistant', content: 'Plan: replace the single answer assignment without changing other text.', tool_calls: [tool('patch', 'replace_project_text', { filename: 'main.js', search: 'answer = 1', replacement: 'answer = 42' })] }
        : { role: 'assistant', content: 'The reviewed change is saved. No code was executed.' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message }] }) });
    });
    await page.evaluate(() => {
      const s = window.Eltes.state; s.settings.customBaseUrl = location.origin + '/test-design-provider'; s.settings.customModel = 'fixture';
      s.settings.tools = true; s.settings.stream = false; s.settings.backendDisabled = true; s.settings.backendUrl = '';
      window.Eltes.selectModel('custom-endpoint');
    });
    await page.locator('#input').fill('Change the answer in main.js to 42.'); await page.locator('#sendBtn').click();
    await page.locator('#artifactApprovalDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#artifactApprovalTitle').textContent(), /Share project source/);
    await page.locator('#approveArtifactBtn').click();
    await page.waitForFunction(() => document.querySelector('#artifactApprovalDialog').open && document.querySelector('#artifactApprovalContent').textContent.includes('answer = 42'));
    await page.locator('#approveArtifactBtn').click(); await page.waitForFunction(() => !window.Eltes.state.sending);
    assert.equal(calls, 3); assert.equal(await page.locator('#projectSandboxEditor').inputValue(), 'const answer = 42;  ');
    // Exhaustion and unavailable-tool guards are runtime behavior, not prompt promises.
    await page.unroute('**/test-design-provider/chat/completions');
    let budgetCalls = 0, blockedCalls = 0, mode = 'budget';
    await page.route('**/test-design-provider/chat/completions', async route => {
      const body = route.request().postDataJSON();
      let message;
      if (mode === 'budget') {
        budgetCalls++;
        message = { role: 'assistant', content: 'Action: inspect saved project metadata.', tool_calls: [tool('budget-' + budgetCalls, 'list_project_files', {})] };
      } else {
        blockedCalls++;
        if (blockedCalls === 1) message = { role: 'assistant', content: 'Plan: propose a project source.', tool_calls: [tool('disabled-write', 'write_project_file', { filename: 'blocked.js', content: 'must not save' })] };
        else {
          assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('not enabled or available')));
          message = { role: 'assistant', content: 'Result: no action was taken.' };
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message }] }) });
    });
    async function freshTurn(enabled) {
      await page.evaluate(enabled => {
        document.querySelectorAll('dialog[open]').forEach(d => d.close());
        const s = window.Eltes.state; s.chats = []; s.activeId = null; s.settings.tools = enabled; s.settings.model = 'custom-endpoint'; window.Eltes.renderAll();
      }, enabled);
      await page.locator('#input').fill('Inspect the project.'); await page.locator('#sendBtn').click();
      await page.waitForFunction(() => !window.Eltes.state.sending);
    }
    await freshTurn(true);
    assert.equal(budgetCalls, 4, 'No hidden fifth provider call');
    assert.match(await page.locator('.msg.ai .prose').last().textContent(), /Eltes runtime notice.*4-round tool limit/);
    mode = 'blocked'; await freshTurn(false);
    assert.equal(blockedCalls, 2);
    assert.equal(await page.locator('#artifactApprovalDialog').isVisible(), false);
    assert.equal(await page.locator('#projectSandboxFiles').getByText('blocked.js', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: six CTab presets; actual chat styles; controls; contrast; persistence; reset; provider/chat isolation; mobile; editor dirty guards/keyboard; reviewed read and precise-edit model tool loop; four-round runtime limit; disabled tools blocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
