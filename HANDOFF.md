# Handoff — last updated 2026-06-24 (session j)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session (j) — playback freeze FIXED + Replicate/Pexels wired + fork committed
- **Fixed the session-i open blocker: playback freeze.** Root cause was NOT a decode/HEVC/AI hang — it was a **speed-0 bug** in the fork's `PlaybackManager`: normal `play()` ran the playhead at `speed = shuttleSpeed = 0` (only the shuttle controls ever set `shuttleSpeed`). Fix: play at 1× when `shuttleDirection === null`.
- **Diagnosed empirically with Playwright** via the real embedded path (`:8000 → iframe :3000`): a canvas-pixel-hash sampler + `playback-update`/`playback-seek` event counters proved the timer fired every frame while `currentTime` stayed pinned. Reusable harness committed at `scripts/oc-embed-diag.mjs`.
- **Verified live on localhost:** after rebuild+restart, `lastTime` advances 4.9→10.5 at 1× and the canvas animates ("NO FREEZE REPRODUCED").
- **Wired the owner's Replicate token** (`NEXT_PUBLIC_REPLICATE_API_TOKEN` in fork `.env.local`) — confirmed baked into the client bundle. **Pexels image search went live** (the prod-server restart loaded the saved key; `/api/images/search` returns photos). Freesound still works (no regression).
- **Committed + pushed the FORK** (`69842d6` → `origin/opencut-ai-fb main`) — playback fix + all session-i Phase-2 runtime fixes + collab dirs. FootageBrain build is **green**.

## Where we left off
**Playback works end-to-end on localhost.** Two background servers run: **FB dev `:8000`** (`npm run dev`) and the **fork PRODUCTION build `:3000`** (rebuilt this session: `bun run build:web` → `next start`). Open `localhost:8000` (logged in) → Editor tab → ← Projects → open a project → embedded OpenCut editor → play advances and the preview animates. Migrations 0095+0096 are applied to the shared Supabase. The **fork is committed + pushed**; the **FootageBrain repo is committed in this wrap-up's doc batch** (Phase-2 embed + 0096 + diagnostic + docs). **Nothing deployed to prod.**

## Open blockers
- None. (Playback freeze — the prior blocker — is fixed and verified.)

## Pending (written but not yet live)
- **Prod editor cutover is NOT done and is the real remaining lift.** The playback fix lives in the FORK, which is not on prod; prod's `EDITOR_EMBED_ENABLED` is OFF and points at `editor.footagebrain.com` (not stood up). Making the editor live in prod = the documented human-gated Hetzner sequence in `docs/opencut-phase1-deploy.md` (DNS → stand up the fork on Hetzner w/ Docker + throwaway PG + Caddy frame-ancestors + env incl. the Supabase SSO vars + Freesound/Pexels/Replicate keys → flip `EDITOR_EMBED_ENABLED=true` → `vercel --prod`). `vercel --prod` alone does NOT surface the fix.
- **Two-browser collab smoke** (presence + Take/Release across two sessions) still not run.
- Carried: re-commit/merge `feat`→`main`; Epidemic + 0092/0093; IG cookies; optional local AI backend (Docker) for captions.

## Next session — start here
1. **Continue the professional-features plan** (the owner's stated next focus — the plan was already generated). Bring more pro OpenCut features online on localhost.
2. **Two-browser collab smoke** (presence + Take/Release control).
3. When the owner is ready for prod: execute the human-gated **editor Hetzner stand-up** (`docs/opencut-phase1-deploy.md`) as a deliberate step.

## Verification commands (to confirm current state on resume)
```bash
# Both servers (restart if down — see below):
curl -s -o /dev/null -w "FB :8000 = %{http_code}\n" http://localhost:8000
curl -s -o /dev/null -w "fork :3000 = %{http_code}\n" http://localhost:3000
# Pexels + Freesound live server-side:
curl -s "http://localhost:3000/api/images/search?q=ocean&page=1" | head -c 80
curl -s "http://localhost:3000/api/sounds/search?q=drum&type=effects&page=1" | head -c 80

# Re-run the playback diagnostic (expects "NO FREEZE REPRODUCED"):
cd "/c/Users/Mi/Downloads/ziflow project-final" && node scripts/oc-embed-diag.mjs ./oc-shots play

# Restart the servers if down:
#   FB:   cd "/c/Users/Mi/Downloads/ziflow project-final" && npm run dev          # :8000
#   FORK (prod): cd /c/Users/Mi/Downloads/opencut-ai/apps/web && bun run start     # :3000 (after bun run build:web)
#   (free port 3000 first: Get-NetTCPConnection -LocalPort 3000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force })

# Fork commit is pushed:
cd /c/Users/Mi/Downloads/opencut-ai && git log --oneline -1   # 69842d6 fix(playback)…
```
