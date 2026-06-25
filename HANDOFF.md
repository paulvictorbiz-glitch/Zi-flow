# Handoff — last updated 2026-06-25 (session u)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Reel DNA "IG spreadsheet not updating" = NOT a bug.** Live read-only diagnosis proved the poller/token/pipeline are healthy; Instagram simply had no new API-visible DMs between 06-23 and the owner's mid-session test send (which captured in ~5 min, `DZ-EVNyMYMB`).
- **Shipped IG poller hardening (Hetzner, LIVE):** newest-~60-message hydration per conversation via tiny per-message Graph fetches (immune to the heavy-thread 500) + #230 token-permission errors surfaced on the run `note`. Tunable `IG_NEWEST_HYDRATE`.
- **Fixed thumbnail re-capture 409 (LIVE):** manual re-add of a previously-deleted thumbnail now revives the tombstoned row instead of 409-ing on the `video_id` unique index.
- **Shipped YouTube Data API thumbnail ingest (LIVE):** `yt-sync` now reads the FULL playlist via Data API v3 (paginated) instead of the ~15-cap Atom feed; RSS fallback retained. Owner's "Korea" playlist had 32 videos (feed showed 15) → 9 hidden videos pulled in. New `YT_API_KEY` set in Vercel + `.env.local`.
- Committed `ef91b06` + pushed `feat/capcut-replica-v2`; frontend live via `vercel --prod`; backend live on Hetzner.

## Where we left off
All three changes are live and verified. Tree committed + pushed (`ef91b06`). Production (`www.footagebrain.com`) reflects the committed code; Hetzner `fb-backend` runs the hardened poller. Thumbnails sheet now at 29 non-deleted rows.

## Open blockers
- None.

## Pending (written but not yet live)
- **Migration `0100_capcut_install_events.sql`** committed but NOT applied (human-gated, from session t) — needed if the Monitor CapCut install-events card writes to it.
- Carried owner-gated follow-ups (from session r/s/t): **OD-2** Reviewer role re-save (Leroy lost Monitor, hasn't gained Analytics/Inbox); Batch 3 RLS delete-hardening → write as **`0099_…`** (0098/0100 used → next free is **0101**); Scout backend redeploy; OpenCut SSO smoke + caddy-bridge persist; Epidemic calibration; MapForge scaffold awaiting go-ahead.
- A recording attached BEFORE the session-t transcode fix stays HEVC/silent → re-attach to fix.

## Next session — start here
1. Optional follow-up: the IG messaging edge is flaky — consider a proactive token/sync health alert (no-sync-in-N-hours / `reconciled=false` ping). The hardening is in; this is monitoring only.
2. Phase 2 of chat-recording (session t): Rocket.Chat-native "📎 Set as reel state" message action / `/reel-state` slash command.
3. Clear the carried owner-gated follow-ups above (OD-2 re-save, 0099 RLS, Scout/OpenCut/Epidemic).

## Verification commands (to confirm current state on resume)
```bash
# IG poller hardening is baked into the live container (read-only)
ssh root@178.105.14.144 "docker exec fb-backend grep -c '_fetch_newest_message_ids' /app/app/api/ig_webhook.py"   # → 1+ 
# YouTube Data API ingest live (cron secret from .env.local)
curl -s -X POST "https://www.footagebrain.com/api/ai/suggest?action=yt-sync&secret=$SUGGEST_CRON_SECRET"           # → {"via":"data_api","items_seen":32,...}
# git state
git -C "c:/Users/Mi/Downloads/ziflow project-final" log --oneline -1   # → ef91b06
```
