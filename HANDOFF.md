# Handoff — last updated 2026-06-18

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **YT-sync cron SSH-verified**: `*/15` yt-sync line confirmed present in Hetzner crontab AND actively executing via `journalctl -u cron` (fires :00/:15/:30/:45). Polling is hands-off. Key gotcha: `/var/log/syslog` was frozen/stale (rsyslog lag) — always use `journalctl -u cron` for cron health on this box.
- **Fresh capture proven**: playlist grew 2 → 15 videos; live poll `{items_seen:15, inserted:7}`, re-poll `{inserted:0}` — dedup correct.
- **Thumbnails shortcut pill added to the Reel DNA filter bar**: a second "Thumbnails" entry point now sits in the gap between the source and view pill groups — more visible than the header tab-strip.
- **Deployed to prod**: `vercel --prod` → `dpl_D1QJk7EPHeQLPNDKP8zfDzcihR73`, live at www.footagebrain.com. Build green (811 modules).

## Where we left off
Everything is **LIVE on footagebrain.com**. The Thumbnails filter-bar shortcut deployed. The yt-sync poller runs every 15 min hands-off. The large tree of prior LIVE-but-uncommitted work (Assets system, comprehensive views, display toggle, RSS diagnostics, IG-DM ingest, etc.) is still **uncommitted on `bugfix-daily-use-batch`** — it deploys fine from the working tree but the git history doesn't match prod.

## Open blockers
- None.

## Pending (written but not yet live)
- **Nothing new this session** — all changes are deployed.
- **Ongoing carry-over (non-blocking):**
  - **Commit the working tree** on `bugfix-daily-use-batch` (lots of LIVE-but-uncommitted work spanning multiple sessions) and **merge → `main`** so the default branch matches prod.
  - **Visual verification of Assets feature** (shipped last session without a runtime walkthrough): attach one Footage + Location + Thumbnail + News to a card → confirm badges + expand + "Assets →" full-screen page + "Pull from pipeline reel" seed + spreadsheet count-cell + non-owner can see News.
  - **World Monitor** — activate fires + conflicts: set `FIRMS_MAP_KEY`, `ACLED_KEY`, `ACLED_EMAIL` (Vercel + `.env.local`) + Hetzner cron for `world-ingest`.
  - **Rotate IG secrets** pasted in chat: `IG_APP_SECRET` + 2 Instagram access tokens — regenerate in Meta dashboard, update Hetzner `deploy/hetzner/.env`, restart backend.
  - Optional retro `/code-review` on the Assets diff (deployed without review).

## Next session — start here
1. **Commit the working tree** on `bugfix-daily-use-batch` (all the LIVE-but-uncommitted files from the last ~4 sessions) and **merge → `main`**.
2. **Visually verify the Assets feature** on prod (the checklist above — it shipped without a runtime walkthrough).
3. Optional: activate World Monitor feeds (env keys + Hetzner cron); retro `/code-review` on Assets diff; tighten the empty-Assets-column 240px spacing.

## Verification commands (to confirm current state on resume)
```bash
# YT-sync cron health (SSH — use journalctl, NOT syslog):
ssh root@178.105.14.144 'journalctl -u cron --no-pager -n 5'

# Live poller (node — curl SSL-fails in this shell):
node --env-file=.env.local --input-type=module -e "fetch('https://footagebrain.com/api/ai/suggest?action=yt-sync&secret='+encodeURIComponent(process.env.SUGGEST_CRON_SECRET)).then(r=>r.text()).then(console.log)"

# reel_dna_assets table live (0068 applied)
node --env-file=.env.local -e 'import("@supabase/supabase-js").then(async({createClient})=>{const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);const a=await s.from("reel_dna_assets").select("id",{count:"exact",head:true});console.log(a.error?a.error.message:"reel_dna_assets OK rows="+(a.count??0));})'

# Build still green
npm run build
```
