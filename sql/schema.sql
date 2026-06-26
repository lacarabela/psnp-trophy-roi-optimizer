-- Trophy ROI Optimizer schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint username_format check (username is null or username ~ '^[A-Za-z0-9_.-]{3,24}$')
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  difficulty numeric not null check (difficulty > 0),
  hours numeric not null check (hours > 0),
  bronze_total integer default 0 check (bronze_total >= 0),
  silver_total integer default 0 check (silver_total >= 0),
  gold_total integer default 0 check (gold_total >= 0),
  platinum_total integer default 0 check (platinum_total >= 0),
  bronze_earned integer default 0 check (bronze_earned >= 0),
  silver_earned integer default 0 check (silver_earned >= 0),
  gold_earned integer default 0 check (gold_earned >= 0),
  platinum_earned integer default 0 check (platinum_earned >= 0),
  bronze_completable integer default 0 check (bronze_completable >= 0),
  silver_completable integer default 0 check (silver_completable >= 0),
  gold_completable integer default 0 check (gold_completable >= 0),
  platinum_completable boolean default true,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.roi_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  bronze_weight numeric default 15,
  silver_weight numeric default 30,
  gold_weight numeric default 90,
  platinum_weight numeric default 300,
  platinum_bonus numeric default 300,
  difficulty_penalty numeric default 1,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.roi_settings enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can view their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can insert their own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users can view their own games" on public.games;
drop policy if exists "Users can insert their own games" on public.games;
drop policy if exists "Users can update their own games" on public.games;
drop policy if exists "Users can delete their own games" on public.games;
create policy "Users can view their own games" on public.games for select using (auth.uid() = user_id);
create policy "Users can insert their own games" on public.games for insert with check (auth.uid() = user_id);
create policy "Users can update their own games" on public.games for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own games" on public.games for delete using (auth.uid() = user_id);

drop policy if exists "Users can view their own roi settings" on public.roi_settings;
drop policy if exists "Users can insert their own roi settings" on public.roi_settings;
drop policy if exists "Users can update their own roi settings" on public.roi_settings;
drop policy if exists "Users can delete their own roi settings" on public.roi_settings;
create policy "Users can view their own roi settings" on public.roi_settings for select using (auth.uid() = user_id);
create policy "Users can insert their own roi settings" on public.roi_settings for insert with check (auth.uid() = user_id);
create policy "Users can update their own roi settings" on public.roi_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own roi settings" on public.roi_settings for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists set_games_updated_at on public.games;
create trigger set_games_updated_at before update on public.games for each row execute function public.set_updated_at();

drop trigger if exists set_roi_settings_updated_at on public.roi_settings;
create trigger set_roi_settings_updated_at before update on public.roi_settings for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^A-Za-z0-9_.-]', '', 'g'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
