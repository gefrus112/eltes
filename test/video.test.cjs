const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('video editor includes local and URL sources, trim, effects, text, and browser export', () => {
  const page = read('video.html');
  const script = read('assets/js/video.js');
  const docs = read('docs.html');

  for (const id of ['trimStart', 'trimEnd', 'playbackSpeed', 'brightness', 'contrast', 'saturation', 'sepia', 'hue', 'blur', 'vignette', 'videoUrl', 'overlayText', 'overlayFont', 'overlaySize', 'overlayColor', 'overlayPosition', 'overlayAlign', 'overlayBackdrop', 'exportButton']) {
    assert.match(page, new RegExp(`id="${id}"`), `missing video editor control: ${id}`);
  }
  assert.match(script, /URL\.createObjectURL\(file\)/);
  assert.match(script, /crossOrigin = 'anonymous'/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.match(script, /MediaRecorder/);
  assert.match(script, /captureStream/);
  assert.match(script, /loadVideoUrl/);
  assert.match(script, /hue-rotate/);
  assert.match(script, /drawVignette/);
  assert.match(script, /playbackRate/);
  assert.match(docs, /id="video-editor"/);
  assert.match(docs, /Local files are opened with a temporary browser URL and are not uploaded to Eltes/);
  assert.match(docs, /your browser requests that host directly/i);
  assert.match(docs, /host must allow CORS/i);
});

test('Pages and Windows static builds include the video editor page', () => {
  assert.match(read('.github/workflows/pages.yml'), /docs\.html video\.html 404\.html/);
  assert.match(read('tools/build-windows.sh'), /docs\.html video\.html 404\.html/);
});
