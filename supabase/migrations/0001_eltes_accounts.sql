-- ==========================================================================
-- Eltes — accounts, mail log and suppression list
-- --------------------------------------------------------------------------
-- Runs on the Supabase project that serves the static site (ripcraft).
-- Everything here is additive and idempotent: running it twice is safe.
--
-- Privileges are explicit. The browser only ever holds the publishable
-- (anon) key, so "anon" gets nothing, signed-in users read their own row,
-- and the Edge Functions act through the service role.
-- ==========================================================================

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null default '',
  display_name         text not null default 'Eltes user',
  bio                  text not null default '',
  plan                 text not null default 'byok',
  welcome_email_status text not null default 'pending'
                       check (welcome_email_status in ('pending', 'sent', 'suppressed', 'failed', 'queued')),
  welcome_email_id     text,
  welcome_email_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- A signed-in user may edit presentation only. Mail state stays server-owned.
grant update (display_name, bio) on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.eltes_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.eltes_touch_updated_at();

-- Every new auth user gets a profile in the same transaction. This is also
-- what the welcome email is keyed on, so a user can never exist without one.
create or replace function public.eltes_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Eltes user'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists eltes_on_auth_user_created on auth.users;
create trigger eltes_on_auth_user_created
  after insert on auth.users
  for each row execute function public.eltes_new_user();

-- ------------------------------------------------------------- email_events
create table if not exists public.email_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  email       text not null,
  kind        text not null check (kind in ('welcome', 'magiclink', 'recovery', 'webhook', 'test')),
  status      text not null check (status in ('sent', 'queued', 'suppressed', 'failed', 'unconfigured')),
  provider    text,
  provider_id text,
  detail      text,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists email_events_email_time on public.email_events (email, created_at desc);
create index if not exists email_events_user on public.email_events (user_id);

-- One delivered welcome letter per account, enforced by the database.
create unique index if not exists email_events_one_welcome
  on public.email_events (user_id)
  where kind = 'welcome' and status = 'sent';

alter table public.email_events enable row level security;
revoke all on public.email_events from anon, authenticated;
grant select on public.email_events to authenticated;

drop policy if exists email_events_select_own on public.email_events;
create policy email_events_select_own on public.email_events
  for select to authenticated
  using (auth.uid() = user_id);

-- -------------------------------------------------------- suppressed_emails
create table if not exists public.suppressed_emails (
  email      text primary key,
  reason     text not null,
  detail     text,
  source     text not null default 'resend',
  created_at timestamptz not null default now()
);

alter table public.suppressed_emails enable row level security;
revoke all on public.suppressed_emails from anon, authenticated;

-- ----------------------------------------------------------------- mail_rate
-- Small fixed-window counter so the public mail function cannot be used as an
-- open relay. Server-only.
create table if not exists public.mail_rate (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

alter table public.mail_rate enable row level security;
revoke all on public.mail_rate from anon, authenticated;

create or replace function public.mail_consume(p_bucket text, p_limit integer, p_window interval)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_      public.mail_rate;
  allowed   boolean;
  remaining integer;
begin
  insert into public.mail_rate (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case
      when public.mail_rate.window_start < now() - p_window then 1
      else public.mail_rate.hits + 1
    end,
    window_start = case
      when public.mail_rate.window_start < now() - p_window then now()
      else public.mail_rate.window_start
    end
  returning * into row_;

  allowed := row_.hits <= p_limit;
  remaining := greatest(0, p_limit - row_.hits);
  return jsonb_build_object(
    'allowed', allowed,
    'remaining', remaining,
    'reset_at', row_.window_start + p_window
  );
end;
$$;

revoke all on function public.mail_consume(text, integer, interval) from public, anon, authenticated;
grant execute on function public.mail_consume(text, integer, interval) to service_role;

-- ------------------------------------------------------------- mail_overview
-- What the account panel reads: this user's own letters, newest first.
create or replace view public.mail_overview
with (security_invoker = true) as
  select id, kind, status, provider, provider_id, created_at
  from public.email_events
  where user_id = auth.uid()
  order by created_at desc
  limit 25;

revoke all on public.mail_overview from anon;
grant select on public.mail_overview to authenticated;
