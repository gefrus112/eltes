# Cloud accounts — what lives in Supabase

Everything in this folder belongs to the **project owner's own Supabase account**.
Eltes ships no backend of its own: the static site talks to this project, and the
project sends its own mail.

The reference deployment is project **`ripcraft`** (`odemzfpgercjitrrdlvk`,
`us-east-2`, Postgres 17). Any project works — nothing here is specific to it.

```
supabase/
├── migrations/
│   └── 0001_eltes_accounts.sql      tables, trigger, RLS, rate limits
└── functions/
    ├── eltes-mail/index.ts          welcome · magic link · password reset
    └── email-webhook/index.ts       Resend bounce/complaint → suppression
```

Both functions are a single file with no imports. They are plain JavaScript in
`.ts` files so the same source can be deployed with `deno` and executed by
`test/supabase.test.cjs` against a fake PostgREST, Auth and Resend.

## What the migration creates

| Object | Why |
| --- | --- |
| `public.profiles` | One row per `auth.users` row, created by an `after insert` trigger. Holds the display name, plan and the welcome-email state. |
| `public.email_events` | Every send attempt: kind, status, provider id, ip. A partial unique index (`kind = 'welcome' and status = 'sent'`) makes a second welcome impossible. |
| `public.suppressed_emails` | Hard bounces and complaints. The mail function checks this before calling Resend. |
| `public.mail_rate` + `mail_consume()` | Atomic fixed-window counter: 6 messages per network and 3 per address per 10 minutes. |
| `public.mail_overview` | A `security_invoker` view the signed-in user can read: their own letters only. |

Row-level security is on for every table. `anon` has no privileges at all;
`authenticated` may read its own profile and email events and update only
`display_name` and `bio`. Mail state is written by the service role, never by
the browser.

## Secrets

Set with `npx supabase secrets set …` or in **Project Settings → Edge Functions
→ Secrets**. They are never in the repository and never in `config.js`.

| Secret | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | yes, to send | `re_…` from [resend.com](https://resend.com) — free: 3,000/month, 100/day. |
| `ELTES_MAIL_FROM` | recommended | e.g. `Eltes <hello@yourdomain.com>`. Defaults to `Eltes <onboarding@resend.dev>`, which Resend only delivers to the account owner until a domain is verified. |
| `ELTES_SITE_URL` | recommended | Where links land. Defaults to `https://gefrus112.github.io/eltes/`. |
| `ELTES_REPLY_TO` | optional | `Reply-To` header. |
| `RESEND_WEBHOOK_SECRET` | optional | `whsec_…`; when set, the webhook requires a valid Svix signature. |
| `ELTES_WEBHOOK_TOKEN` | optional | Fallback shared token (`?token=…`) when no Svix secret is configured. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

## Deploy

```bash
npx supabase link --project-ref <ref>
npx supabase db push
npm run supabase:deploy          # both functions, --no-verify-jwt
```

`--no-verify-jwt` is deliberate: a sign-up has no session yet, and the mail
function authenticates by looking the address up in `profiles` and rate-limits
every call. The webhook verifies Resend's signature instead of a JWT.

## Auth settings that matter

| Setting | Value | Why |
| --- | --- | --- |
| Site URL | your Pages URL | Where verification links return. |
| Redirect URLs | `https://<user>.github.io/eltes/**`, `http://localhost:4173/**` | The generated links must be allowed. |
| Email provider | **not used** | Supabase's built-in mailer is limited to a couple of messages an hour and only reaches project members. Every letter here is built with the admin API and sent by Resend. |
| Confirm email | either | With confirmation off, sign-up returns a session and the welcome letter's link simply opens the workspace. With it on, the same link confirms the address first. |

## Resend webhook

Resend dashboard → Webhooks → add endpoint:

```
https://<ref>.supabase.co/functions/v1/email-webhook
```

Events: `email.delivered`, `email.bounced`, `email.complained`. Copy the signing
secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`. Bounces and complaints then
land in `suppressed_emails`, and the mail function refuses to write to that
address again until you delete the row.

## Verify

```bash
curl -s "https://<ref>.supabase.co/functions/v1/eltes-mail?status=1" \
  -H "apikey: <publishable key>"
# {"configured":true,"provider":"resend","from":"…","site":"…"}
```

Then create an account on the site: the panel reports what actually happened —
`sent`, `already_sent`, `suppressed`, `no_mail_provider`, `rate_limited` or the
provider's own error. `select * from public.email_events order by created_at desc
limit 20;` shows the same thing from the database side.

## Free-tier reality

- 2 active projects, 500,000 Edge Function invocations a month, 50,000 MAU.
- A project idle for about a week is paused; one click in the dashboard resumes it.
- Resend free tier: 100 messages a day, 3,000 a month, no card. Overage is
  rejected rather than billed.
- The publishable key is public by design. The service role key is not — if it
  ever appears in `config.js`, HTML or a test, `npm test` fails.
