# Workflow / FootageBrain Dashboard — Claude Context

Owner-controlled video production pipeline dashboard for a 4-person team (Paul, Judy, Jay, Leroy).
Live at **footagebrain.com** (Vercel). Backend at **api.footagebrain.com** (Hetzner Docker, IP 178.105.14.144).

---

## Resuming a session ("continue")

When the user says **"continue"** (or `/continue`, "resume", "pick up where we left off") at the start of a session, FIRST load the handoff context before doing anything else — invoke the **`continue`** skill, or if unavailable, manually read in this order:
1. `HANDOFF.md` (project root) — current snapshot: where we left off, blockers, next steps.
2. Top entries of `CHANGELOG.md` (project root) — recent changes, the path taken, and lessons learned.
3. Memory folder `current-state.md` + any relevant memory (see `MEMORY.md` index).

Then give a short orientation and wait for direction. Do not start edits/deploys until the user confirms what to tackle.

**Ending a session:** when the user says **"wrap up"** (or `/wrap-up`), invoke the **`wrap-up`** skill — it refreshes `HANDOFF.md`, appends per-change entries to `CHANGELOG.md`, syncs memory, and updates this file if a durable rule changed. (Supersedes the older `/session-close`.)

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18 SPA, entry `index.html → src/main.jsx` |
| State | `src/store/store.jsx` — `useWorkflow()` hook, Supabase-backed |
| Auth | Supabase Auth + `src/auth.jsx`, RLS on all tables |
| DB | Supabase `kjruhbaahqkuajseoojn.supabase.co` |
| Hosting | Vercel (CLI deploy only — `vercel --prod`) |
| Admin API | `api/admin/*.js` Vercel serverless functions |
| Team roster | `src/lib/roster.jsx` — live from Supabase `people` table |

---

## Critical rules — read before acting

1. **Deploy = `vercel --prod` only.** `git push` does NOT deploy. Never assume a push updated the live site. **`vercel --prod` builds the ENTIRE working tree — every uncommitted change ships, not just the files you touched.** So **ALWAYS run a pre-deploy tree-conflict check before uploading any feature:** run `git status --short` and reconcile the dirty tree against what you actually intend to ship. If anything unrelated, half-built, or unverified is dirty, **STOP and flag it** — then commit, stash, or branch off that work (or get explicit owner go-ahead) before deploying. A clean, intentional tree is a hard precondition for `vercel --prod`, not an afterthought. See memory `feedback_full-tree-deploy.md`. **The flip side of an ISOLATED deploy (stash dirty WIP → build from clean `main` → deploy):** because the build is the working tree, it ships a bundle with NONE of the stashed files — so if a dirty file was *live-but-never-committed* (the recurring no-clean-ref==live trap), isolating **silently reverts it on prod**. Before stashing, check whether each dirty file is already live; after any isolated deploy, verify the stashed files' prod features. See memory `reference_isolated-deploy-reverts-live-uncommitted.md`.
2. **Dev and prod share the same Supabase database.** `npm run dev` on localhost hits the live DB. Never seed or mutate without confirming with user.
3. **File edits are pre-approved.** No need to ask "is it ok to edit X?" — proceed directly.
4. **No open signup.** Registration is owner-only via the admin panel (`/api/admin/create-user`). The sign-in screen has no "Create account" option.
5. **Vercel env vars ≠ `.env.local`.** `vercel dev` reads from the Vercel platform, not `.env.local`. Server-side secrets must be set via `vercel env add` AND in `.env.local`.
6. **Per-user prefs go in `user_preferences`, NOT `app_settings`.** `app_settings` is owner-write-only. For per-user UI state (e.g. pipeline collapse), use `user_preferences(person_id, key, value)` (migration 0070): upsert with `{ onConflict: "person_id,key" }`, and hydrate in a **separate effect keyed on the auth person's id** — never inside the main all-or-nothing hydrate, or a missing table bricks boot.
7. **Hetzner backend deploys + live DB migrations are human-gated production actions.** Writing to / restarting the prod backend (`root@178.105.14.144`) and `npm run migrate:apply` (the shared prod Supabase DB) are hard to reverse; the safety system gates them and they require explicit owner authorization or the owner running them. If a denial occurs, surface it to the owner — don't route around it. **When deploying a `backend-handoff/*.py` file: it's a STALE SNAPSHOT — the live Hetzner copy (`/srv/footagebrain/footage-brain-test/backend/app/api/`) may be AHEAD (e.g. ig_webhook.py had the 0077 content_type feature the snapshot lacked). Always `scp` the live file down, `diff --strip-trailing-cr` it against the snapshot (CRLF-vs-LF makes a naive diff show every line), and MERGE (live + your change) — never blind-overwrite, or you revert live features. Code is BAKED into the image (not volume-mounted) → rebuild from the REAL compose: `cd /srv/footagebrain/footage-brain-test/deploy/hetzner && docker compose build backend && docker compose up -d --force-recreate backend` (plain `up -d` won't swap a running container to a freshly built image; the sibling `footage-brain-test/docker-compose.yml` is STALE → builds an orphaned `footage-brain-test-backend` image that never serves traffic — see memory `reference_hetzner-fb-backend-compose.md`), then verify the in-container `sha256sum` (in-container path `/app/app/api/`). The edge is a TWO-LAYER proxy: **Caddy (`fb-caddy`, bind-mounted `deploy/hetzner/Caddyfile`) → `frontend:80` (nginx, baked image) → `backend:8000`** — the frontend nginx only proxies `/api/`, `/thumbnails/`, `/health` (else SPA fallback); to expose a NEW backend path (e.g. `/reels/`) add a `handle` block to the Caddyfile (`reverse_proxy backend:8000`, query-strings auto-forward) + `docker exec fb-caddy caddy reload` — no image rebuild. Use fire-and-forget endpoints + poll, not synchronous `?wait=1`. Port 8000 isn't host-published — reach it via the caddy domain or `docker exec`. See memory `project_ig-sync-graph-error-drop.md` · `current-state.md`.**
8. **RLS + migration safety (learned the hard way 2026-06-19 — took the site down).** (a) An RLS policy ON a table must NEVER directly `select` that same table in its `USING`/`WITH CHECK` — it triggers `infinite recursion detected in policy for relation X` on every access by that role. Wrap the check in a `SECURITY DEFINER` helper owned by the table owner (e.g. `public.auth_is_owner()`). See memory `reference_rls-self-reference-recursion.md`. (b) **`schema_migrations` can lie** — a file can be marked applied without its objects existing (`0049_demo_sandbox` was never actually run). Before relying on an earlier migration's objects, audit the live catalog, not the ledger. See memory `reference_migration-tracking-drift.md`. (c) After applying RLS to prod, verify under a REAL authenticated session — an `anon`-key probe silently passes `to authenticated` policies. (d) **Never bulk `npm run migrate:apply` / `/update-migrations` when some pending files are intentionally held back** (e.g. 0092/0093 music, 0086 — they'd all fire). To apply ONE migration, run a scoped one-off that mirrors `migrate.mjs applyOne()` (`exec_sql` RPC + `schema_migrations` upsert) — put it inside the project tree so it resolves `node_modules`, run via `node --env-file=.env.local`, delete after. `exec_sql` is atomic per-file (one plpgsql txn) so a failed apply rolls back fully — fix and re-run. And a live table's columns can differ from its repo migration (manually-created `edit_sessions` had `last_active`, no `updated_at`) — probe live cols before trusting the file. See memory `reference_migration-tracking-drift.md`.

---

## Admin API — known constraints

- **RLS blocks service_role on `people` table.** The RLS policy uses `auth.role() = 'authenticated'`; service_role returns `'service_role'` which fails it. Workaround in `api/admin/_auth.js`: use the caller's JWT with the service role key as apikey so PostgREST sees `'authenticated'`.
- **`auth.admin.createUser()` requires a valid service role key** sent to Supabase Auth API. If this call returns "User not allowed", the most likely cause is the key stored in Vercel being truncated.
- **`api/admin/activate-slot.js`** links an existing unclaimed `people` slot to a new auth user. Requires migration 0018 to be run so the service role can read/write the `people` table.
- **Vercel Hobby plan caps at 12 Serverless Functions.** Every non-`_`-prefixed `.js` under `api/` is one function; a 13th fails `vercel --prod` at the deploy step (the build still passes first). For new owner-only mutations, prefer a **direct RLS-gated Supabase write** (the "owner write app_settings" policy) over a new `api/*` route, or fold logic into an existing route via `?action=`. See memory `vercel-function-cap.md`.

---

## Team slots (canonical IDs in code)

| DB id | Person | Role |
|---|---|---|
| `paul` | Paul Victor | owner |
| `alex` | Judy Adawag | skilled |
| `sam` | Jay | variant |
| `maya` | Leroy Crosby | reviewer |

New members added via admin panel get UUID-based IDs. All UI reads from live `people` table via `useRoster()`.

---

## Key files

- **`src/styles-solarin.css` is the Solarin reskin (NEW, 2026-06-25)** — a whole-app theme behind `[data-theme="solarin"]` (set on `#root` by `solarinMode` in `app.jsx`), **default-ON for the owner** with a one-click "Exit Pimped Out" revert in the avatar menu. It works by **remapping the existing CSS-var VALUES** (`--c-cyan`/`--bg-2`/`--fg`/`--f-sans`…) — NOT by adding new names — so the whole app reskins at once (teal/mint/peach + IBM Plex Sans/Space Mono); per-tab backgrounds live in `public/assets/bg/`. `src/styles.css` stays edit-locked/untouched. **DEPLOYED LIVE 2026-06-25** (full-tree `vercel --prod`; shipped UNCOMMITTED from the dirty `feat/capcut-replica-v2` tree — a `git checkout` on the Solarin files would revert it from a future build). If the owner's UI looks different from a teammate's, this is why. See memory `project_solarin-redesign.md` · `reference_css-var-remap-reskin.md`.
- `src/lib/roster.jsx` — RosterProvider, useRoster(), module-level cache for store
- `src/lib/shared-data.jsx` — ROLES, STAGES, STAGE_ROLE (static); PEOPLE/PIPELINE_LANES removed
- `src/auth.jsx` — sign-in only (no signup), ClaimIdentityScreen shows "ask Paul" message
- `api/admin/_auth.js` — verifyOwner() with JWT workaround for RLS
- `supabase/migrations/` — apply manually in Supabase SQL editor
- **`editor.footagebrain.com` is a LIVE Hetzner service (since 2026-06-24)** — the embedded OpenCut editor fork runs as its OWN Docker stack at `/srv/opencut-ai` (`opencut-ai-db-1` + `opencut-ai-web-1`, web host port **3200** because 3100 is Rocket.Chat, PG bound 127.0.0.1). It's a THIRD Caddy site, reached because `fb-caddy` was bridged onto `opencut-network` at **runtime** (`docker network connect`) — **this does NOT survive an `fb-caddy` recreation (FB-backend compose redeploy) → the editor would 502 until reconnected.** Persist by adding `opencut-network` (external) to the caddy service in `deploy/hetzner/docker-compose.yml`. FB-side gate = `EDITOR_EMBED_ENABLED` in `src/app.jsx` (now `true`). Full gotchas: memory `reference_opencut-prod-cutover.md`. **CapCut Replica v2 — SHIPPED LIVE (2026-06-24 session n):** the editor now **DEFAULTS to CapCut** (owner kept the toggle — `parsePreset` recognizes an explicit `?ui=classic`). Toggleable CapCut-styled view that REUSES the same engine — fork CSS class **`.capcut`** (not `.theme-capcut`) on the editor-root, selected by a `ui-preset-store` reading `?ui=capcut` + FB_AUTH `uiPreset`; FB persists the choice per-user in `user_preferences` key `editor_ui_preset` (shared `src/lib/editor-ui-preset.js`). **Deploying a fork CODE change to the box: `/srv/opencut-ai` is NOT a git repo** — it's source rsync'd from the local machine with a box-specific root-owned `.env` carrying the SSO/`NEXT_PUBLIC_*` build args. Ship via `git archive --format=tar <branch> apps/web/src | ssh root@178.105.14.144 'tar xf - -C /srv/opencut-ai'` (NEVER overwrite the box `.env`/compose) → `docker compose build web && up -d web` (skin is **BAKED**, so `vercel --prod` alone won't update the editor; verify the bake by grepping the served `.next` chunks, e.g. `capcut dark bg-background`). The web container healthcheck must use **`node` not curl** (slim image has no curl) — a compose-level override on the `web` service. Also shipped session n: an owner-only **Editor usage monitor + history** card on the Monitor hub (`monitor-hub.jsx`), backed by `editor_usage_sessions` (migration **0097**, applied) + `src/lib/editor-usage.js` logging FB-side from the iframe parent. Details: memory `project_capcut-replica-v2.md` · `reference_opencut-prod-cutover.md`.
- **The LIVE MicroSaaS Scout is `src/pages/scout.jsx` + `src/lib/scout-supabase.js` INSIDE this repo** (owner-only Monitor → Scout tab on footagebrain.com) — NOT the standalone `C:/Users/Mi/Downloads/microsaas-scout` repo. They share ONLY the Scout Supabase DB (`rqkzstyvqfmcsxdyogij`); the live "Refresh" proxies to a separately-deployed backend at `SCOUT_BACKEND_URL`. Edit `scout.jsx` for anything user-facing on prod. See memory `reference_scout-two-codebases.md` + `project_scout-discover-upgrades.md`.
- `docs/COLLAB-NOTES.md` + `docs/FRIEND-TASKS.md` — in-repo briefing for the **second contributor** (friend on his own machine + own Claude, GitHub PR-based; owner stays sole deployer/migrator/Hetzner). The friend's Claude gets `CLAUDE.md` + these docs on clone but NOT this memory folder — keep durable collaborator gotchas in those docs. See memory `project_second-contributor-onboarding.md`.

---

## Deeper context

Full memory files: `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\`
Current work state: see `current-state.md` in that directory

**Two-tier memory index:** `MEMORY.md` is the lean ACTIVE index loaded every session (standing rules + reusable gotchas + core infra + work still pending deploy/migration/planned). Completed+verified-LIVE work and historical notes live in `ARCHIVE.md` (same folder, NOT auto-loaded — grep there for history). Every `.md` is indexed in exactly one of the two. `/wrap-up` moves shipped+verified entries from `MEMORY.md` → `ARCHIVE.md` to keep the active index ≤ ~45.
