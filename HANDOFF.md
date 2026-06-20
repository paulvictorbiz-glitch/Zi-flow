# Handoff — last updated 2026-06-21

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Fixed the render endpoint 404 (routes had `/api/render/...` but `main.py` adds `/api` as a prefix → double prefix). Fixed via Python script on Hetzner, rebuilt.
- Implemented `_download_drive_file()` (was a `NotImplementedError` stub) — now calls Drive API v3 via `google-api-python-client` inside `run_in_executor`.
- Added `google-api-python-client==2.137.0` + `google-auth==2.29.0` to `requirements-hosting.txt`.
- Set `GOOGLE_SERVICE_ACCOUNT_JSON` in Hetzner `.env` (service account `opencut@footage-brain-database.iam.gserviceaccount.com`, key file `footage-brain-database-fa569f3dc1df.json`).
- Render worker fully live: `/api/render/health` → `{"ok":true,"drive_configured":true}`.

## Where we left off
The **render pipeline foundation (Phase 0) is complete and live on Hetzner**. The full path is wired: frontend submits timeline JSON → `suggest.js?action=render-submit` → Hetzner `/api/render/submit` → download Drive sources → ffmpeg → Supabase status update → HMAC-signed download URL. The ffmpeg filtergraph (`_build_filtergraph`) is still the Phase 0 passthrough stub (re-encodes first source only) — usable for smoke testing but not real production renders. Phase 1 adds trim/cut + xfade transitions.

The **OpenCut fork (Phase 0 of the editor plan) has NOT been started** — it's the next major build. Until that's live at `editor.footagebrain.com`, `editor.jsx` can't be wired (the iframe currently tries to load `opencut.app` which blocks with X-Frame-Options). `editor-presence.jsx` is dead code (committed, not imported).

## Open blockers
- `_build_filtergraph()` is a Phase 0 stub — renders only passthrough the first source. Phase 1 (trim/cut + xfade) needed for real renders.
- OpenCut fork not started — `editor.jsx` iframe points nowhere useful until `editor.footagebrain.com` exists.
- `editor.jsx` is dirty (modified, not committed) — `VITE_OPENCUT_URL` + `reelDnaId` prop additions were reverted by linter; re-apply once fork is live.

## Pending (written but not yet live)
- `src/lib/editor-presence.jsx` — committed, imported nowhere. Wire in Phase 3 (collab). Sanitize `personName` before `.track()` when wiring.
- `src/pages/editor.jsx` — dirty (modified uncommitted). `VITE_OPENCUT_URL` env var + `reelDnaId` prop pending fork deploy.
- changedetection.io → Pulse bridge — APPROVED, not built. Migration 0084+ (see `project_changedetection-pulse-bridge.md`).
- `_build_filtergraph()` Phase 1 implementation — trim/cut (concat demuxer) + xfade transitions. Local in `backend-handoff/render.py`.

## Next session — start here
1. **Fork OpenCut (Phase 0 of editor plan)** — clone `opencut-app/OpenCut` (MIT), deploy to `editor.footagebrain.com` (separate Vercel project or Hetzner nginx), wire Supabase JWT bridge via `postMessage`, pass `reel_dna_id` in URL. Then update `editor.jsx` iframe src. See plan `.claude/plans/this-is-a-purely-elegant-haven.md` Phase 0.
2. **OR: changedetection.io → Pulse bridge** — simpler, no external deploy. Memory: `project_changedetection-pulse-bridge.md`. Migration 0084 + `_changedetect.js` + `suggest.js?action=changedetect-ingest`.
3. **Phase 1 render filtergraph** — implement `_build_filtergraph()` with trim/cut (concat demuxer) + xfade offset formula. Unit-test with 2/3/5-clip cases before any real render ships.

## Notes for next session build decisions
- **OpenCut fork deployment target**: main site is at the 12-function Vercel cap — OpenCut must be a SEPARATE Vercel project or an nginx container on Hetzner. Hetzner option avoids a second Vercel account/project.
- **xfade offset formula**: `offset_n = Σ(clip_durations[0..n-1]) − Σ(transition_durations[0..n-1])` — this is the #1 correctness risk in Phase 1. Write unit tests before any render ships.
- **`editor-presence.jsx` sanitization**: before calling `channel.track({ name: personName, ... })`, ensure `personName` is ASCII-safe. Supabase realtime presence broadcasts go server-side via undici; a non-ASCII name would cause the same error class as the Scout SCRAPE_SECRET bug.
- **Google Drive scope**: service account `opencut@footage-brain-database.iam.gserviceaccount.com` needs "Viewer" access shared on the Drive folders holding source videos. If downloads fail with 403, check Drive sharing permissions.

## Verification commands (to confirm current state on resume)
```bash
# Render worker health (replace <SECRET> with REEL_DECONSTRUCT_SECRET from .env.local):
curl -s "https://api.footagebrain.com/api/render/health?secret=<SECRET>"
# Expected: {"ok":true,"running":0,"max_concurrent":1,"renders_dir":"/app/data/renders","drive_configured":true}

# Confirm render router registered (no 404 on submit):
curl -s -o /dev/null -w "%{http_code}" -X POST "https://api.footagebrain.com/api/render/submit?secret=<SECRET>" \
  -H "Content-Type: application/json" -d '{"reel_dna_id":"test","project_json":{}}'
# Expected: 400 (validation error) or 422 — NOT 404

# Migrations applied:
# Check in Supabase SQL editor: SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('edit_projects','render_jobs');
# Expected: 2 rows

git status --short   # editor.jsx dirty expected; all other session files committed
git log --oneline -5
```
