-- =========================================================
--  0049 — Demo / test-user sandbox
--
--  ⚠⚠⚠  DO NOT BULK-APPLY  ⚠⚠⚠  (2026-06-19)
--  A live-DB audit found this migration was recorded in schema_migrations but
--  NEVER ACTUALLY RAN (no is_demo_user(), no `demo` columns, reels/cards/tasks
--  still have the blanket "auth read/write" policies). The tracking row was
--  removed so status is honest, which means this now shows as [ pending ].
--  The demo-sandbox feature is UNUSED and was intentionally left UNBUILT by the
--  owner. DO NOT let `npm run migrate:apply` / `/update-migrations` apply it
--  blindly — applying it would restructure reels/cards/tasks RLS + add unused
--  demo scaffolding. Apply ONLY on a deliberate owner decision. See HANDOFF.md.
--
--  =========================================================
--  (original header below)
--  0049 — Demo / test-user sandbox
--
--  Adds a real, DB-enforced "demo" persona so the live site can
--  be shared with friends for feedback under one shared login
--  (testuser@gmail.com) WITHOUT them being able to touch real
--  workflow data — even from devtools / the raw supabase client.
--
--  What this does:
--    1. Adds a `demo boolean` flag to reels / review_lane_cards /
--       tasks, and a `tester` people row with role 'demo'.
--    2. is_demo_user()  — true iff the caller's people.role='demo'.
--    3. Replaces the open 0002 "auth.role()='authenticated'"
--       policies with per-operation policies. A demo user may only
--       read/write rows where demo=true; everyone else (owner +
--       team) is unaffected and keeps full access.
--    4. seed_demo()  — lays a small demo=true baseline.
--       reset_demo() — owner-only wrapper that re-seeds (manual
--       backstop; per-session client sandboxing is the main UX).
--
--  SAFETY: only role='demo' is constrained. owner / skilled /
--  variant / reviewer all evaluate `not is_demo_user()` => true,
--  so the `(not is_demo_user() or demo)` branch is always true for
--  them — no lockout. reset_demo()/seed_demo() only ever touch
--  rows where demo=true, so real data is never in a delete path.
-- =========================================================

-- ---------- 1. demo persona + flag ----------
insert into public.people (id, name, short, role, avatar, tone) values
  ('tester', 'Demo Tester', 'Demo', 'demo', 'DT', 'cyan')
on conflict (id) do nothing;

alter table public.reels             add column if not exists demo boolean not null default false;
alter table public.review_lane_cards add column if not exists demo boolean not null default false;
alter table public.tasks             add column if not exists demo boolean not null default false;

-- Partial indexes so the demo-row scans the policies do stay cheap.
create index if not exists reels_demo_idx on public.reels (demo) where demo = true;
create index if not exists review_lane_cards_demo_idx on public.review_lane_cards (demo) where demo = true;
create index if not exists tasks_demo_idx on public.tasks (demo) where demo = true;

-- ---------- 2. helper predicate ----------
create or replace function public.is_demo_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.people
    where user_id = auth.uid() and role = 'demo'
  );
$$;

-- ---------- 3. per-operation RLS (replaces 0002 open policies) ----------
-- reels
drop policy if exists "auth read reels"  on public.reels;
drop policy if exists "auth write reels" on public.reels;
drop policy if exists "reels_select" on public.reels;
drop policy if exists "reels_insert" on public.reels;
drop policy if exists "reels_update" on public.reels;
drop policy if exists "reels_delete" on public.reels;

create policy "reels_select" on public.reels for select
  using ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "reels_insert" on public.reels for insert
  with check ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "reels_update" on public.reels for update
  using      ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) )
  with check ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "reels_delete" on public.reels for delete
  using ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );

-- review_lane_cards
drop policy if exists "auth read cards"  on public.review_lane_cards;
drop policy if exists "auth write cards" on public.review_lane_cards;
drop policy if exists "cards_select" on public.review_lane_cards;
drop policy if exists "cards_insert" on public.review_lane_cards;
drop policy if exists "cards_update" on public.review_lane_cards;
drop policy if exists "cards_delete" on public.review_lane_cards;

create policy "cards_select" on public.review_lane_cards for select
  using ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "cards_insert" on public.review_lane_cards for insert
  with check ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "cards_update" on public.review_lane_cards for update
  using      ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) )
  with check ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "cards_delete" on public.review_lane_cards for delete
  using ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );

-- tasks
drop policy if exists "auth read tasks"  on public.tasks;
drop policy if exists "auth write tasks" on public.tasks;
drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_delete" on public.tasks;

create policy "tasks_select" on public.tasks for select
  using ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "tasks_insert" on public.tasks for insert
  with check ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "tasks_update" on public.tasks for update
  using      ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) )
  with check ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );
create policy "tasks_delete" on public.tasks for delete
  using ( auth.role() = 'authenticated' and (not public.is_demo_user() or demo = true) );

-- ---------- 4. seed + reset ----------
-- Only core columns from 0001 are set explicitly; every column added
-- by later migrations is `add column if not exists` with a default,
-- so the rows below populate safely without enumerating them.
-- display_number is left NULL on purpose (its unique index is partial:
-- WHERE display_number IS NOT NULL, so multiple NULLs never collide).
create or replace function public.seed_demo()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- wipe any prior demo baseline (children first; tasks FK is set-null,
  -- cards FK cascades, but be explicit and order-safe)
  delete from public.tasks             where demo = true;
  delete from public.review_lane_cards where demo = true;
  delete from public.reels             where demo = true;

  -- A small, realistic spread across the pipeline stages.
  insert into public.reels (id, title, stage, owner, lane, state, logline, note, demo) values
    ('DEMO-001', 'City at Dawn — Teaser',        'idea',    'alex', 'editing', 'ok',
       'A 30s sunrise montage over the skyline.', 'Sample reel for the demo sandbox.', true),
    ('DEMO-002', 'Behind the Build',             'editing', 'sam',  'editing', 'ok',
       'Workshop time-lapse with voiceover.',     'Sample reel for the demo sandbox.', true),
    ('DEMO-003', 'Customer Story — Maya',        'review',  'sam',  'review',  'ok',
       'Testimonial cut, needs reviewer pass.',   'Sample reel for the demo sandbox.', true),
    ('DEMO-004', 'Launch Day Recap',             'posted',  'alex', 'editing', 'ok',
       'Event highlights, already published.',    'Sample reel for the demo sandbox.', true);

  -- One review-lane card mirroring the in-review reel.
  insert into public.review_lane_cards (id, parent_id, title, stage, lane, owner, state, note, demo) values
    ('DEMOCARD-003', 'DEMO-003', 'Customer Story — Maya', 'review', 'review', 'maya', 'ok',
       'Awaiting reviewer pass.', true);

  -- A couple of tasks across people.
  insert into public.tasks (id, from_person, to_person, type, reel_id, instruction, state, demo) values
    ('DEMOT-001', 'paul', 'alex', 'edit',   'DEMO-002', 'Tighten the first 5 seconds.',     'open', true),
    ('DEMOT-002', 'maya', 'sam',  'review', 'DEMO-003', 'Re-grade the interview lighting.',  'open', true);
end;
$$;

create or replace function public.reset_demo()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.people where user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'owner only';
  end if;
  perform public.seed_demo();
end;
$$;

revoke all on function public.reset_demo() from public;
grant execute on function public.reset_demo() to authenticated;

-- Lay the initial baseline now so the demo account has data immediately.
select public.seed_demo();
