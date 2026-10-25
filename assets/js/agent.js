/* ==========================================================================
   Eltes AI — on-device agent
   A small, deterministic tool loop that runs with no key and no network.

   The hosted path in app.js already lets a model call tools. This module is
   the other half: when the selected model is Eltes CAI, there is no model to
   ask, so this planner reads the prompt, picks tools, runs them and returns a
   trace. Every tool is a pure function over its arguments; nothing here calls
   fetch, XHR or WebSocket, and nothing leaves the page.

   Public surface:
     EltesAgent.create({ cai, searchHistory, now }) -> instance
     instance.tools()             plain JSON-schema definitions
     instance.runTool(name, args) -> { name, args, result, error, runtime }
     instance.plan(prompt)        -> [{ name, args, reason }]
     instance.runLocal(prompt)    -> { intent, text, steps }
   ========================================================================== */
window.EltesAgent = (function () {
  'use strict';

  const VERSION = '1.0.0';
  const MAX_STEPS = 6;

  /* --------------------------------- tools -------------------------------- */

  const TOOLS = [
    {
      name: 'calculate',
      icon: 'calculator',
      description: 'Evaluate an arithmetic expression with the on-device parser. Supports + - * / % ^, parentheses, sqrt, cbrt, abs, log, ln, sin, cos, tan, factorial (!), pi, e and aggregates (sum, mean, median, min, max, product).',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression, e.g. "(17 * 43) / 2", "sqrt(81) + 2", "median(4,2,9)"' }
        },
        required: ['expression']
      }
    },
    {
      name: 'convert_units',
      icon: 'arrow-left-right',
      description: 'Convert a value between units of the same kind: length (mm, cm, m, km, in, ft, yd, mi), mass (mg, g, kg, oz, lb, stone), volume (ml, l, cup, gal, fl oz), data (b, kb, mb, gb, tb, kib, mib, gib), speed (m/s, km/h, mph), area (m2, km2, acre), time (ms, s, min, h, day, week, month, year) and temperature (C, F, K). Returns an error instead of guessing when units are unknown or of different kinds.',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'number', description: 'Numeric value to convert' },
          from: { type: 'string', description: 'Source unit, e.g. "km"' },
          to: { type: 'string', description: 'Target unit, e.g. "mi"' }
        },
        required: ['value', 'from', 'to']
      }
    },
    {
      name: 'percentage',
      icon: 'percent',
      description: 'Percentage maths with the working shown. mode "of" answers "15% of 240"; mode "off" answers "20% off 80"; mode "change" answers "percentage change from 40 to 55". A change from zero is reported as undefined rather than a made-up number.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['of', 'off', 'change'], description: 'Which percentage question to answer' },
          value: { type: 'number', description: 'The percentage, or the starting value for "change"' },
          base: { type: 'number', description: 'The number the percentage applies to (for "of" and "off")' },
          from: { type: 'number', description: 'Starting value for "change"' },
          to: { type: 'number', description: 'Ending value for "change"' }
        },
        required: ['mode']
      }
    },
    {
      name: 'date_math',
      icon: 'calendar',
      description: 'Calendar maths on ISO dates (YYYY-MM-DD). kind "difference" counts days between two dates, "weekday" names the day a date falls on, "days_until" counts from today to a date.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['difference', 'weekday', 'days_until'], description: 'Which calculation to run' },
          start: { type: 'string', description: 'ISO date, e.g. 2026-01-01' },
          end: { type: 'string', description: 'Second ISO date for kind "difference"' }
        },
        required: ['kind', 'start']
      }
    },
    {
      name: 'current_time',
      icon: 'clock',
      description: 'Read the device clock: local time, ISO timestamp and timezone. Use for any question about today, now or the current date.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'search_history',
      icon: 'history',
      description: 'Search this browser\'s saved conversations for a phrase and return matching titles with snippets. Only reads local storage.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to search for' }
        },
        required: ['query']
      }
    }
  ];

  const has = (list, name) => list.some((tool) => tool.name === name);

  /* ------------------------------- formatting ------------------------------ */

  function formatTime(date) {
    try {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function timezoneName(date) {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone) return zone;
    } catch (error) { /* fall through */ }
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hours = Math.floor(Math.abs(offset) / 60);
    const minutes = Math.abs(offset) % 60;
    return `UTC${sign}${hours}${minutes ? ':' + String(minutes).padStart(2, '0') : ''}`;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseIsoDate(text) {
    const match = String(text || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return null;
    // Reject 2026-02-31 and friends: Date rolls them over instead of failing.
    if (date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function daysBetween(start, end) {
    const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.round((b - a) / DAY_MS);
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  /* -------------------------------- instance ------------------------------- */

  function create(options) {
    const config = options || {};
    const cai = config.cai || (typeof window !== 'undefined' ? window.EltesCAI : null);
    const now = typeof config.now === 'function' ? config.now : () => new Date();
    const searchHistory = typeof config.searchHistory === 'function' ? config.searchHistory : null;
    const format = (value) => {
      if (cai && typeof cai.formatNumber === 'function') return cai.formatNumber(value);
      return String(Math.round(value * 1e10) / 1e10);
    };

    /* ------------------------------- tool runs ------------------------------ */

    function runCalculate(args) {
      const expression = String((args && args.expression) || '').trim();
      if (!expression) return { error: 'Empty expression.' };
      if (!cai || typeof cai.evaluate !== 'function') return { error: 'The on-device parser is not loaded.' };
      let value;
      try {
        value = cai.evaluate(expression);
      } catch (error) {
        return { error: `Could not evaluate ${expression}.` };
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { error: 'The result is not a finite number.' };
      }
      return { result: `${format(value)}\n\nExpression: ${expression}`, value };
    }

    function runConvertUnits(args) {
      const value = Number(args && args.value);
      const from = String((args && args.from) || '').trim().toLowerCase();
      const to = String((args && args.to) || '').trim().toLowerCase();
      if (!Number.isFinite(value)) return { error: 'Value must be a finite number.' };
      if (!from || !to) return { error: 'Both a source and a target unit are required.' };
      const isScale = (unit) => ['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin'].includes(unit);
      if (isScale(from) || isScale(to)) {
        const scale = (unit) => unit[0];
        return runTemperature({ value, from: scale(from), to: scale(to) });
      }
      if (!cai || typeof cai.convertUnits !== 'function') return { error: 'The unit table is not loaded.' };
      const converted = cai.convertUnits(value, from, to);
      if (!converted) {
        return { error: `Cannot convert ${from} to ${to}: unknown unit, or units of different kinds.` };
      }
      return {
        result: `${format(converted.value)} ${to}\n\n${format(value)} ${from} = ${format(converted.value)} ${to} (${converted.kind})`,
        value: converted.value
      };
    }

    function runTemperature(args) {
      const value = Number(args && args.value);
      const from = String((args && args.from) || '').trim().toLowerCase();
      const to = String((args && args.to) || '').trim().toLowerCase();
      if (!Number.isFinite(value)) return { error: 'Value must be a finite number.' };
      if (!['c', 'f', 'k'].includes(from) || !['c', 'f', 'k'].includes(to)) {
        return { error: 'Temperature scales must be c, f or k.' };
      }
      if (!cai || typeof cai.temperature !== 'function') return { error: 'The temperature table is not loaded.' };
      const converted = cai.temperature(value, from, to);
      const label = (scale) => (scale === 'k' ? 'K' : `°${scale.toUpperCase()}`);
      if (from === to) {
        return { result: `${format(value)} ${label(from)} is the same in ${label(to)}.`, value };
      }
      return {
        result: `${format(converted)} ${label(to)}\n\n${format(value)} ${label(from)} = ${format(converted)} ${label(to)}`,
        value: converted
      };
    }

    function runPercentage(args) {
      const mode = String((args && args.mode) || '').toLowerCase();
      if (mode === 'of' || mode === 'off') {
        const percent = Number(args.value);
        const base = Number(args.base);
        if (!Number.isFinite(percent) || !Number.isFinite(base)) {
          return { error: 'A percentage and a base number are required.' };
        }
        const part = (percent / 100) * base;
        if (mode === 'off') {
          const left = base - part;
          return {
            result: `${format(left)}\n\n${format(base)} − ${format(part)} (that is ${format(percent)}% of ${format(base)}) = ${format(left)}`,
            value: left
          };
        }
        return {
          result: `${format(part)}\n\n${format(base)} × ${format(percent)} / 100 = ${format(part)}`,
          value: part
        };
      }
      if (mode === 'change') {
        const from = Number(args.from);
        const to = Number(args.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          return { error: 'Both a starting value and an ending value are required.' };
        }
        if (from === 0) {
          return {
            result: 'Undefined: a percentage change divides by the starting value, and the starting value is zero.',
            value: null
          };
        }
        const change = ((to - from) / Math.abs(from)) * 100;
        return {
          result: `${format(change)}%\n\n(${format(to)} − ${format(from)}) ÷ |${format(from)}| × 100 = ${format(change)}%`,
          value: change
        };
      }
      return { error: 'Mode must be "of", "off" or "change".' };
    }

    function runDateMath(args) {
      const kind = String((args && args.kind) || 'difference').toLowerCase();
      const start = parseIsoDate(args && args.start);
      if (!start) return { error: 'Give the date as YYYY-MM-DD.' };
      if (kind === 'weekday') {
        return { result: `${formatDate(start)} is a ${WEEKDAYS[start.getDay()]}.`, value: start.getDay() };
      }
      if (kind === 'days_until') {
        const today = now();
        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const days = daysBetween(todayDate, start);
        if (days === 0) return { result: `${formatDate(start)} is today.`, value: 0 };
        return {
          result: days > 0
            ? `${plural(days, 'day')} until ${formatDate(start)} (from ${formatDate(todayDate)}).`
            : `${plural(Math.abs(days), 'day')} since ${formatDate(start)} (today is ${formatDate(todayDate)}).`,
          value: days
        };
      }
      const end = parseIsoDate(args && args.end);
      if (!end) return { error: 'A second date (end) is required to count days between dates.' };
      const days = daysBetween(start, end);
      const [first, last] = days < 0 ? [end, start] : [start, end];
      const magnitude = Math.abs(days);
      return {
        result: `${plural(magnitude, 'day')} between ${formatDate(first)} and ${formatDate(last)}${days < 0 ? ' (the dates were the other way round)' : ''}.`,
        value: days
      };
    }

    function runCurrentTime() {
      const date = now();
      return {
        result: `${formatTime(date)} on ${formatDate(date)} (${timezoneName(date)})\n\nISO: ${date.toISOString()}`,
        value: date.getTime()
      };
    }

    function runSearchHistory(args) {
      const query = String((args && args.query) || '').trim();
      if (!query) return { error: 'A search phrase is required.' };
      if (!searchHistory) return { error: 'Chat history search is not connected in this build.' };
      let found;
      try {
        found = searchHistory(query);
      } catch (error) {
        return { error: 'Chat history search failed.' };
      }
      if (!found) return { result: `No saved conversations match “${query}”.` };
      return { result: String(found) };
    }

    const RUNNERS = {
      calculate: runCalculate,
      convert_units: runConvertUnits,
      percentage: runPercentage,
      date_math: runDateMath,
      current_time: runCurrentTime,
      search_history: runSearchHistory
    };

    function runTool(name, args) {
      const started = Date.now();
      const runner = RUNNERS[name];
      const out = runner ? runner(args || {}) : { error: `Unknown tool: ${name}` };
      return {
        name,
        args: args || {},
        result: out.error ? null : out.result,
        error: out.error || null,
        value: Object.prototype.hasOwnProperty.call(out, 'value') ? out.value : null,
        runtime: Math.max(1, Date.now() - started)
      };
    }

    /* -------------------------------- planning ------------------------------ */

    const STOPWORDS = new Set([
      'a', 'an', 'and', 'as', 'at', 'be', 'can', 'could', 'do', 'for', 'from', 'give', 'how', 'i', 'in',
      'into', 'is', 'it', 'me', 'much', 'my', 'of', 'on', 'please', 'tell', 'that', 'the', 'then', 'this',
      'to', 'what', 'whats', 'what\'s', 'which', 'would', 'you', 'your'
    ]);

    const FILLER = /\b(convert|calculate|compute|evaluate|work out|figure out|solve|how many|how much|what is|what's|whats|tell me|give me|please|exactly|roughly|approximately|about|now|today|currently|right now)\b/gi;

    function leftover(text, matched) {
      const rest = String(text || '')
        .replace(matched || '', ' ')
        .replace(FILLER, ' ')
        .replace(/[^a-z0-9]+/gi, ' ')
        .toLowerCase();
      return rest.split(/\s+/).filter((word) => word && !STOPWORDS.has(word));
    }

    function classify(clause) {
      const text = String(clause || '').trim();
      if (!text) return null;

      // 1. Temperature, before the general unit pattern, so "100 c to f" is not a length.
      let match = text.match(/(-?\d+(?:\.\d+)?)\s*(?:°|degrees?\s*)?(c|f|k|celsius|fahrenheit|kelvin)\b\s*(?:to|in|into)\s*(?:°|degrees?\s*)?(c|f|k|celsius|fahrenheit|kelvin)\b/i);
      if (match) {
        const scale = (word) => word.toLowerCase()[0];
        const from = scale(match[2]);
        const to = scale(match[3]);
        if (!leftover(text, match[0]).length) {
          return { name: 'convert_units', args: { value: Number(match[1]), from, to }, reason: 'temperature conversion' };
        }
      }

      // 2. Units.
      match = text.match(/(-?\d+(?:\.\d+)?)\s*([a-z][a-z/ ]*?)\s*(?:to|in|into|as)\s*([a-z][a-z/ ]*)\b/i);
      if (match) {
        const from = match[2].trim().toLowerCase();
        const to = match[3].trim().toLowerCase();
        if (!['c', 'f', 'k'].includes(from) && !['c', 'f', 'k'].includes(to) && !leftover(text, match[0]).length) {
          return { name: 'convert_units', args: { value: Number(match[1]), from, to }, reason: 'unit conversion' };
        }
      }

      // 3. Percentage change, then percent of / off.
      match = text.match(/(?:percent(?:age)?\s*(?:change|increase|decrease|difference)|change)\s*(?:from)?\s*(-?\d+(?:\.\d+)?)\s*(?:to)\s*(-?\d+(?:\.\d+)?)/i);
      if (match && !leftover(text, match[0]).length) {
        return { name: 'percentage', args: { mode: 'change', from: Number(match[1]), to: Number(match[2]) }, reason: 'percentage change' };
      }
      match = text.match(/(-?\d+(?:\.\d+)?)\s*(?:%|percent)\s*(of|off)\s*(-?\d+(?:\.\d+)?)/i);
      if (match && !leftover(text, match[0]).length) {
        return {
          name: 'percentage',
          args: { mode: match[2].toLowerCase(), value: Number(match[1]), base: Number(match[3]) },
          reason: `percentage ${match[2].toLowerCase()}`
        };
      }

      // 4. Dates.
      const dates = text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/g) || [];
      if (dates.length === 2) {
        return { name: 'date_math', args: { kind: 'difference', start: dates[0], end: dates[1] }, reason: 'days between two dates' };
      }
      if (dates.length === 1) {
        const kind = /\bweekday|day of (?:the )?week|what day\b/i.test(text) ? 'weekday'
          : /\b(until|till|left|away)\b/i.test(text) ? 'days_until'
            : 'weekday';
        return { name: 'date_math', args: { kind, start: dates[0] }, reason: `date ${kind.replace('_', ' ')}` };
      }

      // 5. Clock.
      if (/\b(what(?:'s| is)?\s+(?:the\s+)?(?:time|date)|what time is it|current time|time now|today'?s date)\b/i.test(text)) {
        return { name: 'current_time', args: {}, reason: 'the device clock' };
      }

      // 6. Chat history.
      match = text.match(/\b(?:earlier|previously|before|last time|my chats?|conversations?|history)\b(?:.*?\babout\b\s*(.+))?/i);
      if (match && /\b(earlier|previously|before|last time|my chats?|conversations?|history)\b/i.test(text)) {
        const query = (match[1] || text).trim();
        return { name: 'search_history', args: { query }, reason: 'search saved conversations' };
      }

      // 7. Arithmetic. Only claim it when the expression evaluates cleanly.
      if (/\d/.test(text) && /[-+*/^%!()]|sqrt|log|sin|cos|tan|median|mean|sum|product|factorial|\bpi\b|\be\b/i.test(text)) {
        const expression = text
          .replace(FILLER, ' ')
          .replace(/[?=]+\s*$/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/[−–—]/g, '-')
          .replace(/×/g, '*')
          .replace(/÷/g, '/');
        if (cai && typeof cai.evaluate === 'function' && expression) {
          try {
            const value = cai.evaluate(expression);
            if (typeof value === 'number' && Number.isFinite(value)) {
              return { name: 'calculate', args: { expression }, reason: 'arithmetic' };
            }
          } catch (error) { /* not a pure expression */ }
        }
      }
      return null;
    }

    function splitClauses(prompt) {
      return String(prompt || '')
        .split(/\s+then\s+|\s*;\s*|\n+/i)
        .map((clause) => clause.trim())
        .filter(Boolean);
    }

    // "then add 3" only makes sense against the previous result, so it is
    // recorded as an operation now and turned into an expression at run time.
    function chainedOperation(clause) {
      const match = String(clause || '').match(/^(?:add|plus)\s+(-?\d+(?:\.\d+)?)$/i);
      if (match) return { op: '+', operand: match[1] };
      const minus = String(clause || '').match(/^(?:subtract|minus|less)\s+(-?\d+(?:\.\d+)?)$/i);
      if (minus) return { op: '-', operand: minus[1] };
      const times = String(clause || '').match(/^(?:multiply(?:ed)?\s+by|times|x)\s+(-?\d+(?:\.\d+)?)$/i);
      if (times) return { op: '*', operand: times[1] };
      const divide = String(clause || '').match(/^(?:divide(?:d)?\s+by|over)\s+(-?\d+(?:\.\d+)?)$/i);
      if (divide) return { op: '/', operand: divide[1] };
      return null;
    }

    function plan(prompt) {
      const clauses = splitClauses(prompt);
      if (!clauses.length) return [];
      const steps = [];
      for (const clause of clauses) {
        if (steps.length >= MAX_STEPS) break;
        const chained = chainedOperation(clause);
        if (chained) {
          if (!steps.length) return [];
          steps.push({ name: 'calculate', args: {}, chain: chained, reason: 'carry the previous result forward' });
          continue;
        }
        const match = classify(clause);
        if (!match) return [];
        steps.push(match);
      }
      return steps;
    }

    function describe(step, run, args) {
      if (run.error) return `**${step.name}** could not finish: ${run.error}`;
      const first = String(run.result || '').split('\n')[0];
      switch (step.name) {
        case 'calculate':
          return `**${first}** — \`${args.expression}\``;
        case 'convert_units':
          if (['c', 'f', 'k'].includes(String(args.from).toLowerCase())) {
            return `**${first}** — ${format(args.value)} °${String(args.from).toUpperCase()} in °${String(args.to).toUpperCase()}`;
          }
          return `**${first}** — ${format(args.value)} ${args.from} to ${args.to}`;
        case 'percentage':
          if (args.mode === 'change') return `**${first}** — change from ${format(args.from)} to ${format(args.to)}`;
          if (args.mode === 'off') return `**${first}** — ${format(args.value)}% off ${format(args.base)} (discount ${format((args.value / 100) * args.base)})`;
          return `**${first}** — ${format(args.value)}% of ${format(args.base)}`;
        case 'date_math':
          return `**${first}** — ${args.kind.replace('_', ' ')} ${args.start}${args.end ? ` → ${args.end}` : ''}`;
        case 'current_time':
          return `It is **${first.split(' (')[0]}**${step.result && step.result.includes('(') ? ` (${step.result.split('(')[1].split(')')[0]})` : ''}`;
        case 'search_history':
          return first;
        default:
          return first;
      }
    }

    function runLocal(prompt, options) {
      const opts = options || {};
      const planned = plan(prompt);
      if (!planned.length) {
        const fallback = cai && typeof cai.build === 'function'
          ? cai.build(opts.model || 'eltes-cai-1', String(prompt || ''), opts.history || [], now())
          : { text: 'The on-device model is not loaded.', intent: 'unavailable' };
        return { intent: fallback.intent || 'cai', text: fallback.text, steps: [] };
      }

      const steps = [];
      const lines = [];
      let failed = false;
      let previous = null;
      for (const step of planned) {
        const args = step.chain
          ? { expression: `${previous} ${step.chain.op} ${step.chain.operand}` }
          : step.args;
        const run = runTool(step.name, args);
        steps.push(run);
        if (run.error) {
          lines.push(`**${step.name}** could not finish: ${run.error}`);
          failed = true;
          break;
        }
        lines.push(describe(step, run, args));
        previous = typeof run.value === 'number' && Number.isFinite(run.value) ? run.value : null;
      }

      const footer = steps.length
        ? `\n\n_On-device agent · ${plural(steps.length, 'tool call')} · nothing left this browser._`
        : '';
      const closing = failed ? '\n\nI stopped at the first failure rather than guessing the rest.' : '';
      return {
        intent: 'agent',
        text: lines.join('\n\n') + closing + footer,
        steps,
        stopped: failed
      };
    }

    return {
      version: VERSION,
      maxSteps: MAX_STEPS,
      tools: () => TOOLS.map((tool) => ({ ...tool })),
      toolDefs: () => TOOLS.filter((tool) => has(TOOLS, tool.name)).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        icon: tool.icon
      })),
      toolNames: () => TOOLS.map((tool) => tool.name),
      hasTool: (name) => has(TOOLS, name),
      run: runTool,
      runTool,
      plan,
      classify,
      runLocal
    };
  }

  return { version: VERSION, maxSteps: MAX_STEPS, create };
})();
