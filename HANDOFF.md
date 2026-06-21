# Handoff — last updated 2026-06-21

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Lean-FootageBrain (WS1–WS4) executed + SHIPPED LIVE.** Ran the `lean-footagebrain` workflow, verified, committed (`2a7cd95`), pushed `origin/main`, deployed `vercel --prod` → `dpl_8iNqY7QVDyVxcqx7NC2rx3zzwWH5` → www.footagebrain.com (prod 200-verified). One site, no subdomain — Direction B realized.
- **WS1** gates secondary/heavy tabs off editable roles' DEFAULT nav (`permissions-catalog.js` `LEAN_HIDDEN`: editor, lossless, export, analytics, inbox, locations, coverage, generate; Resources stays; owner unaffected, re-enableable in admin).
- **WS2** code-splits heavy pages (lazy chunks confirmed in build — old single 1.3 MB `index` → many lazy chunks incl. `monitor-hub` 110 kB) + owner-only "Prefetch heavy tabs" toggle (`app.jsx`, `PreferencesModal.jsx`, `vite.config.js`).
- **WS3** role-gates the store's secondary fetches + 2 realtime channels behind `isOwner` (`store.jsx`).
- **WS4** web-vitals perf telemetry: `perf-tracker.js` (one keepalive sample/session, silent-degrade) + `main.jsx` + owner Monitor perf card (`monitor-hub.jsx`) + migration `0086_perf_samples` (apply human-gated).
- Verified pre-ship: build-green (8.08s), per-role Playwright smoke (owner sees Monitor + Analytics, HTTP 200, zero boot page errors), static WS1 gating confirmed from diff.

## Where we left off
Lean overhaul is **live on prod** and serving 200. The working tree is clean (everything committed + pushed). The only outstanding piece is the human-gated DB migration that backs WS4 telemetry.

## Open blockers
- None. (The Playwright smoke's reviewer-leg is blocked by the pre-existing `GamifyWelcomePopup` `gf-overlay`, not a lean regression — owner-side invariants + error-clean boot validated the ship.)

## Pending (written but not yet live)
- **Migration `0086_perf_samples.sql` not yet applied** to prod Supabase (human-gated). Until applied, the WS4 Monitor perf card shows no data and the perf-tracker's one insert/session silently no-ops (by design). Apply via `/update-migrations` or paste into the Supabase SQL editor.

## Next session — start here
1. **Apply migration `0086_perf_samples`** to prod Supabase to light up the WS4 Monitor perf card (then confirm rows arrive after a few real sessions).
2. Optionally eyeball the live lean nav as a non-owner editor (confirm the leaner default tab set feels right; re-enable any tab per-role in admin if the team needs it).
3. Resume any parked threads (Reel DNA Phase 1 deploy, render worker Phase 1 Hetzner build, /space LOCAL items) per their memory files.

## Verification commands (to confirm current state on resume)
- `git -C "c:\Users\Mi\Downloads\ziflow project-final" log --oneline -3` → top should be `2a7cd95 perf(lean): make dashboard lean…`
- `git -C "c:\Users\Mi\Downloads\ziflow project-final" status --short` → should be clean
- `curl -s -o /dev/null -w "%{http_code}\n" https://www.footagebrain.com/` → `200`
- Migration status: open Supabase SQL editor → `select to_regclass('public.perf_samples');` → non-null once `0086` is applied (null = still pending).
