# Handoff — last updated 2026-07-18

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory archive at `..\_claude-archive\memory\` (recovered from the old SSD) for deeper context.
> Repo root on this (recovered) machine: `C:\Users\Leroy\Downloads\ziflow-work\ziflow-project-final`.

## TL;DR of this session (planning + tooling — nothing shipped)
- Ran `/qa-verified-plan` on a **Content Forge** enhancement: expound-a-hook should generate a full editor **blueprint variation sheet** and Send-to-Pipeline should persist the COMPLETE editor package onto the reel card.
- 4 layer specialists + 1 adversarial QA verified the plan against the **live repo + live Supabase** (read-only). Four real gaps confirmed (script not persisted, no blueprint, no PDF, attached footage not persisted).
- Adopted two simplifications after a red-flag critique: **client-side PDF** (no storage bucket / reportlab / migration 0114) and **fold blueprint into the existing `/script` endpoint** (no new Vercel function — repo is at the hard 12/12 cap).
- Generated a ready-to-launch workflow: **`.claude/workflows/content-forge-blueprints.js`** (4 locked-ownership teams, 2 serialized waves).
- **Nothing was built, applied, or deployed this session.**

## Where we left off
The Content Forge blueprint work is fully PLANNED and a build workflow is written and syntax-validated. The owner will launch it in a fresh terminal session. No code in the app has changed yet.

## Open blockers
- None (planning session).

## Pending (written but not yet live)
- **`.claude/workflows/content-forge-blueprints.js`** — written, not launched. Launch line: **"Launch the content-forge-blueprints workflow."**
- The workflow itself only writes code; it does NOT apply migration `0113_reels_blueprint.sql`, deploy the Hetzner backend, or run `vercel --prod` — all three stay human-gated and happen AFTER the build.

## Next session — start here
1. **Launch the Content Forge blueprint workflow** (fresh session): `Launch the content-forge-blueprints workflow.` Watch it with `/workflows`.
2. Review the diff. Then the human-gated finish: apply `0113_reels_blueprint.sql` (scoped one-off, NOT `migrate:apply`); merge-deploy the `content_forge.py` change to Hetzner (scp live → CRLF-safe diff → MERGE → `docker compose build backend && up -d --force-recreate backend` → verify in-container sha256); then `vercel --prod`.
3. Manual end-to-end check: Expound a hook → review the blueprint → Send → open the new reel as a non-owner editor → confirm hook + script + attached footage + variations panel + Download-PDF are all present, and Re-send does not duplicate footage.

## Other open threads (unchanged this session — do not lose)
**OpenCut 3-editor durability Phase 1 — still HALF-shipped (from 2026-07-13):**
- FB side landed (migration `0112_oc_media` applied to prod). Editor side NOT deployed.
- **`..\opencut-ai` fork still has ~22 UNCOMMITTED files** (media-manager, save-manager, version-manager, `supabase-media-sync.ts`, `doc-version-registry.ts`, collab hardening + `hash-wasm` dep) — they exist ONLY on this machine. Commit + push first (git "dubious ownership" → use `git -c safe.directory=<path>`).
- Then: answer the Supabase plan/upload-cap gate; rebuild the fork's Hetzner web image (`git archive apps/web/src … | ssh root@178.105.14.144 tar xf - -C /srv/opencut-ai` → `docker compose build web && up -d web`); un-hide Editor/Projects tabs for Judy/Jay/Leroy; run `docs/opencut-durability-deploy.md` checklist; owner GO/NO-GO on Supabase Pro.

## Watch-outs
- Live site runs off `feat/capcut-replica-v2`, NOT `main` — reconcile branch drift before deploying.
- dev + prod share ONE live Supabase DB. Never `npm run seed` / `migrate:apply`. Apply migrations scoped one-off only.
- Vercel Hobby at hard 12/12 functions — never add an `api/*.js` file; fold into an existing action via `?action=`.
- `backend-handoff/content_forge.py` is a STALE snapshot — never blind-overwrite the live Hetzner copy; scp → CRLF-safe diff → MERGE.
- The project-scoped memory folder from the old Mi machine is NOT present here; this machine's persistent memory is the global auto-memory (`C:\Users\Leroy\.claude\projects\C--Users-Leroy\memory\`).

## Verification commands (read-only, to confirm state on resume)
- Workflow exists: `ls .claude/workflows/content-forge-blueprints.js`
- Migration not yet in tree beyond the plan: `ls supabase/migrations/ | tail` (0113 appears only after the workflow runs)
- Backend live health: `curl -s https://api.footagebrain.com/api/content-forge/health` (secret-gated → expect 401 without `?secret=`)
