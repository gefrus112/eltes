'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadCAI() {
  const window = {};
  const context = { window };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/models.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/cai.js'), 'utf8'), context);
  return window.EltesCAI;
}

const cai = loadCAI();
const fixedNow = new Date('2026-10-19T15:00:00Z');
const answer = (prompt, history = [], model = 'eltes-cai-1') => cai.build(model, prompt, history, fixedNow);

test('answers supported Eltes questions with an explicit documentation source', () => {
  const result = answer('How do API keys work?');
  assert.equal(result.intent, 'kb');
  assert.match(result.text, /direct mode/i);
  assert.match(result.text, /optional proxy/i);
  assert.match(result.text, /docs\.html#api-keys/);
});

test('does not mistake a keyboard mention for an API-key question', () => {
  const result = answer('I have keys on my keyboard');
  assert.equal(result.intent, 'kb');
  assert.match(result.text, /Keyboard/);
  assert.doesNotMatch(result.text, /Provider keys/);
});

test('avoids unsupported certainty on out-of-scope medical questions', () => {
  const result = answer('Which antibiotic should I take for this infection?');
  assert.equal(result.intent, 'fallback');
  assert.match(result.text, /outside what I can answer reliably/i);
  assert.doesNotMatch(result.text, /take (amoxicillin|penicillin|antibiotics)/i);
});

test('states the actual CAI training limits instead of claiming a training run', () => {
  const result = answer('Train the AI model not to give wrong responses and add 4,000,000 vocabulary');
  assert.equal(result.intent, 'training-limits');
  assert.match(result.text, /have not trained model weights/i);
  assert.match(result.text, /four-million-entry knowledge base/i);
  assert.match(result.text, /retriev.*curated documents/i);
});

test('defines tokenizer vocabulary carefully, including the 4-million misconception', () => {
  const result = answer('What is a vocabulary?');
  assert.equal(result.intent, 'glossary');
  assert.match(result.text, /token pieces/i);
  assert.match(result.text, /four-million-entry/i);
  assert.match(answer('What does tokenizer mean?').text, /token IDs/i);
});

test('recalls exact user messages from the active chat, without claiming access to other chats', () => {
  const history = [
    { role: 'user', content: 'I asked where Eltes stores provider keys.' },
    { role: 'assistant', content: 'In this browser local storage, unless a request uses the configured proxy.' }
  ];
  const result = answer('What did I say about provider keys in this chat?', history);
  assert.equal(result.intent, 'chat-search');
  assert.match(result.text, /Matching excerpts from this active chat/);
  assert.match(result.text, /I asked where Eltes stores provider keys/);
  assert.match(result.text, /not confirmation that they represent a final decision/);
});

test('chat search uses whole words, not accidental substrings', () => {
  const history = [{ role: 'user', content: 'The monkey climbed a tree.' }];
  const result = answer('What did I say about key in this chat?', history);
  assert.equal(result.intent, 'chat-search');
  assert.match(result.text, /did not find “key”/);
});

test('recaps only the user prompts supplied in the active conversation context', () => {
  const history = [
    { role: 'user', content: 'Explain RAG.' },
    { role: 'assistant', content: 'RAG retrieves evidence.' },
    { role: 'user', content: 'How does CAI work?' }
  ];
  const result = answer('Summarize this chat', history);
  assert.equal(result.intent, 'chat-recap');
  assert.match(result.text, /Explain RAG/);
  assert.match(result.text, /How does CAI work/);
  assert.doesNotMatch(result.text, /RAG retrieves evidence/);
});

test('basic math returns a finite answer and identifies division by zero', () => {
  assert.match(answer('What is 12 * 8?').text, /96/);
  assert.match(answer('What is 1 / 0?').text, /does not produce a finite number/);
  assert.match(answer('percentage change from 0 to 5').text, /undefined/);
});

test('privacy answer no longer promises all requests stay only in the browser', () => {
  const result = answer('Explain Eltes privacy and storage');
  assert.equal(result.intent, 'kb');
  assert.match(result.text, /request also transits that backend\/platform/);
  assert.match(result.text, /provider/);
  assert.doesNotMatch(result.text, /Everything stays in this browser/);
});

test('calculator handles safe scientific functions and natural-language arithmetic', () => {
  assert.match(answer('What is the square root of 81?').text, /\*\*9\*\*/);
  assert.match(answer('sin(pi / 2)').text, /\*\*1\*\*/);
  assert.match(answer('factorial of 5').text, /\*\*120\*\*/);
  assert.match(answer('average of 1, 2, 3').text, /\*\*2\*\*/);
  assert.match(answer('2 to the power of 8').text, /\*\*256\*\*/);
  assert.match(answer('-2^2').text, /\*\*-4\*\*/);
});

test('solves supported linear and quadratic equations, and abstains on higher-degree forms', () => {
  const linear = answer('Solve for x: 2x + 3 = 7');
  assert.equal(linear.intent, 'math');
  assert.match(linear.text, /x = 2/);
  const quadratic = answer('solve x^2 - 5x + 6 = 0');
  assert.match(quadratic.text, /x = 2/);
  assert.match(quadratic.text, /x = 3/);
  assert.match(answer('solve x² − 5x + 6 = 0').text, /x = 2[\s\S]*x = 3/);
  assert.match(answer('solve x^2 = 4').text, /x = -2[\s\S]*x = 2/);
  assert.equal(answer('solve x^3 = 8').intent, 'math-limit');
  assert.match(answer('solve x^2 + 1 = 0').text, /no real solutions/);
});

test('math parser rejects unsupported expressions without evaluating code', () => {
  const result = answer('1 + window.alert(1)');
  assert.equal(result.intent, 'fallback');
  assert.match(answer('3x4').text, /12/);
  assert.match(answer('1e20 * 2').text, /2e\+20/i);
});

test('converts between number bases', () => {
  const hex = answer('255 to hex');
  assert.equal(hex.intent, 'base');
  assert.match(hex.text, /0xFF/);
  assert.match(answer('0b1010 to decimal').text, /\*\*10\*\*/);
  assert.match(answer('42 to binary').text, /0b101010/);
  assert.match(answer('0xFF to decimal').text, /\*\*255\*\*/);
  assert.equal(answer('255 to hex').text.includes('0xFF'), true);
});

test('handles text transforms and random utilities without network', () => {
  assert.equal(answer('uppercase "hello world"').intent, 'text-transform');
  assert.match(answer('uppercase "hello world"').text, /HELLO WORLD/);
  assert.match(answer('reverse "eltes"').text, /setle/);
  assert.match(answer('sort banana apple cherry').text, /apple banana cherry/);
  const coin = answer('flip a coin');
  assert.equal(coin.intent, 'random');
  assert.match(coin.text, /Heads|Tails/);
  const roll = answer('roll a d20');
  assert.equal(roll.intent, 'random');
  const num = Number((roll.text.match(/\*\*(\d+)\*\*/) || [])[1]);
  assert.ok(num >= 1 && num <= 20);
  assert.match(answer('random number between 5 and 5').text, /\*\*5\*\*/);
});

test('converts time units, Kelvin and date arithmetic on-device', () => {
  assert.match(answer('convert 60 minutes to hours').text, /\*\*1 hours\*\*/);
  assert.match(answer('32 f to c').text, /\*\*0 °C\*\*/);
  assert.match(answer('300 k to c').text, /26\.85/);
  assert.match(answer('how many days between 2024-01-01 and 2024-01-10').text, /\*\*9 days\*\*/);
  assert.match(answer('what is 30 days from 2024-01-01').text, /January 31, 2024/);
});
