const test = require('node:test');
const assert = require('node:assert/strict');
const Highlighter = require('../assets/js/highlighter.js');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('PHP fences highlight PHP syntax while keeping code escaped', () => {
  const source = '<?php\n$name = "Eltes";\n#[Route("/hello")]\nfunction greet($name) { return "Hello, " . $name; }\n// greeting';
  const html = Highlighter.highlight(source, 'php');

  assert.match(html, /&lt;\?<span class="tok-key">php<\/span>/);
  assert.match(html, /class="tok-key">function<\/span>/);
  assert.match(html, /class="tok-key">return<\/span>/);
  assert.match(html, /class="tok-var">\$name<\/span>/);
  assert.match(html, /class="tok-str">"Eltes"<\/span>/);
  assert.match(html, /class="tok-com">\/\/ greeting<\/span>/);
  assert.doesNotMatch(html, /tok-com">#\[Route/);
  assert.match(Highlighter.highlight('<script>alert(1)</script>', 'php'), /&lt;script&gt;/);
});

test('PHP source files are accepted by the chat attachment and code-fence paths', () => {
  const page = read('app.html');
  const app = read('assets/js/app.js');
  const docs = read('docs.html');
  assert.match(page, /accept="[^"]*\.php/);
  assert.match(page, /assets\/js\/highlighter\.js/);
  assert.match(app, /php: 'php'/);
  assert.match(docs, /including PHP/);
  assert.equal(Highlighter.LANGS.test('PHP'), true);
});
