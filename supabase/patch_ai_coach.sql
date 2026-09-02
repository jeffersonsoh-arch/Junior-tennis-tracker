-- Additive patch for the AI Coach feature — safe to run on an already-seeded
-- database. Creates two new tables only; nothing existing is touched, so
-- there's no data-loss risk the way re-running schema.sql would have.
-- Run once in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade unique,
  messages jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
drop trigger if exists ai_conversations_set_updated_at on public.ai_conversations;
create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.player_progress_set_updated_at();

create table if not exists public.ai_saved_items (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('drill','plan')),
  title text not null,
  summary text,
  segments jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.ai_conversations enable row level security;
drop policy if exists "members can view ai conversation" on public.ai_conversations;
create policy "members can view ai conversation" on public.ai_conversations
  for select using (public.user_is_member_of_player(player_id));
drop policy if exists "members can create ai conversation" on public.ai_conversations;
create policy "members can create ai conversation" on public.ai_conversations
  for insert with check (public.user_is_member_of_player(player_id) and created_by = auth.uid());
drop policy if exists "members can update ai conversation" on public.ai_conversations;
create policy "members can update ai conversation" on public.ai_conversations
  for update using (public.user_is_member_of_player(player_id)) with check (public.user_is_member_of_player(player_id));

alter table public.ai_saved_items enable row level security;
drop policy if exists "members can view ai saved items" on public.ai_saved_items;
create policy "members can view ai saved items" on public.ai_saved_items
  for select using (public.user_is_member_of_player(player_id));
drop policy if exists "members can create ai saved items" on public.ai_saved_items;
create policy "members can create ai saved items" on public.ai_saved_items
  for insert with check (public.user_is_member_of_player(player_id) and created_by = auth.uid());
drop policy if exists "members can delete ai saved items" on public.ai_saved_items;
create policy "members can delete ai saved items" on public.ai_saved_items
  for delete using (public.user_is_member_of_player(player_id));
