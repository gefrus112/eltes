/* ==========================================================================
   Eltes AI — application
   Local-first chat + agent workspace. No backend, no tracking.
   ========================================================================== */
(function () {
  'use strict';

  const M = window.EltesModels;
  const I = window.EltesIcons;
  const ic = (name, size = 16) => I.icon(name, { size });
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s = '') =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  /* ------------------------------- storage -------------------------------- */
  const LS = {
    chats: 'eltes.chats.v1',
    settings: 'eltes.settings.v1',
    active: 'eltes.active.v1'
  };

  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  };
  const writeJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast('Storage is full — delete a conversation to keep saving', 'triangle-alert');
      return false;
    }
  };

  const DEFAULTS = {
    model: M.DEFAULT_MODEL,
    keys: {},
    customBaseUrl: '',
    customModel: '',
    customKey: '',
    stream: true,
    sendKey: 'enter',
    agent: false,
    density: 'comfortable',
    reduceMotion: false,
    showTime: true,
    favorites: ['claude-sonnet-4-5', 'gpt-4-1', 'gemini-2-5-pro']
  };

  const savedSettings = readJSON(LS.settings, {});
  const state = {
    chats: readJSON(LS.chats, []),
    activeId: readJSON(LS.active, null),
    settings: Object.assign({}, DEFAULTS, savedSettings, {
      keys: Object.assign({}, DEFAULTS.keys, savedSettings.keys || {})
    }),
    sending: false,
    stopped: false,
    abort: null,
    renameId: null,
    modelPickerFor: 'current'
  };

  if (!Array.isArray(state.chats)) state.chats = [];
  if (!state.chats.some((c) => c.id === state.activeId)) {
    state.activeId = state.chats.length ? state.chats[0].id : null;
  }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeJSON(LS.chats, state.chats);
      writeJSON(LS.settings, state.settings);
      writeJSON(LS.active, state.activeId);
      updateStorageUI();
    }, 120);
  }
  function persistNow() {
    clearTimeout(saveTimer);
    writeJSON(LS.chats, state.chats);
    writeJSON(LS.settings, state.settings);
    writeJSON(LS.active, state.activeId);
    updateStorageUI();
  }

  /* ------------------------------- helpers -------------------------------- */
  const activeChat = () => state.chats.find((c) => c.id === state.activeId) || null;
  const currentModelId = () => {
    const chat = activeChat();
    return (chat && chat.model) || state.settings.model;
  };
  const currentModel = () => M.byId(currentModelId());
  const providerKey = (provider) => (provider === 'custom' ? state.settings.customKey : state.settings.keys[provider]);
  const hasKeyFor = (model) => {
    if (!model) return false;
    if (model.provider === 'custom') return !!state.settings.customBaseUrl;
    if (model.id === 'auto') return !!state.settings.keys.openrouter;
    return !!state.settings.keys[model.provider];
  };
  const connectedKeyCount = () =>
    Object.values(state.settings.keys).filter(Boolean).length + (state.settings.customBaseUrl ? 1 : 0);

  const modelBadge = (model) => {
    const p = M.providerOf(model);
    return `<span class="mb ${p.cls}">${esc(p.badge)}</span>`;
  };

  const fmtTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  function toast(message, icon = 'check') {
    let stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${ic(icon, 15)}<span>${esc(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 2300);
  }

  /* ------------------------------ markdown -------------------------------- */
  const KEYWORDS = new Set(
    ('const let var function return if else for while await async import from export default new class extends ' +
      'try catch finally throw typeof instanceof this super null undefined true false def elif in not and or None ' +
      'True False lambda with as pass raise select where join order by group limit insert update delete create ' +
      'table index on primary key foreign references begin commit rollback pub fn use mut impl struct enum match ' +
      'switch case break continue do interface type public private static void int string bool float echo cd ' +
      'export set local then fi done of is not').split(/\s+/)
  );

  function escapeCode(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const LANGS = /^(js|javascript|jsx|ts|typescript|tsx|json|py|python|bash|sh|shell|zsh|sql|css|html|xml|go|rs|rust|yml|yaml|toml|diff)$/i;

  function highlight(code, lang) {
    if (!lang || !LANGS.test(lang)) return escapeCode(code);
    const src = escapeCode(code);
    const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

    return src.replace(re, (match, comment, str, num, word, offset) => {
      if (comment) return `<span class="tok-com">${comment}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (num) return `<span class="tok-num">${num}</span>`;
      if (word) {
        if (KEYWORDS.has(word)) return `<span class="tok-key">${word}</span>`;
        const after = src.slice(offset + word.length, offset + word.length + 2);
        if (/^[A-Z]/.test(word)) return `<span class="tok-tag">${word}</span>`;
        if (after.startsWith('(')) return `<span class="tok-fn">${word}</span>`;
        return word;
      }
      return match;
    });
  }

  function inline(md) {
    const codes = [];
    let out = md.replace(/(`+)([\s\S]*?)\1/g, (m, ticks, body) => {
      const token = `\u0000C${codes.length}\u0000`;
      codes.push(`<code class="inline">${body}</code>`);
      return token;
    });

    out = out
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
      .replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>');

    out = out.replace(/\u0000C(\d+)\u0000/g, (m, i) => codes[Number(i)]);
    return out;
  }

  function renderMarkdown(raw) {
    let md = String(raw || '');
    // close an open fence while streaming
    const fences = (md.match(/```/g) || []).length;
    if (fences % 2 === 1) md += '\n```';

    const lines = md.split('\n');
    const html = [];
    let i = 0;

    const isBlockStart = (line) =>
      /^```/.test(line) ||
      /^#{1,3}\s/.test(line) ||
      /^>\s?/.test(line) ||
      /^[-*+]\s+/.test(line) ||
      /^\d+\.\s+/.test(line) ||
      /^---+$/.test(line.trim());

    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line)) {
        const lang = line.replace(/^```/, '').trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        const code = buf.join('\n');
        const label = lang || 'text';
        html.push(
          `<div class="code"><div class="code-head"><span class="lang">${ic('code-2', 11)}${esc(label)}</span>` +
            `<button class="cpy" data-copy-code type="button">${ic('copy', 11)}<span>Copy</span></button></div>` +
            `<pre><code>${highlight(code, lang)}</code></pre></div>`
        );
        continue;
      }

      if (!line.trim()) { i++; continue; }

      if (/^---+$/.test(line.trim())) { html.push('<hr />'); i++; continue; }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        html.push(`<h${level}>${inline(esc(h[2]))}</h${level}>`);
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        html.push(`<blockquote>${inline(esc(buf.join(' ')))}</blockquote>`);
        continue;
      }

      if (/^[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
          items.push(inline(esc(lines[i].replace(/^[-*+]\s+/, ''))));
          i++;
        }
        html.push(`<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items.push(inline(esc(lines[i].replace(/^\d+\.\s+/, ''))));
          i++;
        }
        html.push(`<ol>${items.map((t) => `<li>${t}</li>`).join('')}</ol>`);
        continue;
      }

      // table
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const parseRow = (row) =>
          row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
        const head = parseRow(line);
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          body.push(parseRow(lines[i]));
          i++;
        }
        html.push(
          `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join('')}</tr></thead>` +
            `<tbody>${body
              .map((r) => `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join('')}</tr>`)
              .join('')}</tbody></table></div>`
        );
        continue;
      }

      // paragraph
      const buf = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      html.push(`<p>${inline(esc(buf.join(' ')))}</p>`);
    }

    return html.join('');
  }

  /* ----------------------------- demo replies ----------------------------- */
  const DEMO_NOTE = (model) =>
    `\n\n*Demo reply — add a ${M.providerOf(model).name} key in **Settings → API keys** to run ${model.name} for real.*`;

  function demoReply(prompt, model) {
    const p = String(prompt || '').toLowerCase();
    const name = model.name;

    if (/^(hi|hey|hello|yo|good morning|good evening)\b/.test(p) && p.length < 40) {
      return `Hey — I'm Eltes. This workspace is running in **demo mode**, so I answer from a local script rather than a live model.

Here's what you can do right now:

1. **Switch models** mid-conversation with the picker in the top bar (or \`⌘M\`).
2. **Open Settings → API keys** and paste a key from OpenAI, Anthropic, Google, Groq or any OpenAI-compatible endpoint.
3. **Keep everything local** — chats and keys never leave this browser.

Ask me to write some code, compare models, or design something, and I'll show you the shape of a real reply.${DEMO_NOTE(model)}`;
    }

    if (/debounce|usehook|react hook|hook/.test(p)) {
      return `Here's a dependency-free \`useDebounce\` hook. The timer is cleared on every change, so a fast sequence of updates only ever fires once.

\`\`\`js
import { useEffect, useState } from 'react';

export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);

    // cleanup cancels the pending update...
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
\`\`\`

**Why the cleanup matters**

- React runs the cleanup before the next effect. A keystroke within \`delay\` throws away the previous timer, so you never set stale state.
- The dependency list includes \`delay\`, so changing it re-arms the timer instead of keeping the old one.
- On unmount the pending update is cancelled, which avoids the classic "state update on an unmounted component" warning.

Use it like this:

\`\`\`jsx
const [query, setQuery] = useState('');
const debouncedQuery = useDebounce(query, 250);

useEffect(() => {
  if (debouncedQuery) search(debouncedQuery);
}, [debouncedQuery]);
\`\`\`

If you want the debounced function rather than the value, the cleanup logic is the same — wrap the call in a \`useRef\` and clear the timer on each invocation.${DEMO_NOTE(model)}`;
    }

    if (/jwt|refresh token|auth|session|oauth/.test(p)) {
      return `Short version: **rotate refresh tokens on every use, store only a hash, and make reuse detectable.**

### The rotation flow

1. Client sends the refresh token to \`POST /auth/refresh\`.
2. Server looks up its hash, checks expiry and revocation.
3. Server marks the old token \`used_at = now()\` **and** issues a new one in the same transaction.
4. The new pair goes back as an \`HttpOnly\`, \`Secure\`, \`SameSite=Strict\` cookie.

\`\`\`js
async function refresh(req, res) {
  const raw = req.cookies.refresh_token;
  const hash = sha256(raw);
  const row = await db.refreshToken.findUnique({ where: { hash } });

  if (!row || row.expiresAt < new Date()) return res.sendStatus(401);

  if (row.usedAt) {
    // reuse detected — kill the whole family
    await db.refreshToken.deleteMany({ where: { familyId: row.familyId } });
    return res.sendStatus(401);
  }

  const next = await db.$transaction(async (tx) => {
    await tx.refreshToken.update({ where: { hash }, data: { usedAt: new Date() } });
    return createRefreshToken(tx, { familyId: row.familyId, userId: row.userId });
  });

  res.cookie('refresh_token', next.raw, cookieOptions);
  res.json({ accessToken: signAccess(row.userId) });
}
\`\`\`

### Rules that prevent the usual mistakes

- **Never store the raw token** — a database leak should not hand over sessions.
- **Family IDs** let you revoke every descendant token when reuse is detected.
- **Access tokens stay short** (5–15 minutes); refresh tokens 30 days, sliding.
- **One transaction** for mark-used plus insert-new, otherwise a crash can strand a user.

Want me to adapt this to Prisma + \`jose\`, or to a stateless setup with rotating signed tokens?${DEMO_NOTE(model)}`;
    }

    if (/compare|versus|\bvs\b|which model|best model/.test(p)) {
      return `For coding work the three frontier families trade blows, but the differences are fairly stable:

| | Claude | GPT | Gemini |
|---|---|---|---|
| Long-file edits | **Excellent** | Strong | Good |
| Tool / agent loops | **Excellent** | Strong | Strong |
| Huge context (1M) | 200K | 1M | **1M** |
| Latency | Medium | Medium | **Fast** |
| Price | Higher | Medium | Medium |

**How I'd pick**

- **Claude Sonnet 4.5** — default for refactors and agentic coding. It follows multi-file instructions with the fewest surprises.
- **GPT-4.1** — great when you need a million-token window and dependable JSON / instruction following.
- **Gemini 2.5 Flash** — best when latency dominates: autocomplete, quick edits, high-volume classification.
- **DeepSeek V3 or Qwen3 Coder** — when cost per token matters more than the last 5% of quality.

In Eltes you don't have to choose up front. Send the same prompt, switch models in the reply header, and compare — the conversation carries over.${DEMO_NOTE(model)}`;
    }

    if (/postgres|sql|index|query|database/.test(p)) {
      return `A slow orders query is almost always one of three things: a missing composite index, a function wrapped around an indexed column, or a sort that spills to disk.

### 1. Read the plan first

\`\`\`sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, total_cents, created_at
FROM orders
WHERE tenant_id = $1
  AND status = 'paid'
ORDER BY created_at DESC
LIMIT 50;
\`\`\`

If you see \`Seq Scan\` or \`Sort Method: external merge\`, you have your answer.

### 2. Index for the filter *and* the sort

\`\`\`sql
CREATE INDEX CONCURRENTLY idx_orders_tenant_status_created
  ON orders (tenant_id, status, created_at DESC)
  INCLUDE (total_cents);
\`\`\`

- Equality columns first (\`tenant_id\`, \`status\`), then the range/sort column.
- \`INCLUDE\` makes it covering, so the heap fetch disappears for this query.
- \`CONCURRENTLY\` avoids locking writes in production.

### 3. Check the usual traps

- \`WHERE created_at::date = CURRENT_DATE\` — casting kills the index. Use a half-open range instead.
- \`OR\` across different columns often defeats index use; split it into a \`UNION ALL\`.
- \`LIMIT\` does not make a bad plan cheap if the sort has to materialise first.

After the index you should see an \`Index Only Scan\` with the sort removed from the plan. Want me to read your actual \`EXPLAIN\` output? Paste it and I'll annotate the plan.${DEMO_NOTE(model)}`;
    }

    if (/landing|copy|launch|email|marketing|positioning/.test(p)) {
      return `Here's a launch-page structure that tends to convert for developer tools.

**Above the fold**

> ### One workspace. Every model.
> Bring your own key, switch models mid-thought and keep your history on your device.

- Primary button: *Try it free* — no sign-up.
- Secondary: *Read the docs*.
- One line of proof directly under the buttons: *Your keys stay in your browser.*

**Then, in order**

1. **A real screenshot**, not an abstract illustration. The product is the pitch.
2. **Three capabilities**, each with a concrete verb: *switch models*, *keep history*, *run agents*.
3. **A comparison table** against the status quo — one column, six rows, no marketing adjectives.
4. **A short quickstart**: three commands or three clicks.
5. **A closing CTA** that repeats the promise instead of inventing a new one.

**Copy rules that keep it honest**

- Replace "blazing fast" with a number or delete it.
- Say who it is for in the first eight words.
- Keep every paragraph under three lines at 15px.

If you tell me the audience — indie developers, platform teams, or non-technical operators — I'll rewrite the hero and the three feature blocks for that group.${DEMO_NOTE(model)}`;

    }

    if (/bug|error|fix|broken|fails|failing|why/.test(p)) {
      return `Let's narrow it down before changing anything.

**1. Reproduce it deterministically**

Write the smallest input that fails every time. If it only fails sometimes, the bug is usually timing, shared state, or an unawaited promise.

**2. Add one observation**

\`\`\`js
console.log({ input, state: snapshot(state), at: performance.now() });
\`\`\`

Log the value *before* the failure point, not after — after is where it is already wrong.

**3. Bisect the surface**

- Does it fail with a fresh cache and no extensions?
- Does it fail in a test that mocks nothing?
- Does it fail on another machine or only this one?

**4. Then, and only then, change one line**

A fix you cannot explain is a second bug with better timing.

Paste the error text, the stack trace, or the failing test and I'll trace it with you. If you share the file, I can propose a patch rather than a guess.${DEMO_NOTE(model)}`;
    }

    return `Good question. Here's how I'd approach it.

**What I'd check first**

1. **Define the outcome** — what has to be true when this is done? One sentence, no adjectives.
2. **Find the smallest version** that proves the idea works end to end.
3. **Only then** generalise: add the error paths, the edge cases and the tests.

\`\`\`js
// start with the thinnest possible slice
async function run(input) {
  const parsed = parse(input);       // fail loudly here
  const result = await execute(parsed);
  return result;
}
\`\`\`

**Things that usually bite later**

- Silent fallbacks that hide a broken input instead of surfacing it.
- State duplicated in two places, then allowed to drift.
- A dependency added for something thirty lines would cover.

Tell me the constraints you're working with — language, stack, and what "done" means — and I'll turn this into a concrete plan with code you can run.${DEMO_NOTE(model)}`;
  }

  /* ------------------------------ demo steps ------------------------------ */
  const STEP_SETS = [
    [
      { tool: 'read', arg: 'src/app.ts', res: '312 lines' },
      { tool: 'grep', arg: '"session" · 4 matches', res: '4 hits' },
      { tool: 'edit', arg: 'src/session.ts', res: '+18 −4' },
      { tool: 'test', arg: 'pnpm test session', res: '12 passed' }
    ],
    [
      { tool: 'search', arg: 'useDebounce · 2 files', res: '2 files' },
      { tool: 'read', arg: 'src/hooks/index.ts', res: '64 lines' },
      { tool: 'write', arg: 'src/hooks/useDebounce.ts', res: '+22' }
    ],
    [
      { tool: 'read', arg: 'db/schema.prisma', res: '180 lines' },
      { tool: 'grep', arg: '"orders" · 7 matches', res: '7 hits' },
      { tool: 'migration', arg: 'add_orders_index', res: 'ok' }
    ]
  ];

  /* ------------------------------- rendering ------------------------------ */
  const els = {
    shell: $('#shell'),
    side: $('#side'),
    backdrop: $('#sideBackdrop'),
    chatList: $('#chatList'),
    messages: $('#messages'),
    empty: $('#emptyState'),
    thread: $('#thread'),
    input: $('#input'),
    send: $('#sendBtn'),
    modelBtn: $('#modelBtn'),
    modelBtnName: $('#modelBtnName'),
    modelBtnBadge: $('#modelBtnBadge'),
    modelBtnTier: $('#modelBtnTier'),
    composerModelName: $('#composerModelName'),
    composerBadge: $('#composerBadge'),
    demoPill: $('#demoPill'),
    modelDialog: $('#modelDialog'),
    modelList: $('#modelList'),
    modelSearch: $('#modelSearch'),
    cmdDialog: $('#cmdDialog'),
    cmdSearch: $('#cmdSearch'),
    cmdList: $('#cmdList'),
    settingsDialog: $('#settingsDialog'),
    shareDialog: $('#shareDialog'),
    confirmDialog: $('#confirmDialog'),
    keyList: $('#keyList'),
    modelPrefs: $('#modelPrefs'),
    storageLabel: $('#storageLabel'),
    storageBar: $('#storageBar')
  };

  function renderTopbar() {
    const model = currentModel();
    const p = M.providerOf(model);
    els.modelBtnName.textContent = model.name;
    els.modelBtnTier.textContent = model.tier;
    els.modelBtnBadge.textContent = p.badge;
    els.modelBtnBadge.className = `mb ${p.cls}`;
    els.composerModelName.textContent = model.name;
    els.composerBadge.textContent = p.badge;
    els.composerBadge.className = `mb ${p.cls}`;
    els.demoPill.style.display = hasKeyFor(model) ? 'none' : '';
    const profileMeta = $('#profileMeta');
    if (profileMeta) {
      profileMeta.textContent = hasKeyFor(model)
        ? `${connectedKeyCount()} key${connectedKeyCount() === 1 ? '' : 's'} connected`
        : 'Demo mode';
    }
    const settingsModelName = $('#settingsModelName');
    if (settingsModelName) settingsModelName.textContent = model.name;
    const aboutModel = $('#aboutModel');
    if (aboutModel) aboutModel.textContent = M.byId(state.settings.model).id;
    const defaultLabel = $('#defaultModelLabel');
    if (defaultLabel) defaultLabel.textContent = M.byId(state.settings.model).name;
  }

  function chatBucket(ts) {
    const now = new Date();
    const d = new Date(ts);
    const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.floor((startOf(now) - startOf(d)) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days <= 7) return 'Previous 7 days';
    if (days <= 30) return 'Previous 30 days';
    return 'Older';
  }

  function renderSidebar() {
    const list = els.chatList;
    if (!state.chats.length) {
      list.innerHTML = `<div class="chat-empty">No conversations yet.<br />Your chats are saved only in this browser.</div>`;
      updateStorageUI();
      return;
    }

    const sorted = [...state.chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const pinned = sorted.filter((c) => c.pinned);
    const rest = sorted.filter((c) => !c.pinned);
    const groups = new Map();
    rest.forEach((c) => {
      const key = chatBucket(c.updatedAt || c.createdAt || Date.now());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });

    const row = (chat) => {
      const isActive = chat.id === state.activeId;
      const renaming = state.renameId === chat.id;
      return `<div class="chat-row${isActive ? ' active' : ''}" data-chat="${chat.id}" role="button" tabindex="0" aria-label="${esc(chat.title)}">
        ${chat.pinned ? `<span class="pin-mark">${ic('pin', 11)}</span>` : `<span>${ic('message-square', 13)}</span>`}
        ${renaming
          ? `<input class="rename-input" data-rename="${chat.id}" value="${esc(chat.title)}" aria-label="Rename conversation" />`
          : `<span class="title">${esc(chat.title || 'New chat')}</span>`}
        <span class="row-actions">
          <button class="mini-btn" data-pin="${chat.id}" title="${chat.pinned ? 'Unpin' : 'Pin'}" aria-label="${chat.pinned ? 'Unpin' : 'Pin'}">${ic('pin', 12)}</button>
          <button class="mini-btn" data-menu="${chat.id}" title="More" aria-label="More actions">${ic('more-horizontal', 13)}</button>
        </span>
      </div>`;
    };

    let html = '';
    if (pinned.length) {
      html += `<div class="chat-group"><h5>Pinned</h5>${pinned.map(row).join('')}</div>`;
    }
    groups.forEach((items, key) => {
      html += `<div class="chat-group"><h5>${key}</h5>${items.map(row).join('')}</div>`;
    });
    list.innerHTML = html;

    if (state.renameId) {
      const input = list.querySelector(`[data-rename="${state.renameId}"]`);
      if (input) {
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commitRename(input.value);
          if (e.key === 'Escape') cancelRename();
          e.stopPropagation();
        });
        input.addEventListener('blur', () => commitRename(input.value));
        input.addEventListener('click', (e) => e.stopPropagation());
      }
    }
    updateStorageUI();
  }

  function updateStorageUI() {
    const size = new Blob([JSON.stringify(state.chats), JSON.stringify(state.settings)]).size;
    const kb = size / 1024;
    const label = kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
    if (els.storageLabel) els.storageLabel.textContent = label;
    if (els.storageBar) els.storageBar.style.width = `${clamp((size / (5 * 1024 * 1024)) * 100, 1, 100)}%`;
    const dc = $('#dataChats');
    if (dc) dc.textContent = `${state.chats.length} conversation${state.chats.length === 1 ? '' : 's'} · ${state.chats.reduce((n, c) => n + (c.messages ? c.messages.length : 0), 0)} messages`;
    const ds = $('#dataStorage');
    if (ds) ds.textContent = `${label} of local storage used`;
  }

  function actionButtons(msg, index, chat) {
    const isLastAssistant =
      msg.role === 'assistant' && index === chat.messages.length - 1;
    if (msg.role === 'user') {
      return `<div class="msg-actions">
        <button class="mini-btn" data-act="copy" data-id="${msg.id}" title="Copy">${ic('copy', 12)}<span>Copy</span></button>
        <button class="mini-btn" data-act="edit" data-id="${msg.id}" title="Edit">${ic('pencil', 12)}<span>Edit</span></button>
      </div>`;
    }
    return `<div class="msg-actions">
      <button class="mini-btn" data-act="copy" data-id="${msg.id}" title="Copy reply">${ic('copy', 12)}<span>Copy</span></button>
      ${isLastAssistant ? `<button class="mini-btn" data-act="regen" data-id="${msg.id}" title="Regenerate">${ic('refresh-cw', 12)}<span>Retry</span></button>` : ''}
      <span class="sep"></span>
      <button class="mini-btn${msg.rating === 'up' ? ' on' : ''}" data-act="good" data-id="${msg.id}" title="Good reply" aria-label="Good reply">${ic('thumbs-up', 12)}</button>
      <button class="mini-btn${msg.rating === 'down' ? ' on' : ''}" data-act="bad" data-id="${msg.id}" title="Bad reply" aria-label="Bad reply">${ic('thumbs-down', 12)}</button>
    </div>`;
  }

  function stepsHtml(steps) {
    if (!steps || !steps.length) return '';
    const rows = steps
      .map(
        (s) => `<div class="step${s.pending ? ' pending' : ''}">
          <span class="tool">${esc(s.tool)}</span>
          <span class="arg">${esc(s.arg)}</span>
          ${s.res ? `<span class="res">${esc(s.res)}</span>` : ''}
        </div>`
      )
      .join('');
    return `<div class="steps"><div class="steps-head">${ic('bot', 12)} Agent run
      <span class="count">${steps.length} step${steps.length === 1 ? '' : 's'}</span></div>${rows}</div>`;
  }

  function errorHtml(err, msgId) {
    if (!err) return '';
    return `<div class="stream-error">
      <strong>${esc(err.title || 'Request failed')}</strong><br />${esc(err.detail || '')}
      ${err.hint ? `<br /><span>${esc(err.hint)}</span>` : ''}
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-act="regen" data-id="${msgId}">${ic('refresh-cw', 12)} Retry</button>
        <button class="btn btn-ghost btn-sm" data-act="demo" data-id="${msgId}">${ic('sparkles', 12)} Use demo reply</button>
      </div>
    </div>`;
  }

  function messageHtml(msg, index, chat) {
    const model = M.byId(msg.model || chat.model);
    if (msg.role === 'user') {
      return `<div class="msg user" data-msg="${msg.id}">
        <div class="msg-body">
          <div class="bubble">${esc(msg.content)}</div>
          ${actionButtons(msg, index, chat)}
        </div>
      </div>`;
    }
    const time = state.settings.showTime ? `<span class="time">${fmtTime(msg.ts)}</span>` : '';
    return `<div class="msg ai" data-msg="${msg.id}">
      <span class="avatar"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6c.7 5.2 4.2 8.7 9.4 9.4-5.2.7-8.7 4.2-9.4 9.4-.7-5.2-4.2-8.7-9.4-9.4 5.2-.7 8.7-4.2 9.4-9.4Z" fill="#fff"/></svg></span>
      <div class="msg-body">
        <div class="msg-head">
          <span class="who">Eltes</span>
          <span class="model-chip">${modelBadge(model)}${esc(model.name)}</span>
          ${msg.streaming ? `<span class="streaming-dot"><i></i>streaming</span>` : time}
        </div>
        ${stepsHtml(msg.steps)}
        ${msg.streaming && !msg.content ? `<div class="thinking"><span class="dots"><i></i><i></i><i></i></span><span class="shimmer">Thinking with ${esc(model.name)}…</span></div>` : ''}
        <div class="prose">${renderMarkdown(msg.content)}${msg.streaming ? '<span class="caret"></span>' : ''}</div>
        ${errorHtml(msg.error, msg.id)}
        ${msg.streaming || msg.error ? '' : actionButtons(msg, index, chat)}
      </div>
    </div>`;
  }

  function renderMessages() {
    const chat = activeChat();
    if (!chat || !chat.messages.length) {
      els.empty.hidden = false;
      els.messages.hidden = true;
      els.messages.innerHTML = '';
      return;
    }
    els.empty.hidden = true;
    els.messages.hidden = false;
    els.messages.innerHTML = chat.messages.map((m, i) => messageHtml(m, i, chat)).join('');
  }

  const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
  function applyPlatformKeys() {
    if (IS_MAC) return;
    $$('.kbd').forEach((k) => {
      if (k.textContent.indexOf('⌘') > -1) k.textContent = k.textContent.replace(/⌘/g, 'Ctrl');
    });
    $$('[title]').forEach((el) => {
      if (el.title.indexOf('⌘') > -1) el.title = el.title.replace(/⌘/g, 'Ctrl+');
    });
  }

  function renderAll() {
    renderTopbar();
    renderSidebar();
    renderMessages();
    renderComposerHint();
    applyPlatformKeys();
  }

  function renderComposerHint() {
    const hint = $('.composer-hint');
    if (!hint) return;
    hint.innerHTML =
      state.settings.sendKey === 'enter'
        ? '<span class="kbd">↵</span> send <span class="kbd">⇧↵</span> newline'
        : '<span class="kbd">⌘</span><span class="kbd">↵</span> send';
  }

  function scrollToBottom(force) {
    const t = els.thread;
    if (!t) return;
    const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 160;
    if (force || nearBottom) t.scrollTop = t.scrollHeight + 200;
  }

  function updateStreamingNode(msg) {
    const node = els.messages.querySelector(`[data-msg="${msg.id}"] .prose`);
    if (!node) return;
    node.innerHTML = renderMarkdown(msg.content) + (msg.streaming ? '<span class="caret"></span>' : '');
    const dot = els.messages.querySelector(`[data-msg="${msg.id}"] .streaming-dot`);
    if (dot && !msg.streaming) dot.remove();
    scrollToBottom(false);
  }

  /* ---------------------------- chat lifecycle ---------------------------- */
  function createChat(prompt) {
    const model = state.settings.model;
    const chat = {
      id: uid(),
      title: 'New chat',
      model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false
    };
    if (prompt) chat.title = titleFrom(prompt);
    state.chats.unshift(chat);
    state.activeId = chat.id;
    persist();
    renderAll();
    return chat;
  }

  function titleFrom(text) {
    const clean = String(text).replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').slice(0, 7).join(' ');
    const t = words.length > 46 ? words.slice(0, 46).trimEnd() + '…' : words;
    return t.charAt(0).toUpperCase() + t.slice(1) || 'New chat';
  }

  function openChat(id) {
    state.activeId = id;
    const chat = activeChat();
    if (chat && !chat.model) chat.model = state.settings.model;
    persist();
    renderAll();
    if (window.innerWidth <= 900) setSidebar(false);
    scrollToBottom(true);
  }

  function deleteChat(id, skipConfirm) {
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) return;
    const run = () => {
      state.chats = state.chats.filter((c) => c.id !== id);
      if (state.activeId === id) state.activeId = state.chats.length ? state.chats[0].id : null;
      persistNow();
      renderAll();
      toast('Conversation deleted', 'trash-2');
    };
    if (skipConfirm) return run();
    confirmAction({
      title: 'Delete conversation?',
      body: `“${esc(chat.title)}” and its ${chat.messages.length} messages will be removed from this browser. This cannot be undone.`,
      ok: 'Delete'
    }).then((yes) => { if (yes) run(); });
  }

  function clearChat(id) {
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) return;
    confirmAction({
      title: 'Clear this conversation?',
      body: 'All messages will be removed. The chat itself stays in your sidebar.',
      ok: 'Clear'
    }).then((yes) => {
      if (!yes) return;
      chat.messages = [];
      chat.updatedAt = Date.now();
      persistNow();
      renderAll();
      toast('Conversation cleared', 'check');
    });
  }

  function commitRename(value) {
    const id = state.renameId;
    if (!id) return;
    const chat = state.chats.find((c) => c.id === id);
    if (chat) {
      chat.title = (value || '').trim().slice(0, 80) || 'Untitled chat';
      chat.updatedAt = chat.updatedAt || Date.now();
    }
    state.renameId = null;
    persistNow();
    renderSidebar();
  }
  function cancelRename() {
    state.renameId = null;
    renderSidebar();
  }

  /* --------------------------------- menus -------------------------------- */
  let openMenu = null;
  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
      $$('.chat-row.menu-open').forEach((r) => r.classList.remove('menu-open'));
    }
  }
  function showMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items
      .map((it) =>
        it === 'sep'
          ? '<hr />'
          : `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-item="${it.key}">${ic(it.icon, 14)}<span>${esc(it.label)}</span></button>`
      )
      .join('');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 180;
    const h = menu.offsetHeight || 160;
    menu.style.left = `${clamp(r.right - w, 10, window.innerWidth - w - 10)}px`;
    menu.style.top = `${clamp(r.bottom + 6, 10, window.innerHeight - h - 10)}px`;
    openMenu = menu;
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-item]');
      if (btn) {
        const item = items.find((it) => it !== 'sep' && it.key === btn.dataset.item);
        closeMenu();
        if (item && item.action) item.action();
      }
    });
    const row = anchor.closest('.chat-row');
    if (row) row.classList.add('menu-open');
  }

  document.addEventListener('pointerdown', (e) => {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  });

  /* -------------------------------- dialogs ------------------------------- */
  function openDialog(dlg, focusSel) {
    if (!dlg) return;
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') {
        try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
      } else {
        dlg.setAttribute('open', '');
      }
    }
    if (focusSel) setTimeout(() => { const el = $(focusSel, dlg); if (el) el.focus(); }, 30);
  }
  function closeDialog(dlg) {
    if (!dlg) return;
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    else dlg.removeAttribute('open');
  }

  $$('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) closeDialog(dlg);
    });
    $$('[data-close]', dlg).forEach((btn) =>
      btn.addEventListener('click', () => closeDialog($('#' + btn.dataset.close)))
    );
  });

  /* ------------------------------ model picker ---------------------------- */
  function renderModelList(filter = '') {
    const q = filter.trim().toLowerCase();
    const current = currentModelId();
    const favs = state.settings.favorites || [];
    const matches = M.MODELS.filter((m) => {
      if (!q) return true;
      const p = M.providerOf(m);
      return [m.name, p.name, m.tier, m.blurb, m.id, ...(m.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

    if (!matches.length) {
      els.modelList.innerHTML = `<div class="pick-empty">No models match “${esc(filter)}”.<br />Try “claude”, “fast” or “reasoning”.</div>`;
      return;
    }

    const favorites = matches.filter((m) => favs.includes(m.id));
    const others = matches.filter((m) => !favs.includes(m.id));

    const item = (m) => {
      const p = M.providerOf(m);
      const starred = favs.includes(m.id);
      const isCurrent = m.id === current;
      const keyed = hasKeyFor(m);
      return `<button class="pick-item${isCurrent ? ' current' : ''}" data-model-id="${m.id}" role="option" aria-selected="${isCurrent}">
        ${modelBadge(m)}
        <span class="info">
          <strong>${esc(m.name)}
            <span class="tag">${esc(m.tier)}</span>
            ${keyed ? `<span class="tag" style="color:#8ee8c6;border-color:rgba(58,213,160,.28)">key</span>` : ''}
          </strong>
          <span>${esc(p.name)} · ${esc(m.context)} context · ${esc(m.blurb)}</span>
        </span>
        <span class="right">
          ${isCurrent ? `<span class="check">${ic('check', 14)}</span>` : ''}
          <span class="star${starred ? ' on' : ''}" data-star="${m.id}" role="button" tabindex="0" aria-label="${starred ? 'Unstar' : 'Star'} ${esc(m.name)}" title="${starred ? 'Unstar' : 'Star'}">${starred ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M12 2.6 15 9l6.9.6-5.2 4.6 1.5 6.8L12 17.4 5.8 21l1.5-6.8L2.1 9.6 9 9z"/></svg>' : ic('star', 14)}</span>
        </span>
      </button>`;
    };

    const group = (label, list) =>
      list.length
        ? `<div class="pick-group">${label}</div>${list.map(item).join('')}`
        : '';

    els.modelList.innerHTML =
      group('Starred', favorites) +
      (q ? group('All models', others) : group('Anthropic · OpenAI · Google · open models', others));

    const foot = $('#keysFoot');
    const n = connectedKeyCount();
    if (foot) {
      const live = hasKeyFor(currentModel());
      foot.textContent = n
        ? `${n} key${n === 1 ? '' : 's'} connected · ${live ? 'streaming live' : 'demo for this model'}`
        : 'No API keys connected · demo replies';
    }
  }

  function selectModel(id) {
    const model = M.byId(id);
    const chat = activeChat();
    if (chat && chat.messages.length) {
      // mid-conversation switch: keep the default for new chats untouched
      chat.model = id;
      chat.updatedAt = Date.now();
    } else {
      // starting model for this empty chat, and for the next new chat
      if (chat) chat.model = id;
      state.settings.model = id;
    }
    persistNow();
    renderTopbar();
    renderMessages();
    renderDefaultSelect();
    if (!hasKeyFor(model)) {
      toast(`${model.name} selected · demo mode`, 'sparkles');
    } else {
      toast(`Switched to ${model.name}`, 'check');
    }
  }

  function setDefaultModel(id) {
    state.settings.model = id;
    const chat = activeChat();
    if (chat && !chat.messages.length) chat.model = id;
    persistNow();
    renderAll();
    renderDefaultSelect();
    toast(`Default model: ${M.byId(id).name}`, 'check');
  }

  els.modelBtn.addEventListener('click', openModelPicker);
  $('#composerModel').addEventListener('click', openModelPicker);
  function openModelPicker() {
    state.modelPickerFor = 'current';
    renderModelList('');
    els.modelSearch.value = '';
    openDialog(els.modelDialog, '#modelSearch');
  }

  els.modelSearch.addEventListener('input', () => renderModelList(els.modelSearch.value));
  els.modelSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = els.modelList.querySelector('.pick-item');
      if (first) {
        if (state.modelPickerFor === 'default') setDefaultModel(first.dataset.modelId);
        else selectModel(first.dataset.modelId);
        closeDialog(els.modelDialog);
      }
    }
  });

  els.modelList.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      e.stopPropagation();
      toggleFavorite(star.dataset.star);
      renderModelList(els.modelSearch.value);
      return;
    }
    const item = e.target.closest('[data-model-id]');
    if (item) {
      if (state.modelPickerFor === 'default') setDefaultModel(item.dataset.modelId);
      else selectModel(item.dataset.modelId);
      closeDialog(els.modelDialog);
    }
  });
  els.modelList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const star = e.target.closest('[data-star]');
      if (star) {
        e.preventDefault();
        toggleFavorite(star.dataset.star);
        renderModelList(els.modelSearch.value);
      }
    }
  });

  function toggleFavorite(id) {
    const favs = state.settings.favorites || [];
    state.settings.favorites = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
    persist();
    renderModelPrefs();
  }

  $('#manageKeysBtn').addEventListener('click', () => {
    closeDialog(els.modelDialog);
    openSettings('keys');
  });

  /* ---------------------------- command palette --------------------------- */
  let cmdItems = [];
  let cmdCursor = 0;

  function buildCommands(query) {
    const q = query.trim().toLowerCase();
    const actions = [
      { label: 'New chat', icon: 'plus', hint: '⌘N', run: () => { closeDialog(els.cmdDialog); newChat(); } },
      { label: 'Switch model', icon: 'layers', hint: '⌘M', run: () => { closeDialog(els.cmdDialog); openModelPicker(); } },
      { label: 'Open settings', icon: 'settings', hint: '⌘,', run: () => { closeDialog(els.cmdDialog); openSettings('general'); } },
      { label: 'Manage API keys', icon: 'key-round', run: () => { closeDialog(els.cmdDialog); openSettings('keys'); } },
      { label: 'Toggle sidebar', icon: 'panel-left', hint: '⌘B', run: () => { closeDialog(els.cmdDialog); toggleSidebar(); } },
      { label: 'Export conversation', icon: 'download', run: () => { closeDialog(els.cmdDialog); openShare(); } },
      { label: 'Clear current conversation', icon: 'rotate-ccw', run: () => { closeDialog(els.cmdDialog); const c = activeChat(); if (c) clearChat(c.id); } },
      { label: 'Copy last reply', icon: 'copy', run: () => { closeDialog(els.cmdDialog); copyLastReply(); } },
      { label: 'Load a sample conversation', icon: 'sparkles', run: () => { closeDialog(els.cmdDialog); loadSample(); } },
      { label: 'Documentation', icon: 'book-open', run: () => { window.location.href = 'docs.html'; } },
      { label: 'Back to eltes.ai', icon: 'arrow-left', run: () => { window.location.href = 'index.html'; } }
    ];

    const chats = state.chats.map((c) => ({
      label: c.title,
      icon: 'message-square',
      hint: new Date(c.updatedAt || c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      run: () => { closeDialog(els.cmdDialog); openChat(c.id); }
    }));

    const filteredActions = actions.filter((a) => !q || a.label.toLowerCase().includes(q));
    const filteredChats = chats.filter((c) => !q || c.label.toLowerCase().includes(q));
    return { actions: filteredActions, chats: filteredChats };
  }

  function renderCmd(query = '') {
    const { actions, chats } = buildCommands(query);
    cmdItems = [...actions, ...chats];
    cmdCursor = 0;
    if (!cmdItems.length) {
      els.cmdList.innerHTML = `<div class="pick-empty">Nothing matches “${esc(query)}”.</div>`;
      $('#cmdCount').textContent = '0 results';
      return;
    }
    const row = (item, index) => `<button class="cmd-item${index === 0 ? ' cursor' : ''}" data-cmd="${index}" role="option">
      ${ic(item.icon, 15)}
      <span class="trunc">${esc(item.label)}</span>
      ${item.hint ? `<span class="hint">${esc(item.hint)}</span>` : ''}
    </button>`;
    let html = '';
    if (actions.length) html += `<div class="pick-group">Actions</div>${actions.map((a, i) => row(a, i)).join('')}`;
    if (chats.length) {
      html += `<div class="pick-group">Conversations</div>${chats
        .map((c, i) => row(c, actions.length + i))
        .join('')}`;
    }
    els.cmdList.innerHTML = html;
    $('#cmdCount').textContent = `${cmdItems.length} result${cmdItems.length === 1 ? '' : 's'}`;
  }

  function openCommandPalette() {
    els.cmdSearch.value = '';
    renderCmd('');
    openDialog(els.cmdDialog, '#cmdSearch');
  }

  function moveCursor(delta) {
    if (!cmdItems.length) return;
    cmdCursor = (cmdCursor + delta + cmdItems.length) % cmdItems.length;
    const rows = $$('.cmd-item', els.cmdList);
    rows.forEach((r, i) => r.classList.toggle('cursor', i === cmdCursor));
    const el = rows[cmdCursor];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function runCmd(index) {
    const item = cmdItems[index];
    if (item && item.run) item.run();
  }

  els.cmdSearch.addEventListener('input', () => renderCmd(els.cmdSearch.value));
  els.cmdList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (btn) runCmd(Number(btn.dataset.cmd));
  });
  els.cmdList.addEventListener('pointermove', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    cmdCursor = Number(btn.dataset.cmd);
    $$('.cmd-item', els.cmdList).forEach((r, i) => r.classList.toggle('cursor', i === cmdCursor));
  });
  e_keydown(els.cmdSearch, (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
    if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdCursor); }
  });

  function e_keydown(el, fn) { el.addEventListener('keydown', fn); }

  /* -------------------------------- settings ------------------------------ */
  function openSettings(tab = 'general') {
    renderKeyList();
    renderModelPrefs();
    renderDefaultSelect();
    applySettingsToUI();
    setTab(tab);
    openDialog(els.settingsDialog);
  }

  function setTab(name) {
    $$('.settings-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('#settingsPanel > section').forEach((s) => s.classList.toggle('active', s.dataset.panel === name));
    const panel = $('#settingsPanel');
    if (panel) panel.scrollTop = 0;
  }

  $$('.settings-nav button').forEach((btn) =>
    btn.addEventListener('click', () => setTab(btn.dataset.tab))
  );

  function applySettingsToUI() {
    const s = state.settings;
    const setToggle = (id, val) => {
      const t = $(id);
      if (t) t.setAttribute('aria-checked', String(!!val));
    };
    setToggle('#toggleStream', s.stream);
    setToggle('#toggleAgent', s.agent);
    setToggle('#toggleMotion', s.reduceMotion);
    setToggle('#toggleTime', s.showTime);
    const sendKey = $('#sendKeySelect');
    if (sendKey) sendKey.value = s.sendKey;
    const density = $('#densitySelect');
    if (density) density.value = s.density;
    const customUrl = $('#customBaseUrl');
    if (customUrl) customUrl.value = s.customBaseUrl || '';
    const customKey = $('#customKey');
    if (customKey) customKey.value = s.customKey || '';
    const customModel = $('#customModel');
    if (customModel) customModel.value = s.customModel || '';
    $('#defaultModelLabel') && ($('#defaultModelLabel').textContent = M.byId(s.model).name);
    document.body.classList.toggle('compact', s.density === 'compact');
    document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
    renderComposerHint();
    applyPlatformKeys();
  }

  function bindToggle(sel, key, after) {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('click', () => {
      state.settings[key] = !state.settings[key];
      el.setAttribute('aria-checked', String(state.settings[key]));
      persist();
      if (after) after();
    });
  }
  bindToggle('#toggleStream', 'stream');
  bindToggle('#toggleAgent', 'agent', () => {
    $('#agentChip').classList.toggle('on', state.settings.agent);
    $('#agentChip').setAttribute('aria-pressed', String(state.settings.agent));
  });
  bindToggle('#toggleMotion', 'reduceMotion', applySettingsToUI);
  bindToggle('#toggleTime', 'showTime', renderMessages);

  $('#sendKeySelect').addEventListener('change', (e) => {
    state.settings.sendKey = e.target.value;
    persist();
    renderComposerHint();
  });
  $('#densitySelect').addEventListener('change', (e) => {
    state.settings.density = e.target.value;
    persist();
    applySettingsToUI();
  });

  $('#defaultModelBtn').addEventListener('click', () => {
    state.modelPickerFor = 'default';
    renderModelList('');
    els.modelSearch.value = '';
    openDialog(els.modelDialog, '#modelSearch');
  });

  function renderDefaultSelect() {
    const sel = $('#defaultModelSelect');
    if (!sel) return;
    sel.innerHTML = M.MODELS.map(
      (m) => `<option value="${m.id}"${m.id === state.settings.model ? ' selected' : ''}>${esc(m.name)}</option>`
    ).join('');
  }
  $('#defaultModelSelect').addEventListener('change', (e) => setDefaultModel(e.target.value));

  function renderKeyList() {
    const providers = Object.keys(M.PROVIDERS).filter((p) => p !== 'custom');
    els.keyList.innerHTML = providers
      .map((id) => {
        const p = M.PROVIDERS[id];
        const val = state.settings.keys[id] || '';
        const connected = !!val;
        return `<div class="key-provider${connected ? ' connected' : ''}" data-provider="${id}">
          <div class="key-top">
            <span class="mb ${p.cls}">${esc(p.badge)}</span>
            <span class="who"><strong>${esc(p.name)}</strong><span>${esc(p.blurb)}</span></span>
            <span class="key-status${connected ? ' ok' : ''}"><i></i>${connected ? 'Connected' : 'No key'}</span>
          </div>
          <div class="key-input-row">
            <label class="key-input">
              <span data-icon="key-round" data-icon-size="13"></span>
              <input type="${connected ? 'password' : 'text'}" data-key-input="${id}" value="${esc(val)}" placeholder="${esc(p.keyHint)}" aria-label="${esc(p.name)} API key" autocomplete="off" spellcheck="false" />
              <button class="icon-btn" data-reveal="${id}" aria-label="Show or hide key" title="Show or hide">${ic('eye', 13)}</button>
            </label>
            <div class="key-actions">
              <button class="btn btn-ghost btn-sm" data-save-key="${id}">Save</button>
              ${connected ? `<button class="icon-btn" data-remove-key="${id}" aria-label="Remove key" title="Remove">${ic('trash-2', 14)}</button>` : ''}
            </div>
          </div>
          <div class="key-help"><span data-icon="lock" data-icon-size="10"></span>Stored locally · <a href="${p.keyUrl}" target="_blank" rel="noreferrer">get a ${esc(p.name)} key</a></div>
        </div>`;
      })
      .join('');
    I.hydrate(els.keyList);
  }

  els.keyList.addEventListener('click', (e) => {
    const reveal = e.target.closest('[data-reveal]');
    if (reveal) {
      const input = els.keyList.querySelector(`[data-key-input="${reveal.dataset.reveal}"]`);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        reveal.innerHTML = ic(input.type === 'password' ? 'eye' : 'eye-off', 13);
      }
      return;
    }
    const save = e.target.closest('[data-save-key]');
    if (save) {
      const id = save.dataset.saveKey;
      const input = els.keyList.querySelector(`[data-key-input="${id}"]`);
      const value = (input.value || '').trim();
      if (value) state.settings.keys[id] = value;
      else delete state.settings.keys[id];
      persistNow();
      renderKeyList();
      renderTopbar();
      renderModelList(els.modelSearch.value);
      toast(value ? `${M.PROVIDERS[id].name} key saved locally` : `${M.PROVIDERS[id].name} key removed`, value ? 'check' : 'trash-2');
      return;
    }
    const remove = e.target.closest('[data-remove-key]');
    if (remove) {
      delete state.settings.keys[remove.dataset.removeKey];
      persistNow();
      renderKeyList();
      renderTopbar();
      renderModelList(els.modelSearch.value);
      toast(`${M.PROVIDERS[remove.dataset.removeKey].name} key removed`, 'trash-2');
    }
  });

  $('#customSave').addEventListener('click', () => {
    const url = ($('#customBaseUrl').value || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) {
      toast('Base URL must start with http:// or https://', 'triangle-alert');
      return;
    }
    state.settings.customBaseUrl = url;
    state.settings.customModel = ($('#customModel').value || '').trim();
    state.settings.customKey = ($('#customKey').value || '').trim();
    persistNow();
    renderTopbar();
    toast(url ? 'Custom endpoint saved' : 'Custom endpoint cleared', url ? 'check' : 'trash-2');
  });

  function renderModelPrefs() {
    const favs = state.settings.favorites || [];
    els.modelPrefs.innerHTML = M.MODELS.map((m) => {
      const p = M.providerOf(m);
      const on = favs.includes(m.id);
      return `<div class="set-row">
        <span class="mb ${p.cls}" style="width:26px;height:26px;border-radius:7px;display:grid;place-items:center;font-size:10px;font-weight:650;color:#fff">${esc(p.badge)}</span>
        <div class="lbl"><strong>${esc(m.name)}</strong><span>${esc(p.name)} · ${esc(m.context)} · ${esc(m.tier)}</span></div>
        <div class="ctl">
          <button class="toggle" role="switch" aria-checked="${on}" data-fav="${m.id}" aria-label="Star ${esc(m.name)}"></button>
        </div>
      </div>`;
    }).join('');
  }
  els.modelPrefs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fav]');
    if (!btn) return;
    toggleFavorite(btn.dataset.fav);
    btn.setAttribute('aria-checked', String((state.settings.favorites || []).includes(btn.dataset.fav)));
    renderModelList(els.modelSearch.value);
  });

  /* --------------------------------- data --------------------------------- */
  function download(filename, text, type = 'text/plain') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function exportAll() {
    const payload = {
      app: 'Eltes',
      version: 1,
      exportedAt: new Date().toISOString(),
      chats: state.chats,
      settings: Object.assign({}, state.settings, { keys: {}, customKey: '' })
    };
    download(`eltes-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup downloaded (keys excluded)', 'download');
  }

  $('#exportAll').addEventListener('click', exportAll);
  $('#exportChats').addEventListener('click', exportAll);
  $('#refreshStorage').addEventListener('click', () => {
    updateStorageUI();
    toast('Storage usage refreshed', 'refresh-cw');
  });

  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.chats)) throw new Error('bad file');
        state.chats = data.chats;
        if (data.settings) {
          const keys = state.settings.keys;
          state.settings = Object.assign({}, DEFAULTS, data.settings, { keys });
        }
        state.activeId = state.chats.length ? state.chats[0].id : null;
        persistNow();
        applySettingsToUI();
        renderKeyList();
        renderModelPrefs();
        renderDefaultSelect();
        renderAll();
        toast(`Imported ${state.chats.length} conversations`, 'check');
      } catch (err) {
        toast('That file is not an Eltes backup', 'triangle-alert');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#clearChats').addEventListener('click', () => {
    confirmAction({
      title: 'Delete all chats?',
      body: `All ${state.chats.length} conversations will be removed from this browser. API keys and settings are kept. Export a backup first if you need one.`,
      ok: 'Delete all'
    }).then((yes) => {
      if (!yes) return;
      state.chats = [];
      state.activeId = null;
      persistNow();
      renderAll();
      toast('All conversations deleted', 'trash-2');
    });
  });

  /* -------------------------------- share --------------------------------- */
  function transcriptMarkdown(chat) {
    const lines = [`# ${chat.title}`, '', `Model: ${M.byId(chat.model).name} · ${new Date(chat.createdAt).toLocaleString()}`, ''];
    (chat.messages || []).forEach((m) => {
      if (m.role === 'user') {
        lines.push('## You', '', m.content, '');
      } else {
        lines.push(`## Eltes (${M.byId(m.model || chat.model).name})`, '', m.content, '');
        if (m.steps && m.steps.length) {
          lines.push(`<sub>Agent steps: ${m.steps.map((s) => `${s.tool} ${s.arg}`).join(' · ')}</sub>`, '');
        }
      }
    });
    lines.push('---', 'Exported from Eltes — local-first AI workspace.');
    return lines.join('\n');
  }

  function openShare() {
    const chat = activeChat();
    const preview = $('#sharePreview');
    if (!chat || !chat.messages.length) {
      preview.textContent = 'No conversation yet. Send a message first, then export it.';
    } else {
      preview.textContent = transcriptMarkdown(chat).slice(0, 420) + (transcriptMarkdown(chat).length > 420 ? '\n…' : '');
    }
    openDialog(els.shareDialog);
  }

  $('#shareBtn').addEventListener('click', openShare);

  $('#copyTranscript').addEventListener('click', () => {
    const chat = activeChat();
    if (!chat || !chat.messages.length) return toast('Nothing to copy yet', 'triangle-alert');
    copyText(transcriptMarkdown(chat));
  });

  $('#downloadMarkdown').addEventListener('click', () => {
    const chat = activeChat();
    if (!chat || !chat.messages.length) return toast('Nothing to export yet', 'triangle-alert');
    const slug = (chat.title || 'conversation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    download(`${slug || 'eltes-chat'}.md`, transcriptMarkdown(chat), 'text/markdown');
    toast('Markdown downloaded', 'download');
  });

  $('#downloadJson').addEventListener('click', () => {
    const chat = activeChat();
    if (!chat || !chat.messages.length) return toast('Nothing to export yet', 'triangle-alert');
    download(`eltes-chat-${chat.id}.json`, JSON.stringify({ app: 'Eltes', chat }, null, 2), 'application/json');
    toast('JSON downloaded', 'download');
  });

  $('#docsBtn').addEventListener('click', () => { window.location.href = 'docs.html'; });
  $('#demoPill').addEventListener('click', () => openSettings('keys'));
  $('#settingsBtn').addEventListener('click', () => openSettings('general'));
  $('#profileCard').addEventListener('click', () => openSettings('general'));
  $('#profileCard').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettings('general'); }
  });
  $('#cmdBtn').addEventListener('click', openCommandPalette);
  $('#searchBtn').addEventListener('click', openCommandPalette);

  /* -------------------------------- confirm ------------------------------- */
  let confirmResolve = null;
  function confirmAction({ title, body, ok = 'Delete' }) {
    $('#confirmTitle').textContent = title;
    $('#confirmBody').innerHTML = body;
    $('#confirmOk').textContent = ok;
    openDialog(els.confirmDialog);
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  const settleConfirm = (val) => {
    closeDialog(els.confirmDialog);
    if (confirmResolve) { confirmResolve(val); confirmResolve = null; }
  };
  $('#confirmOk').addEventListener('click', () => settleConfirm(true));
  $('#confirmCancel').addEventListener('click', () => settleConfirm(false));
  els.confirmDialog.addEventListener('close', () => { if (confirmResolve) { confirmResolve(false); confirmResolve = null; } });

  /* ------------------------------- sidebar -------------------------------- */
  function setSidebar(open) {
    const mobile = window.innerWidth <= 900;
    els.shell.classList.toggle('collapsed', !open);
    els.backdrop.classList.toggle('show', mobile && open);
  }
  function toggleSidebar() {
    const open = els.shell.classList.contains('collapsed');
    setSidebar(open);
  }
  $('#sidebarBtn').addEventListener('click', toggleSidebar);
  $('#collapseBtn').addEventListener('click', () => setSidebar(false));
  els.backdrop.addEventListener('click', () => setSidebar(false));
  els.newChatBtn = $('#newChatBtn');
  els.newChatBtn.addEventListener('click', () => newChat());

  function newChat() {
    if (state.sending) stopGeneration();
    const current = activeChat();
    if (!current || !current.messages.length) {
      // the welcome screen already is a blank chat — keep any draft intact
      els.input.focus();
      if (window.innerWidth <= 900) setSidebar(false);
      return;
    }
    createChat();
    els.input.value = '';
    autoGrow();
    updateSendState();
    els.input.focus();
    if (window.innerWidth <= 900) setSidebar(false);
  }

  // chat list delegation
  els.chatList.addEventListener('click', (e) => {
    const star = e.target.closest('[data-pin]');
    if (star) {
      e.stopPropagation();
      const chat = state.chats.find((c) => c.id === star.dataset.pin);
      if (chat) {
        chat.pinned = !chat.pinned;
        persistNow();
        renderSidebar();
        toast(chat.pinned ? 'Pinned to top' : 'Unpinned', 'pin');
      }
      return;
    }
    const more = e.target.closest('[data-menu]');
    if (more) {
      e.stopPropagation();
      const chat = state.chats.find((c) => c.id === more.dataset.menu);
      if (!chat) return;
      showMenu(more, [
        { key: 'pin', label: chat.pinned ? 'Unpin conversation' : 'Pin conversation', icon: 'pin', action: () => { chat.pinned = !chat.pinned; persistNow(); renderSidebar(); } },
        { key: 'rename', label: 'Rename', icon: 'pencil', action: () => { state.renameId = chat.id; renderSidebar(); } },
        { key: 'clear', label: 'Clear messages', icon: 'rotate-ccw', action: () => clearChat(chat.id) },
        { key: 'export', label: 'Export as Markdown', icon: 'download', action: () => { openChat(chat.id); openShare(); } },
        'sep',
        { key: 'delete', label: 'Delete', icon: 'trash-2', danger: true, action: () => deleteChat(chat.id) }
      ]);
      return;
    }
    if (e.target.closest('.rename-input')) return;
    const row = e.target.closest('[data-chat]');
    if (row) openChat(row.dataset.chat);
  });
  els.chatList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('chat-row')) {
      e.preventDefault();
      openChat(e.target.dataset.chat);
    }
  });

  /* -------------------------------- composer ------------------------------ */
  function autoGrow() {
    const ta = els.input;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 190)}px`;
  }
  els.input.addEventListener('input', () => {
    autoGrow();
    updateSendState();
  });
  els.input.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter') {
      if (state.settings.sendKey === 'enter' && !e.shiftKey && !mod) {
        e.preventDefault();
        send();
      } else if (state.settings.sendKey === 'mod-enter' && mod) {
        e.preventDefault();
        send();
      }
    }
  });

  els.send.addEventListener('click', () => {
    if (state.sending) stopGeneration();
    else send();
  });

  $('#agentChip').classList.toggle('on', state.settings.agent);
  $('#agentChip').addEventListener('click', () => {
    state.settings.agent = !state.settings.agent;
    $('#agentChip').classList.toggle('on', state.settings.agent);
    $('#agentChip').setAttribute('aria-pressed', String(state.settings.agent));
    $('#toggleAgent') && $('#toggleAgent').setAttribute('aria-checked', String(state.settings.agent));
    persist();
    toast(state.settings.agent ? 'Agent steps enabled for demo runs' : 'Agent steps off', 'bot');
  });

  const LANG_BY_EXT = {
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', json: 'json',
    css: 'css', scss: 'css', html: 'html', xml: 'xml', py: 'python', go: 'go',
    rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', sh: 'bash', sql: 'sql',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', env: 'bash', csv: 'csv', log: 'text',
    ini: 'ini', md: 'markdown', markdown: 'markdown', txt: 'text'
  };

  async function attachFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let added = 0;
    let bytes = 0;
    for (const file of files) {
      if (file.size > 400 * 1024) {
        toast(`${file.name} is too large (max 400 KB per file)`, 'triangle-alert');
        continue;
      }
      bytes += file.size;
      if (bytes > 800 * 1024) {
        toast('Attachments are limited to 800 KB in total', 'triangle-alert');
        break;
      }
      let text;
      try {
        text = await file.text();
      } catch (e) {
        toast(`${file.name} could not be read`, 'triangle-alert');
        continue;
      }
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const lang = LANG_BY_EXT[ext] || 'text';
      const fence = text.includes('```') ? '````' : '```';
      const current = els.input.value.trimEnd();
      const sep = current ? '\n\n' : '';
      els.input.value = `${current}${sep}**${file.name}** (${Math.max(1, Math.round(file.size / 1024))} KB)\n${fence}${lang}\n${text.replace(/\n$/, '')}\n${fence}\n`;
      added++;
    }
    if (added) {
      autoGrow();
      updateSendState();
      els.input.focus();
      els.input.scrollTop = els.input.scrollHeight;
      toast(`${added} file${added === 1 ? '' : 's'} attached to this prompt`, 'paperclip');
    }
  }

  $('#attachBtn').addEventListener('click', () => $('#attachInput').click());
  $('#attachInput').addEventListener('change', (e) => {
    attachFiles(e.target.files);
    e.target.value = '';
  });

  const composerEl = $('#composer');
  if (composerEl) {
    composerEl.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      composerEl.classList.add('dragging');
    });
    composerEl.addEventListener('dragleave', () => composerEl.classList.remove('dragging'));
    composerEl.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      composerEl.classList.remove('dragging');
      attachFiles(e.dataTransfer.files);
    });
  }

  const sampleBtn = $('#sampleBtn');
  if (sampleBtn) sampleBtn.addEventListener('click', () => loadSample());

  $$('.suggestion').forEach((btn) =>
    btn.addEventListener('click', () => {
      els.input.value = btn.dataset.prompt || '';
      autoGrow();
      updateSendState();
      els.input.focus();
    })
  );

  /* -------------------------------- sending ------------------------------- */
  function setSending(on) {
    state.sending = on;
    els.send.classList.toggle('stop', on);
    els.send.innerHTML = on ? '<span class="stop-square"></span>' : ic('arrow-up', 17);
    els.send.setAttribute('aria-label', on ? 'Stop generating' : 'Send message');
    updateSendState();
  }

  function updateSendState() {
    if (!els.send) return;
    els.send.disabled = !state.sending && !els.input.value.trim();
  }

  function stopGeneration() {
    state.stopped = true;
    if (state.abort) { try { state.abort.abort(); } catch (e) {} }
    toast('Generation stopped', 'square');
  }

  function chatHistoryFor(chat, uptoId) {
    return chat.messages
      .filter((m) => !m.streaming && !m.error && m.content && (!uptoId || m.id !== uptoId))
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async function send() {
    const text = els.input.value.trim();
    if (!text || state.sending) return;
    let chat = activeChat();
    if (!chat) chat = createChat(text);
    if (!chat.model) chat.model = state.settings.model;

    const userMsg = { id: uid(), role: 'user', content: text, ts: Date.now() };
    chat.messages.push(userMsg);
    if (chat.messages.filter((m) => m.role === 'user').length === 1) chat.title = titleFrom(text);
    chat.updatedAt = Date.now();

    const assistant = {
      id: uid(),
      role: 'assistant',
      content: '',
      model: chat.model,
      ts: Date.now(),
      streaming: true,
      steps: []
    };
    chat.messages.push(assistant);

    els.input.value = '';
    autoGrow();
    persist();
    renderSidebar();
    renderMessages();
    scrollToBottom(true);
    setSending(true);
    await runAssistant(chat, assistant, text);
  }

  async function runAssistant(chat, assistant, prompt, opts = {}) {
    state.stopped = false;
    const model = M.byId(assistant.model || chat.model);
    const node = () => els.messages.querySelector(`[data-msg="${assistant.id}"]`);

    const useDemo = !hasKeyFor(model) || opts.forceDemo;

    if (state.settings.agent && !opts.noSteps && useDemo) {
      await animateSteps(assistant);
    }

    if (useDemo) {
      await sleep(320 + Math.random() * 320);
      if (state.stopped) return finish(chat, assistant, true);
      const text = demoReply(prompt, model);
      try {
        await demoStream(text, assistant, node);
      } catch (e) {
        /* cancelled */
      }
    } else {
      try {
        await streamReal(model, chat, assistant, prompt, node);
      } catch (err) {
        if (err && err.name === 'AbortError') {
          // stopped by user
        } else {
          assistant.error = describeError(err, model);
          assistant.streaming = false;
          renderMessages();
        }
      }
    }

    return finish(chat, assistant, state.stopped);
  }

  function finish(chat, assistant, stopped) {
    assistant.streaming = false;
    if (!assistant.content && !assistant.error) {
      assistant.content = stopped ? '_Stopped before any tokens arrived._' : '_No content returned._';
    }
    chat.updatedAt = Date.now();
    persistNow();
    setSending(false);
    state.stopped = false;
    renderMessages();
    renderSidebar();
    scrollToBottom(false);
  }

  async function animateSteps(assistant) {
    const set = STEP_SETS[Math.floor(Math.random() * STEP_SETS.length)];
    const chosen = set.slice(0, 2 + Math.floor(Math.random() * (set.length - 1)));
    for (const step of chosen) {
      if (state.stopped) return;
      assistant.steps.push({ ...step, res: '', pending: true });
      renderMessages();
      scrollToBottom(false);
      await sleep(260 + Math.random() * 220);
      const last = assistant.steps[assistant.steps.length - 1];
      last.pending = false;
      last.res = step.res;
      renderMessages();
      scrollToBottom(false);
      await sleep(120);
    }
    await sleep(180);
  }

  async function demoStream(text, assistant, nodeGetter) {
    const chars = text.split('');
    let i = 0;
    while (i < chars.length) {
      if (state.stopped) break;
      const take = 2 + Math.floor(Math.random() * 4);
      assistant.content += chars.slice(i, i + take).join('');
      i += take;
      updateStreamingNode(assistant);
      const delay = state.settings.stream ? 9 + Math.random() * 16 : 0;
      if (delay) await sleep(delay);
      else await Promise.resolve();
      if (!state.settings.stream) break;
    }
    if (!state.settings.stream) {
      assistant.content = text;
      updateStreamingNode(assistant);
    }
  }

  function describeError(err, model) {
    const p = M.providerOf(model);
    const status = err && err.status;
    if (!navigator.onLine) {
      return { title: 'You are offline.', detail: 'The request never left the browser.', hint: 'Reconnect or use a demo reply.' };
    }
    if (status === 401 || status === 403) {
      return {
        title: `${p.name} rejected that key (${status}).`,
        detail: 'The request reached the provider, but the credential was not accepted.',
        hint: 'Open Settings → API keys and paste a fresh key for this provider.'
      };
    }
    if (status === 429) {
      return {
        title: `${p.name} rate limit reached (429).`,
        detail: 'Too many requests or no remaining quota on this key.',
        hint: 'Wait a moment, then retry. You can also finish this answer in demo mode.'
      };
    }
    if (status === 404) {
      return {
        title: `Model not available (404).`,
        detail: `${model.name} may not be enabled for your ${p.name} account.`,
        hint: 'Pick another model from the picker and try again.'
      };
    }
    if (err && err.message && /fetch|network|cors/i.test(err.message)) {
      return {
        title: `Could not reach ${p.name}.`,
        detail: 'Browsers block some direct API calls. Check your network, the key, or use an OpenAI-compatible proxy.',
        hint: 'Your key is still stored locally — nothing was sent to Eltes.'
      };
    }
    return {
      title: err && err.status ? `Request failed (${err.status}).` : 'Request failed.',
      detail: (err && err.message) || 'The provider did not return a usable response.',
      hint: 'Try again, switch models, or open Settings → API keys.'
    };
  }

  /* ------------------------------ real streaming -------------------------- */
  const SYSTEM_PROMPT =
    'You are Eltes, a precise and practical AI assistant inside a local-first workspace. ' +
    'Answer directly, use Markdown, and put code in fenced blocks with a language tag. ' +
    'Be concise unless the user asks for depth.';

  function buildRequest(model, chat, prompt, key) {
    const p = M.providerOf(model);
    const history = chatHistoryFor(chat).slice(-24);
    if (!history.length || history[history.length - 1].content !== prompt) {
      history.push({ role: 'user', content: prompt });
    }

    if (p.api === 'anthropic') {
      const base = 'https://api.anthropic.com/v1';
      return {
        kind: 'anthropic',
        url: `${base}/messages`,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: {
          model: model.apiId,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: history,
          stream: true
        }
      };
    }

    let base;
    if (model.provider === 'custom') base = state.settings.customBaseUrl;
    else base = p.baseUrl;
    base = (base || '').replace(/\/+$/, '');
    if (!base) throw new Error('No base URL configured for this endpoint.');

    if (model.provider === 'custom' && !state.settings.customModel) {
      throw new Error('Set a model ID for your custom endpoint in Settings → API keys.');
    }

    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    return {
      kind: 'openai',
      url: `${base}/chat/completions`,
      headers,
      body: {
        model: model.provider === 'custom'
          ? (state.settings.customModel || 'local-model')
          : model.apiId,
        messages: [
          { role: /^o\d/.test(model.apiId || '') ? 'developer' : 'system', content: SYSTEM_PROMPT },
          ...history
        ],
        stream: true
      }
    };
  }

  async function streamReal(model, chat, assistant, prompt, nodeGetter) {
    const provider = model.provider;
    const key = providerKey(provider);
    const req = buildRequest(model, chat, prompt, key);
    const controller = new AbortController();
    state.abort = controller;

    let res;
    try {
      res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error(`fetch failed: ${err.message}`);
    }

    if (!res.ok) {
      let detail = '';
      try {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          detail = (j.error && (j.error.message || j.error)) || j.message || '';
        } catch (e) {
          detail = text.slice(0, 300);
        }
      } catch (e) {}
      const error = new Error(detail || res.statusText || 'HTTP error');
      error.status = res.status;
      throw error;
    }

    if (!res.body) throw new Error('This browser cannot read streaming responses.');

    let animation = 0;
    const paint = () => {
      if (animation) return;
      animation = requestAnimationFrame(() => {
        animation = 0;
        assistant.content = assistant.content.replace(/\u200b$/, '');
        updateStreamingNode(assistant);
      });
    };

    const onJson = (obj) => {
      if (req.kind === 'anthropic') {
        if (obj.type === 'content_block_delta' && obj.delta && obj.delta.text) {
          assistant.content += obj.delta.text;
          assistant.content += '\u200b';
          paint();
        }
        if (obj.type === 'message_delta' && obj.delta && obj.delta.stop_reason) {
          assistant.content = assistant.content.replace(/\u200b/g, '');
        }
        if (obj.type === 'error') {
          throw new Error((obj.error && obj.error.message) || 'Anthropic stream error');
        }
      } else {
        const choice = (obj.choices && obj.choices[0]) || {};
        const delta = choice.delta || choice.message || {};
        const piece = delta.content || (choice.text ? choice.text : '');
        if (piece) {
          assistant.content += piece;
          paint();
        }
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop();
        for (const raw of parts) {
          const line = raw.trim();
          if (!line || line.startsWith('event:') || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            onJson(JSON.parse(payload));
          } catch (err) {
            if (err && err.throwUp) throw err;
            if (String(err.message || '').includes('stream error')) throw err;
          }
        }
      }
    } finally {
      if (animation) cancelAnimationFrame(animation);
      assistant.content = assistant.content.replace(/\u200b/g, '');
      updateStreamingNode(assistant);
      state.abort = null;
    }
  }

  /* ------------------------- message interactions ------------------------- */
  function findMsg(id) {
    const chat = activeChat();
    if (!chat) return {};
    return { chat, msg: chat.messages.find((m) => m.id === id), index: chat.messages.findIndex((m) => m.id === id) };
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text) {
    const done = () => toast('Copied to clipboard', 'clipboard-check');
    const fail = () => toast('Copy failed — select the text manually', 'triangle-alert');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => (legacyCopy(text) ? done() : fail()));
    } else if (legacyCopy(text)) {
      done();
    } else {
      fail();
    }
  }

  function copyLastReply() {
    const chat = activeChat();
    if (!chat) return toast('No conversation yet', 'triangle-alert');
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant' && m.content);
    if (last) copyText(last.content);
    else toast('No reply to copy yet', 'triangle-alert');
  }

  els.messages.addEventListener('click', async (e) => {
    const copyCode = e.target.closest('[data-copy-code]');
    if (copyCode) {
      const pre = copyCode.closest('.code').querySelector('pre');
      copyText(pre.innerText);
      copyCode.classList.add('copied');
      copyCode.innerHTML = `${ic('check', 11)}<span>Copied</span>`;
      setTimeout(() => {
        copyCode.classList.remove('copied');
        copyCode.innerHTML = `${ic('copy', 11)}<span>Copy</span>`;
      }, 1600);
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const { chat, msg, index } = findMsg(id);
    if (!chat || !msg) return;

    if (act === 'copy') {
      copyText(msg.content);
      return;
    }

    if (act === 'good' || act === 'bad') {
      msg.rating = msg.rating === (act === 'good' ? 'up' : 'down') ? null : act === 'good' ? 'up' : 'down';
      persist();
      renderMessages();
      if (msg.rating) toast(msg.rating === 'up' ? 'Feedback saved locally' : 'Noted — try another model', 'thumbs-up');
      return;
    }

    if (act === 'edit') {
      if (state.sending) return toast('Stop the current reply first', 'triangle-alert');
      els.input.value = msg.content;
      chat.messages = chat.messages.slice(0, index);
      chat.updatedAt = Date.now();
      persistNow();
      renderAll();
      autoGrow();
      updateSendState();
      els.input.focus();
      return;
    }

    if (act === 'regen') {
      if (state.sending) return toast('Already generating', 'triangle-alert');
      // if this is a stale assistant message, drop it and everything after
      if (index < chat.messages.length - 1) chat.messages = chat.messages.slice(0, index);
      const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user');
      if (!lastUser) return toast('Nothing to retry yet', 'triangle-alert');
      Object.assign(msg, { content: '', error: null, streaming: true, steps: [], ts: Date.now() });
      persistNow();
      renderMessages();
      setSending(true);
      await runAssistant(chat, msg, lastUser.content, { forceDemo: act === 'demo' });
      return;
    }

    if (act === 'demo') {
      if (state.sending) return;
      const promptMsg = [...chat.messages].slice(0, index).reverse().find((m) => m.role === 'user');
      msg.error = null;
      msg.content = '';
      msg.streaming = true;
      renderMessages();
      setSending(true);
      await runAssistant(chat, msg, promptMsg ? promptMsg.content : 'Hello', { forceDemo: true, noSteps: false });
    }
  });

  /* -------------------------------- sample -------------------------------- */
  function loadSample() {
    const chat = {
      id: uid(),
      title: 'Debounce hook for search input',
      model: 'claude-sonnet-4-5',
      createdAt: Date.now() - 1000 * 60 * 26,
      updatedAt: Date.now(),
      pinned: false,
      messages: [
        {
          id: uid(),
          role: 'user',
          content: 'Write a debounce hook for a search input in React, then explain why the cleanup matters.',
          ts: Date.now() - 1000 * 60 * 30
        },
        {
          id: uid(),
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          ts: Date.now() - 1000 * 60 * 29,
          steps: [
            { tool: 'search', arg: 'src/hooks · useDebounce', res: 'no match' },
            { tool: 'read', arg: 'src/hooks/index.ts', res: '64 lines' },
            { tool: 'write', arg: 'src/hooks/useDebounce.ts', res: '+21' }
          ],
          content: `Here's a dependency-free version that cancels the pending update on every keystroke.

\`\`\`js
import { useEffect, useState } from 'react';

export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);   // cleanup cancels the stale update
  }, [value, delay]);

  return debounced;
}
\`\`\`

**Why the cleanup matters**

- React runs the cleanup before the next effect, so a fast sequence of keystrokes only fires once.
- On unmount the pending timer is cancelled, which avoids updating a component that is gone.
- \`delay\` is in the dependency list, so changing it re-arms the timer instead of keeping the old interval.

Use it with a search effect:

\`\`\`jsx
const [query, setQuery] = useState('');
const debouncedQuery = useDebounce(query, 250);

useEffect(() => {
  if (debouncedQuery) search(debouncedQuery);
}, [debouncedQuery]);
\`\`\``
        },
        {
          id: uid(),
          role: 'user',
          content: 'Could I switch the 250ms delay per input?',
          ts: Date.now() - 1000 * 60 * 24
        },
        {
          id: uid(),
          role: 'assistant',
          model: 'gpt-4-1',
          ts: Date.now() - 1000 * 60 * 23,
          content: `Yes — that's why \`delay\` is a parameter rather than a constant.

Two practical options:

1. **A per-input delay** — keep the value in state and pass it in: \`useDebounce(query, filters.instant ? 0 : 250)\`. A \`0\` delay still defers to the next tick, which is usually what you want.
2. **A debounced callback** — if you need the function itself rather than the value, wrap it in a ref so the timer survives re-renders:

\`\`\`js
export function useDebouncedCallback(fn, delay) {
  const ref = useRef(fn);
  ref.current = fn;

  return useCallback((...args) => {
    clearTimeout(ref.timer);
    ref.timer = setTimeout(() => ref.current(...args), delay);
  }, [delay]);
}
\`\`\`

Note this reply is from a **different model** — switch the picker in the top bar and the conversation carries over.`
        }
      ]
    };
    state.chats.unshift(chat);
    state.activeId = chat.id;
    persistNow();
    renderAll();
    scrollToBottom(true);
    toast('Sample conversation loaded', 'sparkles');
  }

  /* ------------------------------- shortcuts ------------------------------ */
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    const anyDialog = $('dialog[open]');

    if (e.key === 'Escape') {
      closeMenu();
      return;
    }

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (els.cmdDialog.open) closeDialog(els.cmdDialog);
      else if (!anyDialog) openCommandPalette();
      return;
    }
    if (mod && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      if (!anyDialog) openModelPicker();
      return;
    }
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      if (!anyDialog) toggleSidebar();
      return;
    }
    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      if (!anyDialog) newChat();
      return;
    }
    if (mod && e.key === ',') {
      e.preventDefault();
      openSettings('general');
      return;
    }
    if (mod && e.key === '/') {
      e.preventDefault();
      els.input.focus();
      return;
    }
    if (!typing && !anyDialog && e.key === '/') {
      e.preventDefault();
      els.input.focus();
    }
  });

  window.addEventListener('beforeunload', persistNow);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) els.backdrop.classList.remove('show');
  });

  /* --------------------------------- boot --------------------------------- */
  function boot() {
    if (window.innerWidth <= 900) els.shell.classList.add('collapsed');
    applySettingsToUI();
    renderAll();
    autoGrow();
    updateSendState();
    if (new URLSearchParams(location.search).get('sample') === '1' && !state.chats.length) loadSample();
    if (activeChat() && activeChat().messages.length) scrollToBottom(true);
    if (!state.chats.length) setTimeout(() => els.input.focus(), 120);
    // keep the empty state fresh when the model changes from elsewhere
    renderModelList('');
  }

  boot();

  // expose a tiny debug surface (useful for the docs / testing)
  window.Eltes = { state, renderAll, persistNow, loadSample, openSettings, selectModel };
})();
