# Eltes AI

A local-first AI workspace for real provider APIs, user-run open models, and an honest on-device assistant.

Eltes is a static browser app by default. Hosted requests can go directly from your browser to a provider, or through an optional Vercel/local proxy that forwards your own key for one request and does not persist it. Chats, keys, profiles, and preferences stay in browser storage. There are no simulated hosted-model replies.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Landing page and model catalogue |
| `app.html` | Chat workspace, streaming, local history, settings, custom endpoints, and a video-editor tab |
| `video.html` | On-device single-clip video trimming, color adjustments, text overlays, and browser export |
| `auth.html` | Local profile and provider-key utilities; it is not a hosted identity service |
| `docs.html` | App, video editor, local-model, proxy, deployment, privacy, and troubleshooting guide |

## Features

- **Actual provider requests:** native Anthropic Messages API and OpenAI-compatible chat-completions APIs. Responses stream when enabled; errors are shown with retry guidance. Provider availability, model access, quotas, and billing are controlled by each provider.
- **Bring your own key:** keys are stored in this browser's `localStorage`. Direct mode sends them from the tab to the selected provider. Optional proxy mode sends a key over HTTPS to the Vercel backend for that request; Eltes's function code does not persist or log the key. Use only a backend you trust. See [BYOK and proxy privacy](#byok-and-proxy-privacy).
- **Local open models:** connect Ollama, LM Studio, vLLM, or another OpenAI-compatible server using the Custom endpoint setting. Model weights and inference stay on your own computer/server, subject to that runner's configuration.
- **Eltes CAI:** a deterministic, on-device JavaScript rules-and-knowledge helper for Eltes guidance, arithmetic, common math functions, one-variable linear/quadratic equations, conversions, dates, a curated AI glossary, and exact retrieval from messages included in the active chat. It is not a trained neural network or a general-purpose LLM, and it cannot solve every kind of math.
- **Local-first workspace:** chat history, profiles, settings, and exports are controlled in your browser. No analytics or telemetry are included.
- **Agent tools:** local calculation, clock, and chat-history search can be offered to compatible hosted models. Tool results are sent back as part of the model request.
- **Interface:** dark-blue theme, reduced-motion support, keyboard navigation, streaming indicators, model picker, and local exports.
- **Video editor:** browser-local single-clip trimming, brightness/contrast/saturation controls and presets, configurable title/caption overlays, and MediaRecorder export when supported by the browser. Video is not uploaded; codec and audio-capture support vary by browser.

## Run the app and local API

Requires Node.js 18 or newer. No build step is needed.

```bash
npm install
npm start
# open http://localhost:4173/app.html
```

`npm start` serves the site and local API routes together, binding to `0.0.0.0` so the development preview can reach it. The built-in proxy is automatically used when Eltes detects the same-origin API. Available routes are `/api/health`, `/api/key-check`, and `/api/chat`. Stop the server with Ctrl+C. The local server has no user authentication; keep it on a trusted network. To bind only to loopback, run `HOST=127.0.0.1 npm start`.

For a static-only preview, Python also works:

```bash
python3 -m http.server 4173
```

A static-only server does not implement API routes; hosted keys go directly to providers unless you configure a separate proxy in **Settings → API keys**. The included Windows `.bat` launcher continues to serve the static site only; configure a Vercel backend in settings if you need proxy/key-test features there.

## Connect a local open model

The custom endpoint is compatible with common OpenAI-style chat-completions servers. For example, with Ollama installed:

```bash
ollama pull qwen3:8b
ollama serve
```

In another terminal, run Eltes with `npm start`, then open **Settings → API keys → Custom endpoint** and set:

- Base URL: `http://localhost:11434/v1`
- Model ID: the model name exposed by your runner, such as `qwen3:8b`
- Key: leave blank if the runner does not require one

The app browser calls the local runner directly. Configure the runner's CORS/origin allowlist to permit the exact Eltes origin (for example, `http://localhost:4173`). A hosted HTTPS page generally cannot call a plain-HTTP localhost endpoint because browsers block mixed content; run Eltes locally instead. Keep the runner bound to loopback unless you intentionally want other devices to reach it.

Eltes CAI is not a substitute for a large language model. It has no neural checkpoint, training corpus, or training pipeline; its chat retrieval is limited to the active conversation text supplied to the current turn, not every saved chat. A tokenizer vocabulary is not a knowledge base: adding four million word entries would not by itself teach meanings or prevent incorrect answers. Reliable knowledge expansion needs a curated, licensed source corpus, retrieval with traceable sources, abstention when evidence is weak, and an evaluation set. Eltes does not train a frontier or otherwise powerful model from scratch. Running an open-weight model requires downloading its weights and enough RAM/VRAM; fine-tuning requires a separate model-specific dataset, training stack, and compute. The custom endpoint connects to an already-running inference server; it does not perform training.

## Optional Vercel proxy

GitHub Pages remains a static host. The separate `api/` functions are for Vercel, or can run locally through `npm start`.

1. Import this repository into a Vercel project with the root directory set to the repository root.
2. Set the Vercel environment variable `ELTES_ALLOWED_ORIGINS` to a comma-separated list of exact allowed browser **origins**, with no paths or trailing slashes. Example:
   `https://gefrus112.github.io,http://localhost:4173`
3. Deploy the project. Vercel exposes `/api/health`, `/api/key-check`, and `/api/chat`.
4. In Eltes **Settings → API keys → Optional Vercel/local backend**, enter the deployed origin, such as `https://your-project.vercel.app`, save, and check that the health test succeeds.
5. Use **Test key** beside a saved provider key, or send a hosted-model message. Clear the backend URL to return to direct browser-to-provider mode.

The proxy supports only provider hosts and provider/model pairs in `lib/providers.cjs`; it does not accept arbitrary upstream URLs. CORS is not authentication, and an origin allowlist only controls browser cross-origin use. Treat your Vercel project as trusted infrastructure, set provider spending limits, and monitor function usage. No provider key is configured in Vercel: each user supplies their own key with each request. The server code does not persist or log that key, but the key necessarily transits the backend and is visible to the backend platform while the request is processed. Do not use the proxy if you do not trust its operator/platform.

The proxy cannot grant credits, confirm free-tier eligibility, or bypass provider account permissions. Provider pricing and access rules apply to every hosted request. GitHub Pages itself cannot run these functions.

## BYOK and proxy privacy

- Browser storage is local to the site origin and is not encrypted by Eltes. Anyone with access to the browser profile may be able to inspect it. Remove keys and clear site storage on shared devices.
- Direct mode sends the key from your browser to the configured provider.
- Proxy mode sends the key in an HTTPS request header to your chosen Vercel/local backend, then forwards it to the fixed provider endpoint. The API code does not write keys to files, databases, or logs. Vercel and the provider still process the request under their own infrastructure and policies.
- Prompts, conversation history, and any enabled tool definitions/results are sent to the selected model service. Avoid sending sensitive content unless you accept that provider's terms.
- Never add provider keys to source code, GitHub Pages, GitHub Actions, screenshots, issue reports, or a shared Vercel environment variable.

## GitHub Pages

The `.github/workflows/pages.yml` workflow publishes the static site. It does not deploy the API functions. GitHub Pages cannot process POST requests, proxy provider calls, hold server secrets, or provide free model credits. For proxy features, deploy the separate Vercel project; otherwise use direct mode or your own local model endpoint.

## Windows launcher

`downloads/eltes-windows.zip` includes the `.bat` launcher, PowerShell helper, static site (including `video.html`), and documentation. Unzip and run `eltes.bat`; it opens the local workspace and serves only files. The video editor also runs locally in the browser and does not upload source footage. It does not start the Node API proxy. To use key testing and the proxy on Windows, configure a Vercel backend in Eltes settings. The launcher requires Windows 10/11 plus Python 3 or Node 18+.

## Validate and rebuild

```bash
npm install
npm run validate:html
npm run validate:css
npm test
npm run downloads:build
```

The Windows ZIP is generated from the current source/docs and includes the current `LICENSE` and third-party `NOTICE.md`.

## Storage

| Browser key | Contents |
| --- | --- |
| `eltes.chats.v1` | Conversations |
| `eltes.settings.v1` | Model, provider keys, proxy URL, preferences |
| `eltes.active.v1` | Open conversation |
| `eltes.account.v1` | Optional local profile |

Storage is per browser and origin. Export chats before clearing site data.

## License and reuse

This release is distributed under the restrictive terms in [`LICENSE`](LICENSE), not MIT. The source is publicly viewable because the repository is public; that does not grant permission to copy, redistribute, modify, or publish a clone. The license cannot technically prevent downloading or forking public files. The prior MIT-licensed versions remain subject to the rights granted with those releases; this change is not retroactive. Third-party assets retain their own licenses in [`NOTICE.md`](NOTICE.md). This is a project notice, not legal advice.
