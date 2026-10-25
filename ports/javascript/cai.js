#!/usr/bin/env node
/* ==========================================================================
   Eltes CAI engine — JavaScript port (Node and browser).

   Same rules as the Rust crate and the site's own assets/js/cai.js: arithmetic,
   percentages, unit and temperature conversion, and an explicit refusal for
   anything else. No network, no model weights, no dependencies.

   Run the shared conformance suite:

       node ports/javascript/cai.js ports/vectors.tsv
   ========================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FUNCTIONS = {
  sqrt: [1, 1], cbrt: [1, 1], abs: [1, 1],
  sin: [1, 1], cos: [1, 1], tan: [1, 1],
  asin: [1, 1], acos: [1, 1], atan: [1, 1],
  ln: [1, 1], log10: [1, 1], log2: [1, 1], exp: [1, 1],
  floor: [1, 1], ceil: [1, 1], round: [1, 1],
  log: [1, 2], pow: [2, 2],
  min: [1, Infinity], max: [1, Infinity], sum: [1, Infinity],
  mean: [1, Infinity], product: [1, Infinity]
};

class ParseError extends Error {}

/* --------------------------------- tokens -------------------------------- */

function digitBefore(chars, index) {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (/\s/.test(chars[cursor])) continue;
    return /[0-9]/.test(chars[cursor]);
  }
  return false;
}

function digitAfter(chars, index) {
  for (let cursor = index + 1; cursor < chars.length; cursor++) {
    if (/\s/.test(chars[cursor])) continue;
    return /[0-9]/.test(chars[cursor]);
  }
  return false;
}

function prepare(source) {
  const replaced = String(source)
    .replace(/×|✕|✖/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3');
  const chars = Array.from(replaced);
  return chars
    .map((ch, index) => ((ch === 'x' || ch === 'X') && digitBefore(chars, index) && digitAfter(chars, index) ? '*' : ch))
    .join('');
}

function tokenize(source) {
  const text = prepare(source);
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const ch = text[index];
    if (/\s/.test(ch)) { index++; continue; }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[index + 1] || ''))) {
      const start = index;
      while (index < text.length && /[0-9]/.test(text[index])) index++;
      if (text[index] === '.') {
        index++;
        while (index < text.length && /[0-9]/.test(text[index])) index++;
      }
      if (text[index] === 'e' || text[index] === 'E') {
        let probe = index + 1;
        if (text[probe] === '+' || text[probe] === '-') probe++;
        if (/[0-9]/.test(text[probe] || '')) {
          while (probe < text.length && /[0-9]/.test(text[probe])) probe++;
          index = probe;
        }
      }
      const value = Number(text.slice(start, index));
      if (!Number.isFinite(value)) throw new ParseError('bad number');
      tokens.push({ type: 'num', value });
      continue;
    }

    if (/[a-z]/i.test(ch)) {
      const start = index;
      while (index < text.length && /[a-z]/i.test(text[index])) index++;
      tokens.push({ type: 'ident', value: text.slice(start, index).toLowerCase() });
      continue;
    }

    if ('+-*/^%!'.includes(ch)) { tokens.push({ type: 'op', value: ch }); index++; continue; }
    if (ch === '(') { tokens.push({ type: '(' }); index++; continue; }
    if (ch === ')') { tokens.push({ type: ')' }); index++; continue; }
    if (ch === ',') { tokens.push({ type: ',' }); index++; continue; }
    throw new ParseError('unexpected character');
  }

  const expanded = [];
  for (const token of tokens) {
    const previous = expanded[expanded.length - 1];
    if (previous) {
      const ends = previous.type === 'num' || previous.type === ')' ||
        (previous.type === 'ident' && (previous.value === 'pi' || previous.value === 'e'));
      const starts = token.type === 'num' || token.type === 'ident' || token.type === '(';
      const isCall = previous.type === 'ident' && FUNCTIONS[previous.value] && token.type === '(';
      if (ends && starts && !isCall) expanded.push({ type: 'op', value: '*' });
    }
    expanded.push(token);
  }
  return expanded;
}

/* --------------------------------- parser -------------------------------- */

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };

function factorial(value) {
  if (value < 0 || !Number.isInteger(value) || value > 170) throw new ParseError('factorial domain');
  let result = 1;
  for (let step = 2; step <= value; step++) result *= step;
  return result;
}

function callFunction(name, args) {
  const [low, high] = FUNCTIONS[name];
  if (args.length < low || args.length > high) throw new ParseError('argument count');
  switch (name) {
    case 'sqrt': return Math.sqrt(args[0]);
    case 'cbrt': return Math.cbrt(args[0]);
    case 'abs': return Math.abs(args[0]);
    case 'sin': return Math.sin(args[0]);
    case 'cos': return Math.cos(args[0]);
    case 'tan': return Math.tan(args[0]);
    case 'asin': return Math.asin(args[0]);
    case 'acos': return Math.acos(args[0]);
    case 'atan': return Math.atan(args[0]);
    case 'ln': return Math.log(args[0]);
    case 'log10': return Math.log10(args[0]);
    case 'log2': return Math.log2(args[0]);
    case 'exp': return Math.exp(args[0]);
    case 'floor': return Math.floor(args[0]);
    case 'ceil': return Math.ceil(args[0]);
    case 'round': return Math.round(args[0]);
    case 'log': return args.length === 1 ? Math.log(args[0]) : Math.log(args[0]) / Math.log(args[1]);
    case 'pow': return Math.pow(args[0], args[1]);
    case 'min': return Math.min(...args);
    case 'max': return Math.max(...args);
    case 'sum': return args.reduce((total, n) => total + n, 0);
    case 'mean': return args.reduce((total, n) => total + n, 0) / args.length;
    case 'product': return args.reduce((total, n) => total * n, 1);
    default: throw new ParseError('unknown function');
  }
}

function evaluate(source) {
  const tokens = tokenize(source);
  if (!tokens.length) throw new ParseError('parse');
  let pos = 0;

  const peek = () => tokens[pos];
  const take = () => {
    if (pos >= tokens.length) throw new ParseError('parse');
    return tokens[pos++];
  };

  function primary() {
    const token = take();
    if (token.type === 'num') return token.value;
    if (token.type === 'op' && (token.value === '-' || token.value === '+')) {
      const value = expression(3);
      return token.value === '-' ? -value : value;
    }
    if (token.type === '(') {
      const value = expression(0);
      if (!peek() || peek().type !== ')') throw new ParseError('parse');
      pos++;
      return value;
    }
    if (token.type === 'ident') {
      if (peek() && peek().type === '(' && FUNCTIONS[token.value]) {
        pos++;
        const args = [];
        if (peek() && peek().type !== ')') {
          args.push(expression(0));
          while (peek() && peek().type === ',') {
            pos++;
            args.push(expression(0));
          }
        }
        if (!peek() || peek().type !== ')') throw new ParseError('parse');
        pos++;
        return callFunction(token.value, args);
      }
      if (token.value === 'pi') return Math.PI;
      if (token.value === 'e') return Math.E;
    }
    throw new ParseError('parse');
  }

  function expression(minPrecedence) {
    let left = primary();
    while (peek() && peek().type === 'op' && peek().value === '!') {
      pos++;
      left = factorial(left);
    }
    for (;;) {
      const token = peek();
      if (!token || token.type !== 'op' || !PRECEDENCE[token.value]) break;
      const precedence = PRECEDENCE[token.value];
      if (precedence < minPrecedence) break;
      pos++;
      const right = expression(token.value === '^' ? precedence : precedence + 1);
      if (token.value === '+') left += right;
      else if (token.value === '-') left -= right;
      else if (token.value === '*') left *= right;
      else if (token.value === '/') left /= right;
      else if (token.value === '%') left %= right;
      else left = Math.pow(left, right);
    }
    return left;
  }

  const value = expression(0);
  if (pos !== tokens.length) throw new ParseError('parse');
  return value;
}

/* -------------------------------- numbers -------------------------------- */

function formatNumber(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';

  const magnitude = Math.abs(value);
  if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
    const [mantissa, exponent] = value.toExponential(10).split('e');
    const trimmed = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa;
    const exponentValue = Number(exponent);
    return `${trimmed}e${exponentValue < 0 ? '-' : '+'}${Math.abs(exponentValue)}`;
  }

  const rounded = Math.round(value * 1e10) / 1e10;
  if (rounded === 0) return '0';
  return String(rounded);
}

/* --------------------------------- units --------------------------------- */

const UNITS = {
  mm: ['length', 0.001], cm: ['length', 0.01], m: ['length', 1],
  metre: ['length', 1], metres: ['length', 1], meter: ['length', 1], meters: ['length', 1],
  km: ['length', 1000], in: ['length', 0.0254], inch: ['length', 0.0254], inches: ['length', 0.0254],
  ft: ['length', 0.3048], feet: ['length', 0.3048], foot: ['length', 0.3048], yd: ['length', 0.9144],
  mi: ['length', 1609.344], mile: ['length', 1609.344], miles: ['length', 1609.344],
  mg: ['mass', 0.001], g: ['mass', 1], kg: ['mass', 1000],
  oz: ['mass', 28.349523125], lb: ['mass', 453.59237], lbs: ['mass', 453.59237],
  pound: ['mass', 453.59237], pounds: ['mass', 453.59237],
  stone: ['mass', 6350.29318], st: ['mass', 6350.29318],
  ml: ['volume', 0.001], l: ['volume', 1], litre: ['volume', 1], litres: ['volume', 1],
  liter: ['volume', 1], liters: ['volume', 1],
  tsp: ['volume', 0.00492892159], tbsp: ['volume', 0.0147867648],
  cup: ['volume', 0.2365882365], pint: ['volume', 0.473176473],
  qt: ['volume', 0.946352946], quart: ['volume', 0.946352946],
  gal: ['volume', 3.785411784], gallon: ['volume', 3.785411784], gallons: ['volume', 3.785411784],
  b: ['data', 1], kb: ['data', 1e3], mb: ['data', 1e6], gb: ['data', 1e9], tb: ['data', 1e12],
  kib: ['data', 1024], mib: ['data', 1048576], gib: ['data', 1073741824],
  'km/h': ['speed', 0.277777778], kph: ['speed', 0.277777778],
  mph: ['speed', 0.44704], 'm/s': ['speed', 1],
  m2: ['area', 1], km2: ['area', 1e6], ft2: ['area', 0.09290304], sqft: ['area', 0.09290304],
  acre: ['area', 4046.8564224], hectare: ['area', 10000], ha: ['area', 10000]
};

function temperature(value, from, to) {
  const celsius = from === 'c' ? value : from === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
  if (to === 'c') return celsius;
  if (to === 'f') return celsius * 9 / 5 + 32;
  return celsius + 273.15;
}

/* -------------------------------- intents -------------------------------- */

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function percentIntent(text) {
  const words = text.replace(/%/g, ' percent ').split(/\s+/).filter(Boolean);

  for (let index = 0; index + 3 < words.length; index++) {
    if (words[index + 1] !== 'percent') continue;
    if (words[index + 2] !== 'of' && words[index + 2] !== 'off') continue;
    const percent = Number(words[index]);
    const base = Number(words[index + 3]);
    if (!Number.isFinite(percent) || !Number.isFinite(base)) continue;

    const part = percent / 100 * base;
    if (words[index + 2] === 'off') {
      return `**${formatNumber(base - part)}** after ${formatNumber(percent)}% off ${formatNumber(base)} (a discount of ${formatNumber(part)}).`;
    }
    return `**${formatNumber(part)}** — ${formatNumber(percent)}% of ${formatNumber(base)}.\n\n${formatNumber(base)} × ${formatNumber(percent)} / 100 = ${formatNumber(part)}`;
  }

  if (/percent|increase|decrease|change/.test(text)) {
    for (let index = 0; index + 3 < words.length; index++) {
      if (words[index] !== 'from' || words[index + 2] !== 'to') continue;
      const start = Number(words[index + 1]);
      const end = Number(words[index + 3]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start === 0) {
        return 'Percentage change from zero is undefined because the calculation divides by the starting value. I will not report a finite percentage.';
      }
      const change = (end - start) / Math.abs(start) * 100;
      return `**${formatNumber(change)}%** change from ${formatNumber(start)} to ${formatNumber(end)}.\n\nFormula: (${formatNumber(end)} − ${formatNumber(start)}) ÷ |${formatNumber(start)}| × 100`;
    }
  }

  return null;
}

function splitNumber(word) {
  const match = word.match(/^[+-]?[0-9]*\.?[0-9]+/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return [value, word.slice(match[0].length)];
}

function unitIntent(text) {
  const prepared = text
    .replace(/°/g, ' ')
    .replace(/degrees/g, ' ')
    .replace(/degree/g, ' ')
    .replace(/celsius/g, ' c ')
    .replace(/centigrade/g, ' c ')
    .replace(/fahrenheit/g, ' f ')
    .replace(/kelvin/g, ' k ');
  const words = prepared.split(/\s+/).filter(Boolean);

  for (let index = 0; index < words.length; index++) {
    const split = splitNumber(words[index]);
    if (!split) continue;
    const [value, remainder] = split;

    let source;
    let cursor;
    if (!remainder.trim()) {
      if (index + 1 >= words.length) continue;
      source = words[index + 1];
      cursor = index + 2;
    } else {
      source = remainder;
      cursor = index + 1;
    }
    if (cursor + 1 >= words.length) continue;
    if (!['to', 'in', 'into', 'as'].includes(words[cursor])) continue;
    const target = words[cursor + 1];

    if (source.length === 1 && target.length === 1 && 'cfk'.includes(source) && 'cfk'.includes(target)) {
      if (source === target) {
        return `${formatNumber(value)} °${source.toUpperCase()} is the same in °${target.toUpperCase()}.`;
      }
      const converted = temperature(value, source, target);
      return `**${formatNumber(converted)} °${target.toUpperCase()}**\n\n\`${formatNumber(value)} °${source.toUpperCase()} → ${formatNumber(converted)} °${target.toUpperCase()}\``;
    }

    const from = UNITS[source];
    const to = UNITS[target];
    if (!from || !to || from[0] !== to[0]) continue;
    const converted = value * from[1] / to[1];
    const shown = formatNumber(converted);
    const note = from[0] === 'data' ? 'Using decimal units (1 KB = 1,000 bytes).' : 'Exact conversion factors.';
    return `**${shown} ${target}**\n\n\`${formatNumber(value)} ${source} = ${shown} ${target}\`\n\n${note}`;
  }

  return null;
}

const PREFIXES = [
  "what's ", 'what is ', 'what is the value of ', 'calculate ', 'compute ',
  'solve ', 'evaluate ', 'how much is '
];

function mathIntent(text) {
  let candidate = text;
  for (const prefix of PREFIXES) {
    if (candidate.startsWith(prefix)) { candidate = candidate.slice(prefix.length); break; }
  }
  candidate = candidate.trim().replace(/[?=]+$/, '').trim();

  if (candidate.startsWith('the ')) candidate = candidate.slice(4);
  if (candidate.startsWith('square root of ')) candidate = `sqrt(${candidate.slice('square root of '.length)})`;
  else if (candidate.startsWith('cube root of ')) candidate = `cbrt(${candidate.slice('cube root of '.length)})`;
  else if (candidate.startsWith('factorial of ')) candidate = `${candidate.slice('factorial of '.length)}!`;
  else if (candidate.endsWith(' squared')) candidate = `(${candidate.slice(0, -' squared'.length)})^2`;
  else if (candidate.endsWith(' cubed')) candidate = `(${candidate.slice(0, -' cubed'.length)})^3`;

  candidate = ` ${candidate} `
    .replace(/ to the power of /g, '^')
    .replace(/ divided by /g, '/')
    .replace(/ multiplied by /g, '*')
    .replace(/ times /g, '*')
    .replace(/ plus /g, '+')
    .replace(/ minus /g, '-')
    .replace(/ factorial/g, '!')
    .trim();

  if (!candidate) return null;
  if (!/^[a-z0-9+\-*/^%(),!. ]+$/i.test(candidate)) return null;
  const hasDigit = /[0-9]/.test(candidate);
  const hasConstant = candidate.split(/[^a-z]+/i).some((word) => word === 'pi' || word === 'e');
  if (!hasDigit && !hasConstant) return null;

  let value;
  try {
    value = evaluate(candidate);
  } catch (error) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return ['math-limit', 'That expression does not produce a finite number (for example, division by zero, an invalid function domain or numeric overflow), so I will not present it as a normal result.'];
  }

  const shown = formatNumber(value);
  const display = candidate.replace(/\*/g, '×');
  const trig = /(sin|cos|tan|asin|acos|atan)\(/.test(candidate);
  return ['math', `**${shown}**\n\nExpression: ${display} = ${shown}${trig ? '\n\nTrigonometric functions use radians.' : ''}`];
}

const LIVE = ['weather', 'news', 'stock price', 'score', 'who won', 'latest', 'headlines', 'browse', 'search the web'];

function answer(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return ['empty', 'Ask me for arithmetic, percentages or a unit conversion. I answer on this device, so there is no network round trip.'];
  }

  const lowered = normalize(text);

  const percent = percentIntent(lowered);
  if (percent) return ['percent', percent];

  const units = unitIntent(lowered);
  if (units) return ['units', units];

  const math = mathIntent(lowered);
  if (math) return math;

  if (LIVE.some((word) => lowered.includes(word))) {
    return ['live', 'I cannot check live information — this engine has no network access, and it will not invent an answer.\n\nSwitch to a connected hosted model for current facts, or paste the source text here and I will help you reason about it.'];
  }

  return ['fallback', 'I want to be straight with you: **this is a small on-device engine**, and that question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for open-ended writing, code review or live information.'];
}

/* ------------------------------ conformance ------------------------------ */

function runVectors(file) {
  const source = fs.readFileSync(file, 'utf8').split('\n');
  const failures = [];
  let checked = 0;

  source.forEach((line, index) => {
    const row = line.replace(/\r$/, '');
    if (!row.trim() || row.trimStart().startsWith('#')) return;
    const fields = row.split('\t');
    if (fields.length < 3) { failures.push(`line ${index + 1}: expected at least 3 columns`); return; }
    const [mode, prompt, expected] = fields;
    const contains = fields[3] ? fields[3].split('|') : [];
    checked++;

    if (mode === 'eval') {
      let value;
      try { value = evaluate(prompt); } catch (error) {
        failures.push(`line ${index + 1}: ${JSON.stringify(prompt)} -> error ${error.message}`);
        return;
      }
      const target = Number(expected);
      if (!(Math.abs(value - target) <= 1e-9 * Math.max(1, Math.abs(target)))) {
        failures.push(`line ${index + 1}: ${JSON.stringify(prompt)} -> ${value}, wanted ${target}`);
      }
      return;
    }

    const [intent, text] = answer(prompt);
    if (intent !== expected) {
      failures.push(`line ${index + 1}: ${JSON.stringify(prompt)} -> intent ${intent}, wanted ${expected}`);
      return;
    }
    for (const fragment of contains) {
      if (!text.includes(fragment)) {
        failures.push(`line ${index + 1}: ${JSON.stringify(prompt)} -> text missing ${JSON.stringify(fragment)}`);
        break;
      }
    }
  });

  if (failures.length) {
    failures.forEach((failure) => console.log('FAIL ' + failure));
    console.log(`${failures.length} failure(s) out of ${checked} case(s)`);
    return 1;
  }
  console.log(`ok: ${checked} cases`);
  return 0;
}

const api = { answer, evaluate, formatNumber, runVectors };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.EltesCaiPort = api;

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', 'vectors.tsv');
  process.exit(runVectors(file));
}
