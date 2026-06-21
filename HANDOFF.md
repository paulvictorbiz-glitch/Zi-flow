# Handoff — last updated 2026-06-21

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Planning + tooling session — no app code shipped.** Owner wanted a leaner app focused on the core workflow (inspiration → assets → editors → posted) and was weighing a second website.
- **Explored** the whole feature surface (3 Explore agents: ~20 tabs / 33 pages inventory, core-path trace, hosting/deploy map). Conclusion: a second site is unnecessary, and **hiding tabs alone won't reduce load** (all pages are static-imported into one bundle; the store fetches every table + opens 4 realtime channels regardless of role).
- **Wrote the plan** `there-are-too-many-tidy-crystal.md` — Direction B (one site): WS1 gate editor tabs, WS2 code-split + owner "Prefetch heavy tabs" toggle, WS3 role-gate store fetches/realtime, WS4 `web-vitals` perf tracking on Monitor (migration `0086_perf_samples`).
- **Generated the workflow** `.claude/workflows/lean-footagebrain.js` (via `/workflow-file-creation`) — 4 disjoint-ownership teams (A=permissions-catalog, B=app.jsx/PreferencesModal/vite, C=store.jsx, D=perf-tracker/main/migration/monitor-hub/package.json) + integration architect + adversarial QA per team + whole-project build gate. Syntax-verified. **Not launched.**
- **Marked "Master Save Point #1"** — annotated git tag `master-save-point-1` → `7a95176` (current live, fully-working) + memory, as a named rollback target before the lean refactor.

## Where we left off
Master Save Point #1 (`7a95176`) is the current live state on `main`. The lean-FootageBrain plan is approved and its workflow file is ready to run. Nothing about the app changed yet — the workflow only edits the working tree when launched, so the save point stays intact.

## Open blockers
- None. (The prior session's possible Scout/Monitor prod regression was **resolved** by commit `7a95176` — "restore Scout quota card + scrape-error surfacing".)

## Pending (written but not yet live)
- **`lean-footagebrain` workflow** — generated, not launched. Owner will run it next session. When it finishes it edits owned files only (commits/deploys nothing).
- **Migration `0086_perf_samples`** — will be written by the workflow (WS4); apply is HUMAN-GATED.
- (Carried) **Hetzner render worker** (Editor Phase 1 ffmpeg) — `backend-handoff/render.py` written, NOT deployed; owner-gated.

## Next session — start here
1. **Launch the `lean-footagebrain` workflow** (owner runs it): say "Launch the lean-footagebrain workflow", watch `/workflows`.
2. After it completes: review diffs of the owned files, confirm `npm run build` is green with per-page chunks, smoke as an editor (lean nav, no heavy chunks/queries) and as owner (everything intact).
3. Apply migration `0086` (human-gated), then `git status --short` clean-tree check → `vercel --prod`.
4. (Carried) Deploy the Hetzner render worker; Editor Phase 2/3.

## Verification commands (to confirm current state on resume)
```bash
# The save point is tagged and points at the live commit:
git rev-list -n1 master-save-point-1          # → 7a95176bb3c468f7bf251b4a1451b3e03ec97730
git tag -n9 -l master-save-point-1            # annotated message

# The generated workflow exists (gitignored, local):
ls ".claude/workflows/lean-footagebrain.js"

# Restore to the save point if ever needed:
#   git checkout master-save-point-1  → rebuild → vercel --prod (human-gated)
```
