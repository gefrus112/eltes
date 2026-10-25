/* Capture genuine v3.18.0 UI from an externally extracted git tag.
 * No hosted model calls, real credentials, or synthetic assistant replies.
 * RELEASE_SITE, GUIDE_WORK and BROWSER_MODULES must point outside the checkout.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const browserRequire = createRequire(path.join(process.env.BROWSER_MODULES, '..', 'package.json'));
const { chromium } = browserRequire('playwright-core');
const binary = browserRequire('@sparticuz/chromium').default;
(async () => {
  const root = path.resolve(process.env.RELEASE_SITE), out = path.join(process.env.GUIDE_WORK, 'captures');
  await fs.mkdir(out, { recursive: true });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: await binary.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/app.html'); await page.waitForFunction(() => !!window.Eltes);
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); window.Eltes.selectModel('eltes-cai-1'); });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(out, 'home.png') });
    const framesDir = path.join(out, 'motion'); await fs.mkdir(framesDir, { recursive: true });
    let recording = true; const motion = []; const started = Date.now();
    const captureMotion = (async () => {
      while (recording) {
        const name = `frame-${String(motion.length).padStart(4, '0')}.jpg`;
        await page.screenshot({ path: path.join(framesDir, name), type: 'jpeg', quality: 85 });
        motion.push({ file: name, seconds: (Date.now() - started) / 1000 });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    })();
    await page.locator('#input').pressSequentially('What is 17 * 24?', { delay: 85 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, 'prompt.png') });
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !window.Eltes.state.sending);
    const answer = await page.locator('.msg.ai .prose').last().textContent();
    assert.match(answer, /408/);
    await page.waitForTimeout(4200);
    recording = false; await captureMotion;
    await fs.writeFile(path.join(framesDir, 'timing.json'), JSON.stringify(motion, null, 2));
    await page.screenshot({ path: path.join(out, 'conversation.png') });
    await page.locator('#modelBtn').click();
    await page.screenshot({ path: path.join(out, 'models.png') });
    await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); window.Eltes.openSettings('keys'); });
    await page.screenshot({ path: path.join(out, 'keys.png') });
    await page.evaluate(() => window.Eltes.openSettings('data'));
    await page.screenshot({ path: path.join(out, 'settings.png') });
    await fs.writeFile(path.join(out, 'provenance.json'), JSON.stringify({ tag: 'v3.18.0', method: 'Actual Chromium UI captures of extracted release source, served locally', installedDesktop: false, prompt: 'What is 17 * 24?', actualLocalAnswer: answer, hostedProviderCalls: 0, credentialsEntered: false }, null, 2));
    console.log('Captured actual released UI and verified the local 408 response.');
  } finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
