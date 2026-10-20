/*!
 * Eltes Agent — a small, deterministic, tool-using agent that runs in the tab.
 *
 * The agent is the part of Eltes that *acts* instead of guessing: it turns a
 * request into tool calls, runs them against the on-device CAI engine, and
 * returns both the answer and the trace of what it did. Nothing here touches
 * the network, and there is no hidden model deciding when to invent a number.
 *
 * Hosted models can drive the same tools through the function-calling loop in
 * app.js; the registry below is the single source of truth for both paths.
 *
 *     const agent = window.EltesAgent.create({ cai: window.EltesCAI });
 *     agent.runLocal('12 km to miles, then multiply by 3');
 */
window.EltesAgent = (function () {
  'use strict';

  const VERSION = '1.0.0';
  const MAX_STEPS = 6;

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function isoOf(stamp) {
    const date = new Date(stamp);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function parseISODate(text) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const stamp = Date.UTC(year, month - 1, day);
    const check = new Date(stamp);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      return null;
    }
    return { year, month, day, stamp, iso: match[0] };
  }

  const TEMPERATURE_UNITS = { c: 'c', f: 'f', k: 'k' };

  function normaliseUnit(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/^°\s*/, '')
      .replace(/^degrees?\s+/, '')
      .replace(/\.$/, '');
  }

  function asTemperature(unit) {
    const key = normaliseUnit(unit);
    if (TEMPERATURE_UNITS[key]) return key;
    if (key === 'celsius' || key === 'centigrade') return 'c';
    if (key === 'fahrenheit') return 'f';
    if (key === 'kelvin') return 'k';
    return null;
  }

  /* -------------------------------- tools --------------------------------- */

  function buildTools(cai) {
    return [
      {
        name: 'calculate',
        icon: 'calculator',
        description: 'Evaluate an arithmetic expression with + - * / % ^, parentheses, factorials and functions such as sqrt, log, min, max, mean. Use this for every calculation instead of doing the maths yourself.',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Expression to evaluate, e.g. "(17 * 43) / 2" or "sqrt(144) + 3!"' }
          },
          required: ['expression']
        },
        run(args) {
          const expression = String((args && args.expression) || '').trim();
          if (!expression) return { error: 'No expression was supplied.' };
          if (!/^[0-9a-zA-Z+\-*/%^().,!×÷\s]+$/.test(expression)) {
            return { error: 'The expression contains characters the calculator does not accept.' };
          }
          let value;
          try {
            value = cai.evaluate(expression);
          } catch (error) {
            return { error: 'That expression could not be evaluated.' };
          }
          if (!Number.isFinite(value)) return { error: 'The result is not a finite number.' };
          const shown = cai.formatNumber(value);
          return { result: shown, value, say: `**${shown}** — \`${expression}\`` };
        }
      },
      {
        name: 'convert_units',
        icon: 'ruler',
        description: 'Convert a value between compatible units: length, mass, volume, data, speed and area. Use for "12 km to miles" or "5 kg in lb".',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Numeric amount to convert' },
            from: { type: 'string', description: 'Source unit, e.g. km, kg, gb, mph' },
            to: { type: 'string', description: 'Target unit, e.g. miles, lb, mb, km/h' }
          },
          required: ['value', 'from', 'to']
        },
        run(args) {
          const value = Number(args && args.value);
          const from = normaliseUnit(args && args.from);
          const to = normaliseUnit(args && args.to);
          if (!Number.isFinite(value)) return { error: 'The value to convert must be a number.' };
          if (!from || !to) return { error: 'Both a source and a target unit are required.' };

          const fromTemp = asTemperature(from);
          const toTemp = asTemperature(to);
          if (fromTemp && toTemp) {
            if (fromTemp === toTemp) {
              const same = cai.formatNumber(value);
              return { result: `${same} °${toTemp.toUpperCase()}`, value, say: `${same} °${fromTemp.toUpperCase()} is the same in °${toTemp.toUpperCase()}.` };
            }
            const converted = cai.temperature(value, fromTemp, toTemp);
            const shown = cai.formatNumber(converted);
            return {
              result: `${shown} °${toTemp.toUpperCase()}`,
              value: converted,
              say: `**${shown} °${toTemp.toUpperCase()}** — ${cai.formatNumber(value)} °${fromTemp.toUpperCase()} → ${shown} °${toTemp.toUpperCase()}`
            };
          }

          const converted = cai.convertUnits(value, from, to);
          if (!converted) {
            return { error: `"${from}" and "${to}" are not compatible units, so no honest conversion exists.` };
          }
          const shown = cai.formatNumber(converted.value);
          return {
            result: `${shown} ${to}`,
            value: converted.value,
            say: `**${shown} ${to}** — ${cai.formatNumber(value)} ${from} = ${shown} ${to}`
          };
        }
      },
      {
        name: 'percent',
        icon: 'trending-up',
        description: 'Percentage arithmetic: a share of a number ("15% of 240"), a discount ("20% off 80"), or the percentage change between two values.',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['of', 'off', 'change'], description: 'of = share, off = discount, change = difference between two values' },
            value: { type: 'number', description: 'Percentage for "of"/"off" modes' },
            base: { type: 'number', description: 'The number the percentage applies to' },
            from: { type: 'number', description: 'Starting value for "change" mode' },
            to: { type: 'number', description: 'Ending value for "change" mode' }
          },
          required: ['mode']
        },
        run(args) {
          const mode = String((args && args.mode) || '').toLowerCase();
          if (mode === 'of' || mode === 'off') {
            const percent = Number(args.value);
            const base = Number(args.base);
            if (!Number.isFinite(percent) || !Number.isFinite(base)) {
              return { error: 'Both a percentage and a base number are required.' };
            }
            const part = (percent / 100) * base;
            const partText = cai.formatNumber(part);
            if (mode === 'off') {
              const left = cai.formatNumber(base - part);
              return { result: left, value: base - part, say: `**${left}** after ${cai.formatNumber(percent)}% off ${cai.formatNumber(base)} (a discount of ${partText}).` };
            }
            return { result: partText, value: part, say: `**${partText}** — ${cai.formatNumber(percent)}% of ${cai.formatNumber(base)}` };
          }
          if (mode === 'change') {
            const from = Number(args.from);
            const to = Number(args.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) {
              return { error: 'Both a starting and an ending value are required.' };
            }
            if (from === 0) {
              return { error: 'Percentage change from zero is undefined: the calculation divides by the starting value.' };
            }
            const change = ((to - from) / Math.abs(from)) * 100;
            const shown = cai.formatNumber(change);
            return { result: `${shown}%`, value: change, say: `**${shown}%** change from ${cai.formatNumber(from)} to ${cai.formatNumber(to)}` };
          }
          return { error: 'Unknown percentage mode.' };
        }
      },
      {
        name: 'date_math',
        icon: 'calendar',
        description: 'Calendar arithmetic on ISO dates (YYYY-MM-DD): days between two dates, the weekday of a date, or days until a date. Uses UTC dates.',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['difference', 'weekday', 'days_until'], description: 'What to compute' },
            start: { type: 'string', description: 'Start date for a difference, as YYYY-MM-DD' },
            end: { type: 'string', description: 'End date for a difference, as YYYY-MM-DD' },
            date: { type: 'string', description: 'Target date for weekday or days_until, as YYYY-MM-DD' }
          },
          required: ['kind']
        },
        run(args, ctx) {
          const kind = String((args && args.kind) || '').toLowerCase();
          if (kind === 'difference') {
            const start = parseISODate(args.start);
            const end = parseISODate(args.end);
            if (!start || !end) return { error: 'Both dates must be real ISO dates, like 2026-01-01.' };
            const days = Math.round((end.stamp - start.stamp) / 86400000);
            return {
              result: `${days} days`,
              value: days,
              say: `**${Math.abs(days)} days** between ${start.iso} and ${end.iso}${days < 0 ? ' (the end date comes first)' : ''}.`
            };
          }
          const date = parseISODate(args && args.date);
          if (!date) return { error: 'A real ISO date, like 2026-10-20, is required.' };
          if (kind === 'weekday') {
            const weekday = WEEKDAYS[new Date(date.stamp).getUTCDay()];
            return { result: weekday, say: `${date.iso} is a **${weekday}**.` };
          }
          if (kind === 'days_until') {
            const today = ctx && ctx.now ? ctx.now() : new Date();
            const todayStamp = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
            const days = Math.round((date.stamp - todayStamp) / 86400000);
            const phrase = days === 0 ? 'is today' : days > 0 ? `is ${days} days away` : `was ${Math.abs(days)} days ago`;
            return { result: `${days} days`, value: days, say: `${date.iso} ${phrase} (from ${isoOf(todayStamp)}).` };
          }
          return { error: 'Unknown date operation.' };
        }
      },
      {
        name: 'current_time',
        icon: 'clock',
        description: 'Return the current date and time. Use whenever an answer depends on "now".',
        parameters: {
          type: 'object',
          properties: {
            timezone: { type: 'string', description: 'Optional IANA timezone, e.g. Europe/London' }
          }
        },
        run(args, ctx) {
          const now = ctx && ctx.now ? ctx.now() : new Date();
          const timezone = args && args.timezone;
          try {
            if (timezone) {
              const formatted = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' }).format(now);
              return { result: `${formatted} (${timezone})`, say: `It is ${formatted} (${timezone}).` };
            }
          } catch (error) {
            // Unknown timezone: fall through to UTC rather than guessing.
          }
          const stamp = `${isoOf(now)} ${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())} UTC`;
          return { result: stamp, say: `It is ${stamp} — a ${WEEKDAYS[now.getUTCDay()]}.` };
        }
      },
      {
        name: 'search_history',
        icon: 'search',
        description: 'Search the user\'s saved conversations in this browser for a phrase and return matching titles with snippets. Use when the user refers to something discussed earlier.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Words to search for' }
          },
          required: ['query']
        },
        run(args, ctx) {
          const query = String((args && args.query) || '').trim();
          if (!query) return { error: 'Empty query.' };
          if (!ctx || typeof ctx.searchHistory !== 'function') {
            return { error: 'Conversation search is only available inside the Eltes workspace.' };
          }
          const found = ctx.searchHistory(query);
          if (!found) return { result: `No saved conversations match "${query}".` };
          return { result: found, say: found };
        }
      }
    ];
  }

  /* ------------------------------- planning -------------------------------- */

  const PREFIX = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:what(?:'s| is)\s+the\s+)?/i;

  function splitClauses(prompt) {
    return String(prompt || '')
      .split(/\n+|(?:[.;]\s+)|(?:\s+and\s+then\s+)|(?:\s+then\s+)/i)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function planClause(clause, last, ctx) {
    const text = clause.trim();
    const lowered = text.toLowerCase();
    if (!text) return null;

    if (/\b(?:what time|time is it|current time|what(?:'s| is) the time)\b/.test(lowered)) {
      const zone = /(?:in|at)\s+([a-z]+\/[a-z_]+)/.exec(lowered);
      return { name: 'current_time', args: zone ? { timezone: zone[1] } : {} };
    }

    const isoDates = text.match(/\d{4}-\d{2}-\d{2}/g) || [];

    if (isoDates.length >= 2 && /\b(?:between|from)\b/.test(lowered)) {
      return { name: 'date_math', args: { kind: 'difference', start: isoDates[0], end: isoDates[1] } };
    }
    if (isoDates.length === 1 && /\b(?:what|which)\s+day\b|day\s+of\s+the\s+week|\bweekday\b/.test(lowered)) {
      return { name: 'date_math', args: { kind: 'weekday', date: isoDates[0] } };
    }
    if (isoDates.length === 1 && /\b(?:until|till|away|days?)\b/.test(lowered)) {
      return { name: 'date_math', args: { kind: 'days_until', date: isoDates[0] } };
    }

    const percentMatch = /(-?\d+(?:\.\d+)?)\s*(?:%|percent)\s*(off|of)\s*(-?\d+(?:\.\d+)?)/i.exec(text);
    if (percentMatch) {
      return {
        name: 'percent',
        args: { mode: percentMatch[2].toLowerCase(), value: Number(percentMatch[1]), base: Number(percentMatch[3]) }
      };
    }
    const changeMatch = /(?:percent|percentage)\s+(?:change|increase|decrease)\s*(?:from)?\s*(-?\d+(?:\.\d+)?)\s*(?:to|→)\s*(-?\d+(?:\.\d+)?)/i.exec(text);
    if (changeMatch) {
      return { name: 'percent', args: { mode: 'change', from: Number(changeMatch[1]), to: Number(changeMatch[2]) } };
    }

    const conversion = /(-?\d+(?:\.\d+)?)\s*(?:°\s*|degrees?\s+)?([a-zA-Z/][a-zA-Z/0-9]*)\s+(?:to|in|into|as)\s+(?:°\s*|degrees?\s+)?([a-zA-Z/][a-zA-Z/0-9]*)/i.exec(text);
    if (conversion) {
      return {
        name: 'convert_units',
        args: { value: Number(conversion[1]), from: conversion[2], to: conversion[3] }
      };
    }

    const chained = /^(?:then\s+)?(add|plus|subtract|minus|multiply(?:\s+by)?|divide(?:\s+by)?|times)\s+(-?\d+(?:\.\d+)?)$/i.exec(text);
    if (chained && typeof last === 'number') {
      const word = chained[1].toLowerCase();
      const operator = word.startsWith('add') || word === 'plus' ? '+'
        : word.startsWith('subtract') || word === 'minus' ? '-'
          : word.startsWith('multiply') || word === 'times' ? '*'
            : '/';
      return { name: 'calculate', args: { expression: `${last} ${operator} ${chained[2]}` } };
    }

    if (/\b(?:earlier|previously|last time|what did (?:we|i) (?:say|discuss)|my (?:chats|conversations))\b/.test(lowered)) {
      const query = text.replace(PREFIX, '').replace(/\b(?:earlier|previously|last time)\b/gi, '').trim();
      return { name: 'search_history', args: { query: query || text } };
    }

    const arithmetic = /\d/.test(text) && /[+\-*/^%×÷!]|\b(?:sqrt|cbrt|sin|cos|tan|log|ln|exp|floor|ceil|round|min|max|sum|mean|product|factorial|squared|cubed)\b/i.test(text);
    if (arithmetic) {
      let expression = text
        .replace(PREFIX, '')
        .replace(/^(?:calculate|compute|evaluate|solve)\s+/i, '')
        .replace(/[?]+\s*$/, '')
        .trim();
      expression = expression
        .replace(/\bsquared\b/gi, '^2')
        .replace(/\bcubed\b/gi, '^3')
        .replace(/\bplus\b/gi, '+')
        .replace(/\bminus\b/gi, '-')
        .replace(/\btimes\b/gi, '*')
        .replace(/\bmultiplied by\b/gi, '*')
        .replace(/\bdivided by\b/gi, '/')
        .replace(/×/g, '*')
        .replace(/÷/g, '/');
      return { name: 'calculate', args: { expression } };
    }

    if (ctx && ctx.allowHistory === false) return null;
    return null;
  }

  /* ------------------------------- instance ------------------------------- */

  function create(options) {
    const config = options || {};
    const cai = config.cai;
    if (!cai) throw new Error('EltesAgent needs the CAI engine (cai: window.EltesCAI).');

    const tools = buildTools(cai);
    const registry = {};
    tools.forEach((tool) => { registry[tool.name] = tool; });

    function toolDefs() {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        icon: tool.icon
      }));
    }

    function withContext(extra) {
      return Object.assign({
        now: config.now || (() => new Date()),
        searchHistory: config.searchHistory || null
      }, extra || {});
    }

    function run(name, args, extra) {
      const tool = registry[name];
      const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (!tool) {
        return { name, args: args || {}, result: `Error: unknown tool "${name}"`, error: true, runtime: 0 };
      }
      let outcome;
      try {
        outcome = tool.run(args || {}, withContext(extra)) || {};
      } catch (error) {
        outcome = { error: (error && error.message) || 'The tool failed.' };
      }
      const runtime = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
      if (outcome.error) {
        return { name, args: args || {}, result: `Error: ${outcome.error}`, error: true, runtime, say: `I could not run \`${name}\`: ${outcome.error}` };
      }
      return { name, args: args || {}, result: outcome.result, value: outcome.value, say: outcome.say, error: false, runtime };
    }

    function plan(prompt, extra) {
      const ctx = withContext(extra);
      const clauses = splitClauses(prompt);
      const steps = [];
      let last = null;
      clauses.forEach((clause) => {
        if (steps.length >= MAX_STEPS) return;
        const call = planClause(clause, last, ctx);
        if (!call) { last = null; return; }
        const outcome = run(call.name, call.args, extra);
        steps.push({
          name: outcome.name,
          args: outcome.args,
          clause,
          result: outcome.result,
          error: outcome.error,
          runtime: outcome.runtime
        });
        last = outcome.error ? null : (typeof outcome.value === 'number' ? outcome.value : null);
      });
      return steps;
    }

    function runLocal(prompt, extra) {
      const ctx = withContext(extra);
      const model = (extra && extra.model) || 'eltes-cai-1';
      const history = (extra && extra.history) || [];
      const nowDate = ctx.now();
      const clauses = splitClauses(prompt);
      const steps = [];
      const parts = [];
      let last = null;

      clauses.forEach((clause) => {
        if (steps.length >= MAX_STEPS) return;
        const call = planClause(clause, last, ctx);
        if (!call) {
          const routed = cai.build(model, clause, history, nowDate);
          parts.push(routed.text);
          last = null;
          return;
        }
        const outcome = run(call.name, call.args, extra);
        steps.push({
          name: outcome.name,
          args: outcome.args,
          clause,
          result: outcome.result,
          error: outcome.error,
          runtime: outcome.runtime
        });
        if (outcome.error) {
          parts.push(outcome.say);
          last = null;
          return;
        }
        parts.push(outcome.say || outcome.result);
        last = typeof outcome.value === 'number' ? outcome.value : null;
      });

      const text = parts.filter(Boolean).join('\n\n');
      if (!steps.length) return { steps: [], text: '', intent: 'cai', usedTools: 0 };

      const footer = `\n\n_On-device agent · ${steps.length} tool call${steps.length === 1 ? '' : 's'} · nothing left this browser._`;
      return { steps, text: `${text}${footer}`, intent: 'agent', usedTools: steps.filter((step) => !step.error).length };
    }

    return {
      version: VERSION,
      maxSteps: MAX_STEPS,
      tools: () => tools.map((tool) => tool.name),
      toolDefs,
      run,
      plan,
      runLocal,
      splitClauses,
      planClause: (clause, last) => planClause(clause, last, withContext())
    };
  }

  return { create, VERSION, MAX_STEPS, splitClauses };
})();
