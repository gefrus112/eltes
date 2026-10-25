const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('contributors section lists only GitHub accounts with at least one credited commit', () => {
  const docs = read('docs.html');
  const section = docs.match(/<section id="contributors">([\s\S]*?)<\/section>/)?.[1] || '';
  const cards = Array.from(section.matchAll(/<a class="contributor-card" href="https:\/\/github\.com\/([^"/]+)"[\s\S]*?<small>@[^<]+ · (\d+) commits<\/small>[\s\S]*?<\/a>/g));
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((match) => match[1]).sort(), ['eltes', 'gefrus112']);
  assert.ok(cards.every((match) => Number(match[2]) >= 1));
  assert.match(section, /graphs\/contributors/);
  assert.match(read('index.html'), /docs\.html#contributors/);
});
