# CapCut activity agent

A tiny background agent that records **one editor's CapCut usage** so the owner can see it
in the private (localhost-only) **Activity** tab of the dashboard.

It is **transparent and CapCut-only**: every ~60s it records whether `CapCut.exe` is running,
whether CapCut is the focused window (active vs idle), and CapCut's window title (project name).
It does **not** read other apps, keystrokes, or screen content. Tell the editor it's running.

## One-time setup (owner)

1. **Create the Supabase table** — run this once in the Supabase SQL editor:
   ```sql
   create table if not exists capcut_activity (
     id uuid primary key default gen_random_uuid(),
     worker text not null,
     ts timestamptz not null default now(),
     running boolean not null default false,
     focused boolean not null default false,
     project_title text,
     machine text
   );
   create index if not exists capcut_activity_worker_ts on capcut_activity (worker, ts desc);
   ```

2. **Build the exe** (on any Windows PC with Python):
   ```
   build.bat        ->  dist\capcut_agent.exe
   ```

## Install on the editor's PC

Copy `dist\capcut_agent.exe`, `capcut_config.json`, and `install.bat` into one folder, then:
```
install.bat
```
This registers a **Scheduled Task** (`CapCutActivityAgent`) that runs at logon and starts it now.
It's visible in Task Scheduler / Task Manager. Remove anytime with `uninstall.bat`.

`capcut_config.json` sets which editor the machine belongs to:
```json
{ "WORKER": "sam", "POLL_SECONDS": 60 }
```
(`sam` = Jay in the dashboard roster.)

## View

The owner runs the dashboard locally (`npm run dev`, http://localhost:8000) and opens the
**Activity** tab. That tab only appears on localhost — never on the public site.

## Notes
- Uses the dashboard's public Supabase anon key (already shipped in the web bundle) — no extra
  secrets. The agent only writes `capcut_activity` rows.
- A local `capcut_agent.log` next to the exe captures any errors.
- Heartbeats accrue ~1,440 rows/day per editor. To prune later:
  `delete from capcut_activity where ts < now() - interval '90 days';`
