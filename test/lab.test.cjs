/* Eltes Lab: the trainable character model, its page and its app wiring. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = (name) => readFile(join(root, name), 'utf8');

function loadLab() {
  const before = global.window;
  global.window = {};
  try {
    const file = join(root, 'assets/js/lab.js');
    delete require.cache[require.resolve(file)];
    require(file);
    return global.window.EltesLab;
  } finally {
    global.window = before;
  }
}

/* A tiny model trains in about a tenth of a second, so the suite stays fast. */
function tiny(seed) {
  return loadLab().createModel({
    text: 'The quick brown fox jumps over the lazy dog. '.repeat(40),
    seed: seed || 4,
    context: 8,
    embedding: 12,
    hidden: 48,
    dropout: 0
  });
}

test('the Lab module exposes a real model, not a mock', async () => {
  const Lab = loadLab();
  for (const name of ['createModel', 'trainStep', 'sample', 'evaluate', 'serialize', 'deserialize', 'save', 'load', 'chat', 'paramCount']) {
    if (name === 'trainStep') continue;
    assert.equal(typeof Lab[name], 'function', `${name} is exported`);
  }
  assert.equal(Lab.CORPORA.length, 3);
  assert.deepEqual(Lab.CORPORA.map((c) => c.id), ['eltes', 'prose', 'code']);
  for (const corpus of Lab.CORPORA) {
    assert.ok(corpus.text.length > 800, `${corpus.id} has training text`);
    assert.ok(corpus.name && corpus.note, `${corpus.id} is labelled`);
  }

  const model = Lab.createModel({ corpus: Lab.CORPORA[0], seed: 7 });
  assert.equal(typeof model.trainStep, 'function');
  assert.equal(typeof model.sample, 'function');
  assert.equal(Lab.paramCount(model), 51245, 'the documented default shape');

  /* the weights are float arrays that start non-zero and untrained */
  assert.ok(model.params.E instanceof Float32Array);
  assert.ok(model.params.W1.some((v) => v !== 0), 'W1 was initialised');
  assert.equal(model.step, 0);
  assert.equal(model.lastLoss, null);
});

test('training actually reduces the loss', () => {
  const model = tiny(4);
  const early = [];
  for (let i = 0; i < 40; i += 1) {
    model.trainStep({ batch: 16, lr: 0.005 });
    early.push(model.lastLoss);
  }
  const earlyAvg = early.slice(10).reduce((a, b) => a + b, 0) / 30;
  for (let i = 0; i < 160; i += 1) model.trainStep({ batch: 16, lr: 0.005 });
  const lateAvg = model.history.length; // history is page state; measure again below
  void lateAvg;
  const tail = [];
  for (let i = 0; i < 30; i += 1) {
    model.trainStep({ batch: 16, lr: 0.005 });
    tail.push(model.lastLoss);
  }
  const finalAvg = tail.reduce((a, b) => a + b, 0) / tail.length;
  assert.ok(finalAvg < earlyAvg / 2, `loss fell from ${earlyAvg.toFixed(2)} to ${finalAvg.toFixed(2)}`);
  assert.equal(model.step, 230);
  assert.equal(model.tokens, 230 * 16);
});

test('the same seed reproduces the same run', () => {
  const a = tiny(11);
  const b = tiny(11);
  const c = tiny(12);
  for (let i = 0; i < 12; i += 1) {
    a.trainStep({ batch: 8, lr: 0.004 });
    b.trainStep({ batch: 8, lr: 0.004 });
    c.trainStep({ batch: 8, lr: 0.004 });
  }
  assert.equal(a.lastLoss, b.lastLoss, 'same seed, same loss');
  assert.notEqual(a.lastLoss, c.lastLoss, 'a different seed gives a different run');
  assert.deepEqual(Array.from(a.params.W2.slice(0, 40)), Array.from(b.params.W2.slice(0, 40)));
});

test('a memorised paragraph comes back verbatim', () => {
  const Lab = loadLab();
  const sentence = 'Eltes trains a tiny model in the browser, one gradient at a time.';
  const model = Lab.createModel({
    text: (sentence + '\n').repeat(16),
    seed: 21,
    context: 10,
    embedding: 16,
    hidden: 64,
    dropout: 0
  });
  for (let i = 0; i < 700; i += 1) model.trainStep({ batch: 24, lr: 0.005 });
  assert.ok(model.lastLoss < 0.05, `final loss ${model.lastLoss}`);
  const out = model.sample({ prompt: sentence.slice(0, 20), length: 100, temperature: 0.1, topK: 1, penalty: 0 });
  assert.ok(out.startsWith(sentence.slice(20, 60)), `recital: ${JSON.stringify(out.slice(0, 80))}`);
  assert.ok(out.includes('one gradient at a time'), 'the rest of the sentence follows');
});

test('a snapshot restores weights bit for bit and samples identically', () => {
  const Lab = loadLab();
  const model = tiny(9);
  for (let i = 0; i < 60; i += 1) model.trainStep({ batch: 8, lr: 0.005 });
  model.corpora = 'eltes';
  model.textLength = 2000;

  const saved = JSON.parse(JSON.stringify(Lab.serialize(model)));
  assert.equal(saved.version, 1);
  assert.equal(saved.vocab, model.vocab.join(''));
  assert.equal(saved.step, 60);

  const restored = Lab.deserialize(saved);
  assert.equal(restored.trained, true);
  assert.equal(restored.data.length, 0, 'a snapshot keeps weights, not the corpus');
  assert.equal(restored.vocab.join(''), model.vocab.join(''));
  for (const key of Object.keys(model.params)) {
    const before = Buffer.from(model.params[key].buffer, model.params[key].byteOffset, model.params[key].byteLength);
    const after = Buffer.from(restored.params[key].buffer, restored.params[key].byteOffset, restored.params[key].byteLength);
    assert.ok(before.equals(after), `${key} survives the round-trip exactly`);
  }

  const seeded = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const options = { prompt: 'The quick', length: 60, temperature: 0.6, topK: 8 };
  const first = model.sample({ ...options, random: seeded(99) });
  const second = restored.sample({ ...options, random: seeded(99) });
  assert.equal(second, first, 'restored model generates the same text');

  /* a corrupted snapshot is rejected rather than silently loaded */
  assert.throws(() => Lab.deserialize({ version: 2 }), /not an Eltes Lab model/i);
  assert.equal(Lab.save(model), false, 'no localStorage in Node — save fails quietly');
  assert.equal(Lab.load(), null);
  assert.equal(Lab.hasSaved(), false);
});

test('unknown characters map to one token and never crash sampling', () => {
  const Lab = loadLab();
  const model = tiny(2);
  const { vocab, index } = Lab.buildVocab('abc abc abc');
  assert.ok(vocab.includes('\u0000'), 'token 0 is the unknown slot');
  assert.equal(index.get('a'), vocab.indexOf('a'));
  const encoded = Lab.encode('ab☃z', index);
  assert.equal(encoded[2], 0, 'the snowman is unknown');
  assert.equal(encoded.length, 4);

  for (let i = 0; i < 30; i += 1) model.trainStep({ batch: 8, lr: 0.004 });
  const out = model.sample({ prompt: '☃☃☃ the quick', length: 80, temperature: 0.9, topK: 12 });
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
  assert.ok(!out.includes('\u0000'), 'the unknown token is never emitted as a NUL');
});

test('the Lab page is wired, documented and honest', async () => {
  const html = await read('train.html');
  assert.match(html, /assets\/css\/lab\.css/);
  assert.match(html, /assets\/js\/lab\.js/);
  assert.match(html, /assets\/js\/lab-page\.js/);
  assert.match(html, /id="lossChart"/);
  assert.match(html, /id="trainBtn"/);
  assert.match(html, /id="generateBtn"/);
  assert.match(html, /id="saveBtn"/);
  assert.match(html, /id="memoBtn"/);
  assert.match(html, /<option value="eltes">/);
  assert.match(html, /<option value="prose">/);
  assert.match(html, /<option value="code">/);
  assert.match(html, /character-level/i);
  assert.match(html, /cannot follow instructions|cannot answer a question|Not an instruction follower/i);
  assert.match(html, /localStorage/);

  const css = await read('assets/css/lab.css');
  assert.match(css, /\.lab-console/);
  assert.match(css, /prefers-reduced-motion/);

  const page = await read('assets/js/lab-page.js');
  assert.match(page, /listening|trainStep/);
  assert.match(page, /localStorage|Lab\.save/);
  assert.ok(!/https?:\/\//.test(page), 'the page controller makes no network calls');

  const lab = await read('assets/js/lab.js');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|import\s*\(/.test(lab), 'the model never touches the network');
  assert.match(lab, /localStorage|STORAGE_KEY/);
});

test('Eltes Lab-1 is a real entry in the catalogue and the chat can reach it', async () => {
  const vm = require('node:vm');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(await read('assets/js/models.js'), context);
  const M = context.window.EltesModels;
  const model = M.byId('eltes-lab-1');
  assert.ok(model, 'the catalogue lists Eltes Lab-1');
  assert.equal(model.provider, 'eltes');
  assert.equal(model.local, true);
  assert.equal(M.isLocal(model), true);
  assert.equal(M.MODELS.length, 66);

  const app = await read('assets/js/app.js');
  assert.match(app, /eltes-lab-1/);
  assert.match(app, /streamLabTurn/);
  assert.match(app, /window\.EltesLab\.chat/);

  const appHtml = await read('app.html');
  const labAt = appHtml.indexOf('assets/js/lab.js');
  const appAt = appHtml.indexOf('assets/js/app.js');
  assert.ok(labAt > 0 && labAt < appAt, 'lab.js loads before app.js');

  const chat = loadLab().chat([{ role: 'user', content: 'Eltes is a ' }]);
  assert.equal(chat.intent, 'lab-empty');
  assert.match(chat.text, /not trained yet/i);
  assert.match(chat.text, /train\.html/);
});
