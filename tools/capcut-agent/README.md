# CapCut activity agent

A tiny background agent that records **one editor's CapCut usage** so the owner can see it
in the private (localhost-only) **Activity** tab of the dashboard.

It is **transparent and CapCut-only**: every ~15s (while CapCut is open) it records whether
`CapCut.exe` is running, whether CapCut is the focused window (active vs idle), and the open
CapCut project name (read from disk). It does **not** read other apps, keystrokes, or screen
content. Tell the editor it's running.

> **The agent is now a PowerShell script (`capcut_agent.ps1`), not a `.exe`.** PowerShell ships
> with Windows and is Microsoft-signed, so there is no unsigned PyInstaller binary for antivirus /
> Windows Defender to quarantine — that quarantine was the cause of the old
> `capcut_agent.exe not found in this folder` failures. The agent is launched hidden via a tiny
> `run-hidden.vbs` shim. The old Python files (`capcut_agent.py`, `build.bat`, `capcut_agent.spec`)
> are kept for reference only and are no longer shipped.

## How editors get it (no manual file copying)

Editors download a self-contained zip from the dashboard — the **"↓ CapCut tracker setup"** pill
on the **My Work** page, or the download button on the **Activity** page. Both buttons call the
same `downloadCapcutTracker()` helper (`src/lib/capcut-agent-download.js`), so they always ship the
identical, hardened installer. The zip contains:

| File | Purpose |
|---|---|
| `capcut_config.json` | per-user — bakes in the editor's `WORKER` id |
| `install.bat` | self-diagnosing 4-step installer (files present → unblock → connectivity self-test → register task), prints a PASS/FAIL summary |
| `capcut_agent.ps1` | the agent (served from `/capcut-agent/`) |
| `run-hidden.vbs` | hidden launcher (served from `/capcut-agent/`) |

The editor unzips (**Extract All** — don't run from inside the zip preview) and double-clicks
`install.bat`. It registers a **Scheduled Task** (`CapCutActivityAgent`, runs hidden at logon),
runs a one-shot self-test that proves a row reached Supabase, and prints a summary to screenshot.

Self-test / manual run:
```
powershell -NoProfile -ExecutionPolicy Bypass -File capcut_agent.ps1 --once
```

`capcut_config.json` sets which editor the machine belongs to:
```json
{ "WORKER": "sam", "POLL_SECONDS": 15 }
```
(`sam` = Jay in the dashboard roster.) A `CAPCUT_WORKER` env var overrides it without editing the file.

## One-time setup (owner)

The Supabase table already exists (migration `0019_capcut_activity.sql`). For reference:
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

## View

The owner runs the dashboard locally (`npm run dev`, http://localhost:8000) and opens the
**Activity** tab. That tab only appears on localhost — never on the public site.

## Notes
- Uses the dashboard's public Supabase anon key (already shipped in the web bundle) — no extra
  secrets. The agent only writes `capcut_activity` rows.
- A local `capcut_agent.log` next to the script captures any errors.
- PowerShell uses the Windows trust store (SChannel) natively, so it works behind corporate /
  antivirus HTTPS interception with no extra dependencies (the reason the old Python agent needed
  `truststore`).
- Heartbeats accrue ~1,440 rows/day per editor while CapCut is open. To prune later:
  `delete from capcut_activity where ts < now() - interval '90 days';`
