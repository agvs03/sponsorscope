-- SponsorPilot accounts: run once in Supabase → SQL Editor → New query → Run.
-- Every table is locked to its owner with row-level security, so a signed-in
-- user can read and write only their own rows even with the public anon key.

-- Parsed resume (form fields + skills). The original file is never stored.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  resume      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Saved jobs and their application status.
create table if not exists public.tracker (
  user_id     uuid not null references auth.users (id) on delete cascade,
  job_id      text not null,
  title       text,
  company     text,
  url         text,
  status      text not null default 'Saved',
  updated_at  timestamptz not null default now(),
  primary key (user_id, job_id)
);

-- Saved searches that drive the daily email digest.
create table if not exists public.saved_searches (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  query            text not null default '',
  location         text not null default '',
  sponsors_only    boolean not null default true,
  hide_no_sponsor  boolean not null default true,
  email_enabled    boolean not null default true,
  unsub_token      uuid not null default gen_random_uuid(),
  last_sent_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists saved_searches_user on public.saved_searches (user_id);

alter table public.profiles enable row level security;
alter table public.tracker enable row level security;
alter table public.saved_searches enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own tracker" on public.tracker;
create policy "own tracker" on public.tracker
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own searches" on public.saved_searches;
create policy "own searches" on public.saved_searches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- "Delete my account": removes the auth user; every table above cascades.
create or replace function public.delete_my_account()
returns void language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- One-click unsubscribe from an alert email, no sign-in needed. The token is
-- a random UUID per saved search, so it can only turn off that one alert.
create or replace function public.unsubscribe(token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.saved_searches set email_enabled = false where unsub_token = token;
  return found;
end;
$$;
revoke all on function public.unsubscribe(uuid) from public;
grant execute on function public.unsubscribe(uuid) to anon, authenticated;
