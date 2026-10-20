# Eltes AI

A local-first AI workspace for real provider APIs, user-run open models, and an honest on-device assistant.

Eltes is a static browser app by default. Hosted requests can go directly from your browser to a provider, or through an optional Vercel/local proxy that forwards your own key for one request and does not persist it. Chats, keys, profiles, and preferences stay in browser storage. There are no simulated hosted-model replies.

**Live:** <https://gefrus112.github.io/eltes/> · **Supabase copy:** <https://odemzfpgercjitrrdlvk.supabase.co/storage/v1/object/public/eltes/index.html> — the same files, two hosts.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Landing page and model catalogue |
| `app.html` | Chat workspace, streaming, local history, settings, custom endpoints |
| `auth.html` | Account page: a real Supabase account (email and password, confirmation, magic link, password reset) when `config.js` is filled in, otherwise a local profile and provider-key utilities |
| `docs.html` | App, local-model, proxy, deployment, privacy, and troubleshooting guide |
| `studio.html` | Coding workspace: file tree, editor, live preview and a real local terminal |
| `news.html` | Release notes with screenshots of the galaxy backdrop, the effects library, the workflow guide, Studio and the chat theme |

## Features

- **Actual provider requests:** native Anthropic Messages API and OpenAI-compatible chat-completions APIs. Responses stream when enabled; errors are shown with retry guidance. Provider availability, model access, quotas, and billing are controlled by each provider.
- **Bring your own key:** keys are stored in this browser's `localStorage`. Direct mode sends them from the tab to the selected provider. Optional proxy mode sends a key over HTTPS to the Vercel backend for that request; Eltes's function code does not persist or log the key. Use only a backend you trust. See [BYOK and proxy privacy](#byok-and-proxy-privacy).
- **Local open models:** connect Ollama, LM Studio, vLLM, or another OpenAI-compatible server using the Custom endpoint setting. Model weights and inference stay on your own computer/server, subject to that runner's configuration.
- **Eltes CAI:** a deterministic, on-device JavaScript rules-and-knowledge helper for Eltes guidance, arithmetic, common math functions, one-variable linear/quadratic equations, unit/temperature/time conversion, number-base conversion, date arithmetic, text transforms, random utilities, a curated 50+ term AI glossary, and exact retrieval from messages included in the active chat. It is not a trained neural network or a general-purpose LLM, and it cannot solve every kind of math.
- **Local-first workspace:** chat history, profiles, settings, and exports are controlled in your browser. No analytics or telemetry are included.
- **Chat slash commands:** `/help`, `/clear`, `/export`, `/model`, `/calc`, `/convert`, `/define`, `/base`, `/web`, `/time`, `/coin`, `/dice`, `/random`, `/uppercase`, `/reverse`, `/sort` — handled on-device with a live autocomplete menu; only `/web` needs a search key.
- **Live web search with sources:** click the **Web** chip — it always switches on (and reads *Web on*) — and Eltes searches Brave, Tavily, Serper or Exa through the optional backend, then renders a numbered source list with links and excerpts. Hosted models are asked to cite sources inline as `[1]`, `[2]`; CAI formats the same list deterministically. A recency filter (day, week, month, year) is mapped to each provider's own upstream filter. Your search key stays in this browser and is forwarded per request.
- **Visible search thinking:** while a search runs, the reply shows live steps — the condensed query, provider and recency, the result count and the time each step took. Nothing is pre-scripted; failed searches leave a failed step. Finished traces collapse to a summary and can be reopened; turn them off under Settings → General.
- **Eltes Studio:** a separate page with a workspace file tree, editor, live preview and a real shell. The **Guide** button walks the build-a-website workflow — scaffold files, run the build in the terminal, add a page, preview it, open it in its own tab — and ticks steps off as the real actions happen. The written version is in [docs.html#workflow](docs.html#workflow). Any `.html` file previews at `/preview/<path>` with relative assets intact; edits and terminal builds reload it automatically. The terminal runs `/bin/bash` in `.studio/`, streams output, tracks `cd`, and stops on timeout or Ctrl+C. Without the local server the editor still works in browser-only mode with an in-browser preview and zip export.
- **Effects from code:** the **Effects** button in Studio writes one of six dependency-free recipes — gradient mesh, canvas particles, aurora, halftone, glowing orb, generative poster — into `effects/<name>.html`, opens it in the editor and loads it in the preview. Every recipe is CSS, SVG or canvas, so there is no bitmap to export or download; the guide is in [docs.html#effects](docs.html#effects). The starter `build.mjs` walks subfolders, so the effects ship with the site. Release notes with screenshots: [news.html](news.html).
- **Six agent tools:** `calculate`, `convert_units`, `define_term`, `current_time`, `search_history` and (when enabled) `web_search`.
- **Model catalogue:** 66 models across 14 providers, including OpenAI, Anthropic, Google, DeepSeek, Z.ai, xAI, Qwen, Mistral, Groq, NVIDIA NIM, Cohere, OpenRouter, three on-device CAI models, a Lab model you train in the browser, and custom endpoints.
- **Real welcome email, from your own machine:** creating a profile in `auth.html` sends *Welcome to Eltes AI Workspace* through your own free provider account — Resend (3,000/month), Brevo (300/day) or any SMTP mailbox — from `lib/mail.cjs`, with no dependencies. With nothing configured the message is written to `.mail/outbox/*.eml` instead of pretending; hard bounces (`5xx` at `RCPT TO`, provider `4xx`, or a Brevo/Resend webhook) go on a suppression list so the address is never retried. See [Welcome email](#welcome-email) and [docs.html#email](docs.html#email).
- **Desktop apps:** a Windows installer and portable `.exe`, macOS `.dmg` and Linux AppImage/`.deb`, built from the same site by `desktop/` (Electron shell + the bundled local server), with a hardened window, loopback-only server, recovery screen and CI builds per platform. See [Desktop apps](#desktop-apps).
- **Eltes Lab — a model you train:** [train.html](train.html) builds a real character-level neural network in the tab: a 14-character context, 24-wide embeddings, 128 tanh units and a softmax over the corpus vocabulary (51,245 weights on the default corpus). Hand-written backpropagation, Adam with bias correction, dropout, weight decay and gradient clipping; training and held-out validation curves drawn live with the best validation point marked. Seeded and reproducible, ~6 ms per step. **Memorise it** trains on one paragraph until the loss reaches zero and reports the character-level match of the recital. **Save model** writes the checkpoint to `localStorage` (`eltes.lab.model.v1`), and **Eltes Lab-1** then answers in the workspace chat by quoting a continuation — with its parameter count, corpus and validation loss stated, because a character model cannot follow instructions. No server, no key, no network requests. Details: [docs.html#lab](docs.html#lab).
- **Chat welcome:** an orange ember field follows the pointer across the new-chat screen (`assets/js/chat-embers.js`) — speed is heat, a click stokes it, and it fades out as soon as a conversation starts.
- **Interface:** Obsidian (true black, no blue) by default with Graphite grey as an option under Settings → General, reduced-motion support, keyboard navigation, streaming indicators, model picker, and local exports. Both themes are tokenised in `assets/css/app.css` and stored in `eltes.settings.v1`.

## Eltes Lab

`assets/js/lab.js` is a dependency-free character-level language model: an embedding table for the last 14 characters, one tanh hidden layer of 128 units and a softmax over the vocabulary, with cross-entropy, full backpropagation, Adam (bias-corrected), dropout `0.1`, weight decay `2e-5` and global gradient-norm clipping at `5`. A 1,500-step run on the built-in Eltes handbook takes about nine seconds in a browser and draws training loss against validation loss on a 90/10 split. `assets/js/lab-page.js` is the console; `tools/capture-lab.mjs` re-renders the release-notes figure from a real run (`npm install --no-save @napi-rs/canvas`).

The model is small on purpose. On corpora of 40–90 KB it overfits: validation loss bottoms out a few hundred steps in and then climbs while training loss falls to nearly zero. The page shows that curve, marks the best validation point and explains it; the memorisation test exists because verbatim recall is the one thing a model this size can prove. Free generation produces word-shaped fragments, and the page says so.

## The galaxy backdrop

The marketing and documentation pages sit in front of a live galaxy drawn by `assets/js/galaxy.js`: a tilted band with a dust lane and a warm core, three parallax star layers, pointer lean, warp trails when you scroll fast, and the occasional meteor. It is one `<canvas>` with no libraries and no image files; the static backdrop is painted once, stars run at 30 fps with a capped pixel ratio, the loop stops in a hidden tab, and `prefers-reduced-motion` gets a single still frame. The chat workspace and Studio keep their clean surfaces on purpose. `node tools/capture-galaxy.mjs` re-captures the still shown in the release notes (requires `npm install --no-save @napi-rs/canvas`). Details: [docs.html#look](docs.html#look).

## Desktop apps

`desktop/` is a thin Electron harness around the same site and the same local server. There is no second app: the shell starts `tools/local-server.mjs` with its own binary (`ELECTRON_RUN_AS_NODE`) on a free loopback port and loads `app.html` from it, so a packaged build needs no Node install and adds no second codebase to maintain.

```bash
npm install                    # electron + electron-builder
npm run desktop                # run the harness against this checkout

npm run desktop:win            # Windows: NSIS installer + portable .exe
npm run desktop:mac            # macOS: .dmg + .zip (arm64 and x64)
npm run desktop:linux          # Linux: AppImage + deb
npm run desktop:stage          # just assemble desktop/.build
```

| Platform | Artifact |
| --- | --- |
| Windows | `Eltes-Setup-<v>-x64.exe` (per-user installer) · `Eltes-<v>-Portable-x64.exe` |
| macOS | `Eltes-<v>-arm64.dmg` · `Eltes-<v>-x64.dmg` · zipped `.app` |
| Linux | `Eltes-<v>-linux-x86_64.AppImage` · `eltes_<v>_amd64.deb` |

The window is hardened (context isolation, no node integration, sandboxed renderer, five bridge calls) and navigation is locked to the app's own origin; everything else opens in your real browser. Permissions are denied except clipboard. The bundled server binds `127.0.0.1` only, and data lives in the platform's app-data folder (`studio/`, `logs/desktop.log`, `window-state.json` inside it). If the server cannot start, a recovery screen shows the error and log path instead of a blank window. Signing is configuration only: set `CSC_LINK`/`CSC_KEY_PASSWORD` (Windows) or a Developer ID certificate plus `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (macOS).

`.github/workflows/desktop.yml` builds each platform on its own runner — Windows on `windows-latest`, macOS on `macos-latest` (arm64) and `macos-15-intel` (Intel), Linux on `ubuntu-latest` — and attaches every installer to the GitHub release when you push a `v*` tag. Build Windows on Windows: cross-building skips `rcedit`, so icon and version metadata stay Electron's defaults. Details and troubleshooting: [desktop/README.md](desktop/README.md) and [docs.html#desktop](docs.html#desktop).

If you only need the website, skip the Electron download:

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install
```

## Run the app and local API

Requires Node.js 18 or newer. No build step is needed.

```bash
npm install
npm start
# open http://localhost:4173/app.html
```

`npm start` serves the site, the local API routes and Studio together, binding to `0.0.0.0` so the development preview can reach it. The built-in proxy is automatically used when Eltes detects the same-origin API. Available routes are `/api/health`, `/api/key-check`, `/api/chat`, `/api/search`, `/api/email/*`, and the local-only `/api/studio/*` endpoints. Studio lives at `/studio.html`; its workspace is `.studio/` (gitignored) and its preview is `/preview/`. Stop the server with Ctrl+C. The local server has no user authentication and the terminal can run commands as your user; keep it on a trusted network. To bind only to loopback, run `HOST=127.0.0.1 npm start`. Set `ELTES_STUDIO=0` to disable Studio entirely or `ELTES_STUDIO_SHELL=0` to keep the editor and preview without a shell.

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
3. Deploy the project. Vercel exposes `/api/health`, `/api/key-check`, `/api/chat`, and `/api/search`.
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

## Where the site is published

Both homes serve the same static files, unmodified:

| Home | Address | What it is |
| --- | --- | --- |
| GitHub Pages (canonical) | **https://gefrus112.github.io/eltes/** | Built by `.github/workflows/pages.yml` on every push to `main`. |
| Supabase Storage (mirror) | **https://odemzfpgercjitrrdlvk.supabase.co/storage/v1/object/public/eltes/index.html** | A public bucket in the same project that holds the accounts and sends the mail. |

The Supabase address is not a "Supabase website" product — Supabase has none. It is a **public Storage bucket** served over its CDN: every object gets a real content type, relative links resolve, and the pages behave exactly as they do on Pages. It is a mirror, not a second deployment pipeline: it is refreshed on demand from the repository.

```bash
# one command, no build step — the Edge Function copies the files from GitHub
ELTES_PUBLISH_TOKEN=… npm run site:publish -- --dry   # list what would go
ELTES_PUBLISH_TOKEN=… npm run site:publish            # upload, upsert, report
```

`supabase/functions/site-publish` needs `ELTES_PUBLISH_TOKEN` set in Edge Function secrets; it refuses every call without it and publishes only pages, `assets/` and `downloads/` — never the SQL, the tests or the desktop harness.

The Pages workflow itself does not deploy the API functions. GitHub Pages cannot process POST requests, proxy provider calls, hold server secrets, or provide free model credits. For proxy features, deploy the separate Vercel project; otherwise use direct mode or your own local model endpoint.

## Windows launcher

`downloads/eltes-windows.zip` includes the `.bat` launcher, PowerShell helper, static site, and documentation. Unzip and run `eltes.bat`; it opens the local workspace and serves only files. It does not start the Node API proxy. To use key testing and the proxy on Windows, configure a Vercel backend in Eltes settings. The launcher requires Windows 10/11 plus Python 3 or Node 18+.

## Welcome email

`auth.html` posts the new profile to `POST /api/email/welcome` on the server that served the page. That server — yours, not Eltes's — renders a multipart message (plain text plus HTML, no tracking pixel) and hands it to a provider you own. There is no mail server in Eltes, no shared list and no analytics.

```bash
# Resend — 3,000 emails/month, 100/day, free
export ELTES_MAIL_FROM="Eltes <hello@yourdomain.com>"
export RESEND_API_KEY=re_xxxxxxxx

# Brevo — 300/day, free, no domain required
export ELTES_MAIL_FROM="Eltes <you@gmail.com>"
export BREVO_API_KEY=xkeysib-xxxxxxxx

# or any SMTP mailbox (implicit TLS on 465, STARTTLS on 587)
export ELTES_MAIL_FROM="Eltes <you@example.com>"
export ELTES_SMTP_URL="smtps://you:app-password@smtp.example.com:465"

npm start
```

| Variable | Purpose |
| --- | --- |
| `ELTES_MAIL_FROM` | Sender for the welcome email; required before anything is delivered. |
| `RESEND_API_KEY` / `BREVO_API_KEY` / `ELTES_SMTP_URL` | Pick one transport. |
| `ELTES_MAIL_PROVIDER` | `resend`, `brevo`, `smtp` or `none` to override detection. |
| `ELTES_MAIL_DIR` | Outbox, `events.jsonl` and `suppressed.json`. Defaults to `.mail/`; the desktop app uses `mail/` in its data folder. |
| `ELTES_MAIL_WEBHOOK_SECRET` | Needed for a webhook reachable beyond loopback. |
| `ELTES_MAIL_REPLY_TO` | Optional `Reply-To`. |

Without a provider, `/api/email/welcome` still does the whole job except the network call: it writes a real `.eml` file to `.mail/outbox/` and answers `delivered: false, outbox: true`. The auth page shows *Saved to the local outbox*. On the static GitHub Pages copy there is no local API, so that page uses the Supabase route below instead (or says *No mail server on this host* when `config.js` is empty and the hosted function is unreachable).

Bounces are handled where they are observable. SMTP `5xx` replies at `RCPT TO`/`DATA` are detected in the same request, provider `4xx` rejections of the address are treated the same, and `POST /api/email/webhook` normalises Brevo (`hard_bounce`, `spam`) and Resend (`email.bounced`, `email.complained`) events. Hard bounces and complaints are written to `.mail/suppressed.json`; later sends to that address never open a connection.

```bash
npm run mail status                       # mode, folder, counts, recent events
npm run mail welcome you@example.com      # send the real welcome email
npm run mail test you@example.com         # verify a provider
npm run mail bounce you@example.com       # record a hard bounce (what a webhook writes)
npm run mail unsuppress you@example.com   # allow the address again
```

Tests: `test/mail.test.cjs` covers the wire format, config detection, both provider payloads against a stub, an SMTP delivery over a real socket, a `550` at `RCPT TO`, suppression, webhook normalisation and the HTTP routes against a spawned server.

## Cloud accounts (Supabase, optional)

The static site can create real accounts. Point `config.js` at a Supabase project and `auth.html` grows an email-and-password path: sign up, confirmation, sign in, magic link, password reset, sign out, and a session that survives a reload. The welcome email is then sent by an Edge Function in that same project through Resend — no server of your own, no cost.

```js
// config.js — public identifiers only
window.ELTES_CONFIG = {
  supabaseUrl: 'https://<ref>.supabase.co',
  supabaseAnonKey: 'sb_publishable_…',
  siteUrl: 'https://<user>.github.io/eltes/',
  functionsPath: '/functions/v1',
  mailFunction: 'eltes-mail'
};
```

```bash
npx supabase link --project-ref <ref>
npx supabase db push                                             # tables, trigger, RLS, rate limits
npx supabase functions deploy eltes-mail --no-verify-jwt
npx supabase functions deploy email-webhook --no-verify-jwt
npx supabase secrets set RESEND_API_KEY=re_… ELTES_MAIL_FROM="Eltes <hello@yourdomain.com>" \
  ELTES_SITE_URL=https://<user>.github.io/eltes/
```

Set **Authentication → URL Configuration** to the Pages URL and its wildcard, so confirmation and reset links land on `auth.html`.

| Piece | What it is |
| --- | --- |
| `assets/js/supabase.js` | The browser client: plain `fetch`, no SDK, no build step. |
| `supabase/migrations/0001_eltes_accounts.sql` | `profiles`, `email_events`, `suppressed_emails`, the `auth.users` trigger, RLS and `mail_consume()`. |
| `supabase/functions/eltes-mail` | Welcome, magic link and reset letters through Resend, with the link built by the Auth admin API. |
| `supabase/functions/email-webhook` | Svix-signed Resend webhook; bounces and complaints land on the suppression list. |
| `supabase/functions/site-publish` | Copies the published site from GitHub into the public `eltes` Storage bucket. |

The **service_role** and **Resend** keys live only in Edge Function secrets. `config.js` ships the publishable key, which is designed to be public; RLS limits it to the signed-in user's own row. Without `RESEND_API_KEY` the function sends nothing and the panel says *Not sent — Supabase has no RESEND_API_KEY yet*. See `supabase/README.md` and `docs.html#supabase`.

Local profiles are untouched: no `config.js`, a desktop build, or one click on *Use a local profile instead* and Eltes behaves exactly as before.

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
| `eltes.cloud.v1` | Supabase session (access + refresh token), when cloud accounts are configured |

Storage is per browser and origin. Export chats before clearing site data.

## License and reuse

This release is distributed under the restrictive terms in [`LICENSE`](LICENSE), not MIT. The source is publicly viewable because the repository is public; that does not grant permission to copy, redistribute, modify, or publish a clone. The license cannot technically prevent downloading or forking public files. The prior MIT-licensed versions remain subject to the rights granted with those releases; this change is not retroactive. Third-party assets retain their own licenses in [`NOTICE.md`](NOTICE.md). This is a project notice, not legal advice.
