-- Deuce Board platform schema (v2) — multi-tenant: many players per account,
-- players shareable between accounts, NTRP 1.0-7.0 + a separate youth
-- pathway, coach-configurable plan length in quarters, and level history.
--
-- This SUPERSEDES the v1 schema from PR #1 (single-owner player_progress
-- keyed by a hardcoded player name). Run this in a fresh project, or in the
-- same project if v1 was never actually used in production — it drops and
-- rebuilds player_progress rather than migrating it, per the "Judah and
-- Joseph start fresh" decision.
--
-- Run once in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

drop table if exists public.player_progress cascade;
drop table if exists public.plans cascade;
drop table if exists public.player_levels cascade;
drop table if exists public.player_members cascade;
drop table if exists public.players cascade;
drop table if exists public.drill_blocks cascade;
drop table if exists public.quiz_banks cascade;
drop table if exists public.level_thresholds cascade;

-- ---------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  birth_year int not null,
  pathway text not null check (pathway in ('youth','ntrp')),
  sessions_per_week int not null default 3,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Who can see/edit a player: the creating account plus anyone they invite.
-- role: 'owner' can remove members and delete the player; 'member' can log
-- sessions, edit progress, and change level.
-- status: 'invited' rows have no user_id yet (matched by email); 'active'
-- rows are claimed.
create table public.player_members (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text not null,
  -- Denormalized so an invitee can see who/what they're being invited to
  -- before they've claimed membership — the players row itself isn't
  -- readable to them yet (RLS requires active membership).
  player_name_snapshot text not null,
  role text not null check (role in ('owner','member')) default 'member',
  status text not null check (status in ('invited','active')) default 'invited',
  created_at timestamptz not null default now()
);
create unique index player_members_email_uniq on public.player_members (player_id, lower(invited_email));
create unique index player_members_user_uniq on public.player_members (player_id, user_id) where user_id is not null;

-- Append-only level history — never edited or deleted, so past weeks can
-- always show what was actually assigned at the time (R4.3).
create table public.player_levels (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  ntrp_level numeric(2,1) check (ntrp_level between 1.0 and 7.0),
  youth_stage text check (youth_stage in ('red_starter','red_rally','red_game_player','orange_ready')),
  effective_date date not null default current_date,
  set_by text not null check (set_by in ('manual','benchmark_suggested')) default 'manual',
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.validate_player_level()
returns trigger
language plpgsql
as $$
declare v_pathway text;
begin
  select pathway into v_pathway from public.players where id = new.player_id;
  if v_pathway = 'ntrp' and (new.ntrp_level is null or new.youth_stage is not null) then
    raise exception 'ntrp players require ntrp_level and no youth_stage';
  elsif v_pathway = 'youth' and (new.youth_stage is null or new.ntrp_level is not null) then
    raise exception 'youth players require youth_stage and no ntrp_level';
  end if;
  return new;
end;
$$;
drop trigger if exists player_levels_validate on public.player_levels;
create trigger player_levels_validate before insert on public.player_levels
  for each row execute function public.validate_player_level();

-- A plan is just "how many quarters, starting when" — content is generated
-- client-side from drill_blocks + the level active on each week, never
-- stored, so it can't drift from the library or level history.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  quarters int not null check (quarters between 1 and 4),
  start_date date not null default current_date,
  status text not null check (status in ('active','archived')) default 'active',
  created_at timestamptz not null default now()
);
create unique index plans_one_active_per_player on public.plans (player_id) where status = 'active';

-- Weekly log, badges/skill status, benchmarks/check-ins, quiz results —
-- same shape PR #1 used, now keyed to a plan instead of a hardcoded name.
create table public.player_progress (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade unique,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.player_progress_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists player_progress_set_updated_at on public.player_progress;
create trigger player_progress_set_updated_at
  before update on public.player_progress
  for each row execute function public.player_progress_set_updated_at();

-- ---------------------------------------------------------------------
-- Content library (reference data — not user-owned, read-only from the
-- client; edit via the SQL editor / a future admin tool)
-- ---------------------------------------------------------------------

create table public.drill_blocks (
  id uuid primary key default gen_random_uuid(),
  pathway text not null check (pathway in ('youth','ntrp')),
  level_min numeric(2,1),
  level_max numeric(2,1),
  youth_stage text check (youth_stage in ('red_starter','red_rally','red_game_player','orange_ready')),
  quarter int not null check (quarter between 1 and 4),
  block_order int not null default 1,
  title text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  check (
    (pathway = 'ntrp' and level_min is not null and level_max is not null and youth_stage is null)
    or
    (pathway = 'youth' and youth_stage is not null and level_min is null and level_max is null)
  )
);
create index drill_blocks_ntrp_lookup on public.drill_blocks (pathway, level_min, level_max, quarter, block_order) where pathway = 'ntrp';
create index drill_blocks_youth_lookup on public.drill_blocks (pathway, youth_stage, quarter, block_order) where pathway = 'youth';

-- Quiz banks, same level/stage/quarter addressing as drill_blocks. Sparse
-- by design in v1 — only levels with an authored bank get a Quiz tab;
-- others see a "not yet written for this level" message instead of
-- thin, low-quality filler questions.
create table public.quiz_banks (
  id uuid primary key default gen_random_uuid(),
  pathway text not null check (pathway in ('youth','ntrp')),
  level_min numeric(2,1),
  level_max numeric(2,1),
  youth_stage text check (youth_stage in ('red_starter','red_rally','red_game_player','orange_ready')),
  quarter int not null check (quarter between 1 and 4),
  questions jsonb not null,
  created_at timestamptz not null default now(),
  check (
    (pathway = 'ntrp' and level_min is not null and level_max is not null and youth_stage is null)
    or
    (pathway = 'youth' and youth_stage is not null and level_min is null and level_max is null)
  )
);

-- One graduation threshold per level/stage: if a benchmark's entered
-- results clear these, the app suggests (never auto-applies) leveling up.
create table public.level_thresholds (
  id uuid primary key default gen_random_uuid(),
  pathway text not null check (pathway in ('youth','ntrp')),
  ntrp_level numeric(2,1) check (ntrp_level between 1.0 and 7.0),
  youth_stage text check (youth_stage in ('red_starter','red_rally','red_game_player','orange_ready')),
  serve_pct_target int,
  rally_balls_target int,
  agility_sec_target numeric(3,1),
  longest_rally_target int,
  next_ntrp_level numeric(2,1),
  next_youth_stage text,
  created_at timestamptz not null default now(),
  check (
    (pathway = 'ntrp' and ntrp_level is not null and youth_stage is null)
    or
    (pathway = 'youth' and youth_stage is not null and ntrp_level is null)
  )
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

-- Shared membership check, used by every player-scoped table below.
-- SECURITY DEFINER so it can read player_members without itself being
-- blocked by that table's own (self-referential) RLS policies.
create or replace function public.user_is_member_of_player(p_player_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.player_members m
    where m.player_id = p_player_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

alter table public.players enable row level security;
-- `created_by = auth.uid()` is required in addition to membership: without
-- it, INSERT ... RETURNING (used right after creating a player, before its
-- player_members row exists yet) fails the RETURNING row's SELECT check
-- and surfaces as a confusing "violates row-level security policy" error
-- on the INSERT itself.
create policy "members can view player" on public.players
  for select using (public.user_is_member_of_player(id) or created_by = auth.uid());
create policy "members can update player" on public.players
  for update using (public.user_is_member_of_player(id)) with check (public.user_is_member_of_player(id));
create policy "signed-in users can create a player" on public.players
  for insert with check (created_by = auth.uid());
create policy "owners can delete player" on public.players
  for delete using (exists (
    select 1 from public.player_members m
    where m.player_id = players.id and m.user_id = auth.uid() and m.role = 'owner' and m.status = 'active'
  ));

alter table public.player_members enable row level security;
create policy "members can view membership rows" on public.player_members
  for select using (public.user_is_member_of_player(player_id));
create policy "invitee can see their own pending invite" on public.player_members
  for select using (lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "members can invite new members" on public.player_members
  for insert with check (public.user_is_member_of_player(player_id));
create policy "creator can self-add as owner" on public.player_members
  for insert with check (
    user_id = auth.uid() and role = 'owner' and status = 'active'
    and exists (select 1 from public.players p where p.id = player_members.player_id and p.created_by = auth.uid())
  );
create policy "members can update membership" on public.player_members
  for update using (public.user_is_member_of_player(player_id)) with check (public.user_is_member_of_player(player_id));
create policy "invitee can claim their invite" on public.player_members
  for update
  using (user_id is null and lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (user_id = auth.uid() and status = 'active');
create policy "owner can remove members" on public.player_members
  for delete using (exists (
    select 1 from public.player_members m
    where m.player_id = player_members.player_id and m.user_id = auth.uid() and m.role = 'owner' and m.status = 'active'
  ));
create policy "member can remove self" on public.player_members
  for delete using (user_id = auth.uid());

alter table public.player_levels enable row level security;
create policy "members can view levels" on public.player_levels
  for select using (public.user_is_member_of_player(player_id));
create policy "members can add a level entry" on public.player_levels
  for insert with check (public.user_is_member_of_player(player_id) and created_by = auth.uid());
-- No update/delete policy: level history is append-only by design.

alter table public.plans enable row level security;
create policy "members can view plans" on public.plans
  for select using (public.user_is_member_of_player(player_id));
create policy "members can create plans" on public.plans
  for insert with check (public.user_is_member_of_player(player_id));
create policy "members can update plans" on public.plans
  for update using (public.user_is_member_of_player(player_id)) with check (public.user_is_member_of_player(player_id));

alter table public.player_progress enable row level security;
create policy "members can view progress" on public.player_progress
  for select using (exists (
    select 1 from public.plans pl where pl.id = player_progress.plan_id and public.user_is_member_of_player(pl.player_id)
  ));
create policy "members can create progress" on public.player_progress
  for insert with check (exists (
    select 1 from public.plans pl where pl.id = player_progress.plan_id and public.user_is_member_of_player(pl.player_id)
  ));
create policy "members can update progress" on public.player_progress
  for update using (exists (
    select 1 from public.plans pl where pl.id = player_progress.plan_id and public.user_is_member_of_player(pl.player_id)
  )) with check (exists (
    select 1 from public.plans pl where pl.id = player_progress.plan_id and public.user_is_member_of_player(pl.player_id)
  ));

-- Content library: readable by any signed-in user, writable only from the
-- SQL editor (no insert/update/delete policy = denied by default under RLS).
alter table public.drill_blocks enable row level security;
create policy "signed-in users can read drill blocks" on public.drill_blocks
  for select using (auth.role() = 'authenticated');

alter table public.level_thresholds enable row level security;
create policy "signed-in users can read thresholds" on public.level_thresholds
  for select using (auth.role() = 'authenticated');

alter table public.quiz_banks enable row level security;
create policy "signed-in users can read quiz banks" on public.quiz_banks
  for select using (auth.role() = 'authenticated');
