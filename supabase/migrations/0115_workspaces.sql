-- 0115_workspaces.sql
-- Workspaces — the client/workspace foundation (v1: Pipeline reels/cards +
-- Footage search scoping). Introduces public.workspaces and scopes public.reels
-- by a workspace_id, so the Pipeline board and footage search can be filtered to
-- one client at a time. Children (review_lane_cards, attached_footage_items,
-- tasks) inherit their workspace via reel_id and get NO column of their own.
--
-- WHAT THIS ADDS:
--   * public.workspaces(slug TEXT PK, name, color?, created_at) — the client
--     directory. `slug` is the ONE shared identifier: workspaces.slug ===
--     reels.workspace_id === the backend's client_id (byte-identical, never
--     transformed). Seeded with the default 'paul' workspace.
--   * public.reels.workspace_id TEXT NOT NULL DEFAULT 'paul' — the scoping key.
--     All pre-existing rows backfill to 'paul' (the default/fallback slug), so
--     nothing changes behaviourally until a second workspace is minted.
--   * an index on reels(workspace_id) for the scoped board/list queries.
--
-- RLS: workspaces gets the SAME FLAT authenticated-only policy the sibling
--   tables use (FOR ALL TO authenticated USING(true) WITH CHECK(true)). This is
--   deliberately NOT a self-referencing policy — a policy on public.workspaces
--   must never SELECT public.workspaces in its USING/WITH CHECK or it triggers
--   `infinite recursion detected in policy` (CLAUDE.md rule 8a). Isolation
--   between workspaces is a QUERY FILTER (reels.workspace_id), not a security
--   wall; the trusted-team flat policy stays. reels' own policies are unchanged
--   (the new column inherits "auth write reels" etc.).
--
-- NO foreign key from reels.workspace_id -> workspaces.slug (kept loose so a
--   pre-existing / mistyped slug can never block a reel insert), NO child-table
--   columns. The `color` column is nullable and backs createWorkspace(slug,
--   name, color) in src/lib/workspace.jsx.
--
-- GRACEFUL DEGRADATION: until this file is hand-applied, the store's scoped
--   reels fetch (.eq('workspace_id', slug)) strip-retries UNFILTERED on
--   /workspace_id|column|42703|PGRST/, and persistCreateReel/persistUpdateReel
--   strip workspace_id on /workspace_id|column|PGRST204/ — so a pre-0115 DB
--   behaves byte-identically to today (everything is implicitly 'paul') and no
--   card ever vanishes. Applying this migration flips scoping on with no code
--   change.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files — 0112, 0113, 0114 — are intentionally
-- held back; see CLAUDE.md rule 8d). Never applied by any agent.
--
-- Fully idempotent (CREATE TABLE / ADD COLUMN IF NOT EXISTS, DROP+CREATE POLICY,
-- ON CONFLICT DO NOTHING, guarded backfill, CREATE INDEX IF NOT EXISTS). NO
-- 'concurrently'. Safely re-runnable.

-- 1. The workspaces directory.
create table if not exists public.workspaces (
  slug        text primary key,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now()
);

-- Seed the default workspace. slug is the PK — no id column exists.
insert into public.workspaces (slug, name)
values ('paul', 'Paul Victor')
on conflict (slug) do nothing;

-- RLS: flat authenticated-only, NON-recursive (never selects workspaces).
alter table public.workspaces enable row level security;
drop policy if exists "auth_all_workspaces" on public.workspaces;
create policy "auth_all_workspaces" on public.workspaces
  for all
  to authenticated
  using (true)
  with check (true);

-- 2. Scope reels by workspace. Additive column, defaults + backfills to 'paul'.
alter table public.reels
  add column if not exists workspace_id text not null default 'paul';

-- Guarded backfill for any row that predates the default (belt-and-suspenders;
-- the NOT NULL DEFAULT already covers new/existing rows).
update public.reels set workspace_id = 'paul' where workspace_id is null;

-- Index for the scoped board/list queries.
create index if not exists reels_workspace_id_idx on public.reels (workspace_id);
