# Handoff — last updated 2026-06-23

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.
> This session was 100% the **Epidemic Sound Music Library** feature. Owner is pausing and will resume this topic later.

## TL;DR of this session
- Built the **Epidemic Sound Music Library** end-to-end: a swap-ready server proxy (`api/ai/_epidemic.js` + 3 `?action=epidemic-*` branches in `suggest.js`), a **Music Library** tab (search/preview/licensed-download), and a per-reel **Attach Music** card (music reuses `reel_dna_assets` as `asset_type='music'`). Built via the generated workflow `.claude/workflows/epidemic-sound-music-library.js` (~36 min).
- Ran `/code-review high` → found + **fixed 3 feature-breaking bugs**: the `reel_dna_assets` CHECK constraint blocked `'music'` (fixed in `0092`), the shared `useReelDnaAssets` hook didn't pass `musicTracks`, and `upsertMusicTrack` had no optimistic update. Plus a `MusicPickerModal` audio-preview cleanup.
- **Expanded the Library tab** to 4 views: **Search · Browse (genre/mood) · Favorites · Playlists** (new migration `0093_music_library.sql` + store actions + UI rewrite).
- Wired `EPIDEMIC_TOKEN` into `.env.local` AND Vercel env (dev+prod), and stood up local dev (`vercel dev` :3001 + `npm run dev` :8000).
- **🔴 Discovered THE blocker:** the workflow guessed Epidemic's private host `api.epidemicsound.com` — it **does not resolve**. Search/Browse/Download are inert until the owner provides the real endpoint from a logged-in DevTools capture.
- Everything is `npm run build` green. **Nothing committed, nothing deployed.**

## Where we left off
All Music Library code is written and builds clean, but the feature **cannot pull music yet** — it's blocked on two gates (below). The local dev servers have since stopped (the `npm run dev` background task exited code 4); restart them to resume testing. The owner is pausing this topic and will come back to it.

## Open blockers
- **🔴 Epidemic endpoint calibration (needs owner DevTools) — THE blocker.** The guessed private host `api.epidemicsound.com` does NOT resolve (`curl https://api.epidemicsound.com/` → `http=000`; `www.`/`partner-content-api.`/`login.` all resolve fine). To unblock: owner logs into epidemicsound.com → DevTools → Network → Fetch/XHR → run a search → copy the **request URL that returns tracks**; click **Download** on a track → copy that URL. Then patch the 3 `// CALIBRATION-REQUIRED` constants (`BASE_URL`, `EP_SEARCH_PATH`, `EP_DOWNLOAD_PATH`) + `mapTrack` field names in `api/ai/_epidemic.js`. The Partner-API siblings (`partner-content-api.epidemicsound.com/v0/tracks/...`, which DOES resolve) are the documented identical-shaped fallback if the private path can't be captured.
- **Migrations `0092` + `0093` not applied** — needed for Attach Music + Favorites/Playlists persistence (apply is human-gated; see Pending).

## Pending (written but not yet live)
- **Migration `0092_music_tracks.sql`** — music metadata cache table + EXTENDS `reel_dna_assets` CHECK to allow `'music'`. NOT applied.
- **Migration `0093_music_library.sql`** — `music_favorites` + `music_playlists` + `music_playlist_tracks` (per-user RLS). NOT applied.
  - Apply via the **Supabase SQL editor** for JUST these two (do NOT `npm run migrate:apply` — it would also sweep in other parked threads' pending migrations e.g. 0089/Planable). Or ask for the exact single-file SQL.
- **All Music Library code** — uncommitted, undeployed. After calibration + a clean-tree check, deploy is `vercel --prod` (human-gated; remember it ships the WHOLE dirty tree).
- `EPIDEMIC_TOKEN` is in `.env.local` + Vercel dev/prod env. **Expires ~2026-07-20** (30-day Keycloak user JWT, no refresh) — re-grab from DevTools and re-`vercel env add` when the "reconnect — see Paul" banner appears.

## Next session — start here
1. **Get the Epidemic calibration capture** from the owner's DevTools (search URL + download URL) and patch `api/ai/_epidemic.js`. This unblocks Search/Browse/Preview/Download instantly (no rebuild — `vercel dev` hot-reloads functions).
2. **Apply migrations `0092` + `0093`** via the Supabase SQL editor (human-gated) so Attach Music + Favorites + Playlists persist.
3. Restart local dev and smoke-test the full flow: `vercel dev --listen 3001` + `npm run dev` (:8000), hard-refresh, then Search → preview → download → favorite → add to playlist → attach to a reel.
4. After it works: commit the Music Library files, clean-tree check, `vercel --prod`.
5. (Optional) If the private API proves too brittle, apply for an official Epidemic Partner key → set `EPIDEMIC_AUTH_MODE=partner` + the `epidemic_live_` key (zero frontend change).

## Verification commands (to confirm current state on resume)
```bash
# 1. Local servers are DOWN after this session — restart both:
#    Terminal A:  vercel dev --listen 3001
#    Terminal B:  npm run dev          # SPA on :8000, proxies /api -> :3001

# 2. Confirm the Epidemic host still doesn't resolve (the blocker):
curl -s -o /dev/null -w "%{http_code}\n" https://api.epidemicsound.com/        # expect 000
curl -s -o /dev/null -w "%{http_code}\n" https://partner-content-api.epidemicsound.com/  # 302 (fallback host)

# 3. Confirm the function is wired (once vercel dev :3001 is up) — 401 = good (auth gate), not 404/500:
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3001/api/ai/suggest?action=epidemic-search" -H "Content-Type: application/json" -d '{"term":"lofi"}'

# 4. Direct Epidemic calibration test (bypasses HTTP/auth — hits the real API with the token):
node --env-file=.env.local -e "import('./api/ai/_epidemic.js').then(m=>m.searchTracks({term:'lofi',limit:3})).then(r=>console.log(JSON.stringify(r)))"
#    Currently returns {ok:false, error:'fetch failed'} because the host is wrong — should return tracks after calibration.

# 5. Build gate:
npm run build      # green; emits a music-library chunk

# 6. Migrations present (NOT applied):
ls supabase/migrations/0092_music_tracks.sql supabase/migrations/0093_music_library.sql
```
