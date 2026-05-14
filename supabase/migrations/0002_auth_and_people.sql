-- =========================================================
--  Step 5 — Auth + people identity table
--
--  Adds:
--    · public.people — bridge between auth.users and the four
--      hardcoded role slots (paul/alex/sam/maya). One-time
--      "claim" flow: a signed-in user picks their slot, and
--      people.user_id is set to their auth.uid.
--
--  Tightens existing RLS:
--    · The previous policies allowed anonymous reads + writes
--      (fine for the prototype-without-auth phase). They are
--      replaced by `auth.role() = 'authenticated'` checks so
--      anonymous browsers see nothing and can't write.
--    · Per-role write gates are deliberately NOT enforced at
--      the DB layer — per the chosen "owner god-mode + UI
--      gates" model, the client decides which buttons appear.
--      An attacker with the anon key + a signed-in account
--      could still write anything; that's an accepted
--      trade-off for a 4-person team. Step 7 or later can
--      revisit when there's a real abuse surface.
-- =========================================================

-- ---------- people ----------
create table if not exists public.people (
  id          text primary key,    -- "paul", "alex", "sam", "maya"
  name        text not null,
  short       text,
  role        text not null,       -- owner | skilled | variant | reviewer
  avatar      text,
  tone        text,
  email       text unique,
  user_id     uuid unique references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

insert into public.people (id, name, short, role, avatar, tone) values
  ('paul', 'Paul Victor', 'Paul V', 'owner',    'PV', 'amber'),
  ('alex', 'Alex Rivera', 'Alex R', 'skilled',  'AR', 'cyan'),
  ('sam',  'Sam Kafle',   'Sam K',  'variant',  'SK', 'violet'),
  ('maya', 'Maya Chen',   'Maya C', 'reviewer', 'MC', 'green')
on conflict (id) do nothing;

alter table public.people enable row level security;

drop policy if exists "auth read people"  on public.people;
drop policy if exists "auth claim people" on public.people;

create policy "auth read people"
  on public.people for select
  using (auth.role() = 'authenticated');

create policy "auth claim people"
  on public.people for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---------- Tighten existing RLS ----------
drop policy if exists "anon read reels"          on public.reels;
drop policy if exists "anon write reels"         on public.reels;
drop policy if exists "anon read review_cards"   on public.review_lane_cards;
drop policy if exists "anon write review_cards"  on public.review_lane_cards;
drop policy if exists "anon read tasks"          on public.tasks;
drop policy if exists "anon write tasks"         on public.tasks;

create policy "auth read reels"    on public.reels             for select using (auth.role() = 'authenticated');
create policy "auth write reels"   on public.reels             for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth read cards"    on public.review_lane_cards for select using (auth.role() = 'authenticated');
create policy "auth write cards"   on public.review_lane_cards for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth read tasks"    on public.tasks             for select using (auth.role() = 'authenticated');
create policy "auth write tasks"   on public.tasks             for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
