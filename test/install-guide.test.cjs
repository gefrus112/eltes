const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, stat } = require('node:fs/promises');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { join } = require('node:path');
const root = join(__dirname, '..');
const media = join(root, 'assets/media/install-guide');

const rangeModule = import('../tools/media-response.mjs');

test('media ranges support complete, open-ended, suffix and clamped requests', async () => {
  const { mediaRange } = await rangeModule;
  assert.deepEqual(mediaRange(undefined, 100), { status: 200, start: 0, end: 99, length: 100 });
  assert.deepEqual(mediaRange('bytes=10-19', 100), { status: 206, start: 10, end: 19, length: 10 });
  assert.deepEqual(mediaRange('bytes=90-', 100), { status: 206, start: 90, end: 99, length: 10 });
  assert.deepEqual(mediaRange('bytes=-10', 100), { status: 206, start: 90, end: 99, length: 10 });
  assert.deepEqual(mediaRange('bytes=90-200', 100), { status: 206, start: 90, end: 99, length: 10 });
  assert.deepEqual(mediaRange('bytes=-200', 100), { status: 206, start: 0, end: 99, length: 100 });
  for (const header of ['bytes=100-', 'bytes=20-10', 'bytes=-0', 'bytes=-', 'bytes=x-y', 'items=0-1', 'bytes=0-1,4-5', 'bytes=9007199254740992-']) {
    assert.equal(mediaRange(header, 100).status, 416, header);
  }
  assert.equal(mediaRange('bytes=0-', 0).status, 416);
});

test('media streaming returns correct HTTP bytes, HEAD and unsatisfied ranges', async t => {
  const { serveMedia } = await rangeModule;
  const file = join(media, 'eltes-desktop-install.mp4');
  const content = await readFile(file);
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'video/mp4');
    serveMedia(req, res, file, content.length);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/guide.mp4`;
  let response = await fetch(url, { headers: { Range: 'bytes=0-63' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 0-63/${content.length}`);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), content.subarray(0, 64));
  response = await fetch(url, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get('content-length')), content.length);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  response = await fetch(url, { headers: { Range: 'bytes=-32' } });
  assert.equal(response.status, 206);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), content.subarray(-32));
  response = await fetch(url, { headers: { Range: `bytes=${content.length}-` } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), `bytes */${content.length}`);
  await response.arrayBuffer();
});

test('installation guide has all chapters, accessible fallbacks and fast-start media', async () => {
  const guide = JSON.parse(await readFile(join(root, 'tools/install-guide/guide.json'), 'utf8'));
  const docs = await readFile(join(root, 'docs.html'), 'utf8');
  const transcript = await readFile(join(media, 'transcript.txt'), 'utf8');
  const chapters = await readFile(join(media, 'chapters.en.vtt'), 'utf8');
  const captions = await readFile(join(media, 'captions.en.vtt'), 'utf8');
  assert.equal(guide.durationSeconds, 600);
  assert.equal(guide.chapters.length, 10);
  assert.match(docs, /<video id="installVideo" controls playsinline preload="none"/);
  assert.doesNotMatch(docs.match(/<video id="installVideo"[^>]+>/)[0], /autoplay/);
  assert.match(docs, /<track kind="captions"[^>]+ default>/);
  assert.match(docs, /<track kind="chapters"/);
  assert.match(docs, /<details class="install-transcript">/);
  for (const [i, chapter] of guide.chapters.entries()) {
    assert.ok(docs.includes(`data-install-chapter="${i * 60}"`));
    assert.ok(chapters.includes(chapter.title));
    assert.ok(transcript.includes(chapter.narration));
  }
  assert.equal((chapters.match(/ --> /g) || []).length, 10);
  assert.ok(captions.startsWith('WEBVTT\n'));
  assert.ok((captions.match(/ --> /g) || []).length > 60);
  const mp4 = await readFile(join(media, 'eltes-desktop-install.mp4'));
  assert.equal(mp4.toString('ascii', 4, 8), 'ftyp');
  assert.ok(mp4.indexOf(Buffer.from('moov')) < mp4.indexOf(Buffer.from('mdat')), 'metadata precedes media for progressive playback');
  assert.ok((await stat(join(media, 'poster.jpg'))).size > 1000);
  assert.ok(mp4.length < 20 * 1024 * 1024, 'keep the guide practical for static hosting');
});


test('home page leads with a lazy, accessible installation player before the model showcase', async () => {
  const home = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(home, /<video id="homeInstallVideo" controls playsinline preload="none"/);
  assert.doesNotMatch(home.match(/<video id="homeInstallVideo"[^>]+>/)[0], /autoplay/);
  assert.ok(home.indexOf('id="homeInstallVideo"') < home.indexOf('class="hero-stage'));
  assert.match(home, /href="#installation-video"/);
  assert.match(home, /href="docs.html#install-video"/);
  const player = home.slice(home.indexOf('id="installation-video"'), home.indexOf('class="hero-stats"'));
  assert.match(player, /<track kind="captions"[^>]+ default>/);
  assert.match(player, /<track kind="chapters"/);
  assert.match(player, /href="assets\/media\/install-guide\/transcript.txt"/);
  assert.match(player, /not native installer recordings/);
});
