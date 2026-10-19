# Eltes AI

A local-first AI agent workspace — one interface, every model.

Eltes is a static, browser-only chat and agent workspace with a dark-blue interface built for
people who switch models often. Bring your own API key, keep your chat history on your device,
and compare frontier and open models without losing the thread.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: hero product preview, feature bento, agent demo, comparison, CTA |
| `app.html` | The workspace: streaming chat, model picker, command palette, settings, export |
| `docs.html` | Documentation: quickstart, API keys, models, agent mode, shortcuts, self-hosting |

## Features

- **Model switching mid-conversation** — 15 models across Anthropic, OpenAI, Google, xAI, DeepSeek,
  Groq, Mistral, OpenRouter and any OpenAI-compatible custom endpoint.
- **Bring your own key** — keys live in `localStorage`, requests go straight from the tab to the
  provider. Chat exports deliberately exclude keys.
- **Local chat history** — grouped, searchable, renameable, pinnable, exportable as Markdown or JSON.
- **Streaming answers** — real SSE streaming for OpenAI-compatible APIs and native Anthropic,
  with stop, retry and per-message model labels.
- **Agent mode** — visible read / grep / edit steps before a reply (simulated in demo mode).
- **Command palette** — `⌘K` for chats, models and actions; full keyboard shortcut set.
- **Demo mode** — no key required. Replies are generated locally and clearly labelled.
- **Settings** — default model, send key, streaming, density, reduced motion, timestamps, storage meter.
- **No emoji, no icon fonts** — all icons are inline Lucide vectors; fonts are bundled locally.

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

Open `app.html?sample=1` to load a sample conversation, then press `⌘K`.

## Structure

```
index.html          landing page
app.html            workspace
docs.html           documentation
assets/css/         theme tokens, landing, app and docs styles
assets/js/          icons, model catalogue, app engine, site + docs behaviour
assets/fonts/       Inter and JetBrains Mono (variable, latin subset)
assets/img/         favicon
```

## Connecting a model

1. Open **Settings → API keys**.
2. Paste a key for a provider and press **Save**.
3. Pick a model from that provider with `⌘M`.

For local models point **Custom endpoint** at an OpenAI-compatible server, for example
`http://localhost:11434/v1` with model `llama3.1`. The server must allow CORS from your origin.

## Privacy

There is no Eltes backend, account, analytics or telemetry. Chats, settings and keys are stored in
the browser's `localStorage`. Prompts are sent directly to the provider whose key you added and are
governed by that provider's terms. Clearing site data deletes everything locally — export first.

## Licence

MIT. Lucide icons are ISC licensed; Inter and JetBrains Mono are SIL OFL.
