/* Optional real Chromium media checks. Run against tools/local-server.mjs.
 * Uses the same ELTES_BROWSER_MODULES / ELTES_TEST_URL as other browser checks. */
const path = require('node:path');
const { createRequire } = require('node:module');
const req = process.env.ELTES_BROWSER_MODULES ? createRequire(path.resolve(process.env.ELTES_BROWSER_MODULES, '..', 'package.json')) : require;
const { chromium } = req('playwright-core');
const binary = req('@sparticuz/chromium').default;
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: await binary.executablePath(), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const base = process.env.ELTES_TEST_URL || 'http://127.0.0.1:4173';
  const url = `${base}/docs.html#install-video`;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    const errors = [], mediaRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.url().endsWith('.mp4')) mediaRequests.push(r.url()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(mediaRequests.length, 0, 'no eager MP4 fetch');
    assert.equal(await page.locator('#installVideo').evaluate(v => v.paused), true);
    assert.equal(await page.locator('[data-install-chapter]').count(), 10);
    assert.equal(await page.locator('#installVideo').evaluate(v => v.canPlayType('video/mp4; codecs="avc1.64001f, mp4a.40.2"')), 'probably');
    await page.locator('[data-install-chapter="480"]').click();
    await page.waitForFunction(() => {
      const v = document.querySelector('#installVideo');
      return v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - 480) < 0.1;
    });
    const state = await page.locator('#installVideo').evaluate(v => ({ duration: v.duration, paused: v.paused, width: v.videoWidth, height: v.videoHeight }));
    assert.ok(Math.abs(state.duration - 600) < 0.1);
    assert.equal(state.paused, true, 'chapter click does not autoplay');
    assert.equal(state.width, 1280); assert.equal(state.height, 720);
    assert.equal(await page.locator('[aria-current="true"][data-install-chapter]').getAttribute('data-install-chapter'), '480');
    await page.locator('#installVideo').evaluate(v => v.play());
    await page.waitForFunction(() => document.querySelector('#installVideo').currentTime > 480.5);
    await page.waitForFunction(() => {
      const t = document.querySelector('#installVideo').textTracks[0];
      return t.mode === 'showing' && t.cues.length > 60 && t.activeCues.length > 0;
    });
    await page.locator('[data-install-chapter="540"]').click();
    await page.waitForFunction(() => {
      const v = document.querySelector('#installVideo');
      return !v.paused && !v.seeking && v.currentTime >= 540 && v.currentTime < 545;
    });
    await page.locator('#installVideo').evaluate(v => { v.pause(); v.textTracks[1].mode = 'hidden'; });
    await page.waitForFunction(() => document.querySelector('#installVideo').textTracks[1].cues.length === 10);
    await page.locator('[data-install-chapter="120"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const v = document.querySelector('#installVideo'); return v.currentTime === 120 && !v.seeking; });
    await page.waitForFunction(() => document.querySelector('#installVideoStatus').textContent.startsWith('At 02:00'));
    assert.equal(await page.locator('#installVideo').evaluate(v => v.paused), true);
    if (process.env.ELTES_GUIDE_SCREENSHOT) await page.locator('.install-guide').screenshot({ path: process.env.ELTES_GUIDE_SCREENSHOT });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#installVideo').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal mobile overflow');
    const rect = await page.locator('#installVideo').boundingBox();
    assert.ok(rect.width <= 390 && rect.width > 200);
    await page.locator('.install-transcript summary').click();
    assert.equal(await page.locator('.install-transcript').getAttribute('open'), '');
    assert.equal(await page.locator('.install-transcript h4').count(), 10);
    assert.deepEqual(errors, []);

    const home = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const homeRequests = [], homeErrors = [];
    home.on('request', r => { if (r.url().endsWith('.mp4')) homeRequests.push(r.url()); });
    home.on('pageerror', e => homeErrors.push(e.message));
    await home.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
    assert.equal(homeRequests.length, 0, 'home player does not preload the MP4');
    await home.locator('.hero-cta a[href="#installation-video"]').click();
    await home.locator('#homeInstallVideo').evaluate(v => v.play());
    await home.waitForFunction(() => document.querySelector('#homeInstallVideo').currentTime > 0.5);
    await home.waitForFunction(() => document.querySelector('#homeInstallVideo').textTracks[0].activeCues.length > 0);
    await home.locator('#homeInstallVideo').evaluate(v => { v.pause(); v.currentTime = 300; });
    await home.waitForFunction(() => { const v = document.querySelector('#homeInstallVideo'); return !v.seeking && v.currentTime === 300; });
    if (process.env.ELTES_HOME_GUIDE_SCREENSHOT) await home.locator('.home-install-guide').screenshot({ path: process.env.ELTES_HOME_GUIDE_SCREENSHOT });
    await home.setViewportSize({ width: 390, height: 844 });
    const homeRect = await home.locator('.home-install-guide').boundingBox();
    assert.ok(homeRect.width <= 390 && homeRect.x >= 0 && homeRect.x + homeRect.width <= 390);
    assert.ok(await home.locator('.home-install-guide').evaluate(el => el.scrollWidth <= el.clientWidth));
    assert.deepEqual(homeErrors, []);

    const broken = await browser.newPage();
    await broken.route('**/eltes-desktop-install.mp4', route => route.abort());
    await broken.goto(url);
    await broken.locator('[data-install-chapter="60"]').click();
    await broken.waitForFunction(() => document.querySelector('#installVideoStatus').textContent.includes('could not load'));
    assert.equal(await broken.locator('[data-install-chapter="60"]').isDisabled(), true);
    assert.equal(await broken.locator('a[download][href$="transcript.txt"]').count(), 1);

    const noJs = await browser.newPage({ javaScriptEnabled: false });
    await noJs.goto(url);
    assert.equal(await noJs.locator('[data-install-chapter="0"]').isDisabled(), true);
    await noJs.locator('.install-transcript summary').click();
    assert.equal(await noJs.locator('.install-transcript').getAttribute('open'), '');
    assert.equal(await noJs.locator('#installVideo').getAttribute('controls'), '');
    console.log('PASS: homepage and docs players; no preload/autoplay; H.264/AAC playback; 600s; captions and chapters; paused/playing/keyboard seek; mobile; error fallback; no-JS transcript.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
