# Handoff — last updated 2026-06-18

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Built the **automated news/RSS ingestion** for the owner-only **Pulse** tab: owner curates feeds in a Sources manager → a Hetzner cron (every 30 min) + a "Refresh now" button fetch each feed, classify items (free OpenRouter, source-default fallback), dedup, and write them into the Pulse feed as `poller` rows.
- Folded the ingester into `api/ai/suggest.js` as `?action=news-ingest` (**no new Vercel function** — at the 12-cap). New zero-dep RSS/Atom parser in `api/ai/_rss.js`.
- Fixed the bug that blocked all ingestion: the `monitor_events` dedup index was **partial**, which Postgres won't use for `ON CONFLICT` → migration **0061** swaps it for a full unique index. After the fix, 30 articles ingested, dedup verified.
- Added a **News Monitor health card** (Monitor page) + a **60-day retention prune** (poller rows, keeps starred).
- Committed (`4455424`), **deployed to prod**, and fixed both Hetzner crontab lines to use `www` (the apex 308-redirects API routes — the old insights cron had been silently hitting the redirect).
- Also generated `.claude/workflows/pulse-monitor.js` (a multi-agent build workflow file; gitignored).

## Where we left off
Pulse news ingestion is **fully live** on footagebrain.com. Migrations 0059/0060/0061 applied to Supabase. Owner adds RSS feeds via **Pulse → Sources**, hits **Refresh now** (or waits for the 30-min cron). 2 sources configured, 30 articles ingested. The feature commit is on branch `bugfix-daily-use-batch` (not pushed).

## Open blockers
- **None.** Ingestion, dedup, prune, cron, and the Monitor card are all verified live.

## Pending (written but not yet live)
- **None for Pulse.**
- Pre-existing (separate workstream, untouched this session): `CHANGELOG.md` / `HANDOFF.md` / `backend-handoff/ig_webhook.py` carry uncommitted **IG-DM** edits from a prior session; the IG-DM backend is deployed, only Meta-console config remains (see the IG-DM CHANGELOG entry).

## Next session — start here
1. **Push `bugfix-daily-use-batch` and/or merge → main** so the default branch matches prod (the Pulse commit `4455424` is local only).
2. **Seed a few more Pulse sources** if desired (platform newsrooms for `algo`, world feeds for `news`) — see `backend-handoff/NEWS-MONITOR.md` for a starter list.
3. Finish the **Instagram-DM-to-self ingest** (Meta console only — backend already live): add `instagram_manage_messages` + Webhooks subscription, then a calibration share.

## Verification commands (to confirm current state on resume)
```bash
# Pulse ingest health (run from a non-Avast box; expect {"ok":true,...,"pruned":N})
curl -s "https://www.footagebrain.com/api/ai/suggest?action=news-ingest&secret=fbai_cron_2026"

# Stored article count (service role; reads .env.local)
#   -> Supabase REST: GET /rest/v1/monitor_events?source_type=eq.poller&select=id  (Prefer: count=exact)

# Migrations applied?
npm run migrate            # expect 0059/0060/0061 [ applied ], 0 pending

# Hetzner crontab (both lines should be www.footagebrain.com)
ssh root@178.105.14.144 "crontab -l"
```
