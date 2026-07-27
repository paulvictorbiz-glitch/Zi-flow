# Handoff — last updated 2026-07-27

> Read this first when resuming. CHANGELOG.md has change-by-change detail.
> Memory: this session's cwd is `C:\Users\Paul\dev\footagebrain`, so the auto-memory dir is
> `C:\Users\Paul\.claude\projects\c--Users-Paul-dev-footagebrain\memory\`.
> The 4 OLDER memories from the laptop-migration session are in a DIFFERENT path
> (`C:\Users\Paul\.claude\projects\C--Users-Paul\memory\`) — check both when resuming.

## TL;DR of this session
- Fixed the reported bug: reels sent to review by an editor (Amere) **vanished from his board and were re-attributed to Paul**. Root cause was a split identity between the `reels.owner` and `reels.lane` columns.
- Diagnosed against the **live Supabase data**, not just the code — REEL-378 was still sitting in the broken state, and REEL-381's own `detail.comments` audit trail contained `"assigned to Paul V"` stamped on a move **Amere** made. The app had logged the bug in plain language a day before it was reported.
- Three defects fixed: `duplicateReel` minting split-identity clones (root cause), `MOVE_STAGE` resolving the split by teleporting the card to the stale owner, and attribution (review-queue grouping + send-back routing) following the corrupted field.
- Owner chose **"lane wins"** — heal `owner ← lane` on a stage move, so split rows self-repair on first touch — and **no live-DB repair script**.
- Deployed live (`vercel --prod` → `www.footagebrain.com`), committed `ef78572`, pushed to `origin/feat/capcut-replica-v2`.
- **Side effect worth knowing:** the full-tree deploy also pushed **two** previously-pending frontends live — ingest-stage workspace scoping (backend live, coherent) and distributed-ingest "Sync to box" (**backend NOT deployed — the button 404s on prod**). Both are live-but-uncommitted.

## Where we left off
The reel-assignment fix is live and verified by the owner on localhost before deploy. Everything intended to ship this session shipped. The only outstanding work is the manual data cleanup below.

## Open blockers
None.

**Follow-up (data, not code):** REEL-381, 383 and 384 must be **manually reassigned to Amere** in the UI. Their `lane` had already been overwritten to `paul` before the fix landed, so nothing in those rows still points at Amere and the self-heal cannot reach them. REEL-378 needs no action — it still has `lane = amere` and repairs itself on its next move. Reassigning a reel past Not Started trips `blockLockedReassign`; as owner you get a `window.confirm` override, not a hard block.

## Pending (written but not yet live)
The **distributed-ingest backend** (2026-07-26 pivot) is still undeployed — `hetzner-live/backend`'s `app/api/sync.py`, `app/sync/push.py`, the vector `workspace_id` isolation, and `scripts/backfill_vector_workspace.py`. Deploying it is owner-gated (needs explicit SSH authorization phrasing), plus `SYNC_SECRET` on the box and a post-deploy backfill run.

Its **frontend went live this session anyway** (full-tree deploy), so:

> ⚠️ **"Sync to box" is a dead button on prod right now.** Verified 2026-07-27: `GET api.footagebrain.com/api/sync/push-status` → **404**; `/api/sources` → 200. Anyone clicking Sync in the Ingest Admin tab gets an error. Either deploy the backend or expect the failure.

**Live but NOT committed.** Both pending frontends rode along with this session's deploy and are serving on prod while still dirty:
```
 M api/monitor/migrations.manifest.json
 M src/components/FootageBrainSearch.jsx        # Drive-only playback (2026-07-26)
 M src/lib/footage-brain-client.js
 M src/pages/content-forge.jsx
 M src/pages/footage-status.jsx
?? src/components/drive-match-review.jsx
?? src/components/footage-scan-root-admin.jsx   # incl. SyncToBoxModal (backend missing)
?? supabase/migrations/0116_ingest_workspace_scoping.sql
```
A `git checkout` on these, or a stash-based clean-tree deploy, would **silently revert working prod features** (CLAUDE.md rule 1). Committing them is the safe next move. Migration `0116` was already applied 2026-07-25.

## Next session — start here
1. Reassign REEL-381, 383, 384 to Amere in the UI (see Open blockers), then confirm the Review Queue groups them under Amere.
2. Decide on "Sync to box": deploy the Hetzner backend half (owner-gated) or accept the dead button until then.
3. Commit the live-but-uncommitted files above so a future checkout can't revert prod.
4. Otherwise: the broader workspace-isolation work (`daily_tasks`, `reel_dna`/`thumbnail_dna`/`reel_dna_assets`, `oc_projects`, `edit_projects`, `render_jobs`, `social_connections` redesign) is still unbuilt — resume from the 2026-07-25 planning CHANGELOG entry.

## Verification (read-only checks to confirm current state on resume)
```powershell
cd C:\Users\Paul\dev\footagebrain\Zi-flow
git log --oneline -2          # expect ef78572 "Fix reels vanishing from the editor..." at top
git status --short            # expect the 8 ingest-scoping files above, still uncommitted

# Confirm the fix is in the served bundle (should print a match):
curl.exe -s https://www.footagebrain.com/app -o NUL -w "%{http_code}`n"   # expect 200

# Confirm the data cleanup: 381/383/384 should read owner=<amere-uuid> once reassigned.
# Amere's people.id is 95bc9520-bb24-4173-9662-fdfafd81f1c6.
# Read-only check via the Supabase REST API (service key is in .env.local):
#   GET /rest/v1/reels?id=in.(REEL-378,REEL-381,REEL-383,REEL-384)&select=id,stage,owner,lane,prev_owner
```
