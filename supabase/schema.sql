-- Deuce Board backend schema.
-- Run this once in your Supabase project's SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).

create table if not exists public.player_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player text not null check (player in ('judah','joseph')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, player)
);

alter table public.player_progress enable row level security;

-- Each signed-in family account can only read/write its own rows.
drop policy if exists "Users manage their own progress" on public.player_progress;
create policy "Users manage their own progress"
  on public.player_progress
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.player_progress_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists player_progress_set_updated_at on public.player_progress;
create trigger player_progress_set_updated_at
  before update on public.player_progress
  for each row execute function public.player_progress_set_updated_at();
