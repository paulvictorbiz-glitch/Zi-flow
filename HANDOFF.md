# Handoff — last updated 2026-06-19 (Playwright smoke + Reel DNA verify)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Tooling + verification, no app code.** Installed Playwright (`@playwright/test` + Chromium) — the project had **no** browser automation — and built the first smoke-screenshot harness (`scripts/smoke-screenshot.mjs`).
- **Verified the Reel DNA dashboard tab renders healthy** via real screenshots: capture form, Reels/Thumbnails sub-tabs, IG Sync Health panel, ~28-row captured-reels spreadsheet — no crash, no error boundary, **no uncaught page errors**.
- Auth solved with a one-time `playwright codegen --save-storage=auth.json` (owner logged in once, session reused). `auth.json` + `screenshots/` are gitignored.
- **One minor finding:** the Reel DNA "capture a reel" bookmarklet is `<a href="javascript:…">` ([src/pages/reel-dna.jsx:1197](src/pages/reel-dna.jsx#L1197)) → React future-version warning. Non-breaking.
- **No DB, no deploy.** Live production unchanged. **Note:** during wrap-up a separate commit `ecb3247 fix(demo): decommission demo mode` landed (committed the carried-over `monitor.jsx`/`store.jsx` edits) — `main` is now **1 ahead of `origin/main`, unpushed, not deployed**.
- This now satisfies the "smoke-harness in progress" item the prior reorg-planning session was waiting on (see below) — the harness exists and works.

## Where we left off
Two threads are open:
1. **(This session — done)** Playwright + `scripts/smoke-screenshot.mjs` exist locally (uncommitted); Reel DNA confirmed working. Dev server may still be on port **8001** (8000 was already in use).
2. **(Prior reorg-planning session — still paused on owner input)** A tabs/monitor/permissions **reorganization plan** is drafted but unapproved, awaiting two decisions (below). Plan file: `C:\Users\Mi\.claude\plans\analyze-the-all-tabs-curious-dongarra.md`. Key discovery there: `monitor`/`pulse`/`ai` tabs are hard-gated `isOwner &&` at render ([app.jsx:676-678](src/app.jsx#L676-L678)), not via `canView()` — see memory `reference_owner-monitor-hardgate.md`.

## Open blockers
- **None** for production. The reorg is paused on owner input, not a technical blocker.

## Awaiting owner decision (to finalize the reorg plan)
1. **Smoke harness** — fold a minimal Playwright smoke (boot + per-role tab visibility) into the reorg plan as "Part 0"? ✅ The harness now exists (`scripts/smoke-screenshot.mjs`) and is proven — just needs extending to per-role tab checks. (Recommended — only safety net; repo has zero tests.)
2. **Restructure coordination** — is the nav reorg *part of* the contemplated full restructure ([[reference_restructure-readiness]]) or independent and done first? It rewrites `app.jsx` `TABS`/`DEFAULT_TAB_GROUPS` heavily, so order matters.

## Pending (written but not yet live)
- **Playwright harness uncommitted** — `scripts/smoke-screenshot.mjs` + `@playwright/test` devDep in `package.json`/`package-lock.json` + `.gitignore` edits are local only. Looks like a coherent unit; commit or stash before any deploy.
- **Demo-decommission commit unpushed/undeployed** — `ecb3247` (the former carried-over `monitor.jsx`/`store.jsx` edits) is committed but `main` is 1 ahead of origin and **not deployed**. `git push` + `vercel --prod` when ready (full-tree deploy will also ship the Playwright batch + docs below — review first).
- **Still-dirty tree:** the Playwright batch (above) + `CHANGELOG.md`/`change-log.md`/`HANDOFF.md` docs + `api/monitor/migrations.manifest.json` (prebuild regen). Commit or stash before deploying.
- **0076 §2** (owner-only DELETE reels/cards/tasks) — rewrite against live `"auth write"` policies.
- **0049 demo sandbox** — `[pending]`, guarded, DEFERRED until owner revisits.

## Next session — start here
1. **Answer the two decisions above**, then resequence the reorg plan (owner-only Monitor hub, flat Infra/Pulse/World/AI Brain sub-tabs, centralized `useIsOwner()` role check).
2. Decide whether to **commit the Playwright harness** (and extend `smoke-screenshot.mjs` into a per-role multi-tab smoke test — the restructure audit's highest-leverage gap).
3. **Triage the deploy surface** — push `ecb3247` (demo decommission) + commit/stash the Playwright batch + docs before any `vercel --prod` (full-tree deploy ships everything).
4. Optionally fix the `javascript:` bookmarklet warning in [src/pages/reel-dna.jsx:1197](src/pages/reel-dna.jsx#L1197).
5. 0076 §2 rewrite + apply (verify from a non-owner session); local curl-TLS quirk; (deferred) demo sandbox 0049.

## Verification commands (to confirm current state on resume)
```bash
git status -sb                            # main ahead 1 of origin; dirty = Playwright batch + docs + manifest
git log --oneline -1                      # expect ecb3247 (demo decommission, unpushed)
npx playwright --version                  # confirms Playwright installed
npm run dev                               # starts Vite (falls back to :8001 if :8000 busy)
node scripts/smoke-screenshot.mjs http://localhost:8000   # re-run the Reel DNA smoke (needs auth.json)
```
Plan under review: `C:\Users\Mi\.claude\plans\analyze-the-all-tabs-curious-dongarra.md`
