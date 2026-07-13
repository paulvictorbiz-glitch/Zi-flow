# OpenCut 3-Editors Durability — Phase 1 Deploy Runbook

Built + build-gated (fork `bun run build:web` ✓, FB `npm run build` ✓). Everything below is
**HUMAN-GATED** — the build does none of it. Plan: `.claude/plans/vivid-twirling-whistle.md`.

**What shipped:** shared, content-addressed media (projects stop going black on other machines) +
version-checked autosave with a truthful save-state UI, a save-loss/ reload-loop bug fixed on the way,
and downscaled project thumbnails. Fixes span TWO repos:
- **FB** (`ziflow project-final`): ONE new migration file — `supabase/migrations/0112_oc_media.sql`.
- **FORK** (`C:\Users\Mi\Downloads\opencut-ai`): all editor code (media sync, autosave/CAS, collab, UI).

---

## ⚠️ ENTRY GATE — answer before deploying (QA B-6)

**What Supabase plan is `kjruhbaahqkuajseoojn` on, and what is the global upload cap?**
The `oc-media` bucket allows 2 GiB/file, but the **plan-level global cap wins at runtime**: Free = 50 MB,
Pro = 500 MB (raisable in Dashboard → Storage → Settings). On Free, any clip > 50 MB 413s on upload and
its media stays local-only. **Phase 1 is designed to TRIAL on the current tier** (clips ≤ 50 MB share
fine); the Pro upgrade is the owner's post-trial GO decision (§4), not a prerequisite.

---

## Step 1 — Apply migration 0112 (scoped one-off, NOT migrate:apply)

`0112_oc_media.sql` creates the `oc-media` bucket + storage RLS + the `oc_media` dedup ledger. It is
fully idempotent. Apply it the CLAUDE.md rule-8d way — a scoped one-off mirroring `applyOne()`
(`exec_sql` RPC + `schema_migrations` upsert), run from inside the project tree via
`node --env-file=.env.local`, deleted after. Do NOT bulk `npm run migrate:apply` (other files are held back).

**Verify under a REAL authenticated session** (rule 8c — an anon-key probe silently passes
`to authenticated` policies):
- bucket `oc-media` exists, `public=false`, `file_size_limit=2147483648`, mime `video/*,audio/*,image/*`.
- `public.oc_media` exists; SELECT + INSERT work as an authenticated user; UPDATE/DELETE are refused.
- a storage upload to key `sha256/<hex>` succeeds; a key NOT starting `sha256/` is refused (INSERT policy).
- confirm `public.auth_is_owner()` exists (0076) — the owner-manage policies reference it.

## Step 2 — Rebuild the fork image (baked env; `vercel --prod` does NOT touch the editor)

`/srv/opencut-ai` is a NON-git rsync target with a box-specific root-owned `.env`. Ship the fork `src`
without touching that `.env`/compose:

```
# from C:\Users\Mi\Downloads\opencut-ai (branch with this work)
git archive --format=tar <branch> apps/web/src apps/web/package.json bun.lock \
  | ssh root@178.105.14.144 'tar xf - -C /srv/opencut-ai'
ssh root@178.105.14.144 'cd /srv/opencut-ai && docker compose build web && docker compose up -d web'
```

`hash-wasm` is a NEW dependency — that's why `package.json` + the lockfile ride along; the image build
runs the install. Verify the bake landed by grepping the served chunks for a new string, e.g.
`Project was updated elsewhere` (the conflict banner) or `Also open in another tab`.

**No FB `vercel --prod` needed** — Phase 1 has no FB app-code change (only the migration file).
**No Caddy change** — media is served by Supabase directly, not through the box.

## Step 3 — Trial on the CURRENT tier (no upgrade yet)

Give the 3 editors access (the Editor/Projects tabs are `LEAN_HIDDEN` for their roles — enable per-role/
person; that's Phase-2/owner work, not gated here). Run the validation checklist (§ below) with source
clips ≤ 50 MB.

## Step 4 — OWNER VERDICT GATE → storage decision

- **GO** (editing smooth, export good, multi-person holds): upgrade Supabase Pro + raise the global upload
  cap in Dashboard → Storage → Settings. Full-size footage then "just works" — **zero code change**.
- **NO-GO**: pivot the media backend to Hetzner (contingency below) and keep CapCut Pro primary.

### Hetzner media contingency (documented, NOT built)
All bucket I/O is isolated in the fork's `services/storage/supabase-media-sync.ts` (the K10 seam) — swap
its 4 functions (`mediaExists` / `uploadMedia` / `downloadMedia` / `objectKeyForHash`) to hit a small
FastAPI on the box: `PUT/GET /api/oc-media/sha256/<hash>` behind the same JWT (or an HMAC). A NEW `/api/*`
subpath rides the existing `/api/` proxy — **no Caddyfile change**. Operational notes: content-addressing
keeps disk bounded (dedup); add a `df` alarm + a cron that deletes objects for archived/idle projects
(your ".drp-style" archive/restore lifecycle is the natural Phase-2/3 build on this data model); note box
media sits OUTSIDE the nightly `/srv/backups` set. Persisted asset refs carry `{hash, key}`, so already-
shared media survives the backend swap.

---

## Validation checklist (the owner's GO/NO-GO evidence)

Judy/Jay/Leroy each edit a real short-form reel start-to-finish the same week (clips ≤ 50 MB for now):

- **Durability (the core fix):**
  - (a) import media on machine A → open the SAME project on machine B → every clip resolves (no black
    frames; an "Unavailable" tile only for something still uploading on A).
  - (b) RENAME the project on A → B still resolves all media (manifest preservation).
  - (c) create a brand-new project, make the first edit → NO "updated elsewhere" banner.
- **Smooth editing:** timeline scrub/trim/preview responsive; the save pill is always truthful
  (Saved / Saving / Unsaved / Save failed+Retry / offline / conflict) — never "Saved" on a failed write.
- **Multi-person:** all 3 editing their OWN projects simultaneously holds up. Double-open the SAME project
  in two tabs and edit for ~5 min → zero reload loops, ≤ 1 conflict banner, "Also open in another tab" shows.
- **Export quality:** client-side export vs the same edit in CapCut Pro (resolution, audio sync, size).
- **Big-doc realtime (pre-thumbnail-shrink legacy projects):** open a legacy project with a full-res
  thumbnail in two tabs; confirm a save in one still propagates to the other (the select-version fallback
  path). New/edited projects get the downscaled thumbnail automatically on their next save.
- **Standalone unaffected:** (dev sanity) the upstream/standalone fork build still saves to IndexedDB and
  fires NO save on a plain project open.

## Accepted risks (owner-visible)
- Large-file upload RESTARTS (not resumes) on a network drop until TUS (Phase 2).
- A project whose author never reopens it after this ships (and never finished uploading) stays local-only.
- Unload loss window 800 ms typical / ≤ 10 s worst (no keepalive; the parent flush-ack postMessage is Phase 2).
- Cosmetic: until the classic header is removed, CapCut mode shows the save pill twice (same state, harmless).
- Egress/storage cost once on Pro — content-addressing + the owner-GC policy hooks in 0112 are the mitigations.

## Rollback
- FB: migration 0112 is additive (new bucket + table); nothing references it from FB app code yet, so it can
  sit unused. To hard-remove: drop the `oc_media` table + the three `oc-media` storage policies + the bucket.
- FORK: redeploy the previous image (`docker compose up -d web` on the prior build) — the fork changes are
  self-contained; oc_projects docs written with the new manifest field remain readable by the old code
  (it just ignores `mediaLibrary`), and `version` was unused before.
