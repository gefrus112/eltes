# Eltes AI

A local-first AI workspace for real provider APIs, user-run open models, and an honest on-device assistant.

Eltes is a static browser app by default. Hosted requests can go directly from your browser to a provider, or through an optional Vercel/local proxy that forwards your own key for one request and does not persist it. Chats, keys, profiles, and preferences stay in browser storage. There are no simulated hosted-model replies.

**Live:** <https://gefrus112.github.io/eltes/> · **Supabase copy:** <https://odemzfpgercjitrrdlvk.supabase.co/storage/v1/object/public/eltes/index.html> — the same files, two hosts.

## Screens

<p align="center">
  <img src="assets/img/screens/workspace.svg" alt="Eltes workspace: a Roblox Studio build with three MCP tool cards, the Luau it inserted and the MCP chip showing eight tools" width="440" />
  <img src="assets/img/screens/mcp-settings.svg" alt="Settings, MCP tab: Blender and Roblox Studio presets with Copy command, .bat, .sh and Studio plugin buttons and a connected tool count" width="440" />
</p>
<p align="center">
  <img src="assets/img/screens/landing.svg" alt="Landing page: Ask the web. Keep the receipts. with the model workspace selector" width="440" />
  <img src="assets/img/screens/docs-mcp.svg" alt="Documentation, MCP servers: the four pieces, the four-step add flow, the bridge command and the security callout" width="440" />
</p>

<sub>Vector previews of the interface, drawn from the app's own layout, icon paths and colour tokens by <code>node tools/make-screens.mjs</code> — not screen captures; the conversation and sample data are illustrative.</sub>

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Landing page: model catalogue, feature grid and a real sign-up card; links to the video editor |
| `app.html` | Chat workspace, streaming, local history, settings, custom endpoints |
| `auth.html` | Account page: a real Supabase account (email and password, confirmation, magic link, password reset) when `config.js` is filled in, otherwise a local profile and provider-key utilities |
| `docs.html` | App, local-model, proxy, deployment, privacy, and troubleshooting guide |
| `studio.html` | Coding workspace: file tree, editor, live preview, a real local terminal and the **Other tools** tab (Reel video editor, frame grabber, palette). `studio.html?tools=reel` opens the editor directly |
| `news.html` | Release notes with screenshots of the galaxy backdrop, the effects library, the workflow guide, Studio and the chat theme |

## Features

- **Actual provider requests:** native Anthropic Messages API and OpenAI-compatible chat-completions APIs. Responses stream when enabled; errors are shown with retry guidance. Provider availability, model access, quotas, and billing are controlled by each provider.
- **Bring your own key:** keys are stored in this browser's `localStorage`. Direct mode sends them from the tab to the selected provider. Optional proxy mode sends a key over HTTPS to the Vercel backend for that request; Eltes's function code does not persist or log the key. Use only a backend you trust. See [BYOK and proxy privacy](#byok-and-proxy-privacy).
- **Editor find & replace:** `Ctrl`/`⌘`+`F` in Studio opens a find bar over the code, pre-filled from the selection, with a live match count, next/previous (`Enter` / `Shift`+`Enter`) and replace one or replace all. It runs on the textarea's own value, so it works in both local and browser-only modes.
- **Local open models:** connect Ollama, LM Studio, vLLM, or another OpenAI-compatible server using the Custom endpoint setting. Model weights and inference stay on your own computer/server, subject to that runner's configuration.
- **Eltes CAI:** a deterministic, on-device JavaScript rules-and-knowledge helper for Eltes guidance, arithmetic, common math functions, one-variable linear/quadratic equations, unit/temperature/time conversion, number-base conversion, date arithmetic, text transforms, random utilities, a curated 50+ term AI glossary, and exact retrieval from messages included in the active chat. It is not a trained neural network or a general-purpose LLM, and it cannot solve every kind of math.
- **Local-first workspace:** chat history, profiles, settings, and exports are controlled in your browser. No analytics or telemetry are included.
- **Chat slash commands:** `/help`, `/clear`, `/export`, `/model`, `/calc`, `/convert`, `/define`, `/base`, `/web`, `/time`, `/coin`, `/dice`, `/random`, `/uppercase`, `/reverse`, `/sort` — handled on-device with a live autocomplete menu; only `/web` needs a search key.
- **Live web search with sources:** click the **Web** chip — it always switches on (and reads *Web on*) — and Eltes searches Brave, Tavily, Serper or Exa through the optional backend, then renders a numbered source list with links and excerpts. Hosted models are asked to cite sources inline as `[1]`, `[2]`; CAI formats the same list deterministically. A recency filter (day, week, month, year) is mapped to each provider's own upstream filter. Your search key stays in this browser and is forwarded per request.
- **Visible search thinking:** while a search runs, the reply shows live steps — the condensed query, provider and recency, the result count and the time each step took. Nothing is pre-scripted; failed searches leave a failed step. Finished traces collapse to a summary and can be reopened; turn them off under Settings → General.
- **Eltes Studio:** a separate page with a workspace file tree, editor, live preview and a real shell. The **Guide** button walks the build-a-website workflow — scaffold files, run the build in the terminal, add a page, preview it, open it in its own tab — and ticks steps off as the real actions happen. The written version is in [docs.html#workflow](docs.html#workflow). Any `.html` file previews at `/preview/<path>` with relative assets intact; edits and terminal builds reload it automatically. The terminal runs `/bin/bash` in `.studio/`, streams output, tracks `cd`, and stops on timeout or Ctrl+C. Without the local server the editor still works in browser-only mode with an in-browser preview and zip export.
- **Other tools — Reel, frames and palette:** the pinned **Video editor** tab in Studio opens Reel directly (the **Other tools** tab holds it next to the frame grabber and palette). It is a video editor that runs entirely in the tab, and `studio.html?tools=reel` (also `?tool=reel`, `#reel`, `#tools=reel`) goes straight to it — the landing navigation, hero, features grid, footer and the workspace toolbar all link there. Drop video, image and audio files (or start from the title-card, lyric-video and vertical templates), cut and trim on a snapping timeline, add crossfade, slide, zoom, wipe or flash transitions between clips, give any picture a slow zoom or pan, key position, scale, rotation and opacity with easing, ripple-delete a gap closed, see the music lane's waveform with volume and fades, animate text (fade, rise, drop, pop, blur, typewriter) with five presets, stack looks (cinematic, VHS, noir, dream, neon, golden, mono) and grade each clip, name the project, choose the size, then record the result to a real file. The edit saves as project JSON you can download and open again, and a keyboard sheet in the toolbar lists every shortcut. Export is real-time `MediaRecorder` capture of the canvas, not a server render: a one-minute edit takes one minute, the tab must stay visible, the file is `.webm` (`.mp4` only where the browser exposes an H.264 encoder), and audio baked into video clips is not captured — use the music lane for the soundtrack. The same tab holds a full-resolution frame grabber and a CSS gradient palette. Projects and media stay in the browser; guide in [docs.html#other-tools](docs.html#other-tools).
- **Effects from code:** the **Effects** button in Studio writes one of six dependency-free recipes — gradient mesh, canvas particles, aurora, halftone, glowing orb, generative poster — into `effects/<name>.html`, opens it in the editor and loads it in the preview. Every recipe is CSS, SVG or canvas, so there is no bitmap to export or download; the guide is in [docs.html#effects](docs.html#effects). The starter `build.mjs` walks subfolders, so the effects ship with the site. Release notes with screenshots: [news.html](news.html).
- **MCP servers — Blender and Roblox Studio:** a real MCP client (`assets/js/mcp.js`) with a `Settings → MCP` tab and an **MCP** chip in the composer. Presets ship for **Blender** (via the BlenderMCP add-on) and **Roblox Studio** (a Luau plugin plus `mcp/eltes-roblox-bridge.mjs`), each with a downloadable `.bat` / `.sh` connector that starts the bridge for you. Connected tools are namespaced `server__tool`, join the same registry as the built-in ones, and render in the same trace cards. Details: [docs.html#mcp](docs.html#mcp).
- **Agent mode and coding workspace:** built-in tools remain available through native hosted-model calls (up to four rounds), while the CAI planner runs supported tools on-device. For coding tasks, the model must show a visible **Plan:** before requesting a file write or command. File access is limited to a folder you select; reads enter the draft and are sent only when you press Send; each existing-file replacement needs its own full before/after approval. The separate local command runner is disabled by default, requires pairing plus approval for the exact command, and runs with your account permissions—it is not an OS sandbox. [Studio](studio.html) also provides a local file editor, preview, and user-operated terminal.
- **Reviewed browser code sandbox:** JavaScript snippets can be inspected before running in a disposable worker with network access blocked. An optional bundled TensorFlow.js 4.22.0 CPU runtime can be enabled for snippets; you may select compatible local model files, which stay in the tab. TensorFlow.js is a framework, not a chat model, and model weights are not included. Jac (`.jac`) files have syntax highlighting, attachment, and download support; Jac is not executable in the JavaScript sandbox. See [agent and sandbox docs](docs.html#agent).
- **Agent mode, on by default:** built-in tools include `calculate`, `convert_units`, `percentage`, `date_math`, `current_time`, `search_history`, `define_term` and (when enabled) `web_search`. Hosted models drive them through native function calling (up to four rounds). **Eltes CAI-1** has no model to ask, so a deterministic on-device planner runs the same registry itself. It can run six tools; the glossary and web search stay with the hosted loop. Details: [docs.html#agent](docs.html#agent).
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

The static site can create real accounts. Point `config.js` at a Supabase project and two places grow an email-and-password path: the card on the landing page (`index.html#account`, name + email + password, straight into the workspace) and the full `auth.html` page (confirmation, sign in, magic link, password reset, sign out, and a session that survives a reload). The welcome email is then sent by an Edge Function in that same project through Resend — no server of your own, no cost.

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
| `supabase/migrations/0001_eltes_accounts.sql` | `profiles`, `email_events`, `suppressed_emails`, the `auth.users` trigger, RLS and `mail_consume()`. It has to be applied before sign-up is useful: without it Supabase Auth creates the user but no profile, so the welcome email has no row to address. `npx supabase db push`. |
| `supabase/functions/eltes-mail` | Welcome, magic link and reset letters through Resend, with the link built by the Auth admin API. |
| `supabase/functions/email-webhook` | Svix-signed Resend webhook; bounces and complaints land on the suppression list. |
| `supabase/functions/site-publish` | Copies the published site from GitHub into the public `eltes` Storage bucket. |

The **service_role** and **Resend** keys live only in Edge Function secrets. `config.js` ships the publishable key, which is designed to be public; RLS limits it to the signed-in user's own row. Without `RESEND_API_KEY` the function sends nothing and the panel says *Not sent — Supabase has no RESEND_API_KEY yet*. See `supabase/README.md` and `docs.html#supabase`.

Local profiles are untouched: no `config.js`, a desktop build, or one click on *Use a local profile instead* and Eltes behaves exactly as before.

## MCP servers (Blender, Roblox Studio, anything else)

Eltes speaks the Model Context Protocol over Streamable HTTP. The client is `assets/js/mcp.js`; the servers are yours.

```text
Settings → MCP → Blender → Add & connect
  .bat / .sh connector → mcp/eltes-mcp-bridge.mjs → uvx blender-mcp → Blender add-on
Settings → MCP → Roblox Studio → Add & connect
  .bat / .sh connector → mcp/eltes-roblox-bridge.mjs → EltesRobloxBridge.lua in Studio
```

| File | Role |
| --- | --- |
| `assets/js/mcp.js` | Client: `initialize` → `tools/list` → `tools/call`, JSON or event-stream answers, 12 s timeout, per-server on/off |
| `mcp/eltes-mcp-bridge.mjs` | stdio → HTTP bridge for command-based servers (Blender) |
| `mcp/eltes-roblox-bridge.mjs` | MCP server for Roblox with a command queue |
| `mcp/EltesRobloxBridge.lua` | Studio plugin: applies each edit inside an undo recording |

Roblox tools: `scene_report`, `create_part`, `build_model`, `insert_script`, `animate_rig`, `add_effect`, `scaffold_game`, `set_properties`.

Both bridges bind to `127.0.0.1` only and take an optional `--token`. Run the tests with `node --test test/mcp.test.cjs` — they spawn both bridges and simulate the Studio plugin, so no Blender or Roblox install is needed.

## Eltes CAI engine (Rust)

`engine/` is a zero-dependency Rust crate that reimplements the deterministic part of Eltes CAI — the tokenizer, expression parser, unit and temperature conversion, date maths and the answer router — behind a `cai` CLI:

```bash
cd engine
cargo test                 # unit tests + parity against the shared vectors
cargo run --quiet -- "12 km to miles"   # -> 7.4564543068 miles
cargo run --quiet -- --expr "2 + 3 * 4" # -> 14
```

`engine/tests/parity.rs` reads the same `ports/vectors.tsv` the other implementations use, so the crate cannot drift from the ports. Details: [`engine/README.md`](engine/README.md).

## Language ports

`ports/` holds one small, dependency-free implementation of the CAI contract per language, all checked against a single conformance file, [`ports/vectors.tsv`](ports/vectors.tsv) — 49 cases covering arithmetic, implicit multiplication, factorials, unit and temperature conversion, percentages, date maths and the refusal paths.

| Language | File | Run |
| --- | --- | --- |
| Python | [`ports/python/cai.py`](ports/python/cai.py) | `python3 cai.py ../vectors.tsv` |
| JavaScript | [`ports/javascript/cai.js`](ports/javascript/cai.js) | `node cai.js ../vectors.tsv` |
| TypeScript | [`ports/typescript/cai.ts`](ports/typescript/cai.ts) | `npx -p typescript tsc && node dist/cai.js ../vectors.tsv` |
| Perl | [`ports/perl/cai.pl`](ports/perl/cai.pl) | `perl cai.pl ../vectors.tsv` |
| C | [`ports/c/cai.c`](ports/c/cai.c) | `cc -std=c99 -Wall -Wextra -Werror -O2 cai.c -lm -o cai && ./cai ../vectors.tsv` |
| C++ | [`ports/cpp/cai.cpp`](ports/cpp/cai.cpp) | `c++ -std=c++17 -Wall -Wextra -Werror -O2 cai.cpp -o cai && ./cai ../vectors.tsv` |
| Go | [`ports/go/main.go`](ports/go/main.go) | `go run main.go ../vectors.tsv` |
| Ruby | [`ports/ruby/cai.rb`](ports/ruby/cai.rb) | `ruby cai.rb ../vectors.tsv` |
| PHP | [`ports/php/cai.php`](ports/php/cai.php) | `php cai.php ../vectors.tsv` |
| Java | [`ports/java/Cai.java`](ports/java/Cai.java) | `javac Cai.java && java Cai ../vectors.tsv` |
| Kotlin | [`ports/kotlin/Cai.kt`](ports/kotlin/Cai.kt) | `kotlinc Cai.kt -include-runtime -d cai.jar && java -jar cai.jar ../vectors.tsv` |
| C# | [`ports/csharp/Cai.cs`](ports/csharp/Cai.cs) | `dotnet run -- ../vectors.tsv` |
| Lua | [`ports/lua/cai.lua`](ports/lua/cai.lua) | `lua cai.lua ../vectors.tsv` |
| AWK | [`ports/awk/cai.awk`](ports/awk/cai.awk) | `awk -f cai.awk ../vectors.tsv` |
| Julia | [`ports/julia/cai.jl`](ports/julia/cai.jl) | `julia cai.jl ../vectors.tsv` |
| R | [`ports/r/cai.R`](ports/r/cai.R) | `Rscript cai.R ../vectors.tsv` |
| Dart | [`ports/dart/cai.dart`](ports/dart/cai.dart) | `dart cai.dart ../vectors.tsv` |

Every row runs in CI (`.github/workflows/ports.yml`, one job per language). Adding a language means adding a file, a matrix row, and — if it finds a new edge — a vector. Details and the contract: [`ports/README.md`](ports/README.md).

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

This release is distributed under the restrictive terms in [`LICENSE`](LICENSE), not MIT. Two directories are the exception and carry their own MIT licences: [`engine/`](engine/LICENSE) (the Rust crate) and [`ports/`](ports) (the language ports). The source is publicly viewable because the repository is public; that does not grant permission to copy, redistribute, modify, or publish a clone. The license cannot technically prevent downloading or forking public files. The prior MIT-licensed versions remain subject to the rights granted with those releases; this change is not retroactive. Third-party assets retain their own licenses in [`NOTICE.md`](NOTICE.md). This is a project notice, not legal advice.

## Browser coding and local ML

Ask a connected, tool-capable hosted model to build a website with `write_project_file`.
Approve each source file, then edit it in **Code workspace** and click **Preview reviewed code**.
Files are virtual, transient, top-level source files (24 files, 100 KB per file); download them
before closing the tab. Preview supports local plain HTML script/stylesheet references, not
ES modules, npm or filesystem access. CSP blocks resource fetches, but DOM previews are not a network-security boundary: scripts can navigate the frame or freeze a renderer. Never put private data in preview code.

JavaScript fence **Run** opens the reviewed worker sandbox. TensorFlow.js is optional and
unchecked by default. Enable it to use `tf`, `loadLocalLayersModel()` or
`loadLocalGraphModel()` with a compatible model.json plus weight shards selected locally.
No model weights or general-purpose neural chat model are bundled. TensorFlow.js runs on
CPU with a 30-second limit; ordinary snippets have an eight-second limit. Model files stay
local and are cleared when the dialog closes. The third-party runtime retains Apache-2.0 terms.

Studio’s user-operated OS shell now requires `ELTES_STUDIO_SHELL=1`; the chat command
runner separately requires `ELTES_ENABLE_SHELL=1`, pairing and exact-command approval.
Neither is an OS sandbox. Jac is supported as source text, not browser execution.

The latest main’s static Supabase login remains at `auth.html`. The branch’s HttpOnly-cookie
account flow is retained separately at `cookie-auth.html` (requires `/api/auth` on local/Vercel).
They have independent sessions and profile tables; chat currently displays the static profile.
