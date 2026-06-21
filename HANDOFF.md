# Handoff — last updated 2026-06-21

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Built a batch of **Reel DNA spreadsheet** enhancements (planned via `/qa-verified-plan`, built via a generated `/workflow-file-creation` workflow `reel-dna-cols-and-multi-editor.js`, then hardened against live testing):
  1. **Hide/collapse columns** ("Columns" menu, per-user persisted) + **freeze header row & first ★/color column** (desktop + mobile).
  2. **Send a captured card to the pipeline for chosen editor(s)** — the **→ Pipeline** button now opens an editor-picker modal (first editor = linked reel, extras = independent `(FirstName)` copies). FAB "Create new reel" also got a multi-editor dropdown.
  3. **In-app reel preview popup** on link click — embeds **IG / YouTube / TikTok / Facebook** (YT+FB autoplay), click-out to keep taking notes, + persistent **visited-link underline**.
  4. **"Back to Reel DNA"** (↩ DNA) — reverse of Send-to-Pipeline: migrates assets + text back, unlinks/reset, soft-archives the pipeline reel.
- Fixed real bugs the first workflow build left: freeze needed a **bounded-height scroll container** (`.rd-table-wrap` → `overflow:auto` + `max-height: calc(100dvh - 200px)`); preview modal **class-name drift** (`.rd-preview-*` vs `.rpv-*`) + **Facebook mis-detection** (`platformFromUrl` never returns `"fb"`).
- **Reverted** a mis-placed "Send to editors" multi-select from the pipeline card ⋯ menu (`components.jsx`) — owner wanted it on the Reel DNA side, not pipeline cards.
- No DB migration this session (uses live `user_preferences` 0070 + existing `reels`/`reel_dna` columns).

## Where we left off
All Reel DNA work is **built, build-green, and verified live on `npm run dev` (localhost:8003)**. The reel-dna files + the doc files are **committed + pushed to `origin/main`**. The deploy was **NOT run** — see Open blockers.

## Open blockers
- **Deploy is unsafe right now (shared dirty tree).** A `0090_planable_pushes_grouping.sql` + further edits to `api/ai/suggest.js`, `src/pages/export-view.jsx`, `api/ai/_planable.js` appeared **during** this session (a parallel/owner Planable-grouping effort) and were NOT made by this session. A full-tree `vercel --prod` would ship that unverified Planable-grouping WIP; an isolated deploy would revert the **live-but-uncommitted** Planable phase-2. Both are documented traps. **Held the deploy and surfaced it to the owner.** The reel-dna code is safely committed regardless.

## Pending (written but not yet live)
- This session's **Reel DNA enhancements** — committed + pushed, **NOT deployed** (deploy held per above).
- Planable **grouping** WIP in the tree (`_planable.js`, `suggest.js`, `export-view.jsx`, `0090_planable_pushes_grouping.sql`) — a parallel effort; left untouched + uncommitted by this session.
- Migration `0090` written, **not applied** (Planable grouping; owner-gated). No migration needed for the Reel DNA work.

## Next session — start here
1. **Decide the deploy**: either (a) reconcile/verify the Planable grouping WIP and full-tree deploy everything, or (b) coordinate a clean release of just the Reel DNA work. Then `vercel --prod`.
2. After deploy, smoke the Reel DNA tab: Columns menu + freeze (desktop+mobile), → Pipeline editor picker, link-preview popup (all 4 platforms), ↩ DNA round-trip.
3. (Owner) Calibrate Planable phase-2 `/media` constants on a real upload (still `// CONFIRM`), if continuing Planable.

## Verification commands (to confirm current state on resume)
- `git -C "c:/Users/Mi/Downloads/ziflow project-final" log --oneline -3` — confirm the reel-dna commit is on top of `origin/main`.
- `git -C "c:/Users/Mi/Downloads/ziflow project-final" status --short` — the Planable files (`suggest.js`, `export-view.jsx`, `_planable.js`, `0090`, `detail.jsx`, manifest) should still be the only dirty entries.
- `npm run build` — expect green (only the chunk-size warning).
- Browser: `npm run dev` → Reel DNA tab → exercise the four features above.
