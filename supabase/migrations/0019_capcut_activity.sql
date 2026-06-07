-- CapCut activity table — written by the desktop agent on each editor's PC.
-- The agent uses the anon key (no auth), so the insert policy must allow anon.
-- Only authenticated dashboard users can read.

create table if not exists capcut_activity (
  id            uuid        primary key default gen_random_uuid(),
  worker        text        not null,
  ts            timestamptz not null default now(),
  running       boolean     not null default false,
  focused       boolean     not null default false,
  project_title text,
  machine       text
);

create index if not exists capcut_activity_worker_ts
  on capcut_activity (worker, ts desc);

-- RLS
alter table capcut_activity enable row level security;

-- Agent inserts with anon key — allow all inserts from anon role
create policy "capcut_anon_insert" on capcut_activity
  for insert to anon
  with check (true);

-- Dashboard reads (owner on localhost) require auth
create policy "capcut_auth_select" on capcut_activity
  for select to authenticated
  using (true);
