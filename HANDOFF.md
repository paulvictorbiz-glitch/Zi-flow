# Handoff — last updated 2026-07-06

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **"Book a call" on the portfolio now links to `/landing`** (a new FootageBrain route restoring the old Reel DNA marketing page) instead of a `mailto:` link.
- **Builder + closer clips are now scroll-scrubbed** like the hero orbit — converted from real-time `<video>` playback to canvas frame-sequences (91 webp frames each) via a new shared `useFrameScrub` hook, frame index driven directly by scroll progress.
- **Fixed three text-overlap issues** where overlay copy was blocking the video subject: the "Selected work" cards over the closer (shrunk + lightened), the "What I do" pillars over the builder (constrained to the vignette's darkened left band — this was the ORIGINAL "text blocking the animation" complaint, initially mis-targeted at the cards before the user clarified), and the hero "PAUL VICTOR" name (moved off-center to bottom-left, was sitting directly over the crossed arms).
- All fixes verified via Playwright — bounding-box math + canvas `getImageData` pixel sampling for skin-tone/glow overlap (not just eyeballing screenshots) — at both 1440px and 390px viewports.
- Committed on `feat/capcut-replica-v2` (`afb132b`), pushed, and **deployed LIVE** (`dpl_8Eof7ih8bhqTH8KW6RtuVZN2yFpe`, aliased www.footagebrain.com).

## Where we left off
Clean and live. HEAD of `feat/capcut-replica-v2` = `afb132b`. www.footagebrain.com/ shows the updated portfolio; `/landing` serves the restored Reel DNA marketing page; `/app` is the unchanged FootageBrain app.

## Open blockers
- None.

## Pending (written but not yet live)
- None for FootageBrain. **One flagged, not-yet-actioned item:** `paulvictor-portfolio/public/clips/builder.mp4` + `closer.mp4` (~8.8MB) are now dead weight — no longer used by the live scrub path (replaced by the webp frame sequences) — but left in place since that repo isn't git-tracked and deleting wouldn't be reversible. Owner's call whether to remove them.
- Portfolio's own outstanding items (tracked in `paulvictor-portfolio`'s own `HANDOFF.md`, not blocking): real stats numbers, optional jewelry re-gen.

## Next session — start here
1. Owner's call — no forced follow-up. If updating the portfolio: edit in `C:\Users\Mi\Downloads\paulvictor-portfolio`, `npm run build`, then copy `dist/*` into FootageBrain's `public/portfolio/` and redeploy.
2. Optional cleanup: remove the now-unused `public/clips/builder.mp4`/`closer.mp4` from the portfolio repo (see Pending above).
3. Deferred from prior sessions: landing testimonials real quotes; `webkitdirectory` folder-pick; images badge on compact tiles.

## Verification commands (to confirm current state on resume)
- `git -C "C:\Users\Mi\Downloads\ziflow project-final" log --oneline -3` → HEAD `afb132b`.
- Front page: open https://www.footagebrain.com/ → Paul Victor portfolio; scroll through hero → builder ("what I do" over a person at a desk) → closer ("selected work" cards) and confirm no text sits on top of the face/hands in either clip.
- `/landing` route: `curl -sI https://www.footagebrain.com/landing` → 200 (Reel DNA marketing page).
- App intact: https://www.footagebrain.com/app → FootageBrain sign-in screen.
- Static serve: `curl -s https://www.footagebrain.com/portfolio/index.html | grep -o 'assets/[^"]*'` → should reference `index-COtT4kIl.js` / `index-CQg6U85G.css`.
