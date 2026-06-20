# Handoff — last updated 2026-06-20

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Fixed Leroy's pipeline lane** — removed the `filter(p => p.role !== "reviewer")` exclusion in `pipeline.jsx`; Leroy's reels now land in his own personal board row.
- **Added "Hide Sent" toggle** to the Reel DNA spreadsheet — sent reels (`reelId != null`) are hidden by default; a DPill toggle reveals them.
- **Gave Leroy full owner-level access** — `isOwnerRole()` now returns true for `id === "maya"`, and `canView()`/`can()` bypass all caps when Leroy is the real signed-in user (with `!roleOverride` guard so Paul's perspective-preview still works).
- **Built the assign-to-editor dropdown** in the reel detail panel — a `<select>` that moves a reel to any editor's Not Started column; currently disabled (`false &&`) at owner request, saved to memory for re-activation.
- **Removed vercel deny rules** from `.claude/settings.json` at owner's request; deployed everything to prod.

## Where we left off
All four changes are **LIVE** on footagebrain.com. The assign-to-editor dropdown is built but invisible (`false &&` guard). The vercel deny rules are gone from `.claude/settings.json`. The dirty files (`permissions.jsx`, `detail.jsx`, `pipeline.jsx`, `reel-dna.jsx`, plus docs) have been deployed but **not committed to git**.

## Open blockers
- None.

## Pending (written but not yet live)
- **Git commit of this session's code changes** — `permissions.jsx`, `detail.jsx`, `pipeline.jsx`, `reel-dna.jsx` are deployed but not committed. Run `git add <files> && git commit` when ready.
- **Assign-to-editor re-activation** — Remove `false /* DISABLED — awaiting owner activation */ &&` from `src/pages/detail.jsx` (look for `{false /* DISABLED — awaiting owner activation */ && isOwner && peopleList.length > 0 &&`), build, and redeploy.
- **Astronaut face** — `public/astronaut-face.jpg` was never added; the /space astronaut uses fallback tinted-glass visor. Add photo + rebuild + redeploy from the space worktree.

## Next session — start here
1. **Commit the session's code changes** to git (4 src files + doc updates).
2. **Activate assign-to-editor** when Paul is ready — remove the `false &&` guard in `detail.jsx`, build, deploy.
3. **MicroSaaS Scout integration** — add Scout as a "Scout" sub-tab under Monitor (2nd Supabase client + daily Hetzner cron refresh + Caddy route for Scout backend).

## Verification commands (to confirm current state on resume)
```bash
# Confirm git status shows the expected dirty files
git status --short

# Check the live site for Leroy's pipeline row
# → open footagebrain.com/app → Pipeline tab → look for Leroy/Maya personal row

# Confirm hide-sent toggle on Reel DNA spreadsheet  
# → open footagebrain.com/app → Reel DNA tab → look for "Hide Sent" DPill in filter bar

# Confirm assign-to-editor is still disabled (false && guard present)
grep -n "DISABLED" src/pages/detail.jsx
```
