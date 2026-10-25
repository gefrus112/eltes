/* ==========================================================================
   Eltes CAI — a deterministic on-device conversational helper.
   CAI ("conversational agent intelligence") runs entirely in this tab.
   It uses JavaScript rules and a curated knowledge set, not trained neural
   weights. It handles bounded Eltes help, model choice, arithmetic, units,
   dates, glossary terms and active-chat excerpts. It can still be wrong.
   No network and no key; unsupported questions should receive an abstention.
   v3.4 — improved agent: expanded glossary, time units, date arithmetic,
   median/sum/product natural language, Kelvin handling, safer fallbacks,
   and a code-aware streaming chunker.
   ========================================================================== */
window.EltesCAI = (function () {
  'use strict';

  const M = window.EltesModels;

  /* ------------------------------- utilities ------------------------------ */

  const lower = (s) => String(s || '').toLowerCase();
  const norm = (s) => lower(s).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const strip = (s) => ' ' + norm(s).replace(/[^a-z0-9%$+\-*/().,:/ ]+/g, ' ').replace(/\s+/g, ' ') + ' ';

  function has(text, ...terms) {
    const t = strip(text);
    return terms.some((term) => t.includes(' ' + norm(term) + ' '));
  }
  function hasAny(text, re) { return re.test(norm(text)); }

  function list(items) {
    if (items.length < 2) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  function badge(model) { return model.realtime ? ' · real-time streaming' : ''; }

  function money(n) { return '$' + Number(n).toFixed(2).replace(/\.00$/, ''); }

  /* -------------------------------- time/date ----------------------------- */

  function answerTime(now) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
    const date = new Intl.DateTimeFormat(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }).format(now);
    const clock = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit'
    }).format(now);
    return {
      intent: 'time',
      text: `It is **${clock}** on **${date}** in your timezone (\`${zone}\`).\n\nThis comes from your device clock — CAI never reaches the network.`
    };
  }

  // ---- date arithmetic helpers ----
  function parseNaturalDate(str, now) {
    const s = String(str || '').trim().toLowerCase();
    if (!s) return null;
    if (s === 'today' || s === 'now') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (s === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    if (s === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    // ISO YYYY-MM-DD or YYYY/MM/DD
    let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (m) { const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); if (!isNaN(d)) return d; }
    // US M/D/YYYY
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) { const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])); if (!isNaN(d)) return d; }
    // Month name D YYYY  e.g. jan 5 2024, january 5, 2024
    m = s.match(/^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:,)?\s+(\d{4})$/);
    if (m) {
      const months = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
      const d = new Date(Number(m[3]), months[m[1]], Number(m[2]));
      if (!isNaN(d)) return d;
    }
    // Fallback: Date.parse but clamp to date-only
    const parsed = new Date(s);
    if (!isNaN(parsed)) {
      // Only accept if string contained a year to avoid ambiguous parses
      if (/\d{4}/.test(s)) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
    return null;
  }

  function dateMathIntent(text, now) {
    const t = norm(text);
    // days between X and Y
    let m = t.match(/(?:how many )?days (?:between|from)\s+(.+?)\s+and\s+(.+?)(?:\?)?$/);
    if (m) {
      const a = parseNaturalDate(m[1].trim(), now);
      const b = parseNaturalDate(m[2].trim(), now);
      if (a && b) {
        const diff = Math.round((b - a) / 86400000);
        const abs = Math.abs(diff);
        const dir = diff >= 0 ? 'after' : 'before';
        const aStr = a.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        const bStr = b.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        return {
          intent: 'date-math',
          text: `**${abs} day${abs === 1 ? '' : 's'}** between **${aStr}** and **${bStr}**.\n\n\`${aStr} → ${bStr} = ${diff} days\` (${abs} days ${dir}). Calculated from your device calendar — no network.`
        };
      }
    }
    // what is X days from Y / in X days / X days from today
    m = t.match(/(?:what(?:'s| is)?\s+)?(?:what date is\s+)?(?:in\s+)?(-?\d+)\s+days?\s+(?:from\s+(.+?)|after\s+(.+?)|ago)(?:\?)?$/);
    if (m) {
      const n = Number(m[1]);
      const baseStr = (m[2] || m[3] || '').trim() || 'today';
      const base = parseNaturalDate(baseStr, now);
      if (base && Number.isFinite(n)) {
        const out = new Date(base);
        out.setDate(out.getDate() + n);
        const baseFmt = base.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const outFmt = out.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const sign = n >= 0 ? '+' : '';
        return {
          intent: 'date-math',
          text: `**${outFmt}**\n\n\`${baseFmt} ${sign}${n} days = ${outFmt}\``
        };
      }
    }
    // how many days until X / days since X
    m = t.match(/how many days (?:until|till|to)\s+(.+?)(?:\?)?$/);
    if (m) {
      const target = parseNaturalDate(m[1].trim(), now);
      if (target) {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diff = Math.round((target - today) / 86400000);
        const targetFmt = target.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        if (diff === 0) return { intent: 'date-math', text: `**Today** is **${targetFmt}** — 0 days away.` };
        if (diff > 0) return { intent: 'date-math', text: `**${diff} day${diff === 1 ? '' : 's'} until ${targetFmt}** from today.` };
        return { intent: 'date-math', text: `**${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} since ${targetFmt}**.` };
      }
    }
    // weeks/months helpers: "how many weeks between"
    m = t.match(/how many (weeks|months|years) between\s+(.+?)\s+and\s+(.+?)(?:\?)?$/);
    if (m) {
      const unit = m[1];
      const a = parseNaturalDate(m[2].trim(), now);
      const b = parseNaturalDate(m[3].trim(), now);
      if (a && b) {
        const days = Math.abs(Math.round((b - a) / 86400000));
        let value, label;
        if (unit === 'weeks') { value = (days / 7); label = 'weeks'; }
        else if (unit === 'months') { value = (days / 30.44); label = 'months (~30.44-day avg)'; }
        else { value = (days / 365.25); label = 'years (~365.25-day avg)'; }
        return { intent: 'date-math', text: `**${cleanNumber(value)} ${label}** — ${days} days between the two dates.` };
      }
    }
    return null;
  }

  /* --------------------------------- maths -------------------------------- */

  const MATH_FUNCTIONS = Object.freeze({
    sqrt: { min: 1, max: 1, run: (a) => Math.sqrt(a[0]) },
    cbrt: { min: 1, max: 1, run: (a) => Math.cbrt(a[0]) },
    abs: { min: 1, max: 1, run: (a) => Math.abs(a[0]) },
    sin: { min: 1, max: 1, run: (a) => Math.sin(a[0]) },
    cos: { min: 1, max: 1, run: (a) => Math.cos(a[0]) },
    tan: { min: 1, max: 1, run: (a) => Math.tan(a[0]) },
    asin: { min: 1, max: 1, run: (a) => Math.asin(a[0]) },
    acos: { min: 1, max: 1, run: (a) => Math.acos(a[0]) },
    atan: { min: 1, max: 1, run: (a) => Math.atan(a[0]) },
    ln: { min: 1, max: 1, run: (a) => Math.log(a[0]) },
    log: { min: 1, max: 2, run: (a) => a.length === 1 ? Math.log(a[0]) : Math.log(a[0]) / Math.log(a[1]) },
    log10: { min: 1, max: 1, run: (a) => Math.log10(a[0]) },
    log2: { min: 1, max: 1, run: (a) => Math.log2(a[0]) },
    exp: { min: 1, max: 1, run: (a) => Math.exp(a[0]) },
    floor: { min: 1, max: 1, run: (a) => Math.floor(a[0]) },
    ceil: { min: 1, max: 1, run: (a) => Math.ceil(a[0]) },
    round: { min: 1, max: 1, run: (a) => Math.round(a[0]) },
    min: { min: 1, max: Infinity, run: (a) => Math.min(...a) },
    max: { min: 1, max: Infinity, run: (a) => Math.max(...a) },
    sum: { min: 1, max: Infinity, run: (a) => a.reduce((total, n) => total + n, 0) },
    mean: { min: 1, max: Infinity, run: (a) => a.reduce((total, n) => total + n, 0) / a.length },
    median: { min: 1, max: Infinity, run: (a) => { const s = [...a].sort((x, y) => x - y); const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; } },
    product: { min: 1, max: Infinity, run: (a) => a.reduce((total, n) => total * n, 1) },
    pow: { min: 2, max: 2, run: (a) => Math.pow(a[0], a[1]) }
  });

  function tokenize(src) {
    const out = [];
    let i = 0;
    // Accept common calculator notation without treating arbitrary text as code.
    const s = String(src)
      .replace(/(\d)\s*[xX]\s*(\d)/g, '$1*$2')
      .replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (n) => n.replace(/,/g, ''))
      .replace(/×/g, '*')
      .replace(/÷/g, '/');
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      const rest = s.slice(i);
      const number = rest.match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?/i);
      if (number) {
        const value = Number(number[0]);
        if (!Number.isFinite(value)) throw new Error('bad number');
        out.push({ type: 'num', value });
        i += number[0].length;
        continue;
      }
      const ident = rest.match(/^[a-z]+/i);
      if (ident) {
        out.push({ type: 'ident', value: ident[0].toLowerCase() });
        i += ident[0].length;
        continue;
      }
      if ('+-*/^%(),!'.includes(ch)) {
        out.push({ type: ch === ',' ? 'comma' : ch === '(' || ch === ')' ? ch : 'op', op: ch });
        i++;
        continue;
      }
      throw new Error('unexpected character');
    }

    // Conventional implicit products: 2pi, 3(4+5), and (a)(b).
    const expanded = [];
    out.forEach((token, index) => {
      const prev = expanded[expanded.length - 1];
      const nextStartsValue = token.type === 'num' || token.type === 'ident' || token.type === '(';
      const prevEndsValue = prev && (prev.type === 'num' || prev.type === ')' ||
        (prev.type === 'ident' && (prev.value === 'pi' || prev.value === 'e')));
      const isFunctionCall = prev && prev.type === 'ident' && MATH_FUNCTIONS[prev.value] && token.type === '(';
      if (prevEndsValue && nextStartsValue && !isFunctionCall) expanded.push({ type: 'op', op: '*' });
      expanded.push(token);
    });
    return expanded;
  }

  function evaluate(src, variables) {
    const tokens = tokenize(src);
    const vars = variables || {};
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (type, op) => {
      const token = tokens[pos];
      if (!token || token.type !== type || (op && token.op !== op)) throw new Error('parse');
      pos++;
      return token;
    };

    function factorial(value) {
      if (value < 0 || !Number.isInteger(value) || value > 170) throw new Error('factorial domain');
      let result = 1;
      for (let n = 2; n <= value; n++) result *= n;
      return result;
    }

    function primary() {
      const token = peek();
      if (!token) throw new Error('parse');
      if (token.type === 'num') { pos++; return token.value; }
      if (token.type === 'op' && (token.op === '-' || token.op === '+')) {
        pos++;
        const value = expr(3);
        return token.op === '-' ? -value : value;
      }
      if (token.type === '(') {
        eat('(');
        const value = expr(0);
        eat(')');
        return value;
      }
      if (token.type === 'ident') {
        pos++;
        const name = token.value;
        if (peek() && peek().type === '(' && MATH_FUNCTIONS[name]) {
          eat('(');
          const args = [];
          if (!peek() || peek().type !== ')') {
            args.push(expr(0));
            while (peek() && peek().type === 'comma') {
              pos++;
              args.push(expr(0));
            }
          }
          eat(')');
          const fn = MATH_FUNCTIONS[name];
          if (args.length < fn.min || args.length > fn.max) throw new Error('argument count');
          return fn.run(args);
        }
        if (name === 'pi') return Math.PI;
        if (name === 'e') return Math.E;
        if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
      }
      throw new Error('parse');
    }

    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
    function expr(minPrec) {
      let left = primary();
      while (peek() && peek().type === 'op' && peek().op === '!') {
        pos++;
        left = factorial(left);
      }
      while (true) {
        const token = peek();
        if (!token || token.type !== 'op' || !precedence[token.op] || precedence[token.op] < minPrec) break;
        const op = token.op;
        pos++;
        const right = expr(precedence[op] + (op === '^' ? 0 : 1));
        if (op === '+') left += right;
        else if (op === '-') left -= right;
        else if (op === '*') left *= right;
        else if (op === '/') left /= right;
        else if (op === '%') left %= right;
        else if (op === '^') left = Math.pow(left, right);
      }
      return left;
    }

    const value = expr(0);
    if (pos !== tokens.length) throw new Error('parse');
    return value;
  }

  function cleanNumber(n) {
    if (!Number.isFinite(n)) return String(n);
    if (Math.abs(n) >= 1e12 || (Math.abs(n) > 0 && Math.abs(n) < 1e-8)) {
      return n.toExponential(10).replace(/(\.\d*?[1-9])0+e/, '$1e').replace(/\.0+e/, 'e');
    }
    return String(Math.round(n * 1e10) / 1e10);
  }

  function equationIntent(text) {
    let equation = norm(text)
      .replace(/^(?:please\s+)?(?:solve(?:\s+for\s+[a-z])?|find\s+[a-z]|calculate|compute|what is|does)\s*:?\s*/i, '')
      .replace(/\s+equals?\s+/g, '=')
      .replace(/[−–—]/g, '-')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/[×]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/(\d)\s*x\s*(\d)/g, '$1*$2');
    if ((equation.match(/=/g) || []).length !== 1) return null;
    const sides = equation.split('=').map((part) => part.trim());
    if (!sides[0] || !sides[1] || !/^[a-z0-9+\-*/^%().,\s×÷!=]+$/i.test(equation)) return null;
    const known = new Set([...Object.keys(MATH_FUNCTIONS), 'pi', 'e']);
    const symbols = Array.from(new Set((equation.match(/[a-z]+/gi) || []).map((name) => name.toLowerCase()).filter((name) => !known.has(name))));
    if (!symbols.length) {
      try {
        const left = evaluate(sides[0]);
        const right = evaluate(sides[1]);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return { intent: 'math-limit', text: 'That equation does not produce finite numeric values, so I cannot compare its sides reliably.' };
        return { intent: 'math', text: left === right ? `Both sides equal **${cleanNumber(left)}**, so the equation is true.` : `The sides are **${cleanNumber(left)}** and **${cleanNumber(right)}**, so the equation is false.` };
      } catch (e) { return null; }
    }
    if (symbols.length !== 1) return { intent: 'math-limit', text: 'I can only solve equations with one variable at a time. This one has multiple variables, so I will not guess a solution.' };
    const variable = symbols[0];
    if (!/^[a-z]$/.test(variable)) return { intent: 'math-limit', text: 'For symbolic equations, CAI currently supports one-letter variables and a limited linear/quadratic form. I will not guess how a longer identifier should be treated.' };
    const numberTerm = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
    const term = `(?:(?:${numberTerm})?\\s*\\*?\\s*${variable}(?:\\s*\\^\\s*[0-2])?|${numberTerm})`;
    const polynomial = new RegExp(`^[+\\-\\s]*${term}(?:\\s*[+\\-]\\s*${term})*$`);
    if (!sides.every((side) => polynomial.test(side))) {
      return { intent: 'math-limit', text: `I can evaluate arithmetic and solve one-variable linear or quadratic equations written as sums of constant, ${variable}, and ${variable}² terms. This equation uses a form outside that solver, so I will not guess a solution.` };
    }
    const at = (value) => evaluate(sides[0], { [variable]: value }) - evaluate(sides[1], { [variable]: value });
    try {
      const c = at(0);
      const f1 = at(1);
      const fm1 = at(-1);
      if (![c, f1, fm1].every(Number.isFinite)) throw new Error('non-finite');
      const a = (f1 + fm1 - 2 * c) / 2;
      const b = (f1 - fm1) / 2;
      const close = (left, right) => Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
      let roots;
      if (close(a, 0)) {
        if (close(b, 0)) return { intent: 'math', text: close(c, 0) ? 'Every value of the variable satisfies this equation.' : 'This equation has no solution.' };
        roots = [-c / b];
      } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return { intent: 'math', text: 'This quadratic has no real solutions. CAI does not report complex roots.' };
        const root = Math.sqrt(discriminant);
        roots = close(root, 0) ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)];
      }
      const shown = roots.map((value) => `**${variable} = ${cleanNumber(value)}**`);
      const doubleNewline = String.fromCharCode(10, 10);
      return { intent: 'math', text: `${shown.join(doubleNewline)}${doubleNewline}Solved as a one-variable ${close(a, 0) ? 'linear' : 'quadratic'} equation and checked by substitution.` };
    } catch (e) {
      return { intent: 'math-limit', text: 'I could not safely evaluate both sides of that equation. Check the syntax, then try a simpler one-variable linear or quadratic equation.' };
    }
  }

  function mathIntent(text) {
    const original = norm(text);
    // Percentages first: "15% of 240", "what is 20 percent of 80".
    let m = original.match(/(-?\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:of|off)\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      const pct = Number(m[1]);
      const base = Number(m[2]);
      const part = (pct / 100) * base;
      if (/off/.test(m[0])) return `**${cleanNumber(base - part)}** after ${m[1]}% off ${m[2]} (a discount of ${cleanNumber(part)}).`;
      return `**${cleanNumber(part)}** — ${m[1]}% of ${m[2]}.${String.fromCharCode(10, 10)}${m[2]} × ${m[1]} / 100 = ${cleanNumber(part)}`;
    }

    m = original.match(/from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/);
    if (m && /(percent|increase|decrease|change)/.test(original)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a === 0) return 'Percentage change from zero is undefined because the calculation divides by the starting value. I will not report a finite percentage.';
      const change = ((b - a) / Math.abs(a)) * 100;
      return `**${cleanNumber(change)}%** change from ${m[1]} to ${m[2]}.${String.fromCharCode(10, 10)}Formula: (${m[2]} − ${m[1]}) ÷ |${m[1]}| × 100`;
    }

    let candidate = original
      .replace(/^(what(?:'s| is)|calculate|compute|solve|how much is|evaluate|what is the value of)\s+/i, '')
      .replace(/[?=]+\s*$/, '')
      .replace(/\s+equals?$/i, '')
      .trim()
      .replace(/^the\s+/i, '')
      .replace(/[−–—]/g, '-')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3');

    // natural language aggregates: average/mean, sum, product, min, max, median
    const average = candidate.match(/^(?:average|mean)\s+of\s+(.+)$/);
    if (average) candidate = `mean(${average[1].replace(/\s+and\s+/g, ',')})`;
    const sumMatch = candidate.match(/^(?:sum|total)\s+of\s+(.+)$/);
    if (sumMatch) candidate = `sum(${sumMatch[1].replace(/\s+and\s+/g, ',')})`;
    const prodMatch = candidate.match(/^(?:product)\s+of\s+(.+)$/);
    if (prodMatch) candidate = `product(${prodMatch[1].replace(/\s+and\s+/g, ',')})`;
    const minMatch = candidate.match(/^min(?:imum)?\s+of\s+(.+)$/);
    if (minMatch) candidate = `min(${minMatch[1].replace(/\s+and\s+/g, ',')})`;
    const maxMatch = candidate.match(/^max(?:imum)?\s+of\s+(.+)$/);
    if (maxMatch) candidate = `max(${maxMatch[1].replace(/\s+and\s+/g, ',')})`;
    const medMatch = candidate.match(/^median\s+of\s+(.+)$/);
    if (medMatch) candidate = `median(${medMatch[1].replace(/\s+and\s+/g, ',')})`;

    candidate = candidate
      .replace(/\bsquare root of\s+(-?(?:\d+(?:\.\d+)?|pi|e))\b/g, 'sqrt($1)')
      .replace(/\bcube root of\s+(-?(?:\d+(?:\.\d+)?|pi|e))\b/g, 'cbrt($1)')
      .replace(/\bfactorial of\s+(\d+(?:\.\d+)?)/g, '$1!')
      .replace(/(\d+(?:\.\d+)?|\([^()]+\))\s+factorial\b/g, '$1!')
      .replace(/(\d+(?:\.\d+)?|\([^()]+\))\s+squared\b/g, '($1)^2')
      .replace(/(\d+(?:\.\d+)?|\([^()]+\))\s+cubed\b/g, '($1)^3')
      .replace(/\bto the power of\b/g, '^')
      .replace(/\bdivided by\b/g, '/')
      .replace(/\b(?:multiplied by|times)\b/g, '*')
      .replace(/\bplus\b/g, '+')
      .replace(/\bminus\b/g, '-')
      .replace(/(\d+(?:\.\d+)?)\s*percent\b/g, '($1/100)')
      .trim();

    if (!candidate || !/^[a-z0-9+\-*/^%().,!×÷\s]+$/i.test(candidate)) return null;
    if (!/[0-9]/.test(candidate) && !/\b(?:pi|e)\b/.test(candidate)) return null;
    if (!/[-+*/^%×÷!()]|(?:\d\s*x\s*\d|\bx\b)|\b(?:sqrt|cbrt|abs|sin|cos|tan|asin|acos|atan|ln|log|log10|log2|exp|floor|ceil|round|min|max|sum|mean|median|product|pi|e)\b/i.test(candidate)) return null;
    try {
      const value = evaluate(candidate);
      if (!Number.isFinite(value)) return 'That expression does not produce a finite number (for example, division by zero, an invalid function domain or numeric overflow), so I will not present it as a normal result.';
      const trigNote = /\b(?:sin|cos|tan|asin|acos|atan)\s*\(/.test(candidate) ? `${String.fromCharCode(10, 10)}Trigonometric functions use radians.` : '';
      return `**${cleanNumber(value)}**${String.fromCharCode(10, 10)}Expression: ${candidate.replace(/(\d)\s*x\s*(?=\d)/gi, '$1×').replace(/\*/g, '×')} = ${cleanNumber(value)}${trigNote}`;
    } catch (e) { return null; }
  }

  /* --------------------------------- units -------------------------------- */

  const UNITS = {
    // length → metres
    mm: { kind: 'length', f: 0.001 }, cm: { kind: 'length', f: 0.01 }, m: { kind: 'length', f: 1 },
    km: { kind: 'length', f: 1000 }, in: { kind: 'length', f: 0.0254 }, ft: { kind: 'length', f: 0.3048 },
    yd: { kind: 'length', f: 0.9144 }, mi: { kind: 'length', f: 1609.344 }, mile: { kind: 'length', f: 1609.344 },
    miles: { kind: 'length', f: 1609.344 }, inch: { kind: 'length', f: 0.0254 }, inches: { kind: 'length', f: 0.0254 },
    feet: { kind: 'length', f: 0.3048 }, foot: { kind: 'length', f: 0.3048 }, metre: { kind: 'length', f: 1 },
    metres: { kind: 'length', f: 1 }, meter: { kind: 'length', f: 1 }, meters: { kind: 'length', f: 1 },
    // mass → grams
    mg: { kind: 'mass', f: 0.001 }, g: { kind: 'mass', f: 1 }, kg: { kind: 'mass', f: 1000 },
    oz: { kind: 'mass', f: 28.349523125 }, lb: { kind: 'mass', f: 453.59237 }, lbs: { kind: 'mass', f: 453.59237 },
    pound: { kind: 'mass', f: 453.59237 }, pounds: { kind: 'mass', f: 453.59237 },
    stone: { kind: 'mass', f: 6350.29318 }, st: { kind: 'mass', f: 6350.29318 },
    // volume → litres
    ml: { kind: 'volume', f: 0.001 }, l: { kind: 'volume', f: 1 }, litre: { kind: 'volume', f: 1 },
    litres: { kind: 'volume', f: 1 }, liter: { kind: 'volume', f: 1 }, liters: { kind: 'volume', f: 1 },
    tsp: { kind: 'volume', f: 0.00492892159 }, tbsp: { kind: 'volume', f: 0.0147867648 },
    cup: { kind: 'volume', f: 0.2365882365 }, pint: { kind: 'volume', f: 0.473176473 },
    qt: { kind: 'volume', f: 0.946352946 }, quart: { kind: 'volume', f: 0.946352946 },
    gal: { kind: 'volume', f: 3.785411784 }, gallon: { kind: 'volume', f: 3.785411784 },
    gallons: { kind: 'volume', f: 3.785411784 },
    // data → bytes
    b: { kind: 'data', f: 1 }, kb: { kind: 'data', f: 1000 }, mb: { kind: 'data', f: 1e6 },
    gb: { kind: 'data', f: 1e9 }, tb: { kind: 'data', f: 1e12 }, kib: { kind: 'data', f: 1024 },
    mib: { kind: 'data', f: 1048576 }, gib: { kind: 'data', f: 1073741824 }, tib: { kind: 'data', f: 1099511627776 },
    // speed → m/s
    'km/h': { kind: 'speed', f: 0.277777778 }, kph: { kind: 'speed', f: 0.277777778 },
    mph: { kind: 'speed', f: 0.44704 }, 'm/s': { kind: 'speed', f: 1 },
    // area → m²
    'm2': { kind: 'area', f: 1 }, 'km2': { kind: 'area', f: 1e6 }, 'ft2': { kind: 'area', f: 0.09290304 },
    'sqft': { kind: 'area', f: 0.09290304 }, acre: { kind: 'area', f: 4046.8564224 },
    hectare: { kind: 'area', f: 10000 }, ha: { kind: 'area', f: 10000 },
    // time → seconds
    ms: { kind: 'time', f: 0.001 }, millisecond: { kind: 'time', f: 0.001 }, milliseconds: { kind: 'time', f: 0.001 },
    s: { kind: 'time', f: 1 }, sec: { kind: 'time', f: 1 }, secs: { kind: 'time', f: 1 }, second: { kind: 'time', f: 1 }, seconds: { kind: 'time', f: 1 },
    min: { kind: 'time', f: 60 }, mins: { kind: 'time', f: 60 }, minute: { kind: 'time', f: 60 }, minutes: { kind: 'time', f: 60 },
    h: { kind: 'time', f: 3600 }, hr: { kind: 'time', f: 3600 }, hrs: { kind: 'time', f: 3600 }, hour: { kind: 'time', f: 3600 }, hours: { kind: 'time', f: 3600 },
    day: { kind: 'time', f: 86400 }, days: { kind: 'time', f: 86400 },
    week: { kind: 'time', f: 604800 }, weeks: { kind: 'time', f: 604800 },
    month: { kind: 'time', f: 2629746 }, months: { kind: 'time', f: 2629746 },
    year: { kind: 'time', f: 31557600 }, years: { kind: 'time', f: 31557600 }
  };

  function temperature(value, from, to) {
    const c = from === 'c' ? value : from === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
  }

  // Shared by the agent: convert between units of the same kind, or return null.
  function convertUnits(value, from, to) {
    const a = UNITS[String(from || '').toLowerCase()];
    const b = UNITS[String(to || '').toLowerCase()];
    if (!a || !b || a.kind !== b.kind) return null;
    return { value: (Number(value) * a.f) / b.f, kind: a.kind };
  }

  function unitIntent(text) {
    const t = norm(text).replace(/degrees?|°|celsius|centigrade/g, (m) => (/fahrenheit/.test(m) ? 'f' : 'c'));
    // Support C, F, K short forms — Kelvin has no degree symbol
    let m = t.match(/(-?\d+(?:\.\d+)?)\s*(?:°\s*)?(f|c|k)\b(?:\s*(?:to|in|into)\s*)(?:°\s*)?(f|c|k)\b/);
    if (m) {
      const from = m[2].toLowerCase();
      const to = m[3].toLowerCase();
      if (from === to) return `${cleanNumber(Number(m[1]))} °${from.toUpperCase()} is the same in °${to.toUpperCase()}.`;
      const out = temperature(Number(m[1]), from, to);
      return `**${cleanNumber(out)} °${to.toUpperCase()}**\n\n\`${m[1]} °${from.toUpperCase()} → ${cleanNumber(out)} °${to.toUpperCase()}\``;
    }
    m = t.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees?\s*)?(fahrenheit|celsius|kelvin)\b(?:\s*(?:to|in|into)\s*)(?:degrees?\s*)?(fahrenheit|celsius|kelvin)\b/);
    if (m) {
      const key = (w) => (w[0] === 'f' ? 'f' : w[0] === 'c' ? 'c' : 'k');
      const from = key(m[2]); const to = key(m[3]);
      if (from === to) return `${cleanNumber(Number(m[1]))} °${from.toUpperCase()} is the same in °${to.toUpperCase()}.`;
      const out = temperature(Number(m[1]), from, to);
      return `**${cleanNumber(out)} °${to.toUpperCase()}**`;
    }
    m = t.match(/(-?\d+(?:\.\d+)?)\s*([a-z/]+)\s*(?:to|in|into|as)\s*([a-z/]+)/);
    if (!m) return null;
    const a = UNITS[m[2]]; const b = UNITS[m[3]];
    if (!a || !b || a.kind !== b.kind) return null;
    const value = Number(m[1]);
    const out = (value * a.f) / b.f;
    const kindNote = a.kind === 'data' ? 'Using decimal units (1 KB = 1,000 bytes; use KiB for 1,024).' : a.kind === 'time' ? 'Time conversion using 1 day = 24 h, 1 year ≈ 365.25 days.' : 'Exact conversion factors.';
    return `**${cleanNumber(out)} ${m[3]}**\n\n\`${cleanNumber(value)} ${m[2]} = ${cleanNumber(out)} ${m[3]}\`\n\n${kindNote}`;
  }

  /* ------------------------------- counting ------------------------------- */

  function countIntent(text) {
    const quoted = text.match(/[\"“']([\s\S]+)[\"”']/);
    if (!quoted) return null;
    if (!/(count|how many)\s+(words?|characters?|chars?|letters?)/i.test(text) && !/word count|character count/i.test(text)) return null;
    const body = quoted[1];
    const words = body.trim() ? body.trim().split(/\s+/).length : 0;
    const chars = body.length;
    const noSpaces = body.replace(/\s/g, '').length;
    return `That text has **${words} word${words === 1 ? '' : 's'}**, **${chars} characters** (including spaces) and **${noSpaces}** without spaces.`;
  }

  /* -------------------------- base conversion ------------------------- */
  function baseIntent(text) {
    const t = norm(text);
    // hex/bin/octal conversion: "255 to hex", "0xFF to decimal", "0b1010 in decimal", "convert 42 to binary"
    let m = t.match(/^(?:convert\s+)?(0x[0-9a-f]+|0b[01]+|0o[0-7]+|-?\d+)\s*(?:to|in|into|as)\s*(hex|hexadecimal|binary|bin|octal|oct|decimal|dec|base\s*16|base\s*2|base\s*10|base\s*8)\b/);
    if (!m) {
      // also handle "255 in hex" without 0x prefix detection already covered
      m = t.match(/^(?:what is\s+)?(0x[0-9a-f]+|0b[01]+|-?\d+)\s+in\s+(hex|hexadecimal|binary|bin|octal|oct|decimal|dec)\b/);
    }
    if (!m) return null;
    const src = m[1];
    let target = m[2].replace(/\s+/g, '');
    if (target === 'hexadecimal') target = 'hex';
    if (target === 'bin') target = 'binary';
    if (target === 'oct') target = 'octal';
    if (target === 'dec') target = 'decimal';
    if (target === 'base16') target = 'hex';
    if (target === 'base2') target = 'binary';
    if (target === 'base8') target = 'octal';
    if (target === 'base10') target = 'decimal';
    let value;
    try {
      if (/^0x/i.test(src)) value = parseInt(src, 16);
      else if (/^0b/i.test(src)) value = parseInt(src.slice(2), 2);
      else if (/^0o/i.test(src)) value = parseInt(src.slice(2), 8);
      else value = parseInt(src, 10);
      if (!Number.isFinite(value) || Math.abs(value) > 0x7fffffff) return null;
    } catch (e) { return null; }
    let out, label;
    if (target === 'hex') { out = (value < 0 ? '-' : '') + '0x' + Math.abs(value).toString(16).toUpperCase(); label = 'hexadecimal'; }
    else if (target === 'binary') { out = (value < 0 ? '-' : '') + '0b' + Math.abs(value).toString(2); label = 'binary'; }
    else if (target === 'octal') { out = (value < 0 ? '-' : '') + '0o' + Math.abs(value).toString(8); label = 'octal'; }
    else { out = String(value); label = 'decimal'; }
    const srcLabel = /^0x/i.test(src) ? 'hex' : /^0b/i.test(src) ? 'binary' : /^0o/i.test(src) ? 'octal' : 'decimal';
    return { intent: 'base', text: `**${out}** (${label})\n\n\`${src} (${srcLabel}) → ${out} (${label})\`` };
  }

  function textTransformIntent(text) {
    // text transforms on quoted strings: uppercase, lowercase, reverse, titlecase, sort
    const t = String(text || '');
    let m = t.match(/^\s*(uppercase|lowercase|titlecase|title case|reverse|sort|alphabetize)\s*[: ]\s*[\"“']([\s\S]+)[\"”']\s*$/i);
    if (!m) m = t.match(/^\s*(uppercase|lowercase|reverse)\s+[\"“']([\s\S]+)[\"”']\s*$/i);
    if (!m) {
      // without quotes: uppercase hello world
      const mq = t.match(/^\s*(uppercase|lowercase|reverse)\s+(.+)$/i);
      if (mq && mq[2].length < 200 && !/[?]$/.test(mq[2].trim())) {
        m = mq;
      }
    }
    if (!m) {
      // sort words: apple banana cherry
      const ms = t.match(/^\s*(?:sort|alphabetize)\s+(?:words:?)?\s*(.+)$/i);
      if (ms && ms[1].split(/\s+/).length >= 2 && ms[1].length < 300) {
        const words = ms[1].trim().split(/\s+/).filter(Boolean);
        if (words.length >= 2 && words.length <= 30) {
          const sorted = [...words].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
          return { intent: 'text-transform', text: `**${sorted.join(' ')}**\n\nSorted ${words.length} words alphabetically.` };
        }
      }
      return null;
    }
    const op = m[1].toLowerCase().replace(/\s+/g, '');
    const body = m[2];
    if (body.length > 800) return null;
    let out;
    if (op === 'uppercase') out = body.toUpperCase();
    else if (op === 'lowercase') out = body.toLowerCase();
    else if (op === 'titlecase' || op === 'title case') out = body.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    else if (op === 'reverse') out = body.split('').reverse().join('');
    else if (op === 'sort' || op === 'alphabetize') {
      const words = body.trim().split(/\s+/).filter(Boolean);
      out = [...words].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(' ');
    } else return null;
    return { intent: 'text-transform', text: `**${out}**\n\n\`${op}: \"${body.slice(0, 80)}\" → \"${out.slice(0, 80)}\"\`` };
  }

  function randomIntent(text) {
    const t = norm(text);
    if (/^(flip a coin|coin flip|flip coin)$/.test(t)) {
      const side = Math.random() < 0.5 ? 'Heads' : 'Tails';
      return { intent: 'random', text: `**${side}**\n\nCoin flip — random from your device (not cryptographic).` };
    }
    let m = t.match(/^(?:roll a dice|roll dice|roll a d(\d+)|roll d(\d+))$/);
    if (m) {
      const sides = Number(m[1] || m[2] || 6);
      if (sides < 2 || sides > 100) return { intent: 'random', text: 'Use a dice with 2–100 sides, e.g. “roll a d20”.' };
      const roll = Math.floor(Math.random() * sides) + 1;
      return { intent: 'random', text: `**${roll}**\n\nRolled a d${sides} (1–${sides}) — device RNG.` };
    }
    m = t.match(/^(?:random number between|random between|pick a number between)\s+(-?\d+)\s+and\s+(-?\d+)$/);
    if (!m) m = t.match(/^random (-?\d+)\s+(-?\d+)$/);
    if (m) {
      let a = Number(m[1]); let b = Number(m[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a > b) [a, b] = [b, a];
      if (b - a > 1000000) return { intent: 'random', text: 'Range too large — keep it within 1,000,000 numbers.' };
      const n = Math.floor(Math.random() * (b - a + 1)) + a;
      return { intent: 'random', text: `**${n}**\n\nRandom integer between ${a} and ${b} (inclusive).` };
    }
    if (/^pick (?:a )?random (?:item|word|choice) from/i.test(t)) {
      const items = text.split(/[,]/).map(s => s.trim()).filter(Boolean);
      if (items.length >= 2) {
        const pick = items[Math.floor(Math.random() * items.length)];
        return { intent: 'random', text: `**${pick}**\n\nPicked randomly from ${items.length} options.` };
      }
    }
    return null;
  }

  /* -------------------------- Eltes knowledge base ------------------------- */

  const KB = [
    {
      keys: ['quickstart', 'get started', 'start', 'first message', 'how do i use', 'how to use', 'begin'],
      a: `## Quickstart\n\n1. Open **auth.html** to connect where supported, or add a provider key in **Settings → API keys**.\n2. Return to **app.html** and pick a model from the switcher.\n3. Send a message. Hosted requests go directly to the provider unless you configured the optional proxy.\n\nNo key? Choose **Eltes CAI-1** for a local answer without a network call.`
    },
    {
      keys: ['api key', 'api keys', 'keys', 'byok', 'bring your own', 'connect provider', 'connect a provider', 'add key', 'paste key', 'openai key', 'anthropic key', 'deepseek key', 'connect a key', 'connect my key', 'where do i put'],
      a: `## Provider keys\n\nEltes is bring-your-own-key. In direct mode, keys are stored in this browser's \`eltes.settings.v1\` local-storage record and sent to the provider you select. If you configure the optional proxy, the key is sent transiently through that proxy to the provider; Eltes function code does not persist or log it.\n\n- OpenAI keys start \`sk-\` — create one at platform.openai.com/api-keys.\n- Anthropic keys start \`sk-ant-\` — console.anthropic.com/settings/keys.\n- DeepSeek keys look like \`sk-…\` — platform.deepseek.com/api_keys.\n\nAdd or replace them in **Settings → API keys**, or on the account page. Never share or commit a key.`
    },
    {
      keys: ['cors', 'failed to fetch', 'network error', 'blocked', 'preflight'],
      a: `## CORS and direct browser calls\n\nIn direct mode, the browser can read a provider response only when that provider permits the page's origin through CORS. Provider policies can change, so CAI does not promise that any particular endpoint will work from every browser.\n\nIf a request fails with a network/CORS error, check the provider's current browser-access policy, your connection and extensions. Alternatively, configure the optional Eltes proxy or a trusted OpenAI-compatible endpoint. GitHub Pages is static and cannot host the API routes.`
    },
    {
      keys: ['401', '429', '403', 'rate limit', 'quota', 'unauthorized', 'error', 'retry'],
      a: `## Reading provider errors\n\n- **401 / 403** — authentication or permission was rejected. Check the key and account access.\n- **429** — rate limit or billing/quota restriction; check the provider dashboard before retrying.\n- **404** — the selected model or endpoint may be unavailable to your account.\n- **400** — the provider rejected the request; the exact error message is the best clue.\n- **Network/CORS error** — check connectivity, browser extensions and the provider's current browser-access policy.\n\nThese codes are common patterns, not universal guarantees; providers may use different status codes. Eltes keeps failed turns with retry guidance.`
    },
    {
      keys: ['streaming', 'real-time', 'realtime', 'token streaming', 'live tokens'],
      a: `## Real model streaming\n\nWhen **Settings → General → Stream responses** is enabled, Eltes streams output from the selected provider. The request may go directly from this browser to the provider or through the optional proxy configured by the user.\n\n- Add the provider key in **Settings → API keys**. Direct mode sends it to the provider; proxy mode forwards it transiently through the selected backend.\n- Missing keys, provider rejections and network failures are shown as distinct errors with retry guidance.\n- Eltes does not include hosted-model credits. CAI runs locally without a key; hosted usage and charges follow the provider's terms.`
    },
    {
      keys: ['cai', 'on-device', 'local model', 'own model', 'custom model', 'eltes model', 'offline model'],
      a: `## Eltes CAI — our own models\n\nCAI runs inside this tab: no key, no network, no per-token cost.\n\n- **Eltes CAI-1** — bounded chat, model advice, arithmetic, common functions, simple equations, units, dates and Eltes help.\n- **Eltes CAI-1 Fast** — shorter answers with quicker pacing.\n- **Eltes CAI Docs** — a specialist for setup, keys, accounts, downloads and troubleshooting.\n\nCAI is a deterministic JavaScript rules-and-knowledge system, not a trained general-purpose neural model. It has a narrow scope, can still make mistakes, and has no network or live browsing. For questions outside its supported knowledge, it should say so rather than invent an answer.`
    },
    {
      keys: ['models', 'model list', 'catalogue', 'catalog', 'how many models', 'providers', 'how many providers'],
      a: `## The catalogue\n\nEltes ships **${M.MODELS.length} models across ${Object.keys(M.PROVIDERS).length} providers**: Anthropic, OpenAI, Google, Z.ai, DeepSeek, xAI, Qwen, Mistral, Groq, OpenRouter, NVIDIA NIM, Eltes CAI and your own custom endpoint.\n\nEvery hosted entry is a real API id. The on-device CAI family is labelled **On-device**. Nothing is simulated.`
    },
    {
      keys: ['which model should', 'best model', 'recommend', 'for coding', 'for code', 'cheap', 'cheapest', 'fastest', 'vision', 'long context', 'reasoning'],
      a: '' // built dynamically
    },
    {
      keys: ['account', 'sign up', 'signup', 'sign in', 'signin', 'login', 'profile', 'openai account', 'anthropic account', 'deepseek account', 'oauth'],
      a: `## Accounts and provider keys\n\nEltes accounts use **Supabase Auth** email/password sign-up and sign-in. The password is sent to the same-origin \`/api/auth\` endpoint and handled by Supabase; Eltes does not store it in browser storage. Session access/refresh tokens are held in HttpOnly same-site cookies. The signed-in display name is stored in the row-level-secured \`public.eltes_profiles\` table.\n\nAccount sign-in requires the Eltes Vercel deployment or the configured local Node server. GitHub Pages is static and cannot serve the account API. Provider API keys are separate from your Eltes account and remain in local \`eltes.settings.v1\`; connect keys in the workspace. Legacy local-only profiles are not real credentials and are removed.`
    },
    {
      keys: ['pricing', 'price', 'cost', 'free', 'subscription', 'plan'],
      a: `## Pricing\n\nEltes has no hosted subscription or included model credits. With BYOK, provider usage may incur charges under that provider's plan; direct or proxy routing does not change the provider's billing terms. Check the provider dashboard for current prices and limits.\n\nEltes's hosted plans are marked coming soon; no future price is promised here.`
    },
    {
      keys: ['privacy', 'storage', 'local storage', 'data', 'telemetry', 'tracking'],
      a: `## Privacy and storage\n\nChats, settings and provider API keys stay in this browser. Supabase Auth stores account credentials and an Eltes profile; sign-in tokens are held in HttpOnly same-site cookies, not localStorage. In direct mode, hosted prompts and keys go to the provider you selected. If you configure the optional proxy, the request also transits that backend/platform before reaching the provider; Eltes's function code does not persist or log the key.\n\n**Settings → Data** can export or clear local data. Review Supabase, provider, and backend privacy terms before sending sensitive content.`
    },
    {
      keys: ['download', 'downloads', 'windows', 'bat', 'install', 'offline', 'desktop', 'launcher'],
      a: `## Downloads and the Windows launcher\n\nThe **Downloads** section on the home page ships \`eltes-windows.zip\`. Unzip it anywhere and double-click **eltes.bat**.\n\nThe launcher finds Python (or Node), starts a small static server on \`127.0.0.1:4173\`, then opens your default browser at the workspace. It also installs a **Start menu** shortcut if you pass \`--shortcut\`. Eltes is still local-first: the launcher only serves files from the unzipped folder.`
    },
    {
      keys: ['tools', 'tool calling', 'agent', 'tool loop', 'search history', 'current time'],
      a: `## Agent mode\n\nAgent mode is on by default — the **Agent** chip in the composer toggles it (\`⌘K → Toggle tools\`). Eltes offers eight real functions: \`calculate\`, \`convert_units\` (including temperatures), \`percentage\`, \`date_math\`, \`current_time\`, \`search_history\`, \`define_term\` and \`web_search\`.\n\nHosted models ask for a tool and Eltes runs it, up to four rounds. With an Eltes CAI model there is no model to ask: a deterministic planner reads the message, picks a tool per clause, and can carry a result into the next step ("then multiply by 3"), up to six steps. The glossary and web search stay with the hosted loop.\n\nTool calls appear as cards with arguments, output and runtime. Everything except web search runs in this page.`
    },
    {
      keys: ['export', 'import', 'backup', 'share', 'json', 'markdown'],
      a: `## Export and import\n\n- **Export all** in Settings → Data writes a JSON backup; secret API keys are excluded.\n- The download icon in the top bar exports the open conversation as Markdown.\n- Import merges a previous JSON export; chats are normalised and invalid model ids fall back to your default.`
    },
    {
      keys: ['custom endpoint', 'ollama', 'vllm', 'litellm', 'proxy', 'self-host', 'self hosted', 'local server'],
      a: `## Custom endpoints\n\nSettings → API keys → **Custom endpoint** accepts an OpenAI-compatible base URL, such as a local Ollama or vLLM server, LiteLLM, or a gateway you control.\n\nSet the base URL, model id and optional token, then select **Custom endpoint** in the model switcher. Browser CORS, network exposure and authentication depend on that endpoint; do not expose an unauthenticated local service to the public internet.`
    },
    {
      keys: ['shortcut', 'keyboard', 'hotkey', 'command palette', 'cmd k'],
      a: `## Keyboard\n\n- \`⌘K\` / \`Ctrl K\` — command palette (chats and actions)\n- \`⌘B\` — collapse the sidebar\n- \`⌘,\` — settings\n- \`⌘Enter\` — send when the composer is in that mode\n- \`Esc\` — close a dialog or stop renaming\n\nChange the send key in Settings → General.`
    },
    {
      keys: ['docs', 'documentation', 'manual', 'guide'],
      a: `## Documentation\n\n**docs.html** covers quickstart, provider keys, CORS, the catalogue, CAI, the tool loop, accounts, privacy, downloads, pricing and self-hosting. Use the search box, or ask me about any of those directly.`
    },
    {
      keys: ['reset', 'clear data', 'delete everything', 'wipe', 'logout', 'sign out'],
      a: `## Clearing data\n\nSettings → Data → **Delete local data** removes chats, settings and keys from this browser after a confirmation.\n\nSigning out only removes the profile; chats and keys stay. Export first if you want a backup.`
    },
    {
      keys: ['troubleshoot', 'not working', 'not responding', 'bug', 'issue', 'fix'],
      a: `## Troubleshooting\n\n- **No reply?** Check you picked a model that matches a connected key, or switch to **Eltes CAI-1** (no key needed). For hosted models, verify the key in **Settings → API keys** and that streaming is enabled.\n- **Network/CORS error?** The provider may block browser calls. Try another provider or configure the optional proxy in **Settings → API keys → Optional Vercel/local backend**.\n- **Rate limit 429?** Wait briefly, check provider billing/quota, then retry or switch models.\n- **Custom endpoint not connecting?** Confirm the base URL ends with \`/v1\`, the model id matches the runner, and CORS allows your Eltes origin.\n- **Still stuck?** Open \`docs.html\` and search for your error message.`
    },
    {
      keys: ['slash', 'slash command', 'chat features', 'chat command', '/help', 'chat help', 'commands'],
      a: `## Chat features & slash commands\n\nEltes chat has built-in slash commands — no key needed:\n\n- \`/help\` — show all commands\n- \`/clear\` — clear current conversation\n- \`/export\` — download chat as Markdown\n- \`/model <id>\` — switch model (e.g. \`/model gpt-4o\`)\n- \`/calc <expr>\` — calculate (e.g. \`/calc sqrt(81) + 2*3\`)\n- \`/convert <value> <from> to <to>\` — units (e.g. \`/convert 5 mi to km\`)\n- \`/define <term>\` — glossary (e.g. \`/define RAG\`)\n- \`/time\` — current device time\n- \`/coin\` / \`/dice\` / \`/random 1 100\` — quick random utilities\n\nCAI also handles **base conversion** (\`255 to hex\`, \`0xFF to decimal\`, \`42 to binary\`), **text transforms** (\`uppercase \"hello\"\`, \`reverse \"eltes\"\`, \`sort apple banana\`) and **date math** (\`days between 2024-01-01 and 2024-02-01\`). Type \`/help\` in the composer to see them.`
    }
  ];

  const KB_SOURCES = Object.freeze({
    quickstart: 'docs.html#quickstart', 'api key': 'docs.html#api-keys', cors: 'docs.html#providers',
    '401': 'docs.html#providers', streaming: 'docs.html#providers', cai: 'docs.html#models',
    models: 'docs.html#models', 'which model should': 'docs.html#models', account: 'docs.html#accounts',
    pricing: 'docs.html#pricing', privacy: 'docs.html#privacy', download: 'docs.html#downloads',
    tools: 'docs.html#agent', export: 'docs.html#chat', 'custom endpoint': 'docs.html#custom-endpoint',
    shortcut: 'docs.html#shortcuts', docs: 'docs.html', reset: 'docs.html#settings', troubleshoot: 'docs.html#providers'
  });

  const GLOSSARY = {
    'llm': 'A **large language model** is a neural network trained to process and generate text. It learns statistical patterns from training data; it is not a verified database, and its answers can be wrong.',
    'token': 'A **token** is a unit produced by a model tokenizer, often a word piece, punctuation mark or other text fragment. Some providers bill by tokens; billing rules vary.',
    'context window': 'The **context window** is the maximum number of tokens a model can process in one request, including instructions, conversation and generated output. The limit and its exact accounting are model-specific.',
    'agent': 'An **agent** is a model given tools and a loop: it plans, calls a tool, reads the result and continues. Eltes caps the loop at four rounds.',
    'cors': '**CORS** is a browser rule: a page can only read a cross-origin response when the server sends the right headers. A missing header looks like a network failure, even though the request may have reached the API.',
    'byok': '**BYOK** means bring your own key. Your provider account is billed under its terms. In direct mode Eltes sends requests to that provider; with an optional proxy, requests also transit the configured backend.',
    'api key': 'An **API key** is a secret that identifies your account to a provider. Treat it like a password: never commit it, and rotate it if it leaks.',
    'streaming': '**Streaming** delivers pieces of a response while the provider generates it, rather than waiting for the complete response. Latency depends on the model, network and provider.',
    'ttft': '**TTFT** is time to first token — the delay before streaming starts. It is the number that decides whether an interface feels instant.',
    'temperature': '**Temperature** adjusts sampling randomness in models that support the setting. Lower values can make output more repeatable, but do not guarantee factual accuracy or identical answers.',
    'quantization': '**Quantization** stores weights at lower precision (8-bit, 4-bit) to cut memory and raise speed, at a small cost in quality.',
    'transformer': 'A **transformer** is the architecture behind modern LLMs. Self-attention lets each token weigh every other token in context.',
    'prompt injection': '**Prompt injection** is text that tries to override instructions — often hidden in a web page or document. Treat retrieved text as untrusted.',
    'vector database': 'A **vector database** stores embeddings and answers nearest-neighbour queries. It is the storage layer behind most RAG systems.',
    'mcp': '**MCP** (Model Context Protocol) is an open way to expose tools and data to models through a standard server interface.',
    'reasoning model': 'A **reasoning model** is marketed or configured to spend additional computation on multi-step tasks. Results, latency and cost vary by model; the label is not a correctness guarantee.',
    'hallucination': 'A **hallucination** is a confident statement the model cannot support. The fix is evidence in the prompt, not a louder instruction.',
    'temperature 0': 'A temperature setting of zero requests low-randomness sampling where supported. It does not guarantee identical output across systems or make answers factually reliable.',
    'ocr': '**OCR** turns pixels of text into characters. Vision models can often read images without a separate OCR pass.',
    'ssrf': '**SSRF** tricks a server into calling internal addresses. Any proxy that accepts user URLs needs an allowlist.',
    'inference': '**Inference** is running a trained model to produce output. Cost and latency come from inference, not training.',
    'multimodal': 'A **multimodal** model accepts more than text — usually images, sometimes audio or video. In Eltes, vision is a per-model tag.',
    'system prompt': 'The **system prompt** is the standing instruction that shapes tone and rules for a conversation. Hosted models receive it with every request.',
    'function calling': '**Function calling** (tool calling) lets a model request a structured tool invocation instead of guessing. Eltes caps tool rounds at four.',
    'open weights': '**Open weights** means a model’s learned parameters are available under the publisher’s terms. It does not necessarily mean open training data, unrestricted use or free hosting.',
    'tokenizer': 'A **tokenizer** converts text into the token IDs a model accepts. Its vocabulary is a set of token pieces, not a list of everything the model knows.',
    'vocabulary': 'A model **vocabulary** usually means the token pieces recognized by its tokenizer. A four-million-entry word list is not the same thing as a four-million-token model vocabulary, training data or verified knowledge, and adding entries alone does not teach a model facts.',
    'pretraining': '**Pretraining** is the initial training of model weights on a broad dataset, commonly by predicting text tokens. It requires a model design, training data and substantial compute; it is different from adding documents to a searchable knowledge base.',
    'training data': '**Training data** is the material used to adjust a model’s weights. Its quality, licensing, coverage and deduplication matter; putting text into a dataset does not ensure the model will recall it correctly.',
    'dataset': 'A **dataset** is an organized collection of examples or documents. For model work, it should have clear provenance, permitted usage, quality checks and a train/validation/test split.',
    'supervised fine-tuning': '**Supervised fine-tuning (SFT)** trains an existing model on input-and-target examples. It can teach response patterns; it does not guarantee factual correctness or reliably store a very large knowledge base.',
    'knowledge base': 'A **knowledge base** is a collection of organized information that can be searched. It can be updated without retraining a language model, but its answers depend on source quality and retrieval.',
    'retrieval': '**Retrieval** is searching a collection for items relevant to a query. Keyword retrieval is lightweight; semantic retrieval often uses embeddings. Neither guarantees that a result is correct.',
    'grounding': '**Grounding** means tying an answer to supplied evidence, such as a retrieved document or chat message. A grounded system should distinguish what the source says from unsupported inference.',
    'citation': 'A **citation** identifies the source supporting a claim. A citation is useful only when it points to a real, relevant source that actually supports that claim.',
    'abstention': '**Abstention** is declining to answer when evidence or confidence is insufficient. It is a reliability feature, not a promise that every other answer is correct.',
    'evaluation': '**Evaluation** measures a system against a defined set of questions and expected outcomes. A useful reliability test includes answerable, ambiguous, out-of-scope and adversarial cases.',
    'benchmark': 'A **benchmark** is a standardized set of tasks or measurements used to compare systems. Scores apply to that benchmark and do not guarantee performance on a user’s particular question.',
    'chunk': 'A retrieval **chunk** is a portion of a document indexed and returned as evidence. Chunk size and overlap affect which context can be found; the source should remain traceable.',
    'lora': '**LoRA** (low-rank adaptation) is a parameter-efficient fine-tuning method that trains small adapter weights alongside a frozen base model. It still requires a suitable base model, examples and compute.',
    'epoch': 'An **epoch** is one pass through the training examples. More epochs are not automatically better; too many can overfit the data.',
    'data leakage': '**Data leakage** occurs when evaluation information unintentionally influences training or model selection, making reported test performance overly optimistic.',
    'tf-idf': '**TF-IDF** scores terms by how frequent they are in a document and how uncommon they are across the collection. It is a simple lexical retrieval method, not a language model.',
    'top-k': '**Top-k retrieval** returns the k highest-ranked results for a query. A high rank is a relevance estimate, not proof that the result is evidence.',
    'rag': '**RAG (retrieval-augmented generation)** retrieves relevant documents at query time and grounds the answer in that evidence. It uses a curated corpus, retrieval with traceable sources, and abstains when evidence is weak. It is not the same as a tokenizer entry, and adding a vocabulary list does not create retrieval capability.',
    'embedding': 'An **embedding** is a dense numeric vector representing text, images or other data so that similar meanings are near each other in vector space. Embeddings power semantic search, clustering and many retrieval systems; they still require a curated corpus and evaluation.',
    'fine-tuning': '**Fine-tuning** continues training an existing model on a smaller, task-specific dataset. It can adapt tone, format and some behaviors, but does not reliably inject large new knowledge bases or guarantee factual correctness. Retrieval is often more reliable for changing facts.',
    'attention': '**Attention** is the mechanism in a transformer that lets each token weigh every other token in context. **Self-attention** computes those weights from the same sequence; it is powerful but computationally expensive at very long contexts.',
    'prompt': 'A **prompt** is the input text that instructs a model — including system, user and any retrieved context. Prompt clarity often matters more than model size for bounded tasks.',
    'overfitting': '**Overfitting** is when a model memorizes training details and generalizes poorly. It is managed with held-out evaluation, regularization and limiting training epochs.',
    'self-attention': '**Self-attention** is the core operation in a transformer where each position attends to all positions in the same sequence, learning contextual relationships between tokens.'
  };

  const GLOSSARY_ALIASES = {
    'retrieval augmented generation': 'rag',
    'retrieval-augmented generation': 'rag',
    'retrieval augmentation': 'rag',
    'rag': 'rag',
    'embeddings': 'embedding',
    'vector embeddings': 'embedding',
    'vector db': 'vector database',
    'context': 'context window',
    'context length': 'context window',
    'function calling': 'function calling',
    'tool calling': 'function calling',
    'tools': 'function calling',
    'key': 'api key',
    'api keys': 'api key',
    'model weights': 'open weights',
    'temperature zero': 'temperature 0',
    'token vocabulary': 'vocabulary',
    'tokenizer vocabulary': 'vocabulary',
    'word vocabulary': 'vocabulary',
    'supervised fine tuning': 'supervised fine-tuning',
    'fine tuning': 'fine-tuning',
    'low rank adaptation': 'lora',
    'low-rank adaptation': 'lora',
    'training corpus': 'training data',
    'test set': 'evaluation',
    'eval': 'evaluation',
    'tf idf': 'tf-idf',
    'retrieval-augmented generation': 'rag'
  };

  function modelAdvice(text) {
    const t = norm(text);
    const picks = [];
    const reasons = [];
    if (/code|coding|program|refactor|debug|typescript|python/.test(t)) {
      picks.push('claude-sonnet-5-5', 'gpt-6-sol', 'deepseek-v4-pro');
      reasons.push('code');
    }
    if (/cheap|cost|budget|free/.test(t)) {
      picks.push('eltes-cai-1', 'deepseek-flash', 'gpt-6-luna');
      reasons.push('cost');
    }
    if (/fast|latency|instant|quick/.test(t)) {
      picks.push('eltes-cai-1-fast', 'claude-haiku-5-5', 'gpt-6-luna');
      reasons.push('speed');
    }
    if (/vision|image|screenshot|diagram|photo/.test(t)) {
      picks.push('claude-sonnet-5-5', 'gemini-2-5-pro', 'deepseek-flash');
      reasons.push('vision');
    }
    if (/long|book|document|pdf|million|context/.test(t)) {
      picks.push('claude-sonnet-5-5', 'gemini-2-5-pro', 'deepseek-flash');
      reasons.push('long context');
    }
    if (/reason|math|hard|plan|research/.test(t)) {
      picks.push('claude-opus-5-5', 'gpt-6-sol', 'deepseek-v4-pro');
      reasons.push('reasoning');
    }
    const unique = Array.from(new Set(picks)).slice(0, 4);
    if (!unique.length) {
      return `## Choosing a model\n\nThere is no single best model — pick by the job:\n\n- **Code and long refactors:** Claude Sonnet 5.5 or GPT‑6 Sol.\n- **Hard reasoning:** Claude Opus 5.5 or GPT‑6 Sol.\n- **Cheap and long:** DeepSeek V4.1 Flash.\n- **Instant and offline:** Eltes CAI-1.\n\nTell me the job (code, cheap, fast, vision, long documents) and I will narrow it down.`;
    }
    const rows = unique.map((id) => {
      const m = M.byId(id);
      return `- **${m.name}** — ${m.blurb}${badge(m)}`;
    }).join('\n');
    return `## For ${list(reasons.slice(0, 2))}\n\n${rows}\n\nEltes CAI models need no key. The others need a connected provider; the picker marks every model that is ready.`;
  }

  function kbLookup(text) {
    const query = norm(text).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
    if (!query) return null;
    const broadSingles = new Set(['key', 'keys', 'start', 'data', 'error', 'free', 'install', 'help', 'local', 'model', 'account', 'provider']);
    let best = null;
    let bestScore = 0;
    KB.forEach((entry) => {
      let score = 0;
      entry.keys.forEach((rawKey) => {
        const key = norm(rawKey).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
        if (!key || !(` ${query} `).includes(` ${key} `)) return;
        const words = key.split(' ');
        if (words.length === 1 && broadSingles.has(key)) return;
        // Prefer specific phrases; broad single-word triggers are deliberately ignored.
        score = Math.max(score, words.length > 1 ? 4 + Math.min(words.length, 4) : 3);
      });
      if (score > bestScore) { bestScore = score; best = entry; }
    });
    if (!best || bestScore < 3) return null;
    return { ...best, score: bestScore, source: KB_SOURCES[best.keys[0]] || null };
  }

  function glossaryLookup(text) {
    const t = norm(text).replace(/[?!.]+$/, '').trim();
    let rawTerm = '';
    let m = t.match(/^(?:what(?:'s| is| are)\s+|define\s+|meaning of\s+|explain\s+)(.+)$/);
    if (m) rawTerm = m[1];
    if (!rawTerm) {
      m = t.match(/^what does\s+(.+?)\s+(?:mean|stand for)(?:\s+in\s+.+)?$/);
      if (m) rawTerm = m[1];
    }
    if (!rawTerm) return null;
    const term = rawTerm.replace(/^(?:an?\s+|the\s+)/, '').replace(/\s+(?:mean|means|stand for|in ai|in machine learning)$/, '').trim();
    if (GLOSSARY_ALIASES[term]) return { term, text: GLOSSARY[GLOSSARY_ALIASES[term]] };
    if (GLOSSARY[term]) return { term, text: GLOSSARY[term] };
    const found = Object.keys(GLOSSARY).find((k) => term === k || term === k + 's' || term.startsWith(k + ' '));
    if (found) return { term: found, text: GLOSSARY[found] };
    const alias = Object.keys(GLOSSARY_ALIASES).find((k) => term === k || term === k + 's');
    return alias ? { term, text: GLOSSARY[GLOSSARY_ALIASES[alias]] } : null;
  }

  function trainingIntent(text) {
    const t = norm(text);
    const mentionsEltesModel = /\b(eltes|etles|cai|custom ai|custom model|ai model|assistant|yourself)\b/.test(t);
    const asksToTrain = /\b(train|training|teach)\b|\bfine[\s-]*tune\w*\b/.test(t) && mentionsEltesModel;
    const asksHugeVocab = /(?:4[, ]?000[, ]?000|4000000|four million)/.test(t) && /vocab|word|token|train|knowledge/.test(t);
    return asksToTrain || asksHugeVocab;
  }

  function trainingAnswer() {
    return `## CAI training and the “4,000,000 vocabulary”\n\nI have not trained model weights. In this repository, CAI is a deterministic JavaScript rules-and-knowledge system; there is no neural checkpoint, training corpus or training pipeline to run.\n\nA tokenizer vocabulary is a set of text pieces, not a measure of how much verified knowledge a model has. A four-million-word list would not by itself teach meanings or stop wrong answers, and it is not a sensible substitute for training data.\n\nA practical reliability path is to use a suitable existing open-weight model, retrieve answers from curated documents with source references, abstain when evidence is weak, and evaluate it against a test set that includes ambiguous and out-of-scope questions. Fine-tuning can shape behavior but does not guarantee factual accuracy; retrieval is usually the better way to add changing facts.\n\nEltes CAI now handles **date arithmetic, time-unit conversions, median/sum/product phrasing and Kelvin correctly**, retrieves exact evidence from the active chat and is more conservative about unsupported questions. It is not a training run or a four-million-entry knowledge base.`;
  }

  function historyIntent(prompt, history) {
    const t = norm(prompt);
    const messages = (Array.isArray(history) ? history : []).filter((m) => m &&
      (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-24);
    if (!messages.length) return null;
    const userMessages = messages.filter((m) => m.role === 'user');
    const wantsLastQuestion = /\bwhat did i (?:just )?(?:ask|say|write)|\brepeat (?:my )?(?:last|previous) (?:question|message|prompt)|\bmy last prompt\b/.test(t) && !/\babout\b/.test(t);
    const wantsRecap = /\b(?:summari[sz]e|recap|what did we (?:talk|discuss)|what have we (?:talked|discussed|covered))\b/.test(t) && /\b(?:chat|conversation|here|so far|we)\b/.test(t);
    const wantsSearch = /\b(?:what did i (?:say|ask|write)|what did we decide|did i mention|find|search|remember|recall)\b/.test(t) && /\b(?:about|earlier|before|in this chat|in this conversation)\b/.test(t);
    if (wantsLastQuestion) {
      const last = userMessages[userMessages.length - 1];
      return { intent: 'chat-recall', text: last ? `Your most recent message in the context I can see was:\n\n> ${last.content.replace(/\s+/g, ' ').slice(0, 500)}` : 'I do not have an earlier user message in the context supplied to this turn.' };
    }
    if (wantsRecap) {
      const recent = userMessages.slice(-6);
      return { intent: 'chat-recap', text: recent.length
        ? `I can recap the user messages included in this active chat. These are excerpts, not an interpretation of decisions:\n\n${recent.map((m) => `- “${m.content.replace(/\s+/g, ' ').slice(0, 220)}”`).join('\n')}`
        : 'I do not have earlier user messages in the context supplied to this turn.' };
    }
    if (wantsSearch) {
      const about = t.match(/\babout\s+(.+?)(?:\s+in this (?:chat|conversation))?$/);
      const query = (about ? about[1] : t).replace(/\b(?:what|did|i|we|say|ask|asked|write|wrote|decide|mention|find|search|remember|recall|earlier|before|in|this|chat|conversation|the|a|an|about)\b/g, ' ');
      const terms = Array.from(new Set(query.match(/[a-z0-9]{3,}/g) || []));
      if (!terms.length) return { intent: 'chat-search', text: 'Please give me a more specific word or phrase to search for in the messages included in this chat.' };
      const matches = messages.map((m, index) => {
        const bodyTerms = new Set(norm(m.content).match(/[a-z0-9]+/g) || []);
        const hits = terms.filter((term) => bodyTerms.has(term)).length;
        return { m, index, hits };
      }).filter((item) => item.hits > 0).sort((a, b) => b.hits - a.hits || b.index - a.index).slice(0, 3);
      if (!matches.length) return { intent: 'chat-search', text: `I did not find “${terms.join(' ')}” in the active-chat messages supplied to me. I cannot search other saved chats from this local CAI turn.` };
      return { intent: 'chat-search', text: `Matching excerpts from this active chat (not confirmation that they represent a final decision):\n\n${matches.map(({ m }) => `- **${m.role === 'user' ? 'You' : 'Assistant'}:** “${m.content.replace(/\s+/g, ' ').slice(0, 280)}”`).join('\n')}` };
    }
    return null;
  }

  /* --------------------- safety / sensitive-domain fallbacks --------------------- */
  function sensitiveFallback(text) {
    const t = norm(text);
    const medical = /(antibiotic|dosage|diagnos|symptom|treatment|disease|infection|should i take|medical|doctor|prescri)/.test(t);
    const legal = /(lawsuit|sue|legal advice|contract|lawyer|attorney|copyright|liability|terms of service)/.test(t);
    const financial = /(invest|stock price|buy.*stock|portfolio|crypto.*invest|financial advice)/.test(t);
    if (medical || legal || financial) {
      const domain = medical ? 'medical' : legal ? 'legal' : 'financial';
      const who = medical ? 'a qualified medical professional' : legal ? 'a qualified legal professional' : 'a qualified financial professional';
      return {
        intent: 'fallback',
        text: `I want to be straight with you: **CAI-1 is a small on-device model**, and that ${domain} question is outside what I can answer reliably.\n\nI will not provide specific ${domain} advice or instructions. For ${domain} decisions, speak to ${who} and check authoritative sources.\n\nI am solid on:\n\n- Eltes setup, keys, accounts and downloads\n- picking a model from the catalogue\n- arithmetic, percentages, unit and date conversions\n- dates, definitions and short factual checks from the active chat\n\nSwitch to a hosted model in the picker for open-ended writing, code review or live information. The thread follows you, so nothing is lost.`
      };
    }
    return null;
  }

  /* ----------------------------- answer builder ---------------------------- */

  function buildAnswer(modelId, prompt, history, now) {
    const text = String(prompt || '').trim();
    const t = norm(text);
    const fast = modelId === 'eltes-cai-1-fast';
    const docsOnly = modelId === 'eltes-cai-docs';

    if (!text) {
      return { intent: 'empty', text: 'Ask me about Eltes, arithmetic, units, dates, AI terms or messages included in this chat. I answer on this device, so there is no network round trip.' };
    }

    if (trainingIntent(text)) return { intent: 'training-limits', text: trainingAnswer() };
    const chatContext = historyIntent(text, history);
    if (chatContext) return chatContext;

    if (hasAny(t, /^(hi|hey|hello|yo|good (morning|afternoon|evening)|howdy)\b/)) {
      const hour = now.getHours();
      const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
      return {
        intent: 'greeting',
        text: `Good ${part}. I am **Eltes CAI-1**, running on this device.\n\nI can help with:\n\n- Eltes itself — setup, keys, accounts, downloads\n- choosing between the ${M.MODELS.length} models in the catalogue\n- arithmetic, common math functions (sqrt, log, trig, median…), simple equations, unit conversions, date math\n- definitions from the built-in AI glossary (${Object.keys(GLOSSARY).length} terms)\n\nWhat do you want to work on?`
      };
    }

    if (hasAny(t, /^(thanks|thank you|ty|cheers|nice|great|cool)\b/)) {
      return { intent: 'thanks', text: 'You are welcome. I am here if you want to test another model, wire a key or dig through the docs.' };
    }

    if (hasAny(t, /^(bye|goodbye|see you|good night)\b/)) {
      return { intent: 'bye', text: 'See you. Your chats and keys stay in this browser until you clear them.' };
    }

    if (hasAny(t, /who are you|what are you|are you (chatgpt|claude|gpt|openai)|your name|what model are you/)) {
      return {
        intent: 'identity',
        text: `I am **Eltes CAI-1**, a deterministic on-device assistant built into this workspace. I am not ChatGPT, Claude or Gemini, and I do not call any API.\n\nMy strengths are narrow and honest: Eltes product help, model selection, arithmetic with scientific functions, units including time, dates and date arithmetic, and AI definitions. For open-ended writing or deep reasoning, switch to a hosted model — that is what the model picker is for.`
      };
    }

    if (hasAny(t, /what can you do|help me|capabilit|what do you know|how do you work|slash commands|chat features/)) {
      return {
        intent: 'capabilities',
        text: `**On this device, right now:**\n\n- Eltes setup, provider keys, accounts, CORS, downloads and troubleshooting\n- model recommendations from the live catalogue (${M.MODELS.length} models, ${Object.keys(M.PROVIDERS).length} providers)\n- calculator expressions, common math functions (sqrt, log, trig, median, sum…) and simple linear/quadratic equations\n- unit and temperature conversions (including Kelvin and time: seconds → years)\n- **base conversion** (hex/binary/octal/decimal: “255 to hex”, “0b1010 to decimal”)\n- **date arithmetic**: days between dates, date plus N days, days until a date\n- **text tools**: uppercase/lowercase/reverse/sort, word counts, base transforms\n- **random utilities**: flip a coin, roll a dice, random number between X and Y\n- **slash commands** in chat: \`/help\`, \`/calc\`, \`/convert\`, \`/define\`, \`/model\`, \`/time\`, \`/export\`\n- the current date and time in your timezone\n- short definitions from its built-in AI glossary (${Object.keys(GLOSSARY).length} terms, including RAG, embeddings, attention)\n- exact retrieval of relevant messages included in this chat\n\n**Out of range:** arbitrary symbolic math and proofs, live facts, news, browsing and long-form originality. CAI is rule-based and may miss intent or contain outdated product facts; verify important answers. Switch to a hosted model for those — Eltes keeps the same thread when you do.`
      };
    }

    if (hasAny(t, /what time|current time|what date|today'?s date|what day is it|time is it/)) {
      // date math should be checked before generic time, but generic time still wins for simple queries
      const dateMath = dateMathIntent(text, now);
      if (dateMath) return dateMath;
      return { intent: 'time', ...answerTime(now) };
    }

    // date arithmetic takes precedence over generic time when pattern matches
    const dateMathEarly = dateMathIntent(text, now);
    if (dateMathEarly) return dateMathEarly;

    const count = countIntent(text);
    if (count) return { intent: 'count', text: count };

    const units = unitIntent(text);
    if (units) return { intent: 'units', text: units };

    const base = baseIntent(text);
    if (base) return base;

    const tform = textTransformIntent(text);
    if (tform) return tform;

    const rand = randomIntent(text);
    if (rand) return rand;

    const equation = equationIntent(text);
    if (equation) return equation;

    const math = mathIntent(text);
    if (math) return { intent: 'math', text: math };

    if (/weather|news|stock price|score|who won|latest|today'?s headlines|browse|search the web/.test(t)) {
      return {
        intent: 'live',
        text: `I cannot check live information on my own — CAI has no network access, and I will not invent an answer.\n\nIf web search is set up, turn on the **Web** chip (or use \`/web <query>\`) and I will return live links with excerpts. You can also switch to a connected hosted model, or paste the source text here and I will help you reason about it.`
      };
    }

    if (modelAdviceTrigger(t)) {
      return { intent: 'advice', text: modelAdvice(text) + (fast ? '' : docsAnswerHint()) };
    }

    const kb = kbLookup(text);
    if (kb) {
      if (!kb.a) {
        return { intent: 'advice', text: modelAdvice(text) + (fast ? '' : docsAnswerHint()) };
      }
      const reference = kb.source ? `\n\n_Source: \`${kb.source}\`._` : '';
      if (docsOnly && kb.keys[0] === 'pricing') {
        return { intent: 'kb', text: kb.a + reference };
      }
      return { intent: 'kb', text: kb.a + reference + (fast ? '' : docsAnswerHint()) };
    }

    const gloss = glossaryLookup(text);
    if (gloss) {
      // Many entries already open with the canonical term in bold (e.g. **RAG …**).
      // Only add a heading when the entry does not, so acronyms keep their casing.
      const alreadyTitled = /^\*\*/.test(gloss.text);
      const heading = gloss.term.replace(/\b\w/g, (c) => c.toUpperCase());
      return { intent: 'glossary', text: alreadyTitled ? gloss.text : `**${heading}**\n\n${gloss.text}` };
    }

    if (docsOnly) {
      return {
        intent: 'fallback',
        text: `That is outside what I can answer accurately on this device.\n\nTry one of these, which I do know:\n\n- “How do I connect an OpenAI key?”\n- “Which models are on-device?”\n- “Where is the Windows download?”\n- “What does CORS mean?”\n\nOr switch to a hosted model for the open-ended question.`
      };
    }

    const sensitive = sensitiveFallback(text);
    if (sensitive) return sensitive;

    return {
      intent: 'fallback',
      text: `I want to be straight with you: **CAI-1 is a small on-device model**, and that question is outside what I can answer reliably.\n\nI am solid on:\n\n- Eltes setup, keys, accounts and downloads\n- picking a model from the catalogue\n- arithmetic, percentages, unit and date conversions\n- definitions and short factual checks from the active chat\n\nSwitch to a hosted model in the picker for open-ended writing, code review or live information. The thread follows you, so nothing is lost.`
    };
  }

  function docsAnswerHint() {
    return '\n\n_More detail in `docs.html`._';
  }

  function modelAdviceTrigger(t) {
    return /which model|what model|recommend|best model|model for|should i use/.test(t);
  }

  /* -------------------------------- streaming ------------------------------ */

  function chunker(text) {
    // Code-aware chunker: avoid splitting inside fenced blocks, and keep words intact
    const fences = [];
    let protectedText = text.replace(/```[\s\S]*?```/g, (m) => {
      const idx = fences.length;
      fences.push(m);
      return `\u0000F${idx}\u0000`;
    });
    const parts = protectedText.match(/\s*\S+/g) || [protectedText];
    const out = [];
    let buf = '';
    parts.forEach((p) => {
      buf += p;
      if (buf.length >= 18 || /[.!?\n]$/.test(buf.trim())) { out.push(buf); buf = ''; }
    });
    if (buf) out.push(buf);
    // restore fences, split large fences into their own chunks for smoother streaming
    const restored = [];
    out.forEach((chunk) => {
      if (chunk.includes('\u0000F')) {
        // split around fence markers
        const segs = chunk.split(/(\u0000F\d+\u0000)/g);
        segs.forEach((seg) => {
          const m = seg.match(/\u0000F(\d+)\u0000/);
          if (m) {
            const fence = fences[Number(m[1])];
            // emit fence in 3 pieces: open, body lines, close
            const lines = fence.split('\n');
            if (lines.length > 6) {
              restored.push(lines.slice(0, 2).join('\n') + '\n');
              for (let i = 2; i < lines.length - 2; i += 4) {
                restored.push(lines.slice(i, i + 4).join('\n') + '\n');
              }
              restored.push(lines.slice(-2).join('\n'));
            } else {
              restored.push(fence);
            }
          } else if (seg) restored.push(seg);
        });
      } else {
        restored.push(chunk);
      }
    });
    return restored;
  }

  async function stream({ modelId, messages, onToken, signal, onMeta }) {
    const model = modelId === 'eltes-cai-1-fast' ? 'eltes-cai-1-fast' : modelId === 'eltes-cai-docs' ? 'eltes-cai-docs' : 'eltes-cai-1';
    const history = (messages || []).slice(0, -1);
    const prompt = (messages && messages.length) ? messages[messages.length - 1].content : '';
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const now = new Date();

    await new Promise((r) => setTimeout(r, 35)); // local compute beat, not a fake network delay
    const { text, intent } = buildAnswer(model, prompt, history, now);
    const parts = chunker(text);
    const delay = model === 'eltes-cai-1-fast' ? 9 : 14;
    let full = '';
    let firstAt = 0;

    for (let i = 0; i < parts.length; i++) {
      if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      if (!firstAt) firstAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      full += parts[i];
      if (onToken) onToken(parts[i], full);
      if (onMeta && i === 0) onMeta({ intent });
      // slight rhythm variation keeps the stream readable rather than mechanical
      await new Promise((r) => setTimeout(r, delay + ((i * 7) % 11)));
    }

    return {
      text: full,
      intent,
      usage: { input: estimate(prompt), output: estimate(full) },
      firstTokenAt: firstAt,
      totalAt: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      started
    };
  }

  function estimate(s) { return Math.max(1, Math.round(String(s || '').length / 4)); }

  /* Public surface used by app.js and the docs playground */
  return {
    models: ['eltes-cai-1', 'eltes-cai-1-fast', 'eltes-cai-docs'],
    isLocal: (id) => ['eltes-cai-1', 'eltes-cai-1-fast', 'eltes-cai-docs'].includes(id),
    answer: (modelId, prompt) => buildAnswer(modelId, prompt, [], new Date()).text,
    build: buildAnswer,
    stream,
    evaluate,
    formatNumber: cleanNumber,
    temperature,
    convertUnits,
    kbEntries: KB.length,
    glossaryTerms: Object.keys(GLOSSARY).length
  };
})();
