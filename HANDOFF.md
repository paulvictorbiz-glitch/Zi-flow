# Handoff — last updated 2026-06-17

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Fixed the **7 "do these first — daily use impact" bugs** from the Obsidian backlog in one coordinated multi-agent run, committed as `548c768` on a new branch **`bugfix-daily-use-batch`**. Build green; **NOT deployed yet** (user is verifying locally first).
- Brought the **Obsidian vault into the workspace** via a gitignored junction `obsidian-vault/` → `C:\Users\Mi\Documents\FootageBrain Obsidian`.
- Created the **`/workflow` skill** (`.claude/skills/workflow/SKILL.md`) — runs a `/qa-verified-plan` output by spinning up one Senior Architect agent per component, each with implementer subagents + a dedicated QA agent, across parallel waves with inter-wave gates.
- Ran `/qa-verified-plan` → `/workflow`: **Wave 1** (T-PERM, T-STORE, T-TOOL) → apply migration 0056 → **Wave 2** (T-MYWORK, T-GAMIFY). All QA-signed.
- Applied **migration `0056_daily_tasks_sort_order.sql`** to Supabase (additive nullable column).

## The 7 bug fixes (all in commit `548c768`)
1. **Permission enforcement** — new `moveReel` cap (default true) gates card moves on Pipeline/My Work/List view; completed needs `moveReel && moveToCompleted`. (`permissions-catalog.js`, `pipeline.jsx`, `list-view.jsx`, `my-work.jsx`)
2. **Owner preview-role** — verified consistent with the real editor; **no change**.
3. **Per-reel rubric archive** — `gamifyHiddenSubskills` is now a `{ [reelId]: string[] }` map; legacy flat arrays read via a `__legacy_global__` bucket. (`store.jsx`, `GamifyRubricSheet.jsx`)
4. **Migration manifest** — `prebuild` hook regenerates `migrations.manifest.json` on every build. (`package.json`, `migrations.manifest.json`, `status.js`, `MIGRATIONS.md`)
5. **My Work task reorder** — `daily_tasks.sort_order` (migration 0056) + `reorderDailyTasks()` + drag-and-drop + readability classes. (`0056_*.sql`, `store.jsx`, `my-work.jsx`, `training.css`)
6. **Per-editor training widget** — verified working on owner dashboard; **no change**.
7. **Redundant self-assess toggle** — removed `selfAssessRubric` from the roles matrix (kept in `DEMO_ACTIONS`); Monitor Gamify card is the single control. (`permissions-catalog.js`, `GamifyRubricSheet.jsx`)

## Where we left off
The bug-fix batch is **committed (`548c768`) AND DEPLOYED** to production — live on **www.footagebrain.com** via `vercel --prod` (2026-06-17, deployment `dpl_AhBoxaVFBEjeoVkZNKsgiYr54QDu`, HTTP 200, bundle `index-B59c77hh.js`). Migration 0056 applied. The deploy was from the `bugfix-daily-use-batch` working tree, so the uncommitted `/space` revision round also went live (owner-only, isolated). **Branch is NOT yet merged to `main`.**

## Open blockers
- None.

## Pending (written but not yet live)
- **Merge `bugfix-daily-use-batch` → `main`** — the fixes are live on prod but the branch isn't merged (deploy was from the working tree). Merge for backup/version hygiene.
- **One-time Vercel check (bug #4):** confirm the Vercel Build Command is the default `npm run build` so the `prebuild` manifest-regen keeps working on future deploys.
- **One-time Vercel check (gates bug #4):** confirm the Vercel project Build Command is the default `npm run build` (not a custom `vite build`), or the `prebuild` manifest-regen is skipped.
- **(Prior session, still uncommitted in the tree) the `/space` 3D homepage revision round** — `src/components/space/{RubikCube,StarWeb,DetailPanel,widgets}.jsx`, `src/pages/space3d.{jsx,css}`, new `src/components/space/SpaceSettings.jsx`. NOT touched this session and deliberately kept OUT of the bug-fix commit. Owner still needs a visual smoke test at `/space`, then commit + deploy. See CHANGELOG entry "3D Space alternate homepage".

## Next session — start here
1. Finish local verification of the 7 fixes (esp. #1 permission enforcement, #3 per-reel archive, #5 task drag). If good → `vercel --prod` → run the 8-point live checklist → merge `bugfix-daily-use-batch` to `main`.
2. Confirm the Vercel Build Command is `npm run build` (bug #4 depends on it).
3. Deal with the still-uncommitted space3d revision round (owner smoke test → commit → deploy) — separate from the bug fixes.
4. Tick the 7 bug boxes in `obsidian-vault/05 - Roadmap/TODO Backlog.md` once deployed.

## Verification commands (to confirm current state on resume)
```bash
cd "c:/Users/Mi/Downloads/ziflow project-final"
git branch                                   # expect bugfix-daily-use-batch
git log --oneline -2                          # 548c768 bug fixes; 8a32fea checkpoint
git status --short                            # expect ONLY space3d files uncommitted
node --env-file=.env.local scripts/migrate.mjs   # 58 applied · 0 pending (incl. 0056)
npm run build                                 # must pass; manifest regen via prebuild
```
