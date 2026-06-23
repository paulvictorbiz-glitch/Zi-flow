# Collaborator Notes — read this before you touch anything

> You are a second contributor (your own Claude Code account) on the FootageBrain / Ziflow
> dashboard. The owner (Paul) is the **only** person who deploys, applies DB migrations, and
> touches the Hetzner backend. You build on branches and open Pull Requests. This file plus
> `CLAUDE.md` (repo root) is your full briefing — the owner's local Claude memory is **not**
> shared with you, so the hard-won gotchas you'd otherwise miss are collected here.

---

## The five hard rules

1. **Never deploy. Never migrate. Never SSH the backend.** Do not run `vercel --prod`, do not
   apply Supabase migrations, do not `ssh root@178.105.14.144`. These are owner-only,
   hard-to-reverse production actions. `vercel --prod` ships the **entire working tree**, so
   deploys must come from the owner's one clean, intentional tree.
2. **`npm run dev` on localhost hits the LIVE production Supabase database.** There is no
   separate dev DB — dev and prod share one. **Never seed, mutate, insert, or delete data**
   (via scripts or through the UI) without explicit owner confirmation. Reading is fine.
3. **One branch per feature/fix, branched fresh from `origin/main`. Never commit to `main`.**
   Push your branch, open a PR into `main`, let the owner review + merge. Don't merge your own.
4. **Never `git add -A`, `git commit -a`, or `git stash pop` blindly.** The working tree often
   carries unrelated WIP. Stage explicit files only; eyeball `git diff --cached --stat` before
   committing.
5. **Migrations are append-only and globally numbered — coordinate the number before you write
   the file.** Two people creating `0095_*.sql` silently collide. See "Migrations" below.

---

## How to work here

- **Stack:** Vite + React 18 SPA (`index.html → src/main.jsx`), Supabase (auth + DB + RLS on
  every table), Vercel hosting, `api/*.js` serverless functions, a separate Dockerized Python
  backend on Hetzner for heavy jobs (reel analysis, ffmpeg renders, Whisper).
- **State:** everything routes through `src/store/store.jsx` — the `useWorkflow()` hook. It's a
  god-module; treat edits to it as high-collision (see "Hot files").
- **Build gate:** `npm run build` is the **only** automated gate — there are **zero tests**.
  "Build-green" does NOT mean "works." Verify behavior manually in `npm run dev` before you
  call something done. `node --check` works on plain `.js` (e.g. `api/*`) but cannot lint
  `.jsx` (JSX syntax) — rely on `npm run build` for those.
- **Auth / roster:** no open signup; users are owner-created. The team roster is live from the
  Supabase `people` table via `src/lib/roster.jsx` (`useRoster()`).
- **Permissions:** view/action gating lives in `src/lib/permissions-catalog.js` + `can()` /
  `canView()`. Beware: several features use a **hard `isOwner &&` gate** instead of `can()` —
  changing a permission config will NOT unlock those; the gate itself must change.

## Hot files — coordinate before editing (collision magnets)

- `src/store/store.jsx` — the central store; almost everything depends on it.
- `src/app.jsx` — tabs + routing.
- `api/ai/suggest.js` — the `?action=` catch-all (Vercel Hobby caps the project at **12
  serverless functions**, so new server logic gets folded in here instead of a new `api/*`).
- `src/lib/permissions-catalog.js` — gating.
- Shared `*.css` token files.

If you must touch a hot file, make **surgical-additive** edits (append a new branch/section;
don't restructure), keep the PR small, and tell the owner so it merges before a conflicting one.

## Migrations

- Files live in `supabase/migrations/`, numbered `NNNN_name.sql`. The next free numbers are
  `0091` (skipped earlier) and `0095`+.
- **Claim your number in the PR before writing the file** (mention it to the owner).
- **Additive only** — never edit or renumber a migration that's already been applied.
- You write the SQL; the **owner applies it** (after merge) and verifies under a real
  authenticated session.
- **RLS trap:** a policy ON a table must never `select` that same table in its `USING`/`WITH
  CHECK` — it causes `infinite recursion detected in policy`. Wrap the check in a
  `SECURITY DEFINER` helper owned by the table owner (e.g. `public.auth_is_owner()`).
- Per-user UI state goes in `user_preferences(person_id, key, value)` (upsert with
  `onConflict: "person_id,key"`), **not** `app_settings` (owner-write-only).

## Backend (Hetzner) — owner-only, but know the shape

- The Python backend is a separate private repo; files under `backend-handoff/*.py` in THIS
  repo are **stale snapshots**, not the live code. Never assume they match production.
- Owner-only to deploy. If your change needs a backend edit, describe it in the PR; the owner
  scp's the live file down, diffs (CRLF vs LF — use `--strip-trailing-cr`), MERGES, rebuilds
  the Docker image, and verifies the in-container hash.

## Known good starter tasks (low blast radius, isolated files)

The cross-account bug list in the owner's handoff (final-video gate, empty monitor for
non-owners, Scout Headers TypeError, perspective-switch, role-label and name-truncation
display bugs) are well-scoped first PRs. Reproduce account-specific bugs with **real per-account
logins** — the in-app "switch perspective" only re-gates the UI, it does NOT change the data
layer, so it masks data-gating bugs.

## PR checklist (before you open one)

- [ ] Branched from a fresh `origin/main`; rebased on latest `main`.
- [ ] `npm run build` passes locally.
- [ ] You verified the behavior in `npm run dev` (no test suite exists).
- [ ] No unrelated files staged (`git diff --cached --stat` is clean and intentional).
- [ ] No data writes to the shared live DB.
- [ ] If a migration: number claimed, additive only, owner will apply.
- [ ] You did NOT deploy, migrate, or touch Hetzner.
