# Handoff — last updated 2026-07-19

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files for deeper context.
>
> **Machine note:** this is the **Leroy** working copy (`C:\Users\Leroy\Downloads\ziflow-work\ziflow-project-final`).
> Cross-session memory: `C:\Users\Leroy\.claude\projects\C--Users-Leroy\memory\` (the original `C:\Users\Mi\…`
> path does NOT exist on this machine). Code merges to a single SSD working copy end-of-day — SSD/Paul may
> hold newer code. See memory `feedback_track_edits_for_ssd_merge`.

## TL;DR of this session
- Built **multi-client workspaces v1** — one set of tabs + a top-bar workspace switcher that re-scopes the app per client (logical scoping; no RLS rewrite, no client logins). v1 = Pipeline reels/cards + footage search.
- Delivered it as a **multi-model workflow file** (`.claude/workflows/multi-client-workspaces.js`; Fable 5 leads/gates, Opus 4.8 for the 2 risky zones + QA, Sonnet 5 mechanical). Owner **launched it externally** → all 4 teams' code landed.
- Post-run gates GREEN: SPA `npm run build`, backend `py_compile`; coherence-read the switcher/scoping/backend filter — sound.
- **Applied migration 0115 to the LIVE Supabase DB** (scoped one-off). Verified in the live catalog: `workspaces` seeded `paul`; `reels.workspace_id` 88/88 = `paul`, 0 null. Behaviour-neutral.
- Started `localhost:8003` for the owner's manual isolation test (now stopped). **Nothing else deployed.**

## Where we left off
0115 is live + verified. The workspace foundation code (SPA `workspace.jsx`/`store.jsx`/`app.jsx`/search wiring + the SEPARATE `footagebrain-backend` `client_id` work + `scripts/onboard-client.mjs`) is written but **uncommitted and undeployed**. Prod is unaffected (prod SPA bundle has no workspace code yet; 0115 is additive). The owner's manual UI test of workspace switching/isolation on localhost was **not yet run**.

## Open blockers
- **INGEST / footage-location (decide first).** The prod backend scans paths **on the Hetzner box**, not the operator's PC. Leroy's test clips are local (`C:\Users\Leroy\Videos\leroy finance shorts`, 2 `.MOV`), so pointing `api.footagebrain.com/api/sources` at that path yields a scan root the box can't read (0 files). Need to decide HOW footage reaches the ingester (upload to box / a local-or-GPU ingest that writes prod's Postgres+Qdrant) before onboarding Leroy.
- **Hetzner backend rebuild is drift-sensitive.** The live box copy (`/srv/footagebrain/footage-brain-test`) may be AHEAD of the local repo — must scp the live files down, CRLF-safe diff, MERGE the `client_id` change in, then rebuild (never blind-overwrite; CLAUDE.md rule 7).

## Pending (written but not yet live)
- **SPA workspace UI + scoping** — not `vercel --prod`'d.
- **Backend `client_id` isolation** (`footagebrain-backend`) — not rebuilt/deployed on Hetzner; needs `UPDATE scan_roots/video_files SET client_id='paul'` backfill on the box after.
- **Leroy `leroy-crosby` workspace + ingest** — not created (blocked on footage-location).
- **Carried over:** Taj Mahal end-to-end test of the LIVE editor-blueprint feature (opp `37898993-c7ec-4bc8-8627-30172b21546b`); App Workflow Blueprint (prior session) still LOCAL, ships next `vercel --prod`.

## Next session — start here
1. **Owner ingests new Leroy content for test processing on api.footagebrain** — FIRST resolve how the footage physically reaches the box (the ingest blocker above), then `scripts/onboard-client.mjs --slug leroy-crosby --name "Leroy Crosby" --path <box-visible path> --preflight` to print the STEP 1–5 runbook.
2. Owner manual-test workspace switching/isolation on localhost (create `leroy-crosby` via the switcher's ＋New client → board empties → make a card → switch to Paul → card gone → 88 reels return). Catch any leak BEFORE deploying to Paul's live site.
3. Then deploy: backend Hetzner rebuild (scp+merge) + `client_id='paul'` backfill → `vercel --prod` for the SPA.

## Verification commands (read-only)
```bash
# 0115 applied (expect [ applied ] 0115_workspaces.sql)
node --env-file=.env.local scripts/migrate.mjs 2>&1 | grep 0115
# workspace foundation present
grep -c "getActiveWorkspaceSlug\|subscribeWorkspace" src/lib/workspace.jsx
grep -n "fetchScopedReels\|RESET_FOR_WORKSPACE" src/store/store.jsx | head
# backend client_id threaded (separate repo)
grep -n "client_id" ../footagebrain-backend/backend/app/search/engine.py
# onboarding runbook (dry-run, safe)
node scripts/onboard-client.mjs --help
```
