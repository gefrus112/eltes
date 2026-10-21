create table public.eltes_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.eltes_profiles enable row level security;
revoke all on table public.eltes_profiles from anon;
grant select, insert, update on table public.eltes_profiles to authenticated;

create policy "Users can read their own Eltes profile"
  on public.eltes_profiles for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own Eltes profile"
  on public.eltes_profiles for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own Eltes profile"
  on public.eltes_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
