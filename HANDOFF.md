# Handoff — last updated 2026-06-20

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Executed the Reel DNA Phase 1 activation runbook STEP 0→9** (`.claude/plans/reel-dna-phase1-activation-pyscene.md`) — short-reel deconstruction (PySceneDetect cut-detection + downloadable asset layers + cut-pacing) is now **LIVE and proven end-to-end**, alongside the already-live Wave 1 longform Story.
- **Backend merged + rebuilt on Hetzner**: merged worker (cv2 4.13 + scenedetect 0.7, longform path intact, claim now format-agnostic), `serve_router` registered, Caddy `/reels/*` → `backend:8000`, `REELS_DIR=/app/data/reels` on a persisted volume (B1 closed), `FB_DOWNLOAD_SIGNING_SECRET` set (byte-parity 3 ways).
- **DB**: 0081 columns confirmed present (B2 was a stale PostgREST cache, not a ledger lie — refreshed via `NOTIFY pgrst`).
- **Vercel**: owner ran `vercel --prod` (reachability fix live — short Analyze button reachable; minter secret wired). **HMAC parity** Python==JS==`34010c33…`.
- **Calibrated all 4 reel types**, capped by the decisive proof: a signed download **streamed HTTP 200** through the live Caddy→uvicorn chain.
- **Discussed commit/merge safety** — confirmed `feat/reel-dna-phase1 → main` is a clean fast-forward; git ops don't deploy; nothing breaks. Wrap-up + grouped commit + ff-merge planned.

## Where we left off
Phase 1 is fully LIVE. Queue clean (0 pending_analyze, 0 analyzing), `*/2` drain cron re-enabled, `/api/reel/status` all green (`download_signing_set:true`, `reels_dir:/app/data/reels`). Branch `feat/reel-dna-phase1` is build-green + proven but **not yet committed/pushed/merged** (owner-gated). Host backups tagged `phase1-20260620_003139`.

## Open blockers
- None.

## Pending (written/done but not yet committed-to-git)
- `feat/reel-dna-phase1` not committed/pushed. The reachability fix (`unified-dna-card.jsx`) + 0081 manifest entry are the Phase-1-thread uncommitted bits (the reachability fix IS already live via the owner's `vercel --prod`).
- Grid-view trio (`pipeline.jsx`/`components.jsx`/`styles.css`) + `ig_webhook.py` + `ig-sync-diagnose.mjs` remain uncommitted (separate, already-live threads — leave to owner).
- `.env.local` now holds `FB_DOWNLOAD_SIGNING_SECRET` (gitignored — never committed).

## Next session — start here
1. **Commit + merge (owner-gated):** tidy grouped commit of the Phase-1 thread → fast-forward merge `feat/reel-dna-phase1` → `main`. Stop before `push` (owner's call). Clean ff, no conflicts.
2. **Optional Phase-1 hardening:** add a single-flight guard to the worker (no concurrency guard → parallel analyzes could OOM the 5.2GB box); add yt-dlp cookies (`IG_COOKIES_FILE`/`YTDLP_COOKIES`) if auto-acquire is wanted (manual upload is the current backbone).
3. **Optional Phase 5:** swap PySceneDetect → TransNetV2 behind the intact `_detect_scenes(video,work):764` seam (torch-CPU, TransNetV2-primary + PySceneDetect-fallback) — touches only the detector + deps.

## Verification commands (to confirm current state on resume)
```bash
git rev-parse --abbrev-ref HEAD                                  # feat/reel-dna-phase1
git log --oneline main..feat/reel-dna-phase1 | wc -l            # 4 (clean ff to main)
curl -s https://api.footagebrain.com/api/reel/status            # ok:true, download_signing_set:true, reels_dir:/app/data/reels
# read-only signed-download proof: mint reels/<id>/<file>:<exp> HMAC with FB_DOWNLOAD_SIGNING_SECRET, curl https://api.footagebrain.com/reels/... → 200
ssh root@178.105.14.144 'crontab -l | grep reel/deconstruct'    # */2 active (un-paused)
```
