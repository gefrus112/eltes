-- ==========================================================================
-- Eltes — backfill profiles for accounts that signed up before the schema
-- --------------------------------------------------------------------------
-- The live project had auth users but no `public.profiles` rows: the first
-- migration was written here but never pushed, so Supabase Auth kept creating
-- users while the welcome-email function looked for a profile that did not
-- exist. `0001` creates the table, the trigger and the policies; this one
-- gives every existing auth user the row they should have had, and is safe to
-- run again (it only inserts what is missing).
--
-- Run after 0001: `npx supabase db push`, or paste into the SQL editor.
-- ==========================================================================

insert into public.profiles (id, email, display_name)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Eltes user'
  )
from auth.users u
on conflict (id) do nothing;

-- Sanity check: after this statement the two counts must match.
--   select (select count(*) from auth.users) as users,
--          (select count(*) from public.profiles) as profiles;
