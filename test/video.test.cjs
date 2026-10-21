const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('video editor includes local trim, looks, text overlays, and browser export', () => {
  const page = read('video.html');
  const script = read('assets/js/video.js');
  const docs = read('docs.html');

  for (const id of ['trimStart', 'trimEnd', 'brightness', 'contrast', 'saturation', 'overlayText', 'overlayFont', 'overlaySize', 'overlayColor', 'overlayPosition', 'overlayAlign', 'overlayBackdrop', 'exportButton']) {
    assert.match(page, new RegExp(`id="${id}"`), `missing video editor control: ${id}`);
  }
  assert.match(script, /URL\.createObjectURL\(file\)/);
  assert.match(script, /MediaRecorder/);
  assert.match(script, /captureStream/);
  assert.match(docs, /id="video-editor"/);
  assert.match(docs, /does not send video to an AI provider or upload it to an Eltes backend/);
});

test('Pages and Windows static builds include the video editor page', () => {
  assert.match(read('.github/workflows/pages.yml'), /docs\.html video\.html 404\.html/);
  assert.match(read('tools/build-windows.sh'), /docs\.html video\.html 404\.html/);
});
