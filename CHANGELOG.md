# Changelog

Durable record of changes to the Workflow / FootageBrain app — newest first. Each entry captures *what* changed, the *path we took*, and *what we learned*. Maintained by the `/wrap-up` skill.

---

## 2026-06-17 — 7 daily-use bug fixes (multi-agent `/workflow` run)

**What changed:** Fixed the 7 "do these first — daily use impact" bugs from the Obsidian backlog in one coordinated, file-ownership-isolated multi-agent run. (1) **Permission enforcement** — added a `moveReel` capability (default `true`) that actually gates reel-card moves on the Pipeline board, My Work, and List view; completed-stage moves require `moveReel && moveToCompleted`. (2) **Owner preview-role** — verified already consistent with the real editor (no change). (3) **Per-reel rubric archive** — `gamifyHiddenSubskills` is now a `{ [reelId]: string[] }` map instead of a global flat array, so hiding a sub-skill on one reel no longer hides it everywhere. (4) **Migration manifest** — a `prebuild` hook regenerates `migrations.manifest.json` on every build (it had gone stale at 54/57 entries), fixing the Monitor "Check migrations" error. (5) **My Work task reorder** — new `daily_tasks.sort_order` column (migration 0056) + `reorderDailyTasks()` action + HTML5 drag-and-drop on task rows + readability/contrast classes. (6) **Per-editor training widget** — verified working on the owner dashboard (no change). (7) **Redundant self-assess toggle** — removed `selfAssessRubric` from the roles matrix (kept in `DEMO_ACTIONS`); Monitor Gamify card stays the single control.

**Where:** `src/lib/permissions-catalog.js`, `src/pages/pipeline.jsx`, `src/pages/list-view.jsx`, `src/store/store.jsx`, `supabase/migrations/0056_daily_tasks_sort_order.sql` (new), `src/pages/my-work.jsx`, `src/pages/training.css`, `src/components/GamifyRubricSheet.jsx`, `package.json`, `api/monitor/migrations.manifest.json`, `api/monitor/status.js`, `supabase/MIGRATIONS.md`. Committed as `548c768` on branch `bugfix-daily-use-batch`.

**Path we took:** `/qa-verified-plan` (4 domain agents + 1 adversarial QA agent) produced a layered plan with a File Ownership Registry, frozen contracts, and 2 execution waves. The new `/workflow` skill then executed it: **Wave 1** spun up 3 Senior Architect agents in parallel (T-PERM, T-STORE, T-TOOL), each managing implementer subagents + exactly one dedicated QA agent in a disjoint file lane; migration 0056 was applied at the inter-wave gate; **Wave 2** ran 2 more (T-MYWORK, T-GAMIFY) consuming the published contracts (`moveReel`, `setGamifyHiddenSubskills(reelId,keys)`, `reorderDailyTasks(orderedIds)`).

**What we learned:** (1) The QA pass corrected 3 triage assumptions before any code was written — #4 was never a 500 (status.js already returns a graceful 200; the bug was a stale manifest), and #2/#6 were already working. (2) `moveReel` must **default true** and `can()` must stay **fail-open**, or person-level permission overrides that predate the new cap would silently lock editors out. (3) The per-reel rubric map needs a backward-compatible read (`normalizeHiddenSubskills` buckets legacy flat arrays under a `__legacy_global__` sentinel) so existing hidden rows don't crash or vanish. (4) The file-ownership gate flagged the prior session's uncommitted space3d edits as "strays"; resolved by staging only the 12 owned bug-fix files explicitly, leaving space3d untouched.

**Status:** **Committed on `bugfix-daily-use-batch` (`548c768`); build green; migration 0056 applied to Supabase. NOT deployed** — user chose to verify locally first (dev server on `http://localhost:8001`).

## 2026-06-17 — `/workflow` orchestrator skill

**What changed:** Created the `/workflow` skill — it executes an approved `/qa-verified-plan` output by spinning up **one Senior Architect agent per mission-critical component**, each managing 3–4 subagents (implementers + exactly one dedicated QA agent) inside a strict file-ownership boundary, with parallel waves, inter-wave gates (incl. migration application), deploy, and verification.

**Where:** `.claude/skills/workflow/SKILL.md`.

**Path we took:** The user wanted a runnable terminal command that layers on top of `/senior-architect` — but with one Senior Architect *per component* (rather than one for the whole plan), each running its own QA. Built it to read the plan's File Ownership Registry / contracts / waves generically, with a pinned component→wave mapping for the current bug-fix plan at the bottom.

**What we learned:** Spawned `general-purpose` agents can themselves spawn subagents, enabling nested orchestration (main → per-component Senior Architect → implementers + QA). Ran the authoritative `npm run build` at each wave gate rather than inside each agent, to avoid concurrent writes to `dist/` racing on Windows.

**Status:** Live locally (skill files are local to Claude Code; `.claude/` is gitignored).

## 2026-06-17 — Obsidian vault in workspace + daily-use bug triage & plan

**What changed:** Brought the FootageBrain Obsidian vault into the project via a directory junction `obsidian-vault/` → `C:\Users\Mi\Documents\FootageBrain Obsidian` (live link, not a copy; gitignored). Produced `bugfix-triage.md` categorizing the 7 daily-use bugs by subsystem + file ownership, and a QA-verified layered plan at `~/.claude/plans/categorize-my-bug-fixes-swift-fairy.md`.

**Where:** `obsidian-vault/` (junction), `.gitignore`, `bugfix-triage.md`.

**Path we took:** Located two vaults under `Documents/`; used the FootageBrain one. The bug list lives in `obsidian-vault/05 - Roadmap/TODO Backlog.md` under "🐛 Bug Fixes (do these first — daily use impact)". A junction keeps the vault editable from both Obsidian and the workspace without duplication.

**What we learned:** A Windows directory junction (`New-Item -ItemType Junction`) gives read/write access to the vault from inside the repo with zero duplication; gitignoring `obsidian-vault/` keeps it out of version control. This is a lightweight step toward the backlog's "Obsidian two-way integration" item.

**Status:** Live locally.

## 2026-06-17 — 3D "Space" alternate homepage (`/space`, owner-only)

**What changed:** Built a completely separate, toggle-able alternate homepage: an interactive 3D Rubik's cube (React Three Fiber) that acts as a living map of the whole app. Reached at `/space` from a new **▦ 3D Space** pill on the owner My Work dashboard. The cube has three scene states — **assembled** (six category faces, drag-to-orbit, gentle auto-rotate, gold-glow frame), **exploded** (one labelled column per category with headers), and **detail** (a picked box flies to the corner and a panel shows summary + key stat cards + a mini bar graph + an "Open full page in app →" link). Background is a customizable starfield/nebula with occasional shooting stars. A ⚙ panel lets the owner change cube edge color, style (glass/solid/wire), and background preset — all persisted to `localStorage`.

**Where:** New `src/pages/space3d.jsx` + `space3d.css` (L2 state machine); new `src/components/space/` (RubikCube, StarWeb, SpaceMenu, DetailPanel, SpaceFallback, SpaceSettings, widgets); new `src/lib/space-cube-config.jsx` (L0 data). Two additive edits to existing files: `src/app.jsx` (one lazy import + one `/space` branch inside the authed provider tree) and `src/pages/my-work.jsx` (one owner-only toggle pill). Dev-only `vite.config.js` change (`optimizeDeps.include`). Initial build + the vite fix landed in checkpoint commit `2026-06-17 19:50`; the revision round (orbit, categorized faces, on-face labels, nebula+shooting stars, rich detail stats, customization panel) is **uncommitted**.

**Path we took:** Planned via `/qa-verified-plan` → `/senior-architect`. Key architectural decision: because it needs **live owner data** but must not interfere with anything, it lives **inside** the authed provider tree (so it gets `useWorkflow()`/`useLocations()` read-only) at its own URL, rather than on the public `/`. Followed the existing L0–L3 layered pattern from the Reel DNA landing; reused the proven R3F v8 glow technique from `dna-helix.jsx` (instanced halos, `webglAvailable()` fallback, `THREE.MathUtils.damp` lerps). Lazy-loaded so the 837 kB three.js chunk never ships with the main app. After the first visual pass the user requested revisions (drag-orbit via `OrbitControls`, six categorized faces with per-box topic labels, bigger boxes, fixed column labels, column headers, rich detail stats, and a customization panel) — all delivered in the same isolated files.

**What we learned:** (1) **Vite dev dynamic-import race** — the first visit to a lazy R3F route ("Failed to fetch dynamically imported module") happens because `three`/`@react-three/fiber`/`@react-three/drei` get optimized on-the-fly, triggering a reload that aborts the in-flight import. Fix: add them to `optimizeDeps.include` so they're pre-bundled at dev startup (also hardens the lazy landing page). (2) **drei `<Html center>` already applies `translate(-50%,-50%)`** — adding our own translate double-offset and mangled the column labels; removing it + dropping `distanceFactor` fixed the formatting. (3) Linking back into the classic app works by setting `localStorage.wb_view` then navigating to `/app` (AppShell reads `wb_view` on mount); all 15 link keys were verified against real AppShell `view ===` conditionals.

**Status:** **Local only — build passes (`npm run build`, `space3d` is its own chunk, main bundle unchanged), dev smoke clean. NOT deployed.** Pending the owner's visual smoke test (drag feel + on-face label sizing are the two items most likely to need a tweak), then `vercel --prod`.

## 2026-06-17 — /senior-architect skill

**What changed:** Created the `/senior-architect` Claude skill. After running `/qa-verified-plan` and approving a layered plan, invoking `/senior-architect` executes it task-by-task under a single Senior Architect (Claude itself). Each task gets 3–4 specialist sub-agents plus a dedicated QA agent per task. The Senior Architect builds a File Ownership Registry upfront so no task can write files belonging to another task, enforces CSS class prefixes and store key declarations as output contracts, and runs sequential task execution with auto-pause only on unresolved QA blockers.

**Where:** `.claude/skills/senior-architect/SKILL.md` (new skill file). No application code changed.

**Path we took:** User wanted a skill that takes the `/qa-verified-plan` output and actually builds it safely — the gap was that ad-hoc execution had no isolation between tasks and no per-task QA. Designed the skill around three key mechanisms: (1) a file ownership registry built before any code is written, (2) a per-task agent team with mandatory QA, and (3) sequential layer-order execution with output contracts passed forward to each subsequent task.

**What we learned:** The hardest design problem was preventing cross-task file contamination. The solution: each sub-agent prompt explicitly receives both an allowed-files list AND a DO NOT TOUCH list. If an implementer's output references a file outside its ownership list, the Senior Architect rejects it before QA even sees it. This two-gate approach (Senior Architect + QA) is more robust than relying on QA alone.

**Status:** Skill written locally. No deployment needed (skill files are local to Claude Code).

## 2026-06-17 — /update-migrations skill + schema_migrations sync fix

**What changed:** Created a `/update-migrations` Claude skill that auto-applies pending SQL migrations to Supabase without any manual pasting into the web dashboard. Also diagnosed and fixed a discrepancy where 10 migrations (0045–0053, 0055) existed in Supabase but were absent from the `schema_migrations` tracking table.

**Where:** `.claude/skills/update-migrations/SKILL.md` (new skill file). No application code changed.

**Path we took:** User noticed `npm run migrate` was showing 10 pending migrations even though those migrations had already been applied manually via the Supabase SQL editor. Queried `schema_migrations` directly via the service role client and confirmed only 47 rows existed (0001–0044 + 0054), with a gap at 0045–0053 and 0055. Used `--mark` on each missing migration to record them without re-running the SQL, then verified the tracker was clean (57 applied · 0 pending).

**What we learned:** The `schema_migrations` table only gets a row when migrations are applied via `scripts/migrate.mjs`. Pasting SQL directly into the Supabase dashboard runs the DDL but doesn't touch the tracker — causing a permanent false-positive "pending" list. Going forward, `/update-migrations` (which calls `migrate.mjs --apply`) keeps both the DB schema and the tracker in sync automatically.

**Status:** Skill live locally. schema_migrations now fully in sync (57 applied, 0 pending).

---

## 2026-06-14 — Anthropic (Claude) monitor card + owner kill switch

**What changed:** Added an "Anthropic (Claude)" card to the Monitor page, mirroring the Vercel card (Anthropic has no usage/rate-limit API, so it links out to `platform.claude.com/dashboard`). The card carries a **sliding toggle that actually pauses all server-side Claude usage** — not just a cosmetic switch.

**Where:**
- **DB** — new migration `0043_anthropic_killswitch.sql` seeds `app_settings.anthropic_enabled = {"enabled": true}`. (Not required to deploy — code fails-open to enabled and the toggle upserts the row on first flip — but seed it for cleanliness.)
- **Server gate** — `api/admin/_auth.js`: added `isAnthropicEnabled()` (reads the flag via service role, **fails open** so a DB hiccup never breaks AI features) + `ANTHROPIC_PAUSED` 503 body. Wired into the three real Claude consumers:
  - `api/generate.js` — only the `anthropic` provider branch (OpenRouter still works) → 503 when paused.
  - `api/ai/ask.js` — FAQ-bot synthesis branch degrades gracefully to the fallback answer; high-confidence direct FAQ answers still work (no Claude needed).
  - `api/ai/suggest.js` — daily suggestions cron → 503 when paused (the `action=insights` pass uses a free OpenRouter model and is intentionally NOT gated).
  - Note: `api/ai/_embed.js` imports Anthropic but actually uses OpenRouter embeddings — left untouched.
- **UI** — `src/pages/monitor.jsx`: new `AnthropicSection` component (dashboard link, live status line, sliding toggle, model/used-by/status rows). `src/pages/monitor.css`: `.mon-killrow` + `.mon-switch` styles.

**Path we took / what we learned:**
- First built a dedicated `api/admin/toggle-anthropic.js` endpoint — **deploy failed**: it pushed the function count past Vercel's **Hobby 12-function cap** ("No more than 12 Serverless Functions"). Deleted it and had the UI write the flag **directly to `app_settings` via Supabase**, gated by the existing "owner write app_settings" RLS policy (migration 0014). Zero functions added, equally secure (owner-only).
- **Rule reaffirmed: stay under 12 Vercel functions.** New owner-only mutations should prefer a direct RLS-gated Supabase write over a new `api/*` route.
- The toggle is optimistic and reverts + shows an error on write failure (e.g. a non-owner trying).

**Deployed:** `vercel --prod` succeeded, aliased to www.footagebrain.com.

## 2026-06-13 — Rocket.Chat integration (Phase 1 server + Phase 4 frontend)

**What changed:** Began deploying Rocket.Chat (Community) on Hetzner as internal team chat + WhatsApp omnichannel, replacing the never-deployed custom WhatsApp webhook. Added a "Team" tab (iframe-embeds chat.footagebrain.com) and an owner-only "+ New message" Outbox to the Inbox.

**Done this session:**
- **Phase 1 (server) — LIVE:** Added `mongodb` (mongo:6.0, replSet rs0) + `rocketchat` (rocket.chat:7) services to `deploy/hetzner/docker-compose.yml` on Hetzner, on the `internal` network (NOT `backend` as the plan said — that network doesn't exist here). MongoDB replica set initialized; Rocket.Chat **7.13.8** running, reachable at `localhost:3100` internally. Compose backed up to `docker-compose.yml.bak.rocketchat.*`.
- **Phase 3 (backend) — STAGED, not registered:** Wrote `backend/app/api/rocketchat.py` on the server (status/channels/messages/dm + a defensive whatsapp-send). NOT yet added to `app/api/__init__.py`, so the running backend is unchanged. Corrections vs plan: status probes `/api/info` (public) not `/api/v1/info` (404s on 7.x, needs auth); default `ROCKETCHAT_URL=http://rocketchat:3000` (internal port).
- **Phase 4 (frontend) — DONE, build green:** Removed all WhatsApp UI/fetches from `social-client.js`, `inbox.jsx`, `social-status.jsx`, `monitor.jsx`, `api/monitor/status.js`. Added `src/pages/team-chat.jsx` + Team tab in `app.jsx` (canView is fail-open, so no permission-catalog entry needed). Added Outbox panel + `sendOutbox` to `inbox.jsx` (phone→whatsapp-send, @user→dm).

**What we learned / surprises:**
- The plan assumed `backend/`, `deploy/` exist in this repo — they DON'T. All server work is SSH-only on Hetzner. There's a stale `backend-handoff/whatsapp.py` local stash but the real backend never had a whatsapp router (Phase 3a was a no-op).
- Reverse proxy is **Caddy**, not nginx. Caddy auto-handles WebSocket upgrades, so no manual upgrade headers needed for the chat vhost.

**Completed end-to-end (later same day):**
- DNS A record `chat.footagebrain.com → 178.105.14.144` added; Caddy vhost added (`reverse_proxy rocketchat:3000`), LE cert auto-issued — `https://chat.footagebrain.com` live.
- Phase 2 wizard done (admin acct, #general created). Admin PAT generated.
- Phase 3 wired: registered `rocketchat.router` in `backend/app/api/__init__.py`; added `ROCKETCHAT_URL/ADMIN_TOKEN/ADMIN_USER_ID` to `.env` + compose passthrough; rebuilt + restarted backend. `GET /api/auth/rocketchat/status` → `{"connected":true,"version":"7.13"}`; `/channels` returns #general (auth works).
- Phase 5: `vercel --prod` deployed; www.footagebrain.com 200. Team tab + Outbox live.

**Mid-session incident — site appeared down:** Porkbun DNS had reset to parking — apex was on stale Vercel IPs and a `*` wildcard CNAME + apex ALIAS both pointed at `uixie.porkbun.com` (Porkbun parking → "A Brand New Domain!" page). Fixed in Porkbun: apex → `A 76.76.21.21`, `www` → `CNAME cname.vercel-dns.com`, deleted the `*` wildcard. api/chat A-records were untouched. Site restored.

**Still TODO (optional):** Rocket.Chat omnichannel WhatsApp not yet enabled, so the Outbox `whatsapp-send` returns a 501 "not enabled yet" until Admin → Omnichannel → WhatsApp is configured. Team-member accounts (Judy/Jay/Leroy) not yet created. The `/dm` path works now.

## 2026-06-11 — Instagram per-reel analytics grid + detail panel

**What changed:** The Analytics tab now shows an "Instagram Reels" card with a 12-reel thumbnail grid (9:16 aspect ratio, like/comment counts). Clicking any reel opens a fixed right-side panel with the reel thumbnail, caption, permalink, and a horizontal bar chart of 8 lifetime metrics: reach, views, likes, comments, shares, saves, total interactions, avg watch time.

**Where:**
- Hetzner backend — `backend/app/api/instagram.py`: added `GET /api/auth/instagram/media` (lists 12 recent reels) and `GET /api/auth/instagram/media/{media_id}` (per-reel lifetime metrics). Both reuse `_pick_ig_page()` + `appsecret_proof` from the existing insights pattern. Image rebuilt + `fb-backend` restarted.
- Frontend — `src/lib/social-client.js`: added `fetchInstagramMedia()` + `fetchInstagramMediaDetail()`.
- Frontend — `src/pages/analytics.jsx`: new `igMedia` + `selectedReel` state, fetch calls in `useEffect` + `refreshConnections`, "Instagram Reels" card, `handleReelClick` callback, `ReelDetailPanel` component + `REEL_METRICS` constant. Deployed via `vercel --prod`.

**Path we took:** Appended routes to the container's `instagram.py` via `docker exec python3`, then copied updated file to the host source and rebuilt the image. First attempt used `impressions` as a metric — Meta rejected it for Reels. Second attempt used `plays` — also rejected. Read the error message's valid-values list and landed on `reach,likes,comments,shares,saved,total_interactions,views,ig_reels_avg_watch_time` as the correct Reels-compatible set.

**What we learned:** (1) Meta's IG Graph API does NOT support per-day media insights — only lifetime totals (`metric_type=total_value`). True retention curves (watch time over days) are not available, unlike YouTube. (2) Valid metrics for Reels differ from regular posts — `impressions` and `plays` are rejected; use `views` + `ig_reels_avg_watch_time` instead. (3) Metrics may return 0 for older reels — Meta's insights window expires on lower-traffic or older content. (4) Always check the error message's `valid_values` list rather than guessing metric names.

**Status:** Live on prod. Metrics show 0 on all reels currently — likely because the stored Facebook token was granted before `instagram_manage_insights` was in scope, or the content is old enough that Meta's window expired. Reconnecting Facebook should fix the former.

---

## 2026-06-11 — Remove deprecated `pages_messaging` scope (unblock Facebook connect)

**What changed:** Facebook OAuth no longer requests the `pages_messaging` permission, which Meta deprecated from standard Facebook Login. This cleared the "Invalid Scopes: pages_messaging" error that was blocking all social account connections.

**Where:** Hetzner backend — `deploy/hetzner/.env` (added `FB_SCOPES=...` without `pages_messaging`) and `deploy/hetzner/docker-compose.yml` (added `FB_SCOPES: ${FB_SCOPES:-}` passthrough under `backend.environment`). Source default in `backend/app/core/config.py` still hardcodes it but is now overridden by env. Container `fb-backend` recreated.

**Path we took:** Read the error → traced scopes to the backend `fb_scopes` setting → chose the env-override route over editing the baked-in default (survives image rebuilds, no source change). Discovered the running compose file maps `FB_*` vars individually rather than via `env_file`, so we had to add a matching `FB_SCOPES` passthrough line for the var to reach the container, then `docker compose up -d backend` (not just `restart`, which doesn't re-read env). Verified the live `/facebook/login` redirect's `scope=` param no longer contains `pages_messaging`.

**What we learned:** (1) Meta removed `pages_messaging` from standard FB Login — it now needs App Review as an advanced permission. (2) pydantic `BaseSettings` (case-insensitive) lets an env var override the config.py default. (3) This stack's compose maps `FB_*` individually, so adding a var to `.env` alone is NOT enough — it needs a compose `environment` passthrough too. (4) `docker restart` keeps old env; env changes require `up -d`.

**Status:** Live on prod. Side-effect: FB/IG **DMs are disabled** until `pages_messaging` is restored via Meta App Review (comments unaffected).

---

## 2026-06-11 — Fix Instagram Page selection (`_pick_ig_page`)

**What changed:** Instagram now connects correctly. The backend resolves the Instagram account from whichever Facebook Page actually has one linked, instead of blindly using the first Page.

**Where:** Hetzner backend — `backend/app/api/instagram.py` (new `_pick_ig_page` helper; `status`, `insights`, `comments` endpoints switched from `_pick_page` to it). Image rebuilt + `fb-backend` restarted.

**Path we took:** `instagram/status` returned `no_ig_account` even though connect succeeded. Queried the Graph API directly with each Page's stored token and found `paulvictortravels` (ig id `17841459136265439`, ~1155 followers) **is** linked — to Page *Paul Victor* (`108771260648482`), which is `pages[1]`, not `pages[0]`. Root cause: `_pick_page` returns `pages[0]` (*Samuel Paul Victor*, no IG). Added `_pick_ig_page` that probes every Page for a linked `instagram_business_account` and returns the first match (falls back to `_pick_page` so a no-IG state still reports cleanly). Verified live status flipped to `connected: true`.

**What we learned:** (1) The IG link was never the problem — earlier passkey/redirect_uri/Business-Suite troubleshooting chased a non-issue. Always verify the actual Graph-API link state before assuming a Meta-side setup gap. (2) `_pick_page`'s `pages[0]` default is fragile for multi-Page accounts. (3) The stored token file uses key `page_access_token` (not `access_token`), and Graph calls need `appsecret_proof` (HMAC of token with app secret).

**Status:** Live on prod, verified (`paulvictortravels`, 1,155 followers, 104 posts).

---

## 2026-06-11 — Fix Instagram insights metric format (`metric_type=total_value`)

**What changed:** Instagram analytics now return real data — a 30-day daily `reach` series plus a `profile_views` total — instead of an empty `insights: []`.

**Where:** Hetzner backend — `backend/app/api/instagram.py` insights endpoint. Image rebuilt + restarted.

**Path we took:** After the Page-selection fix, insights still came back empty with `(#100) ... profile_views should be specified with parameter metric_type=total_value`. Probed the Graph API to see each metric's behavior: `reach` still supports a daily `period=day` time-series, but `profile_views` now only works with `metric_type=total_value` and returns a single aggregate (no per-day breakdown). Rewrote the endpoint to make two calls — `reach` (daily, drives the chart + views KPI) and `profile_views` (30-day total) — and attribute the total to the last row so the frontend's existing per-row engagement sum stays correct without a frontend change. Added `profile_views_total` to the payload.

**What we learned:** (1) Meta changed IG account-level insights: `profile_views` (and several others) moved to the `total_value` aggregate form; account-level `impressions` is deprecated, `reach` remains a stable time-series. (2) Keeping the response shape stable (`insights[]` rows with `day`/`reach`/`profile_views`) let us fix the backend without redeploying the Vercel frontend.

**Status:** Live on prod, verified (30 reach rows + 163 profile views).

---

## 2026-06-11 — Add `wrap-up` / `continue` session-handoff system

**What changed:** New `/wrap-up` skill (refreshes HANDOFF.md, appends per-change CHANGELOG entries, syncs memory, updates CLAUDE.md) and `/continue` skill (loads handoff + recent changelog + memory to resume with full context). CLAUDE.md now has a "Resuming a session" block so the bare word "continue" also bootstraps context.

**Where:** `~/.claude/skills/wrap-up.md` (global), `.claude/skills/continue.md` (project), `CLAUDE.md` (resume/wrap-up block), plus this `CHANGELOG.md` and `HANDOFF.md` seeded at project root.

**Path we took:** Inspected existing skill conventions (`session-close.md`, `log-change.md`) to match format. Chose project-root for HANDOFF/CHANGELOG (committed, team-visible) and made `wrap-up` supersede the older `session-close`. Added the CLAUDE.md rule because a plain-text "continue" can't auto-fire a slash skill on its own.

**What we learned:** Bare-word triggers ("continue", "wrap up") need an instruction in CLAUDE.md to reliably load the right skill/files — the slash command alone isn't enough when the user just types the word.

**Status:** Live in the repo (not a deploy — tooling/config only).
