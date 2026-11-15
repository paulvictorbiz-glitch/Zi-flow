# Handoff — last updated 2026-07-06

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Planned + built OpenCut 3-editors durability Phase 1** — the fix for the one thing standing between "the embedded editor works" and "3 editors can rely on it": media bytes lived only in the importing browser (OPFS), so a project opened on another machine/person showed silent black frames. Now media is content-addressed (SHA-256, deduped) and shared via a new Supabase Storage bucket, with upload-on-import + resolve-on-load and an explicit "Unavailable" tile instead of silence.
- **Autosave is now version-checked (CAS)** instead of last-writer-wins — a stale write can no longer silently clobber a newer save. The save-state pill is now truthful (Saved / Saving / Unsaved / Save failed+Retry / Offline / "updated elsewhere"+Reload) — the old indicator lied and showed "Saved" even on failed writes.
- **Fixed a live bug along the way:** a solo editor's OWN autosave could trigger a realtime echo that reloaded them mid-edit and left autosave paused forever. Also downscaled project thumbnails (full-res PNG → ≤360px JPEG) since they were bloating every doc and blowing past Realtime's ~1MB payload cap.
- Planned via 3 domain agents + a genuinely adversarial QA agent (ran 2 rounds — verified every claim against real source in BOTH repos, not just plan text) before writing one line of code. Found 6 blocking issues in round 1 (a key-format mismatch that would have 100%-failed every upload; a file-ownership collision; a rename that would silently break media on other machines; a two-tab infinite reload/save loop; a missing save UI in the default CapCut skin; an unconfirmed Supabase upload cap).
- Built by hand across two repos under locked file ownership; **both build gates are green** (`bun run build:web` in the fork, `npm run build` in FootageBrain, sequential).
- **Nothing is deployed.** Migration not applied, fork image not rebuilt, editors' tabs not enabled. Deploy runbook written: `docs/opencut-durability-deploy.md`.

## Where we left off
Code complete, both builds green, zero deploy actions taken. This is a **two-repo change**:
- FB (`ziflow project-final`, this repo): ONE new file, `supabase/migrations/0112_oc_media.sql` (not applied). No other FB app-code touched by this work.
- Fork (`C:\Users\Mi\Downloads\opencut-ai`, branch `feat/capcut-replica-v2`... check current branch): all the editor-side changes (media sync, CAS autosave, collab hardening, UI). New dependency `hash-wasm` added to `apps/web/package.json`. Not pushed/committed by this session — verify branch/commit state before deploying.

**Note:** the FB repo tree has other UNRELATED uncommitted changes sitting alongside this work (e.g. `src/app.jsx`, `src/pages/landing.jsx`, `src/pages/hud/`, migration `0111_content_opps_entities_mentioned.sql`) — those are from other sessions/work, not touched or reviewed here. Per standing policy, don't flag/reconcile the dirty tree; the owner manages it.

## Open blockers
- **Entry-gate question unanswered:** what Supabase plan is `kjruhbaahqkuajseoojn` on? Determines the real per-file upload cap (Free=50MB, Pro=500MB+ raisable) — the whole media story is designed to trial fine on either, but full-size footage needs Pro.

## Pending (written but not yet live)
- Apply migration `0112_oc_media.sql` (scoped one-off — NOT bulk `migrate:apply`; other pending migrations are intentionally held back).
- Rebuild the fork's Hetzner Docker image (`git archive apps/web/src apps/web/package.json bun.lock | ssh root@178.105.14.144 tar xf - -C /srv/opencut-ai` → `docker compose build web && up -d web`). Baked env — `vercel --prod` does NOT touch the editor.
- Enable the Editor/Projects tabs for Judy/Jay/Leroy (currently `LEAN_HIDDEN` for their roles).
- Owner trial (clips ≤50MB) → **verdict gate**: GO → upgrade Supabase Pro + raise the Dashboard upload cap (zero code change needed). NO-GO → pivot the media backend to Hetzner (contingency documented in the runbook; the fork's `supabase-media-sync.ts` is a swappable seam for exactly this) and keep CapCut Pro as primary.
- Full validation checklist (cross-machine media resolution, rename-preserves-media, two-tab double-open, export quality vs CapCut Pro) is in `docs/opencut-durability-deploy.md` — none of it has been run against a deployed instance yet.

## Next session — start here
1. If the owner wants to proceed: answer the Supabase-plan question, then apply migration 0112 (scoped one-off) and rebuild the fork image per the runbook.
2. After deploy, run the validation checklist with Judy/Jay/Leroy before calling Phase 1 done.
3. Phase 2/3 of the original plan (`.claude/plans/opencut-3-editors-durability.md`) — gallery reading `oc_projects` as source of truth, per-role tab enablement, scale/hardening — is explicitly OUT of scope for this build and still open.

## Verification commands (to confirm current state on resume)
- `git -C "C:\Users\Mi\Downloads\ziflow project-final" status --short` → should show only `docs/opencut-durability-deploy.md` + `supabase/migrations/0112_oc_media.sql` as NEW from this session (plus unrelated pre-existing dirty files).
- `git -C "C:\Users\Mi\Downloads\opencut-ai" status --short` → confirm all the fork edits listed above are still present (uncommitted) before doing anything destructive.
- `Get-Content "c:\Users\Mi\Downloads\ziflow project-final\supabase\migrations\0112_oc_media.sql" | Select-Object -First 5` → confirm the migration file is intact.
- Read `docs/opencut-durability-deploy.md` for the full apply/deploy/verify sequence.
