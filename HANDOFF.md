# Handoff — last updated 2026-06-18

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Made **"DM a reel to @paulvictortravels (with a tag note) → it auto-logs to the Reel DNA spreadsheet"** fully **LIVE and automatic**.
- The **webhook approach dead-ended**: Instagram only delivers real-DM webhooks once the app is **published + App-Review'd**; Development mode emits only the dashboard's synthetic "Test" event. (We proved this end-to-end: handler, signature, parser all work — Meta just never POSTs real DMs.)
- **Pivoted to polling** the Business-Suite Instagram inbox: new `GET/POST /api/ig/sync` reads the Page's IG conversations, takes each shared reel's permalink from `shares.data[].link`, pairs it with the adjacent tag-note text, and inserts a `reel_dna` row (deduped on the share-message id). `parseTagNote` splits the note into Location/Music/Font columns.
- Deployed the poller to **Hetzner**, added a **15-min cron**, dedup pre-check keeps Supabase writes ~0, async run dodges nginx's 60s timeout. **33 reels captured live.**
- Committed `01046fd`; ran `vercel --prod` (frontend unchanged — feature is 100% backend, so the deploy was effectively a no-op).
- Big lesson: the **Instagram-Login API uses a separate Instagram App Secret** (`IG_APP_SECRET`), and its webhook payload is `entry[].changes[].value`, not `messaging[]`.

## Where we left off
Inspiration capture is **working in production**: DM a reel to paulvictortravels and within ~15 min it appears in **Reel DNA → Spreadsheet** with the reel link + parsed tags. The poller (`/api/ig/sync`) is live on Hetzner with a 15-min crontab line; the webhook handler (`/api/ig/webhook`) stays deployed but dormant (only fires if the app is ever published). Branch `bugfix-daily-use-batch` holds this session's commit `01046fd` plus the prior Pulse commit `4455424` — **neither pushed to GitHub/main**.

## Open blockers
- **None functionally.** The feature works via polling.
- Webhooks (instant push) remain unavailable until the Meta app is **published + App-Review'd** for `instagram_business_manage_messages` — deferred; the poll covers the need.

## Pending (written but not yet live / follow-ups)
- **Rotate secrets pasted in chat:** the `IG_APP_SECRET` (`9d5a…`) and the two Instagram access tokens were pasted into the session — regenerate them in the Meta dashboard (Instagram app secret has a Reset; resetting won't break FB login). Update `IG_APP_SECRET` in `deploy/hetzner/.env` after.
- **One leftover `(debug — no reel url)` row** from the Test event — delete it from the Reel DNA spreadsheet.
- **Push `bugfix-daily-use-batch` → GitHub / merge → main** (commits `01046fd` + `4455424` are local only).

## Next session — start here
1. **Rotate the IG app secret + access tokens** (pasted in chat), update Hetzner `.env`, restart backend.
2. **Push the branch to GitHub / merge → main** so the repo matches prod.
3. Optionally: delete the leftover debug row; tune the cron interval if 15 min feels slow.

## Verification commands (to confirm current state on resume)
```bash
# Poller healthy + flags
curl -s https://api.footagebrain.com/api/ig/status
#  -> {"ok":true,"ingest_enabled":true,"app_secret_set":true,"supabase_configured":true,...}

# Manual sync (synchronous, shows counts; dedup means inserted:0 on a repeat)
curl -s "https://api.footagebrain.com/api/ig/sync?secret=fb_ig_sync_9f3a2026&wait=1"
#  -> {"ok":true,"conversations":N,"reels_seen":M,"inserted":0}

# Cron present (3 lines: insights, news-ingest, ig/sync every 15m)
ssh root@178.105.14.144 "crontab -l"

# Captured reels count (service role; reads .env.local)
#  Supabase REST: GET /rest/v1/reel_dna?source=eq.ig_dm&select=count  (Prefer: count=exact)
```
