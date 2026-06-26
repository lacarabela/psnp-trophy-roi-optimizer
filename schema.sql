create extension if not exists pgcrypto;

-- Profiles are keyed directly to auth.users.id.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_length
    check (username is null or char_length(username) between 3 and 24),

  constraint profiles_username_format
    check (username is null or username ~ '^[A-Za-z0-9_.-]+$')
);

-- Case-insensitive username uniqueness.
create unique index if not exists profiles_username_lower_unique
on public.profiles (lower(username))
where username is not null;

create table if not exists public.roi_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bronze_weight numeric not null default 15 check (bronze_weight >= 0),
  silver_weight numeric not null default 30 check (silver_weight >= 0),
  gold_weight numeric not null default 90 check (gold_weight >= 0),
  platinum_weight numeric not null default 300 check (platinum_weight >= 0),
  platinum_bonus numeric not null default 300 check (platinum_bonus >= 0),
  difficulty_penalty numeric not null default 1 check (difficulty_penalty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  difficulty numeric not null check (difficulty >= 1 and difficulty <= 10),
  hours numeric not null check (hours > 0),

  bronze_total integer not null default 0 check (bronze_total >= 0),
  silver_total integer not null default 0 check (silver_total >= 0),
  gold_total integer not null default 0 check (gold_total >= 0),
  platinum_total integer not null default 0 check (platinum_total >= 0 and platinum_total <= 1),

  bronze_earned integer not null default 0 check (bronze_earned >= 0),
  silver_earned integer not null default 0 check (silver_earned >= 0),
  gold_earned integer not null default 0 check (gold_earned >= 0),
  platinum_earned integer not null default 0 check (platinum_earned >= 0 and platinum_earned <= 1),

  bronze_completable integer not null default 0 check (bronze_completable >= 0),
  silver_completable integer not null default 0 check (silver_completable >= 0),
  gold_completable integer not null default 0 check (gold_completable >= 0),
  platinum_completable boolean not null default true,

  notes text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint games_bronze_earned_lte_total check (bronze_earned <= bronze_total),
  constraint games_silver_earned_lte_total check (silver_earned <= silver_total),
  constraint games_gold_earned_lte_total check (gold_earned <= gold_total),
  constraint games_platinum_earned_lte_total check (platinum_earned <= platinum_total),

  constraint games_bronze_completable_lte_remaining
    check (bronze_completable <= bronze_total - bronze_earned),

  constraint games_silver_completable_lte_remaining
    check (silver_completable <= silver_total - silver_earned),

  constraint games_gold_completable_lte_remaining
    check (gold_completable <= gold_total - gold_earned)
);

create index if not exists games_user_id_created_at_idx
on public.games (user_id, created_at);

-- Automatically maintain updated_at columns.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists roi_settings_set_updated_at on public.roi_settings;
create trigger roi_settings_set_updated_at
before update on public.roi_settings
for each row execute function public.set_updated_at();

drop trigger if exists games_set_updated_at on public.games;
create trigger games_set_updated_at
before update on public.games
for each row execute function public.set_updated_at();

-- Enable Row Level Security.
alter table public.profiles enable row level security;
alter table public.roi_settings enable row level security;
alter table public.games enable row level security;

-- Profiles: users can only read/write their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles
for delete
to authenticated
using (auth.uid() = id);

-- ROI settings: users can only read/write their own settings.
drop policy if exists "roi_settings_select_own" on public.roi_settings;
create policy "roi_settings_select_own"
on public.roi_settings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "roi_settings_insert_own" on public.roi_settings;
create policy "roi_settings_insert_own"
on public.roi_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "roi_settings_update_own" on public.roi_settings;
create policy "roi_settings_update_own"
on public.roi_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "roi_settings_delete_own" on public.roi_settings;
create policy "roi_settings_delete_own"
on public.roi_settings
for delete
to authenticated
using (auth.uid() = user_id);

-- Games: users can only read/write their own games.
drop policy if exists "games_select_own" on public.games;
create policy "games_select_own"
on public.games
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "games_insert_own" on public.games;
create policy "games_insert_own"
on public.games
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "games_update_own" on public.games;
create policy "games_update_own"
on public.games
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "games_delete_own" on public.games;
create policy "games_delete_own"
on public.games
for delete
to authenticated
using (auth.uid() = user_id);