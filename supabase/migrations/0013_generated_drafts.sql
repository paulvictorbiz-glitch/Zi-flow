-- Generated drafts — history for the AI Generate tab.
-- Syncs across devices via Supabase instead of localStorage.

create table if not exists public.generated_drafts (
  id          text primary key default gen_random_uuid()::text,
  prompt      text not null,
  draft       jsonb not null default '{}'::jsonb,
  reel_id     text references public.reels(id) on delete set null,
  created_at  timestamptz default now()
);

create index if not exists generated_drafts_created_idx on public.generated_drafts (created_at desc);

alter table public.generated_drafts enable row level security;
create policy "gen_drafts_select" on public.generated_drafts for select using (true);
create policy "gen_drafts_insert" on public.generated_drafts for insert with check (true);
create policy "gen_drafts_delete" on public.generated_drafts for delete using (true);
