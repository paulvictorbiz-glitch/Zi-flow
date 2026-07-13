# Handoff — last updated 2026-07-13

> Read this first when resuming. Then skim CHANGELOG.md and the memory archive at
> `..\_claude-archive\memory\` (recovered from the old SSD) for deeper context.

## Context: recovered onto a borrowed PC (2026-07-13)
The Mi laptop died. This repo + the opencut-ai fork + Obsidian + SSH keys were recovered
off its SSD onto a friend's Windows PC. Working copy root: `C:\Users\Leroy\Downloads\ziflow-work\`
(`ziflow-project-final`, `opencut-ai`, `footagebrain-backend`, `obsidian\`, `.ssh\`, `_claude-archive\`).
Localhost, Hetzner SSH (root@178.105.14.144, key `id_ed25519`), GitHub push (HTTPS+GCM),
and Vercel (`vercel --prod`) all re-verified working from here.

## Shipped today
- **Recovered mobile pass DEPLOYED to prod** (`footagebrain.com`): responsive mobile bottom-nav +
  "More" sheet (`mobile-nav.jsx` + `use-is-mobile.js` + `styles-mobile.css`, ≤768px, zero desktop
  regression), Modal→full-screen-sheet on mobile, HUD split into `hud/` subpages, PWA meta.
  Commits `8d8ae83` + `d0c273e` on `feat/capcut-replica-v2`, pushed. `vercel --prod` live (HTTP 200).
- **Migration `0112_oc_media` APPLIED to prod** (scoped one-off, NOT `migrate:apply`). Status now
  `112 applied · 0 pending`. Creates private `oc-media` bucket + `oc_media` table + RLS (additive).

## OpenCut 3-editor durability Phase 1 — HALF-shipped, this is the live thread
The 7/6 session built content-addressed shared media + CAS autosave across TWO repos. Today the FB
side landed (migration 0112 ✅). The EDITOR side is NOT deployed and its code was uncommitted:
- **`opencut-ai` fork now recovered to `..\opencut-ai`** (branch `feat/capcut-replica-v2`, remote
  `paulvictorbiz-glitch/opencut-ai-fb.git`). **22 files still UNCOMMITTED** (media-manager, save-manager,
  version-manager, `supabase-media-sync.ts`, `doc-version-registry.ts`, `save-errors.ts`,
  `import-external.ts`, collab hardening + `hash-wasm` dep). ⚠️ Commit + push these first (safe now that
  they're on C:) — they exist ONLY here.

## Next session — start here
1. **Commit + push the opencut-ai fork's 22 uncommitted files** (git blocks it with "dubious ownership";
   use `git -c safe.directory=<path>` or `git config --global --add safe.directory`).
2. Answer the entry-gate: which Supabase plan is `kjruhbaahqkuajseoojn` on? (Free 50MB vs Pro 500MB cap.)
3. **Rebuild the fork's Hetzner web image** (`vercel --prod` does NOT touch the editor):
   `git archive apps/web/src apps/web/package.json bun.lock | ssh root@178.105.14.144 tar xf - -C /srv/opencut-ai`
   → `docker compose build web && up -d web`. (SSH writes to prod are human-gated.)
4. Un-hide Editor/Projects tabs for Judy/Jay/Leroy (`LEAN_HIDDEN`).
5. Run the cross-machine validation checklist in `docs/opencut-durability-deploy.md`, then owner
   GO/NO-GO on Supabase Pro. Phase 2/3 (gallery reads `oc_projects` as source of truth, per-role tab
   enablement, scale/hardening) remain OUT of scope and open.

## Watch-outs
- Live site runs off `feat/capcut-replica-v2`, NOT `main` — reconcile branch drift before deploying.
- dev + prod share ONE live Supabase DB. Never `npm run seed` / `migrate:apply`. Apply migrations
  scoped one-off only.
- Friend's PC: `ziflow-work\` holds `.env` secrets + SSH keys — deletable to clean up once everything's pushed.
