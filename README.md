# Eltes AI

One workspace, every real model — plus our own model running on your device.

Eltes is a local-first, browser-only AI agent workspace. It speaks directly to real provider APIs with
your own account, streams every answer, shows its tool calls, and keeps chats, profile and settings in
your browser. There is no Eltes server and no telemetry. Hosted answers are live from the model you
picked, failures are explicit, and **Eltes CAI** answers locally when you have no key at all.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: scroll-driven block field, 12-provider model wall, feature bento, agent terminal, comparison, provider accounts, downloads, pricing (not announced) |
| `app.html` | The workspace: dark-blue theme, streaming chat, block field, step timeline, tool cards, model picker, provider accounts, command palette, settings, export |
| `auth.html` | Sign up or in with OpenAI, Anthropic or DeepSeek — or keep a local profile. OAuth contract plus honest key fallback; no GitHub button |
| `docs.html` | 16 sections: quickstart, accounts, provider keys, CORS, custom endpoints, models, CAI, Astra streaming, tools, chats, settings, shortcuts, downloads, pricing, self-hosting, privacy, FAQ |

## What is new in v3

- **Green-cloud brand** — one eye closed, one open. Inline SVG mark, favicon, `.ico`, Apple touch icon,
  192/512 PNGs and a maskable manifest icon.
- **Provider accounts** — sign up or in with OpenAI, Anthropic or DeepSeek. On a static copy the panel
  verifies and stores a real provider key; with `window.ELTES_CONFIG.authEndpoint` it performs a real
  OAuth redirect. GitHub sign-up is gone.
- **Dark-blue chat, black accounts** — the workspace is a deeper blue with a scroll-reactive block
  field; the account pages are black with solid block geometry.
- **Eltes CAI** — three on-device models (`Eltes CAI-1`, `CAI-1 Fast`, `CAI Docs`) built in
  `assets/js/cai.js`. No key, no network, and honest about the limits of what they know.
- **ChatGPT Astra, real time** — `gpt-6-astra` streams through Chat Completions with a 12 ms paint
  throttle, a live streaming dot and first-token metrics. Also routed through OpenRouter.
- **Downloads** — `downloads/eltes-windows.zip` ships `eltes.bat`, `Start-Eltes.ps1`, a Windows README
  and the whole static site. Unzip, double-click, browser opens. macOS/Linux use any static server.
- **Catalogue refresh** — 38 models across 13 providers, including Claude 5.5, GPT‑6 Sol/Luna,
  DeepSeek V4.1 Flash / V4 Pro, NVIDIA NIM and Eltes CAI.
- **Docs completion** — every section is written; nothing is marked “coming soon”.

## Features

- **Real streaming only** — native Anthropic Messages API and OpenAI-compatible SSE, with a
  non-streaming fallback. Missing keys, `401`, `403`, `429`, `404`, CORS failures and offline states each
  get a typed card with retry and a key shortcut. No simulated answers.
- **On-device fallback** — CAI handles Eltes help, model choice, arithmetic, percentages, units, dates,
  word counts and AI definitions. It states plainly when a question needs a hosted model.
- **Agent loop with real tools** — `calculate`, `current_time` and `search_history` execute locally and
  feed results back to the model, up to four rounds. Every call renders as a card with arguments,
  result and runtime.
- **Designed chat surface** — step timeline, model/provider/on-device chips, first-token latency, total
  time, tokens in/out, tokens per second, copyable and downloadable code, sandboxed HTML previews,
  editable prompts and retry.
- **Bring your own key** — keys live in `localStorage` and go straight from the tab to the provider.
  Exports exclude them. A custom endpoint covers Ollama, vLLM, LiteLLM and local gateways.
- **Local history you own** — grouped by date, pin, rename, clear, search with `⌘K`, export Markdown or
  JSON, import a backup. Chats are normalised on load, so stale or malformed data cannot break the app.
- **Optional accounts** — a local profile with editable bio and PNG/JPEG/WebP/GIF avatar plus per-provider
  connection state, shared across pages via the `eltes:account` event. GitHub OAuth is intentionally not
  enabled on the static build; do not paste personal access tokens into the browser.
- **Honest pricing** — BYOK is free and pay-the-provider. Hosted plans are marked “pricing not
  announced”; nothing can take a payment.
- **No emoji, no icon fonts** — inline Lucide vectors and real provider marks; Inter and JetBrains Mono
  are bundled locally.

## Models

38 entries across 13 providers: Anthropic, OpenAI, Google, Z.ai, DeepSeek, xAI, Qwen, Mistral, Groq,
OpenRouter, NVIDIA NIM, Eltes CAI and a custom OpenAI-compatible endpoint. The picker marks every hosted model that
has a connected account, `realtime` entries with a live dot, and CAI as `on-device`.

## Run it

No build step. Any static server works:

```bash
python3 -m http.server 4173
# open http://127.0.0.1:4173/app.html
```

Or with npm:

```bash
npm install
npm start
```

Then either chat with **Eltes CAI-1** immediately or connect a provider under **Accounts** or
**Settings → API keys**. There is no sample conversation to load.

### Windows

Download `downloads/eltes-windows.zip`, unzip it, and double-click `eltes.bat`. The launcher finds
Python 3 or Node 18+, serves the folder on `127.0.0.1:4173` and opens the workspace. Optional flags:
`--port 8080`, `--shortcut`, `--no-browser`. It is a readable batch file — no installer, no service, no
registry writes.

## Validate

```bash
npm install
npm run validate:html
npm run validate:css
```

Optional jsdom suites live outside the repo; the v3 pass covers landing, workspace, accounts, docs and
the local CAI engine.

## Storage

| Key | Contents |
| --- | --- |
| `eltes.account.v1` | Local profile |
| `eltes.chats.v1` | Conversations |
| `eltes.settings.v1` | Model, keys, preferences |
| `eltes.active.v1` | Open conversation |
| `eltes.waitlist.v1` | Pricing waitlist emails (local only) |

Nothing is uploaded. Clearing site data removes all of it, so export a backup first.

## License

MIT. Third-party assets and their licenses are listed in `NOTICE.md`.
