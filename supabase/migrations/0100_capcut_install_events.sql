-- CapCut tracker: per-install heartbeat id + a download/run audit log.
--
-- (1) Make each heartbeat uniquely traceable to a specific INSTALL (not just a
--     worker): the agent stamps a stable INSTALL_ID (a UUID baked into its
--     capcut_config.json at download time) on every heartbeat. Old agents that
--     predate this just leave it NULL.
--
-- (2) capcut_install_events — the lifecycle audit the owner can see on the
--     Monitor hub ("CapCut Tracker Installs" card):
--       'download'    — logged client-side (browser, authenticated user) when
--                       the tracker zip is built / download is attempted
--       'selftest'    — logged by the agent (anon key) during install.bat's
--                       --once self-test, with ok = pass/fail
--       'agent_start' — logged by the agent (anon key) when the background loop
--                       actually starts (proves the install took and is running)

alter table capcut_activity add column if not exists install_id text;

create table if not exists capcut_install_events (
  id         uuid        primary key default gen_random_uuid(),
  ts         timestamptz not null default now(),
  worker     text        not null,
  install_id text,
  event      text        not null,   -- download | selftest | agent_start
  ok         boolean,                -- selftest pass/fail (NULL for other events)
  detail     text,
  machine    text,                   -- agent-side hostname
  os         text,                   -- agent-side OS string
  client     text                    -- browser user-agent (download event)
);

create index if not exists capcut_install_events_worker_ts
  on capcut_install_events (worker, ts desc);

-- RLS — mirrors capcut_activity: the agent writes with the public anon key, the
-- browser writes the 'download' event with the user's authenticated session, and
-- only authenticated dashboard users can read.
alter table capcut_install_events enable row level security;

create policy "capcut_evt_anon_insert" on capcut_install_events
  for insert to anon with check (true);

create policy "capcut_evt_auth_insert" on capcut_install_events
  for insert to authenticated with check (true);

create policy "capcut_evt_auth_select" on capcut_install_events
  for select to authenticated using (true);
