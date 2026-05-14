-- =========================================================
--  Workflow dashboard — initial schema
--  Mirrors the in-memory store: reels, review_lane_cards, tasks.
--
--  Notes:
--   · Text PKs (REEL-201, IDEA-088, T-301, ...) preserve the
--     existing human-readable IDs. Auto-numbered surrogate keys
--     can come later if needed.
--   · `from` / `to` are reserved SQL words → renamed to
--     from_person / to_person.
--   · `state` is a Postgres reserved-ish identifier in some
--     contexts; we quote it implicitly via lowercase use.
--   · variant_progress + links are stored as jsonb so the
--     client doesn't need a join for these shapeless fields.
--   · RLS is enabled but starts permissive — step 5 tightens
--     it to per-user policies once auth is wired up.
-- =========================================================

-- updated_at auto-bump trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- reels ----------
create table if not exists public.reels (
  id              text primary key,
  title           text not null,
  stage           text not null,
  owner           text,
  lane            text,
  state           text default 'ok',
  age             text,
  due             text,
  fb              integer default 0,
  refs            integer default 0,
  blocker         text,
  blocker_role    text,
  next            text,
  downstream      text,
  grouping        text,
  variant_progress jsonb,
  note            text,
  foot            text,
  tone            text,
  links           jsonb,
  status          text,
  prev_owner      text,
  logline         text,
  fb_query        text,
  audio           text,
  inspo           text,
  plan            text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists reels_stage_idx on public.reels (stage);
create index if not exists reels_owner_idx on public.reels (owner);
create index if not exists reels_state_idx on public.reels (state);

drop trigger if exists trg_reels_updated_at on public.reels;
create trigger trg_reels_updated_at
before update on public.reels
for each row execute procedure public.set_updated_at();

-- ---------- review_lane_cards (Maya's reviewer-pass projections) ----------
create table if not exists public.review_lane_cards (
  id          text primary key,
  parent_id   text references public.reels(id) on delete cascade,
  title       text not null,
  stage       text not null,
  lane        text default 'review',
  owner       text,
  state       text default 'ok',
  note        text,
  foot        text,
  tone        text,
  status      text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists review_lane_cards_parent_idx on public.review_lane_cards (parent_id);

drop trigger if exists trg_review_lane_cards_updated_at on public.review_lane_cards;
create trigger trg_review_lane_cards_updated_at
before update on public.review_lane_cards
for each row execute procedure public.set_updated_at();

-- ---------- tasks ----------
create table if not exists public.tasks (
  id           text primary key,
  from_person  text,
  to_person    text,
  type         text,
  reel_id      text references public.reels(id) on delete set null,
  instruction  text,
  due          text,
  state        text default 'open',
  ref          text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists tasks_to_idx on public.tasks (to_person);
create index if not exists tasks_reel_idx on public.tasks (reel_id);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute procedure public.set_updated_at();

-- ---------- Row Level Security ----------
-- Enabled, but permissive until step 5 wires auth. The anon key
-- can read AND write everything for now — fine for prototype,
-- NOT fine once a real user lives in this database.
alter table public.reels             enable row level security;
alter table public.review_lane_cards enable row level security;
alter table public.tasks             enable row level security;

drop policy if exists "anon read reels"             on public.reels;
drop policy if exists "anon write reels"            on public.reels;
drop policy if exists "anon read review_cards"      on public.review_lane_cards;
drop policy if exists "anon write review_cards"     on public.review_lane_cards;
drop policy if exists "anon read tasks"             on public.tasks;
drop policy if exists "anon write tasks"            on public.tasks;

create policy "anon read reels"          on public.reels             for select using (true);
create policy "anon write reels"         on public.reels             for all    using (true) with check (true);
create policy "anon read review_cards"   on public.review_lane_cards for select using (true);
create policy "anon write review_cards"  on public.review_lane_cards for all    using (true) with check (true);
create policy "anon read tasks"          on public.tasks             for select using (true);
create policy "anon write tasks"         on public.tasks             for all    using (true) with check (true);
