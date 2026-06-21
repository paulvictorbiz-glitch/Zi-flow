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
All Reel DNA work is **LIVE on www.footagebrain.com** (`dpl_53XjnpzdMdbT9koUgPH7wfVNSXpj`). The reel-dna files + docs are **committed (`694e0c6`) + pushed to `origin/main`**. Owner authorized a **full-tree deploy**, so the parallel Planable-grouping WIP **also shipped** (still uncommitted — see Pending).

## Open blockers
- **None for the Reel DNA work** (live + verified-buildable + committed).
- ⚠ The **full-tree deploy shipped the parallel Planable-grouping WIP** (`suggest.js`/`export-view.jsx`/`_planable.js` + `0090`) to prod **uncommitted and unverified by this session**. The Planable owner should smoke-test the Planable push/grouping on prod and commit those files (no clean git ref == live for them yet — the recurring trap). Migration `0090` is **written, not applied** — if the shipped Planable code references 0090 columns, apply it (owner-gated).

## Pending (written but not yet live)
- Planable **grouping** files are **deployed-but-uncommitted** (`_planable.js`, `suggest.js`, `export-view.jsx`, `0090`) — parallel effort; commit + verify pending (its owner).
- Migration `0090` written, **not applied**. No migration was needed for the Reel DNA work.

## Next session — start here
1. **Verify on prod** (`www.footagebrain.com` → Reel DNA tab): Columns menu + freeze (desktop+mobile), → Pipeline editor picker, link-preview popup (IG/YT/TikTok/FB), ↩ DNA round-trip.
2. **Planable owner:** smoke the Planable push/grouping that rode along on this deploy; commit those files; apply `0090` if its code needs it.
3. (Owner) Calibrate Planable phase-2 `/media` constants on a real upload (still `// CONFIRM`), if continuing Planable.

## Verification commands (to confirm current state on resume)
- `git -C "c:/Users/Mi/Downloads/ziflow project-final" log --oneline -3` — `694e0c6` (reel-dna batch) on top of `origin/main`.
- `git -C "c:/Users/Mi/Downloads/ziflow project-final" status --short` — only the Planable files (`suggest.js`, `export-view.jsx`, `_planable.js`, `0090`, `detail.jsx`, manifest) remain dirty (deployed-but-uncommitted).
- `curl -sI https://www.footagebrain.com | head -1` — prod reachable (deploy `dpl_53XjnpzdMdbT9koUgPH7wfVNSXpj`).
- Browser: `www.footagebrain.com` → Reel DNA tab → exercise the four features.
