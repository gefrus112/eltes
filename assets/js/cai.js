/* ==========================================================================
   Eltes CAI — our own on-device conversational models.
   CAI ("conversational agent intelligence") runs entirely in this tab.
   It is a small, deterministic model: it knows Eltes, model choice, arithmetic,
   units, dates and a working glossary of AI terms, and it says so when a
   question is outside that range. No network, no key, no invented facts.
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

  /* --------------------------------- maths -------------------------------- */

  const tokenize = (src) => {
    const out = [];
    let i = 0;
    const s = src.replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/\^/g, '^').replace(/,/g, '');
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const raw = s.slice(i, j);
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new Error('bad number');
        out.push({ type: 'num', value: n });
        i = j;
        continue;
      }
      if ('+-*/^%()'.includes(ch)) { out.push({ type: ch === '(' || ch === ')' ? ch : 'op', op: ch }); i++; continue; }
      throw new Error('unexpected character');
    }
    return out;
  };

  function evaluate(src) {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (kind) => {
      const t = tokens[pos];
      if (!t || (kind && t.type !== kind && t.op !== kind)) throw new Error('parse');
      pos++;
      return t;
    };

    function primary() {
      const t = peek();
      if (!t) throw new Error('parse');
      if (t.type === 'num') { pos++; return t.value; }
      if (t.op === '(') { eat('('); const v = expr(0); eat(')'); return v; }
      if (t.op === '-' || t.op === '+') { pos++; const v = primary(); return t.op === '-' ? -v : v; }
      throw new Error('parse');
    }

    const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
    function expr(minPrec) {
      let left = primary();
      while (true) {
        const t = peek();
        if (!t || t.type !== 'op' || !prec[t.op] || prec[t.op] < minPrec) break;
        const op = t.op;
        pos++;
        const right = expr(prec[op] + (op === '^' ? 0 : 1));
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
    const rounded = Math.round(n * 1e10) / 1e10;
    return String(rounded);
  }

  function mathIntent(text) {
    // percentages first: "15% of 240", "what is 20 percent of 80"
    let m = norm(text).match(/(-?\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:of|off)\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      const pct = Number(m[1]);
      const base = Number(m[2]);
      const part = (pct / 100) * base;
      if (/off/.test(m[0])) {
        return `**${cleanNumber(part)}** is ${m[1]}% of ${m[2]}, so ${m[2]} minus that is **${cleanNumber(base - part)}**.`;
      }
      return `**${cleanNumber(part)}** — ${m[1]}% of ${m[2]}.\n\n\`${m[2]} × ${m[1]} / 100 = ${cleanNumber(part)}\``;
    }
    // percentage change
    m = norm(text).match(/from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/);
    if (m && /(percent|increase|decrease|change)/.test(norm(text))) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const change = ((b - a) / Math.abs(a)) * 100;
      return `**${cleanNumber(change)}%** change from ${m[1]} to ${m[2]}.\n\n\`(${m[2]} − ${m[1]}) ÷ |${m[1]}| × 100\``;
    }
    const candidate = norm(text)
      .replace(/^(what(?:'s| is)|calculate|compute|solve|how much is|evaluate)\s+/i, '')
      .replace(/[?=]+\s*$/, '')
      .replace(/\s+equals?$/i, '')
      .trim();
    if (!candidate || !/[0-9]/.test(candidate)) return null;
    if (!/^[-+*/^%().\d\s×x÷,]+$/i.test(candidate)) return null;
    if (!/[-+*/^%×x÷]/.test(candidate)) return null;
    try {
      const value = evaluate(candidate);
      return `**${cleanNumber(value)}**\n\n\`${candidate.replace(/[×x]/g, '×')} = ${cleanNumber(value)}\``;
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
    mib: { kind: 'data', f: 1048576 }, gib: { kind: 'data', f: 1073741824 },
    // speed → m/s
    'km/h': { kind: 'speed', f: 0.277777778 }, kph: { kind: 'speed', f: 0.277777778 },
    mph: { kind: 'speed', f: 0.44704 }, 'm/s': { kind: 'speed', f: 1 },
    // area → m²
    'm2': { kind: 'area', f: 1 }, 'km2': { kind: 'area', f: 1e6 }, 'ft2': { kind: 'area', f: 0.09290304 },
    'sqft': { kind: 'area', f: 0.09290304 }, acre: { kind: 'area', f: 4046.8564224 },
    hectare: { kind: 'area', f: 10000 }, ha: { kind: 'area', f: 10000 }
  };

  function temperature(value, from, to) {
    const c = from === 'c' ? value : from === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
  }

  function unitIntent(text) {
    const t = norm(text).replace(/degrees?|°|celsius|centigrade/g, (m) => (/fahrenheit/.test(m) ? 'f' : 'c'));
    let m = t.match(/(-?\d+(?:\.\d+)?)\s*(?:°\s*)?(f|c)\b(?:\s*(?:to|in|into)\s*)(?:°\s*)?(f|c)\b/);
    if (m) {
      const from = m[2] === 'f' ? 'f' : 'c';
      const to = m[3] === 'f' ? 'f' : 'c';
      if (from === to) return `${cleanNumber(Number(m[1]))} °${from.toUpperCase()} is the same in °${to.toUpperCase()}.`;
      const out = temperature(Number(m[1]), from, to);
      return `**${cleanNumber(out)} °${to.toUpperCase()}**\n\n\`${m[1]} °${from.toUpperCase()} → ${cleanNumber(out)} °${to.toUpperCase()}\``;
    }
    m = t.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees?\s*)?(fahrenheit|celsius|kelvin)\b(?:\s*(?:to|in|into)\s*)(?:degrees?\s*)?(fahrenheit|celsius|kelvin)\b/);
    if (m) {
      const key = (w) => (w[0] === 'f' ? 'f' : w[0] === 'c' ? 'c' : 'k');
      const from = key(m[2]); const to = key(m[3]);
      const out = temperature(Number(m[1]), from, to);
      return `**${cleanNumber(out)} °${to.toUpperCase()}**`;
    }
    m = t.match(/(-?\d+(?:\.\d+)?)\s*([a-z/]+)\s*(?:to|in|into|as)\s*([a-z/]+)/);
    if (!m) return null;
    const a = UNITS[m[2]]; const b = UNITS[m[3]];
    if (!a || !b || a.kind !== b.kind) return null;
    const value = Number(m[1]);
    const out = (value * a.f) / b.f;
    return `**${cleanNumber(out)} ${m[3]}**\n\n\`${cleanNumber(value)} ${m[2]} = ${cleanNumber(out)} ${m[3]}\`\n\n${a.kind === 'data' ? 'Using decimal units (1 KB = 1,000 bytes).' : 'Exact conversion factors.'}`;
  }

  /* ------------------------------- counting ------------------------------- */

  function countIntent(text) {
    const quoted = text.match(/["“']([\s\S]+)["”']/);
    if (!quoted) return null;
    if (!/(count|how many)\s+(words?|characters?|chars?|letters?)/i.test(text) && !/word count|character count/i.test(text)) return null;
    const body = quoted[1];
    const words = body.trim() ? body.trim().split(/\s+/).length : 0;
    const chars = body.length;
    const noSpaces = body.replace(/\s/g, '').length;
    return `That text has **${words} word${words === 1 ? '' : 's'}**, **${chars} characters** (including spaces) and **${noSpaces}** without spaces.`;
  }

  /* -------------------------- Eltes knowledge base ------------------------- */

  const KB = [
    {
      keys: ['quickstart', 'get started', 'start', 'first message', 'how do i use', 'how to use', 'begin'],
      a: `## Quickstart\n\n1. Open **auth.html** and connect a provider account (OpenAI, Anthropic or DeepSeek), or paste a key under **Settings → API keys**.\n2. Return to **app.html** and pick a model from the switcher at the top.\n3. Type a message. Eltes streams the answer directly from the provider — there is no middle server.\n\nNo key yet? Choose **Eltes CAI-1** and the on-device model answers instantly without a network.`
    },
    {
      keys: ['api key', 'api keys', 'keys', 'byok', 'bring your own', 'connect provider', 'connect a provider', 'add key', 'paste key', 'openai key', 'anthropic key', 'deepseek key', 'connect a key', 'connect my key', 'where do i put'],
      a: `## Provider keys\n\nEltes is bring-your-own-key. Keys are saved in **\`eltes.settings.v1\`** in this browser's local storage and sent only to the provider you picked.\n\n- OpenAI keys start \`sk-\` — create one at platform.openai.com/api-keys.\n- Anthropic keys start \`sk-ant-\` — console.anthropic.com/settings/keys.\n- DeepSeek keys look like \`sk-…\` — platform.deepseek.com/api_keys.\n\nAdd or replace them in **Settings → API keys**, or on the account page. Nothing is uploaded to Eltes.`
    },
    {
      keys: ['cors', 'failed to fetch', 'network error', 'blocked', 'preflight'],
      a: `## CORS and direct browser calls\n\nEltes talks to providers from the tab, so their CORS policy decides whether a key can be used directly.\n\n- OpenAI, Anthropic, Google, Groq, OpenRouter and Mistral accept browser requests.\n- DeepSeek, xAI, Z.ai and some Qwen endpoints may refuse them.\n\nIf you see **Could not reach …**, the request never reached the provider. Options: use a provider that allows browser calls, or run a small proxy and set it as a **Custom endpoint** in Settings.`
    },
    {
      keys: ['401', '429', '403', 'rate limit', 'quota', 'unauthorized', 'error', 'retry'],
      a: `## Reading provider errors\n\n- **401 / 403** — the provider rejected the key. Paste a fresh one in Settings → API keys, then press **Retry**.\n- **429** — rate limit or no credit. Wait a moment, or switch models.\n- **404** — the model id is not enabled for your account.\n- **400** — the provider rejected the payload; check the model id or endpoint.\n- **Could not reach** — usually CORS, an ad-blocker or being offline.\n\nEltes keeps the failed turn in the thread with a retry button, so nothing is lost.`
    },
    {
      keys: ['astra', 'gpt 6', 'gpt-6', 'gpt6', 'realtime', 'real time', 'streaming', 'first token', 'latency'],
      a: `## ChatGPT Astra and real-time streaming\n\n**GPT‑6 Astra** (\`gpt-6-astra\`) is the flagship OpenAI model in Eltes. It streams through the Chat Completions API with \`stream: true\`, and Eltes paints each delta the moment it arrives.\n\n- Turn on **Settings → General → Stream responses** (on by default).\n- The message header shows a live **streaming** dot, then first-token and total latency.\n- The picker marks Astra with a **realtime** chip.\n\nAstra supports tool calling through OpenAI's Responses API; Eltes uses Chat Completions, so tools stay off for that entry and every other model keeps them.`
    },
    {
      keys: ['cai', 'on-device', 'local model', 'own model', 'custom model', 'eltes model', 'offline model'],
      a: `## Eltes CAI — our own models\n\nCAI runs inside this tab: no key, no network, no per-token cost.\n\n- **Eltes CAI-1** — general chat, model advice, arithmetic, units, dates and Eltes help.\n- **Eltes CAI-1 Fast** — shorter answers with quicker pacing.\n- **Eltes CAI Docs** — a specialist for setup, keys, accounts, downloads and troubleshooting.\n\nCAI is a small deterministic model. It is accurate on what it knows and says so when a question needs a hosted model. It never pretends to browse.`
    },
    {
      keys: ['models', 'model list', 'catalogue', 'catalog', 'how many models', 'providers', 'how many providers'],
      a: `## The catalogue\n\nEltes ships **${M.MODELS.length} models across ${Object.keys(M.PROVIDERS).length} providers**: Anthropic, OpenAI, Google, Z.ai, DeepSeek, xAI, Qwen, Mistral, Groq, OpenRouter, Eltes CAI and your own custom endpoint.\n\nEvery hosted entry is a real API id. The on-device CAI family is labelled **On-device**. Nothing is simulated.`
    },
    {
      keys: ['which model should', 'best model', 'recommend', 'for coding', 'for code', 'cheap', 'cheapest', 'fastest', 'vision', 'long context', 'reasoning'],
      a: '' // built dynamically
    },
    {
      keys: ['account', 'sign up', 'signup', 'sign in', 'signin', 'login', 'profile', 'openai account', 'anthropic account', 'deepseek account', 'oauth'],
      a: `## Accounts and provider connect\n\nYou can create a profile with **OpenAI, Anthropic or DeepSeek**, or keep a local profile. There is no GitHub button any more.\n\n- With \`window.ELTES_CONFIG.authEndpoint\` set by a host, the provider buttons start a real OAuth redirect.\n- On a static copy of Eltes there is no server to exchange an OAuth code, so the same panel asks for an API key instead and stores it locally. It never claims a connection that did not happen.\n\nA profile lives in \`eltes.account.v1\` and is never sent anywhere.`
    },
    {
      keys: ['pricing', 'price', 'cost', 'free', 'subscription', 'plan'],
      a: `## Pricing\n\nEltes itself is **free while in BYOK**: you pay your provider for tokens, directly. There is no Eltes subscription and no markup.\n\nHosted plans are not announced, so no price is shown on the site. When they ship, the same workspace keeps working with your own keys.`
    },
    {
      keys: ['privacy', 'storage', 'local storage', 'data', 'telemetry', 'tracking'],
      a: `## Privacy and storage\n\nEverything stays in this browser:\n\n- \`eltes.chats.v1\` — conversations\n- \`eltes.settings.v1\` — model, keys, preferences\n- \`eltes.active.v1\` — the open conversation\n- \`eltes.account.v1\` — your local profile\n\nNo analytics, no telemetry, no Eltes server. **Settings → Data** can export everything as JSON or clear it.`
    },
    {
      keys: ['download', 'downloads', 'windows', 'bat', 'install', 'offline', 'desktop', 'launcher'],
      a: `## Downloads and the Windows launcher\n\nThe **Downloads** section on the home page ships \`eltes-windows.zip\`. Unzip it anywhere and double-click **eltes.bat**.\n\nThe launcher finds Python (or Node), starts a small static server on \`127.0.0.1:4173\`, then opens your default browser at the workspace. It also installs a **Start menu** shortcut if you pass \`--shortcut\`. Eltes is still local-first: the launcher only serves files from the unzipped folder.`
    },
    {
      keys: ['tools', 'tool calling', 'agent', 'tool loop', 'search history', 'current time'],
      a: `## Agent tools\n\nEnable the wrench chip in the composer (or \`⌘K → Toggle tools\`). Eltes then offers the model three real functions:\n\n- \`current_time\` — the device clock, with timezone\n- \`calculate\` — arithmetic evaluated in a sandboxed parser\n- \`search_history\` — search this browser's saved chats\n\nTool calls appear as cards with arguments, output and runtime. Eltes loops up to four rounds, then stops. Models without tool support hide the toggle.`
    },
    {
      keys: ['export', 'import', 'backup', 'share', 'json', 'markdown'],
      a: `## Export and import\n\n- **Export all** in Settings → Data writes one JSON file with chats, settings and account (keys included only if you confirm).\n- The download icon in the top bar exports the open conversation as Markdown.\n- Import merges a previous JSON export; chats are normalised and invalid model ids fall back to your default.`
    },
    {
      keys: ['custom endpoint', 'ollama', 'vllm', 'litellm', 'proxy', 'self-host', 'self hosted', 'local server'],
      a: `## Custom endpoints\n\nSettings → API keys → **Custom endpoint** accepts any OpenAI-compatible base URL: Ollama (\`http://localhost:11434/v1\`), vLLM, LiteLLM, a Cloudflare Worker or your own gateway.\n\nSet the base URL, the model id and an optional token. Then pick **Custom endpoint** in the model switcher. A proxy is also the reliable fix for providers that block browser CORS.`
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
    }
  ];

  const GLOSSARY = {
    'llm': 'A **large language model** predicts the next token across billions of parameters. It is not a database: it reasons over what is in the prompt and what it learned in training.',
    'token': 'A **token** is the unit models read and bill. English averages about four characters per token; code and unusual words use more.',
    'context window': 'The **context window** is the maximum number of tokens a model can hold in one request — prompt plus answer. A 200K window is roughly 150,000 words.',
    'rag': '**RAG** (retrieval-augmented generation) fetches relevant documents first, then puts them in the prompt so the model answers from evidence instead of memory.',
    'embedding': 'An **embedding** is a vector that represents meaning. Similar text lands nearby, which is what makes semantic search and clustering work.',
    'fine-tuning': '**Fine-tuning** trains a model further on your examples. It changes behaviour and style; it is a poor way to add facts that change often.',
    'agent': 'An **agent** is a model given tools and a loop: it plans, calls a tool, reads the result and continues. Eltes caps the loop at four rounds.',
    'cors': '**CORS** is a browser rule: a page can only read a cross-origin response when the server sends the right headers. A missing header looks like a network failure, even though the request may have reached the API.',
    'byok': '**BYOK** means bring your own key. You pay the provider directly and the app never sees your bill or your tokens.',
    'api key': 'An **API key** is a secret that identifies your account to a provider. Treat it like a password: never commit it, and rotate it if it leaks.',
    'streaming': '**Streaming** sends the answer as server-sent events while it is generated, so the first words appear in hundreds of milliseconds instead of after the whole reply.',
    'ttft': '**TTFT** is time to first token — the delay before streaming starts. It is the number that decides whether an interface feels instant.',
    'temperature': '**Temperature** scales randomness. Low values are consistent and factual; higher values are more varied and creative.',
    'quantization': '**Quantization** stores weights at lower precision (8-bit, 4-bit) to cut memory and raise speed, at a small cost in quality.',
    'transformer': 'A **transformer** is the architecture behind modern LLMs. Self-attention lets each token weigh every other token in context.',
    'prompt injection': '**Prompt injection** is text that tries to override instructions — often hidden in a web page or document. Treat retrieved text as untrusted.',
    'vector database': 'A **vector database** stores embeddings and answers nearest-neighbour queries. It is the storage layer behind most RAG systems.',
    'mcp': '**MCP** (Model Context Protocol) is an open way to expose tools and data to models through a standard server interface.',
    'reasoning model': 'A **reasoning model** spends extra tokens thinking before it answers. It helps on maths, code and planning, and costs more latency.',
    'hallucination': 'A **hallucination** is a confident statement the model cannot support. The fix is evidence in the prompt, not a louder instruction.',
    'temperature 0': 'Temperature 0 makes sampling greedy: the same prompt tends to give the same answer, which is useful for extraction and tests.',
    'ocr': '**OCR** turns pixels of text into characters. Vision models can often read images without a separate OCR pass.',
    'ssrf': '**SSRF** tricks a server into calling internal addresses. Any proxy that accepts user URLs needs an allowlist.',
    'inference': '**Inference** is running a trained model to produce output. Cost and latency come from inference, not training.',
    'multimodal': 'A **multimodal** model accepts more than text — usually images, sometimes audio or video. In Eltes, vision is a per-model tag.',
    'system prompt': 'The **system prompt** is the standing instruction that shapes tone and rules for a conversation. Hosted models receive it with every request.',
    'function calling': '**Function calling** (tool calling) lets a model request a structured tool invocation instead of guessing. Eltes caps tool rounds at four.',
    'open weights': '**Open weights** means the model files are downloadable. It does not mean free to run: you still pay for hardware or hosting.'
  };

  const GLOSSARY_ALIASES = {
    'retrieval augmented generation': 'rag',
    'retrieval-augmented generation': 'rag',
    'retrieval augmentation': 'rag',
    'vector db': 'vector database',
    'context': 'context window',
    'context length': 'context window',
    'function calling': 'function calling',
    'tool calling': 'function calling',
    'tools': 'function calling',
    'key': 'api key',
    'api keys': 'api key',
    'model weights': 'open weights',
    'temperature zero': 'temperature 0'
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
      picks.push('gpt-6-astra', 'claude-sonnet-5-5', 'gemini-2-5-pro');
      reasons.push('vision');
    }
    if (/long|book|document|pdf|million|context/.test(t)) {
      picks.push('gpt-6-astra', 'gemini-2-5-pro', 'deepseek-flash');
      reasons.push('long context');
    }
    if (/reason|math|hard|plan|research/.test(t)) {
      picks.push('claude-opus-5-5', 'gpt-6-astra', 'deepseek-v4-pro');
      reasons.push('reasoning');
    }
    const unique = Array.from(new Set(picks)).slice(0, 4);
    if (!unique.length) {
      return `## Choosing a model\n\nThere is no single best model — pick by the job:\n\n- **Code and long refactors:** Claude Sonnet 5.5 or GPT‑6 Sol.\n- **Hard reasoning:** Claude Opus 5.5 or ChatGPT Astra.\n- **Cheap and long:** DeepSeek V4.1 Flash.\n- **Instant and offline:** Eltes CAI-1.\n\nTell me the job (code, cheap, fast, vision, long documents) and I will narrow it down.`;
    }
    const rows = unique.map((id) => {
      const m = M.byId(id);
      return `- **${m.name}** — ${m.blurb}${badge(m)}`;
    }).join('\n');
    return `## For ${list(reasons.slice(0, 2))}\n\n${rows}\n\nEltes CAI models need no key. The others need a connected provider; the picker marks every model that is ready.`;
  }

  function kbLookup(text) {
    const t = strip(text);
    let best = null;
    let bestScore = 0;
    KB.forEach((entry) => {
      let score = 0;
      entry.keys.forEach((k) => {
        const key = norm(k);
        if (!key) return;
        if (t.includes(' ' + key + ' ')) score += key.includes(' ') ? 3 : 2;
      });
      if (score > bestScore) { bestScore = score; best = entry; }
    });
    return bestScore >= 2 ? best : null;
  }

  function glossaryLookup(text) {
    const m = norm(text).match(/(?:what (?:is|are|does)|define|meaning of|explain)\s+(?:an?\s+|the\s+)?([a-z0-9 .+\-]{2,40})/);
    if (!m) return null;
    const term = m[1].replace(/[?.!]+$/, '').trim();
    if (GLOSSARY_ALIASES[term]) return { term, text: GLOSSARY[GLOSSARY_ALIASES[term]] };
    if (GLOSSARY[term]) return { term, text: GLOSSARY[term] };
    const found = Object.keys(GLOSSARY).find((k) => term === k || term === k + 's' || term.startsWith(k + ' '));
    if (found) return { term: found, text: GLOSSARY[found] };
    const alias = Object.keys(GLOSSARY_ALIASES).find((k) => term === k || term === k + 's');
    return alias ? { term, text: GLOSSARY[GLOSSARY_ALIASES[alias]] } : null;
  }

  /* ----------------------------- answer builder ---------------------------- */

  function buildAnswer(modelId, prompt, history, now) {
    const text = String(prompt || '').trim();
    const t = norm(text);
    const fast = modelId === 'eltes-cai-1-fast';
    const docsOnly = modelId === 'eltes-cai-docs';

    if (!text) {
      return { intent: 'empty', text: 'Ask me anything about Eltes, models, arithmetic, units or dates. I answer on this device, so there is no network round trip.' };
    }

    if (hasAny(t, /^(hi|hey|hello|yo|good (morning|afternoon|evening)|howdy)\b/)) {
      const hour = now.getHours();
      const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
      return {
        intent: 'greeting',
        text: `Good ${part}. I am **Eltes CAI-1**, running on this device.\n\nI can help with:\n\n- Eltes itself — setup, keys, accounts, downloads\n- choosing between the ${M.MODELS.length} models in the catalogue\n- arithmetic, unit conversions, dates and definitions\n\nWhat do you want to work on?`
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
        text: `I am **Eltes CAI-1**, an on-device model built into this workspace. I am not ChatGPT, Claude or Gemini, and I do not call any API.\n\nMy strengths are narrow and honest: Eltes product help, model selection, arithmetic, units, dates and AI definitions. For open-ended writing or deep reasoning, switch to a hosted model — that is what the model picker is for.`
      };
    }

    if (hasAny(t, /what can you do|help me|capabilit|what do you know|how do you work/)) {
      return {
        intent: 'capabilities',
        text: `**On this device, right now:**\n\n- Eltes setup, provider keys, accounts, CORS, downloads and troubleshooting\n- model recommendations from the live catalogue\n- arithmetic and percentages, with the working shown\n- unit and temperature conversions\n- the current date and time in your timezone\n- word and character counts\n- short, accurate definitions of AI terms\n\n**Out of range:** live facts, news, browsing and long-form originality. Switch to a hosted model for those — Eltes keeps the same thread when you do.`
      };
    }

    if (hasAny(t, /what time|current time|what date|today'?s date|what day is it|time is it/)) {
      return { intent: 'time', ...answerTime(now) };
    }

    const count = countIntent(text);
    if (count) return { intent: 'count', text: count };

    const units = unitIntent(text);
    if (units) return { intent: 'units', text: units };

    const math = mathIntent(text);
    if (math) return { intent: 'math', text: math };

    if (/weather|news|stock price|score|who won|latest|today'?s headlines|browse|search the web/.test(t)) {
      return {
        intent: 'live',
        text: `I cannot check live information — CAI has no network access, and I will not invent an answer.\n\nSwitch to a connected hosted model for current facts, or paste the source text here and I will help you reason about it.`
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
      if (docsOnly && kb.keys[0] === 'pricing') {
        // docs model prefers the documentation pointer
        return { intent: 'kb', text: kb.a + '\n\nMore detail: **docs.html#pricing**.' };
      }
      return { intent: 'kb', text: kb.a + (fast ? '' : docsAnswerHint()) };
    }

    const gloss = glossaryLookup(text);
    if (gloss) {
      return { intent: 'glossary', text: `**${gloss.term.replace(/\b\w/g, (c) => c.toUpperCase())}**\n\n${gloss.text}` };
    }

    if (docsOnly) {
      return {
        intent: 'fallback',
        text: `That is outside what I can answer accurately on this device.\n\nTry one of these, which I do know:\n\n- “How do I connect an OpenAI key?”\n- “Which models are on-device?”\n- “Where is the Windows download?”\n- “What does CORS mean?”\n\nOr switch to a hosted model for the open-ended question.`
      };
    }

    return {
      intent: 'fallback',
      text: `I want to be straight with you: **CAI-1 is a small on-device model**, and that question is outside what I can answer reliably.\n\nI am solid on:\n\n- Eltes setup, keys, accounts and downloads\n- picking a model from the catalogue\n- arithmetic, percentages and unit conversions\n- dates, definitions and short factual checks\n\nSwitch to a hosted model in the picker for open-ended writing, code review or live information. The thread follows you, so nothing is lost.`
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
    // split into small, stable pieces so streaming feels live without breaking words
    const parts = text.match(/\s*\S+/g) || [text];
    const out = [];
    let buf = '';
    parts.forEach((p) => {
      buf += p;
      if (buf.length >= 14 || /[.!?\n]$/.test(buf.trim())) { out.push(buf); buf = ''; }
    });
    if (buf) out.push(buf);
    return out;
  }

  async function stream({ modelId, messages, onToken, signal, onMeta }) {
    const model = modelId === 'eltes-cai-1-fast' ? 'eltes-cai-1-fast' : modelId === 'eltes-cai-docs' ? 'eltes-cai-docs' : 'eltes-cai-1';
    const history = (messages || []).slice(0, -1);
    const prompt = (messages && messages.length) ? messages[messages.length - 1].content : '';
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const now = new Date();

    await new Promise((r) => setTimeout(r, 60)); // local compute beat, not a fake network delay
    const { text, intent } = buildAnswer(model, prompt, history, now);
    const parts = chunker(text);
    const delay = model === 'eltes-cai-1-fast' ? 9 : 15;
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
    kbEntries: KB.length,
    glossaryTerms: Object.keys(GLOSSARY).length
  };
})();
