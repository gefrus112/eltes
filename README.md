# Eltes AI

One workspace, every real model.

Eltes is a local-first, browser-only AI agent workspace. It speaks directly to real provider APIs with
your own keys, streams every answer, shows its tool calls, and keeps chats, profile and settings on your
device. There is no Eltes server, no telemetry and **no demo mode** — an answer is either live from the
model you picked or an explicit error you can act on.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Dark landing page: scroll-driven block field, real model wall, feature bento, agent terminal, comparison, pricing (coming soon), accounts |
| `app.html` | The workspace: streaming chat, step timeline, tool cards, model picker, command palette, settings, export |
| `auth.html` | Optional local profile: create, sign in, link a GitHub handle, delete |
| `docs.html` | Documentation: quickstart, keys, providers and CORS, custom endpoints, models, tools, accounts, pricing, self-hosting |

## Features

- **28 real models, 11 providers** — Claude, GPT, Gemini, GLM, DeepSeek, Grok, Qwen, Mistral, Llama on
  Groq, OpenRouter routes, plus any OpenAI-compatible custom endpoint.
- **Real streaming only** — native Anthropic Messages API and OpenAI-compatible SSE. No simulated
  replies. Missing keys, `401`, `403`, `429`, `404`, CORS failures and offline states each get a typed
  card with retry and a key shortcut.
- **Agent loop with real tools** — `calculate`, `current_time` and `search_history` execute locally and
  feed their results back to the model, up to four rounds. Every call renders as a tool card with
  arguments, result and runtime.
- **Designed chat surface** — step timeline, model/provider chips on every reply, first-token latency,
  total time, tokens in/out, tokens per second, code blocks with copy, editable prompts, retry.
- **Bring your own key** — keys live in `localStorage` and go straight from the tab to the provider.
  Exports exclude them. A custom endpoint covers Ollama, vLLM, LiteLLM and local gateways.
- **Local history you own** — grouped by date, pin, rename, clear, search with `⌘K`, export Markdown or
  JSON, import a backup.
- **Optional accounts** — a local profile with initials avatar and an `eltes:account` event shared
  across pages. The GitHub button links a handle now and upgrades to a real OAuth backend when
  `window.ELTES_CONFIG.authEndpoint` is set.
- **Pricing that is honest** — BYOK is free and pay-the-provider. Hosted plans are marked coming soon
  until they exist; nothing can take a payment.
- **No emoji, no icon fonts** — inline Lucide vectors and real provider marks; Inter and JetBrains Mono
  are bundled locally.

## Run it

No build step. Any static server works:

```bash
python3 -m http.server 4173
# open http://localhost:4173
```

Or with npm:

```bash
npm install
npm start
```

Then open `app.html`, connect a provider under **Settings → API keys**, and send a message. There is no
sample conversation to load.

## Structure

```
index.html          landing page
app.html            workspace
auth.html           local accounts
docs.html           documentation
assets/css/         theme tokens + landing, app, docs, auth styles
assets/js/          icons, brand marks, model catalogue, app engine, site/docs/auth behaviour
assets/fonts/       Inter and JetBrains Mono (variable, latin subset)
assets/img/         favicon and social card
```

## Connecting a model

1. Open **Settings → API keys** (or press the key pill in the top bar).
2. Paste a key for a provider and press **Save**.
3. Pick any of that provider's models with `⌘M`.

For local models, open **Settings → API keys → Custom endpoint** and point it at an OpenAI-compatible
server, for example `http://localhost:11434/v1` with model `llama3.1`. The server must allow CORS from
your origin, and an HTTPS page cannot call an HTTP endpoint.

### Providers and CORS

OpenAI, Anthropic, Google, Groq and OpenRouter accept direct browser calls; Anthropic additionally
needs the `anthropic-dangerous-direct-browser-access` header, which Eltes sends. Some other providers
block browser origins. When that happens Eltes shows the network/CORS card and the docs explain the
proxy route — it never falls back to a fake answer. See `docs.html#providers`.

## Accounts

An Eltes account is a local profile: name, email, optional GitHub handle, provider and creation date.
There is no password, session cookie or email delivery. Real GitHub OAuth needs a server to hold the
client secret; the static build links a handle locally and says so. Set
`window.ELTES_CONFIG = { authEndpoint: 'https://auth.example.com' }` before the auth scripts to switch
the button to the real redirect. See `docs.html#accounts`.

## Privacy

There is no Eltes backend, analytics or telemetry. Chats, settings, keys, profile and waitlist entries
live in `localStorage`. Prompts are sent directly to the provider whose key you added and are governed
by that provider's terms. Clearing site data deletes everything locally — export first.

## Licence

MIT. Lucide icons are ISC licensed; Simple Icons brand paths are CC0; Inter and JetBrains Mono are SIL
OFL. Provider names and marks belong to their owners.
