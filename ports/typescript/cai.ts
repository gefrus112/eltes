/**
 * Eltes CAI engine — TypeScript port (strict, standard library only).
 *
 * Arithmetic, percentages, unit and temperature conversion, with an explicit
 * refusal for anything outside those rules. No network, no model weights.
 *
 *     npx tsc && node dist/cai.js ../vectors.tsv
 */

type Kind = "number" | "ident" | "op" | "open" | "close" | "comma";

interface Token {
    kind: Kind;
    value: number;
    text: string;
    op: string;
}

interface Answer {
    intent: string;
    text: string;
}

const FUNCTIONS: Record<string, [number, number]> = {
    sqrt: [1, 1], cbrt: [1, 1], abs: [1, 1],
    sin: [1, 1], cos: [1, 1], tan: [1, 1],
    asin: [1, 1], acos: [1, 1], atan: [1, 1],
    ln: [1, 1], log10: [1, 1], log2: [1, 1], exp: [1, 1],
    floor: [1, 1], ceil: [1, 1], round: [1, 1],
    log: [1, 2], pow: [2, 2],
    min: [1, Number.MAX_SAFE_INTEGER], max: [1, Number.MAX_SAFE_INTEGER],
    sum: [1, Number.MAX_SAFE_INTEGER], mean: [1, Number.MAX_SAFE_INTEGER],
    product: [1, Number.MAX_SAFE_INTEGER],
};

const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };

class ParseError extends Error {}

function token(kind: Kind, value: number, text: string, op: string): Token {
    return { kind, value, text, op };
}

function formatNumber(value: number): string {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";

    const magnitude = Math.abs(value);
    if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
        const raw = value.toExponential(10);
        const [mantissa, exponent] = raw.split("e");
        return `${mantissa.replace(/0+$/, "").replace(/\.$/, "")}e${exponent}`;
    }

    const rounded = Math.round(value * 1e10) / 1e10;
    if (rounded === 0) return "0";
    let text = rounded.toFixed(10);
    text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text;
}

function digitBefore(chars: string[], index: number): boolean {
    for (let cursor = index - 1; cursor >= 0; cursor--) {
        if (/\s/.test(chars[cursor])) continue;
        return /[0-9]/.test(chars[cursor]);
    }
    return false;
}

function digitAfter(chars: string[], index: number): boolean {
    for (let cursor = index + 1; cursor < chars.length; cursor++) {
        if (/\s/.test(chars[cursor])) continue;
        return /[0-9]/.test(chars[cursor]);
    }
    return false;
}

function prepare(source: string): string {
    let text = source
        .replace(/×/g, "*")
        .replace(/✕/g, "*")
        .replace(/✖/g, "*")
        .replace(/÷/g, "/")
        .replace(/−/g, "-")
        .replace(/–/g, "-")
        .replace(/—/g, "-")
        .replace(/²/g, "^2")
        .replace(/³/g, "^3");

    const chars = [...text];
    let out = "";
    for (let index = 0; index < chars.length; index++) {
        const ch = chars[index];
        if ((ch === "x" || ch === "X") && digitBefore(chars, index) && digitAfter(chars, index)) {
            out += "*";
        } else {
            out += ch;
        }
    }
    return out;
}

function tokenize(source: string): Token[] {
    const text = prepare(source);
    const tokens: Token[] = [];
    let index = 0;

    while (index < text.length) {
        const ch = text[index];

        if (/\s/.test(ch)) { index++; continue; }

        if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[index + 1] ?? ""))) {
            const start = index;
            while (index < text.length && /[0-9]/.test(text[index])) index++;
            if (text[index] === ".") {
                index++;
                while (index < text.length && /[0-9]/.test(text[index])) index++;
            }
            if (text[index] === "e" || text[index] === "E") {
                let probe = index + 1;
                if (text[probe] === "+" || text[probe] === "-") probe++;
                if (/[0-9]/.test(text[probe] ?? "")) {
                    while (probe < text.length && /[0-9]/.test(text[probe])) probe++;
                    index = probe;
                }
            }
            const literal = text.slice(start, index);
            const parsed = Number(literal);
            if (Number.isNaN(parsed) || !Number.isFinite(parsed)) throw new ParseError("bad number");
            tokens.push(token("number", parsed, "", ""));
            continue;
        }

        if (/[a-zA-Z]/.test(ch)) {
            const start = index;
            while (index < text.length && /[a-zA-Z]/.test(text[index])) index++;
            tokens.push(token("ident", 0, text.slice(start, index).toLowerCase(), ""));
            continue;
        }

        if ("+-*/^%!".includes(ch)) { tokens.push(token("op", 0, "", ch)); index++; continue; }
        if (ch === "(") { tokens.push(token("open", 0, "", "")); index++; continue; }
        if (ch === ")") { tokens.push(token("close", 0, "", "")); index++; continue; }
        if (ch === ",") { tokens.push(token("comma", 0, "", "")); index++; continue; }
        throw new ParseError("unexpected character");
    }

    const expanded: Token[] = [];
    for (const item of tokens) {
        const previous = expanded[expanded.length - 1];
        if (previous) {
            const ends = previous.kind === "number" || previous.kind === "close" ||
                (previous.kind === "ident" && (previous.text === "pi" || previous.text === "e"));
            const starts = item.kind === "number" || item.kind === "ident" || item.kind === "open";
            const isCall = previous.kind === "ident" && previous.text in FUNCTIONS && item.kind === "open";
            if (ends && starts && !isCall) expanded.push(token("op", 0, "", "*"));
        }
        expanded.push(item);
    }
    return expanded;
}

class Parser {
    private tokens: Token[];
    private position = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    parse(): number {
        const value = this.expression(0);
        if (this.position !== this.tokens.length) throw new ParseError("parse");
        return value;
    }

    private peek(): Token {
        if (this.position >= this.tokens.length) throw new ParseError("parse");
        return this.tokens[this.position];
    }

    private has(): boolean {
        return this.position < this.tokens.length;
    }

    private expression(minPrecedence: number): number {
        let left = this.primary();

        while (this.has() && this.tokens[this.position].kind === "op" && this.tokens[this.position].op === "!") {
            this.position++;
            left = factorial(left);
        }

        while (this.has() && this.tokens[this.position].kind === "op") {
            const op = this.tokens[this.position].op;
            const precedence = PRECEDENCE[op];
            if (precedence === undefined || precedence < minPrecedence) break;
            this.position++;
            const right = this.expression(op === "^" ? precedence : precedence + 1);
            switch (op) {
                case "+": left += right; break;
                case "-": left -= right; break;
                case "*": left *= right; break;
                case "/": left /= right; break;
                case "%": left %= right; break;
                case "^": left = Math.pow(left, right); break;
                default: throw new ParseError("parse");
            }
        }

        return left;
    }

    private primary(): number {
        const item = this.peek();
        this.position++;

        if (item.kind === "number") return item.value;

        if (item.kind === "op" && (item.op === "-" || item.op === "+")) {
            const value = this.expression(3);
            return item.op === "-" ? -value : value;
        }

        if (item.kind === "open") {
            const value = this.expression(0);
            if (!this.has() || this.tokens[this.position].kind !== "close") throw new ParseError("parse");
            this.position++;
            return value;
        }

        if (item.kind === "ident") {
            if (this.has() && this.tokens[this.position].kind === "open" && item.text in FUNCTIONS) {
                this.position++;
                const args: number[] = [];
                if (this.has() && this.tokens[this.position].kind !== "close") {
                    args.push(this.expression(0));
                    while (this.has() && this.tokens[this.position].kind === "comma") {
                        this.position++;
                        args.push(this.expression(0));
                    }
                }
                if (!this.has() || this.tokens[this.position].kind !== "close") throw new ParseError("parse");
                this.position++;
                return callFunction(item.text, args);
            }
            if (item.text === "pi") return Math.PI;
            if (item.text === "e") return Math.E;
        }

        throw new ParseError("parse");
    }
}

function factorial(value: number): number {
    if (value < 0 || value !== Math.floor(value) || value > 170) throw new ParseError("factorial domain");
    let result = 1;
    for (let step = 2; step <= value; step++) result *= step;
    return result;
}

function callFunction(name: string, args: number[]): number {
    const bounds = FUNCTIONS[name];
    if (!bounds) throw new ParseError("unknown function");
    if (args.length < bounds[0] || args.length > bounds[1]) throw new ParseError("argument count");

    switch (name) {
        case "sqrt": return Math.sqrt(args[0]);
        case "cbrt": return Math.cbrt(args[0]);
        case "abs": return Math.abs(args[0]);
        case "sin": return Math.sin(args[0]);
        case "cos": return Math.cos(args[0]);
        case "tan": return Math.tan(args[0]);
        case "asin": return Math.asin(args[0]);
        case "acos": return Math.acos(args[0]);
        case "atan": return Math.atan(args[0]);
        case "ln": return Math.log(args[0]);
        case "log10": return Math.log10(args[0]);
        case "log2": return Math.log2(args[0]);
        case "exp": return Math.exp(args[0]);
        case "floor": return Math.floor(args[0]);
        case "ceil": return Math.ceil(args[0]);
        case "round": return Math.round(args[0]);
        case "log": return args.length === 1 ? Math.log(args[0]) : Math.log(args[0]) / Math.log(args[1]);
        case "pow": return Math.pow(args[0], args[1]);
        case "min": return Math.min(...args);
        case "max": return Math.max(...args);
        case "sum": return args.reduce((total, value) => total + value, 0);
        case "mean": return args.reduce((total, value) => total + value, 0) / args.length;
        case "product": return args.reduce((total, value) => total * value, 1);
        default: throw new ParseError("unknown function");
    }
}

function evaluate(source: string): number {
    const tokens = tokenize(source);
    if (tokens.length === 0) throw new ParseError("parse");
    return new Parser(tokens).parse();
}

interface Unit {
    kind: string;
    factor: number;
}

const UNITS: Record<string, Unit> = {
    mm: { kind: "length", factor: 0.001 }, cm: { kind: "length", factor: 0.01 },
    m: { kind: "length", factor: 1 }, metre: { kind: "length", factor: 1 },
    metres: { kind: "length", factor: 1 }, meter: { kind: "length", factor: 1 },
    meters: { kind: "length", factor: 1 }, km: { kind: "length", factor: 1000 },
    in: { kind: "length", factor: 0.0254 }, inch: { kind: "length", factor: 0.0254 },
    inches: { kind: "length", factor: 0.0254 }, ft: { kind: "length", factor: 0.3048 },
    feet: { kind: "length", factor: 0.3048 }, foot: { kind: "length", factor: 0.3048 },
    yd: { kind: "length", factor: 0.9144 }, mi: { kind: "length", factor: 1609.344 },
    mile: { kind: "length", factor: 1609.344 }, miles: { kind: "length", factor: 1609.344 },
    mg: { kind: "mass", factor: 0.001 }, g: { kind: "mass", factor: 1 },
    kg: { kind: "mass", factor: 1000 }, oz: { kind: "mass", factor: 28.349523125 },
    lb: { kind: "mass", factor: 453.59237 }, lbs: { kind: "mass", factor: 453.59237 },
    pound: { kind: "mass", factor: 453.59237 }, pounds: { kind: "mass", factor: 453.59237 },
    stone: { kind: "mass", factor: 6350.29318 }, st: { kind: "mass", factor: 6350.29318 },
    ml: { kind: "volume", factor: 0.001 }, l: { kind: "volume", factor: 1 },
    litre: { kind: "volume", factor: 1 }, litres: { kind: "volume", factor: 1 },
    liter: { kind: "volume", factor: 1 }, liters: { kind: "volume", factor: 1 },
    tsp: { kind: "volume", factor: 0.00492892159 }, tbsp: { kind: "volume", factor: 0.0147867648 },
    cup: { kind: "volume", factor: 0.2365882365 }, pint: { kind: "volume", factor: 0.473176473 },
    qt: { kind: "volume", factor: 0.946352946 }, quart: { kind: "volume", factor: 0.946352946 },
    gal: { kind: "volume", factor: 3.785411784 }, gallon: { kind: "volume", factor: 3.785411784 },
    gallons: { kind: "volume", factor: 3.785411784 },
    b: { kind: "data", factor: 1 }, kb: { kind: "data", factor: 1e3 },
    mb: { kind: "data", factor: 1e6 }, gb: { kind: "data", factor: 1e9 },
    tb: { kind: "data", factor: 1e12 }, kib: { kind: "data", factor: 1024 },
    mib: { kind: "data", factor: 1048576 }, gib: { kind: "data", factor: 1073741824 },
    "km/h": { kind: "speed", factor: 0.277777778 }, kph: { kind: "speed", factor: 0.277777778 },
    mph: { kind: "speed", factor: 0.44704 }, "m/s": { kind: "speed", factor: 1 },
    m2: { kind: "area", factor: 1 }, km2: { kind: "area", factor: 1e6 },
    ft2: { kind: "area", factor: 0.09290304 }, sqft: { kind: "area", factor: 0.09290304 },
    acre: { kind: "area", factor: 4046.8564224 }, hectare: { kind: "area", factor: 10000 },
    ha: { kind: "area", factor: 10000 },
};

function temperature(value: number, from: string, to: string): number {
    const celsius = from === "c" ? value : from === "f" ? ((value - 32) * 5) / 9 : value - 273.15;
    if (to === "c") return celsius;
    if (to === "f") return (celsius * 9) / 5 + 32;
    return celsius + 273.15;
}

function normalize(text: string): string {
    const out = text
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[−–—]/g, "-")
        .replace(/²/g, "^2")
        .replace(/³/g, "^3");
    return out.trim().replace(/\s+/g, " ");
}

function isNumber(word: string): boolean {
    return /^[+-]?([0-9]*\.?[0-9]+)([eE][+-]?[0-9]+)?$/.test(word);
}

function splitNumber(word: string): [number, string] | null {
    const match = /^([+-]?[0-9]*\.?[0-9]+)(.*)$/s.exec(word);
    if (!match) return null;
    return [parseFloat(match[1]), match[2]];
}

function percentIntent(text: string): string | null {
    const words = text.replace(/%/g, " percent ").split(/\s+/).filter(Boolean);

    for (let index = 0; index + 3 < words.length; index++) {
        if (words[index + 1] !== "percent") continue;
        if (words[index + 2] !== "of" && words[index + 2] !== "off") continue;
        if (!isNumber(words[index]) || !isNumber(words[index + 3])) continue;

        const percent = parseFloat(words[index]);
        const base = parseFloat(words[index + 3]);
        const part = (percent / 100) * base;

        if (words[index + 2] === "off") {
            return `**${formatNumber(base - part)}** after ${formatNumber(percent)}% off ` +
                `${formatNumber(base)} (a discount of ${formatNumber(part)}).`;
        }
        return `**${formatNumber(part)}** — ${formatNumber(percent)}% of ${formatNumber(base)}.\n\n` +
            `${formatNumber(base)} × ${formatNumber(percent)} / 100 = ${formatNumber(part)}`;
    }

    if (/percent|increase|decrease|change/.test(text)) {
        for (let index = 0; index + 3 < words.length; index++) {
            if (words[index] !== "from" || words[index + 2] !== "to") continue;
            if (!isNumber(words[index + 1]) || !isNumber(words[index + 3])) continue;

            const start = parseFloat(words[index + 1]);
            const end = parseFloat(words[index + 3]);
            if (start === 0) {
                return "Percentage change from zero is undefined because the calculation divides " +
                    "by the starting value. I will not report a finite percentage.";
            }
            const change = ((end - start) / Math.abs(start)) * 100;
            return `**${formatNumber(change)}%** change from ${formatNumber(start)} to ` +
                `${formatNumber(end)}.\n\nFormula: (${formatNumber(end)} − ${formatNumber(start)}) ÷ ` +
                `|${formatNumber(start)}| × 100`;
        }
    }

    return null;
}

function unitIntent(text: string): string | null {
    const prepared = text
        .replace(/°/g, " ")
        .replace(/degrees/g, " ")
        .replace(/degree/g, " ")
        .replace(/celsius/g, " c ")
        .replace(/centigrade/g, " c ")
        .replace(/fahrenheit/g, " f ")
        .replace(/kelvin/g, " k ");
    const words = prepared.split(/\s+/).filter(Boolean);

    for (let index = 0; index < words.length; index++) {
        const split = splitNumber(words[index]);
        if (!split) continue;
        const value = split[0];

        let source: string;
        let cursor: number;
        if (split[1] === "") {
            if (index + 1 >= words.length) continue;
            source = words[index + 1];
            cursor = index + 2;
        } else {
            source = split[1];
            cursor = index + 1;
        }
        if (cursor + 1 >= words.length) continue;
        const connector = words[cursor];
        if (connector !== "to" && connector !== "in" && connector !== "into" && connector !== "as") continue;
        const target = words[cursor + 1];

        if (source.length === 1 && target.length === 1 && "cfk".includes(source) && "cfk".includes(target)) {
            if (source === target) {
                return `${formatNumber(value)} °${source.toUpperCase()} is the same in °${target.toUpperCase()}.`;
            }
            const converted = temperature(value, source, target);
            return `**${formatNumber(converted)} °${target.toUpperCase()}**\n\n\`` +
                `${formatNumber(value)} °${source.toUpperCase()} → ${formatNumber(converted)} ` +
                `°${target.toUpperCase()}\``;
        }

        const from = UNITS[source];
        const to = UNITS[target];
        if (!from || !to || from.kind !== to.kind) continue;

        const converted = (value * from.factor) / to.factor;
        const note = from.kind === "data"
            ? "Using decimal units (1 KB = 1,000 bytes)."
            : "Exact conversion factors.";
        return `**${formatNumber(converted)} ${target}**\n\n\`` +
            `${formatNumber(value)} ${source} = ${formatNumber(converted)} ${target}\`\n\n${note}`;
    }

    return null;
}

const PREFIXES = [
    "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
    "solve ", "evaluate ", "how much is ",
];

function mathIntent(text: string): Answer | null {
    let candidate = text;
    for (const prefix of PREFIXES) {
        if (candidate.startsWith(prefix)) {
            candidate = candidate.slice(prefix.length);
            break;
        }
    }
    candidate = candidate.trim().replace(/[?=]+$/, "").trim();
    if (candidate.startsWith("the ")) candidate = candidate.slice(4);

    if (candidate.startsWith("square root of ")) {
        candidate = `sqrt(${candidate.slice("square root of ".length)})`;
    } else if (candidate.startsWith("cube root of ")) {
        candidate = `cbrt(${candidate.slice("cube root of ".length)})`;
    } else if (candidate.startsWith("factorial of ")) {
        candidate = `${candidate.slice("factorial of ".length)}!`;
    } else if (candidate.endsWith(" squared")) {
        candidate = `(${candidate.slice(0, -" squared".length)})^2`;
    } else if (candidate.endsWith(" cubed")) {
        candidate = `(${candidate.slice(0, -" cubed".length)})^3`;
    }

    const padded = ` ${candidate} `
        .replace(/ to the power of /g, "^")
        .replace(/ divided by /g, "/")
        .replace(/ multiplied by /g, "*")
        .replace(/ times /g, "*")
        .replace(/ plus /g, "+")
        .replace(/ minus /g, "-")
        .replace(/ factorial/g, "!");
    candidate = padded.trim();

    if (!candidate) return null;
    if (/[^a-zA-Z0-9+\-*/^%(),!. ]/.test(candidate)) return null;

    const hasDigit = /[0-9]/.test(candidate);
    const hasConstant = candidate.split(/[^a-zA-Z]+/).some(word => word === "pi" || word === "e");
    if (!hasDigit && !hasConstant) return null;

    let value: number;
    try {
        value = evaluate(candidate);
    } catch {
        return null;
    }

    if (!Number.isFinite(value)) {
        return {
            intent: "math-limit",
            text: "That expression does not produce a finite number (for example, division by " +
                "zero, an invalid function domain or numeric overflow), so I will not present it " +
                "as a normal result.",
        };
    }

    const shown = formatNumber(value);
    const display = candidate.replace(/\*/g, "×");
    const trig = /sin\(|cos\(|tan\(|asin\(|acos\(|atan\(/.test(candidate);
    return {
        intent: "math",
        text: `**${shown}**\n\nExpression: ${display} = ${shown}` +
            (trig ? "\n\nTrigonometric functions use radians." : ""),
    };
}

const LIVE = [
    "weather", "news", "stock price", "score", "who won", "latest",
    "headlines", "browse", "search the web",
];

function answer(prompt: string): Answer {
    const text = prompt.trim();
    if (!text) {
        return {
            intent: "empty",
            text: "Ask me for arithmetic, percentages or a unit conversion. I answer on this device, " +
                "so there is no network round trip.",
        };
    }

    const lowered = normalize(text);

    const percent = percentIntent(lowered);
    if (percent) return { intent: "percent", text: percent };

    const units = unitIntent(lowered);
    if (units) return { intent: "units", text: units };

    const math = mathIntent(lowered);
    if (math) return math;

    for (const word of LIVE) {
        if (lowered.includes(word)) {
            return {
                intent: "live",
                text: "I cannot check live information — this engine has no network access, and it " +
                    "will not invent an answer.\n\nSwitch to a connected hosted model for current " +
                    "facts, or paste the source text here and I will help you reason about it.",
            };
        }
    }

    return {
        intent: "fallback",
        text: "I want to be straight with you: **this is a small on-device engine**, and that " +
            "question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic " +
            "and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for " +
            "open-ended writing, code review or live information.",
    };
}

declare const require: any;
declare const module: any;
declare const process: any;
declare const __dirname: string;

function runVectors(path: string): number {
    const fs = require("node:fs");
    const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
    const failures: string[] = [];
    let checked = 0;

    lines.forEach((line: string, offset: number) => {
        const number = offset + 1;
        if (!line.trim() || line.startsWith("#")) return;
        const fields = line.split("\t");
        if (fields.length < 3) {
            failures.push(`line ${number}: expected at least 3 columns`);
            return;
        }
        checked++;

        if (fields[0] === "eval") {
            let value: number;
            try {
                value = evaluate(fields[1]);
            } catch {
                failures.push(`line ${number}: '${fields[1]}' -> error`);
                return;
            }
            const expected = Number(fields[2]);
            const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
            if (Math.abs(value - expected) > tolerance) {
                failures.push(`line ${number}: '${fields[1]}' -> ${value}, wanted ${fields[2]}`);
            }
            return;
        }

        const result = answer(fields[1]);
        if (result.intent !== fields[2]) {
            failures.push(`line ${number}: '${fields[1]}' -> intent ${result.intent}, wanted ${fields[2]}`);
            return;
        }
        const fragments = (fields[3] ?? "").split("|").filter(Boolean);
        for (const fragment of fragments) {
            if (!result.text.includes(fragment)) {
                failures.push(`line ${number}: '${fields[1]}' -> text missing '${fragment}'`);
                break;
            }
        }
    });

    if (failures.length > 0) {
        failures.forEach(failure => console.log(`FAIL ${failure}`));
        console.log(`${failures.length} failure(s) out of ${checked} case(s)`);
        return 1;
    }
    console.log(`ok: ${checked} cases`);
    return 0;
}

module.exports = { answer, evaluate, formatNumber, runVectors };

if (require.main === module) {
    const target = process.argv[2] ?? `${__dirname}/../vectors.tsv`;
    process.exit(runVectors(target));
}
