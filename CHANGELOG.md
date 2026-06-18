# Changelog

Durable record of changes to the Workflow / FootageBrain app — newest first. Each entry captures *what* changed, the *path we took*, and *what we learned*. Maintained by the `/wrap-up` skill.

---

## 2026-06-19 — Playwright installed + first smoke-screenshot harness; Reel DNA tab verified healthy

**What changed:** Stood up browser automation for the project (it had none) and used it to visually verify the **Reel DNA** dashboard tab. Added `@playwright/test` + Chromium as a devDependency and a small ad-hoc script that loads a saved login session, opens the authed dashboard at `/app`, waits out the "LOADING WORKFLOW…" hydrate splash, clicks/lands on Reel DNA, screenshots it, and reports console + uncaught page errors. Outcome: **Reel DNA renders fine — capture form, Reels/Thumbnails sub-tabs, IG Sync Health panel, and the ~28-row captured-reels spreadsheet all paint correctly; no crash, no error boundary, no uncaught page errors.** This is the first concrete piece of the Playwright smoke harness the 2026-06-19 restructure audit flagged as the highest-leverage missing gate.

**Where:** `package.json` / `package-lock.json` (devDep), `scripts/smoke-screenshot.mjs` (new, the harness), `.gitignore` (added `auth.json` + `screenshots/`). No app code, no DB, no deploy. `auth.json` (saved Supabase session, 11 cookies + localStorage for localhost:8000) and `screenshots/` are gitignored.

**Path we took:** Confirmed first that there were **no Playwright browser tools in this session** (only the vidIQ MCP) **and no Playwright in the project** — so a screenshot was impossible without installing it; said so instead of faking output. Owner approved install. Auth was the wall: the dashboard is behind Supabase login, so used `npx playwright codegen http://localhost:8000 --save-storage=auth.json` (run in background so it wouldn't time out) — owner logged in once in the real browser window and closed it, persisting the session to `auth.json`. First authed run hit `/app` but screenshotted "LOADING WORKFLOW…" (store still hydrating); fixed by polling for the tab strip / shell-ready instead of a fixed wait. The app restored the owner's last view, so it opened directly on Reel DNA.

**What we learned:** (1) **Root `/` is the public 3D landing page; the authed dashboard is `/app`** (lazy `Landing` outside the `AuthGate` in `app.jsx`; `isLanding = pathname === "/"`). (2) **`networkidle` never fires** on this app — the R3F landing keeps a render/animation loop busy; use `domcontentloaded` + an explicit wait for a real element. (3) The shell gates on an **all-or-nothing store hydrate** ("LOADING WORKFLOW…"), so screenshot scripts must wait for the tab strip to appear, not a timer. (4) **One real (minor) finding:** the Reel DNA drag-to-bookmark "capture a reel" control is an `<a href="javascript:…">` ([src/pages/reel-dna.jsx:1197](src/pages/reel-dna.jsx#L1197)) → React logs *"A future version of React will block javascript: URLs"*. Works today; non-breaking; worth migrating before a React major. (5) Reminder honored: dev (port 8000) hits the **live shared Supabase DB**, so this was read-only navigation/screenshots — no writes.

**Status:** **Done (local only).** Playwright + script present, not committed, not deployed. Reel DNA verified healthy. Follow-ups: optionally flesh the script into a multi-tab smoke test; fix the `javascript:` bookmarklet warning.

---

## 2026-06-19 — Repo hygiene (worktree prune) + codebase-restructure readiness audit

**What changed:** No application code, DB, or deploy. Two things: (1) pruned all **10 stale `.claude/worktrees/agent-*` worktrees** plus their 10 `worktree-agent-*` branches, and (2) ran a **4-subagent audit** of the codebase to produce a prioritized "critical things to note before restructuring the entire codebase" inventory (the session's durable output).

**Where:** `.claude/worktrees/` (all removed) + local git branches; findings logged to `obsidian-vault/05 - Roadmap/Session Log.md` and memory `reference_restructure-readiness.md`. Working tree clean, `main == origin/main == 747c4cd`.

**Path we took:** Inspected each worktree with `git -C <wt> status --short` before removing — all 10 were based on old commits (`2c29b06`/`e3a345c`, far behind main) with edits referencing long-superseded migrations 0036–0038, so confirmed throwaway → `git worktree remove --force` ×10 + `prune`, then `git branch -D` the matching `worktree-agent-*` branches. For the audit, dispatched 4 parallel agents (build/deploy/infra · app architecture & import graph · DB/RLS/migration coupling · git/worktree/hidden hazards) and synthesized. When the owner asked "will the steps leave red flags?", gave a second-order risk analysis distinguishing the git/build/path failure class (the steps fix it) from the runtime-regression class (inherent — no tests, no staging, full-tree deploy, shared live DB).

**What we learned:** (1) **`refactor/folder-structure` is a trap** — 61 commits behind main, 0 ahead; merging it would delete migrations 0068–0076, `tools/capcut-agent/`, and the current `vercel.json` (~63k deletions). Branch fresh from `main`. (2) **`npm run build` is the only gate and it's necessary-but-not-sufficient** — it proves imports compile but can't see runtime regressions (realtime channel names, deep-link parsing, reducer side-effects, person-slot fallbacks are all string/runtime-coupled). (3) **Add a `@/` Vite alias + `jsconfig.json` as step 1** before any file moves, else every move cascades through `../` rewrites (hubs: `store.jsx` ~34 importers, `roster.jsx` ~17, `shared-data.jsx` ~9). (4) Migration paths are hardcoded in 3 scripts + regenerated into the shipped `api/monitor/migrations.manifest.json`; never relocate `supabase/migrations/`-or rename applied files (keyed on filename + SHA256). (5) Vercel function cap is at **12/12** — the `api/` layer can be moved but not expanded. (6) The single highest-leverage addition *not* in the plan is a thin Playwright smoke-test harness to convert "trust manual testing" into an objective gate. (7) `git worktree remove --force` discards a dirty worktree's edits permanently — scan status first (did so).

**Status:** **Done** — worktrees pruned, audit documented. No deploy. Restructure itself not started (awaiting owner go-ahead).

---

## 2026-06-19 — 🔴 INCIDENT: `people` RLS infinite recursion (caused by 0076), found + fixed live

**What changed:** Restored the live site after migration 0076's `"owner manage people"` policy took it down. The policy was **on** `public.people` yet its `USING`/`WITH CHECK` did `select … from public.people`, so Postgres re-evaluated `people`'s policies while evaluating that one → **"infinite recursion detected in policy for relation people"** on *every authenticated read* of `people`. That's what the owner hit as "Instagram IG analyze won't update." Fixed by moving the owner check into a `SECURITY DEFINER` function `public.auth_is_owner()` (runs as the table owner → bypasses RLS on `people` → no recursion); the policy now calls that function.

**Where:** live DB (dropped + recreated the policy, added `auth_is_owner()`), `supabase/migrations/0076_rls_hardening.sql` (file updated to the helper-based version + re-marked to match live checksum). Committed `238759b`.

**Path we took:** Owner reported the error mid-session → recognized it as a direct consequence of the 0076 §1 owner-manage policy I'd just applied → wrote a staged fix script (drop the recursive policy first to guarantee restore, then re-add via the helper, with a fallback that leaves the safe drop-only state if the helper version still recursed). An anon probe was a false "OK" (the policy is `to authenticated`, so anon never triggers it) — had to verify under a **real authenticated session** minted via the admin `generateLink → verifyOtp` flow (no JWT secret needed): `select people → 7 rows, no recursion`.

**What we learned:** (1) **An RLS policy ON a table must never directly query that same table** — it recurses. The fix is a `SECURITY DEFINER` helper owned by the table owner (bypasses RLS). The same owner-gate `exists(select … from people where … role='owner')` is *fine* on other tables (app_settings etc.) precisely because they're a different relation; it only recurses when the policy and the subquery target the same table. (2) **Test RLS as the right role** — an `anon`-key probe silently passes `to authenticated` policies; reproduce the failing path with an actual authenticated token. (3) The IG *poller* uses the service-role key (bypasses RLS), so ingestion was never affected — only the authenticated app read path.

**Status:** **LIVE — production restored + verified.** Committed `238759b`, pushed to `origin/main`.

---

## 2026-06-19 — Migration 0076 drift reconciliation: phantom-applied 0049 discovered; apply §1/§3/§4, defer §2

**What changed:** Applying 0076 failed with `function public.is_demo_user() does not exist`. A full live-DB audit (tables/functions/indexes/columns/policies/constraints) revealed **`0049_demo_sandbox.sql` was recorded in `schema_migrations` but never actually ran** — `is_demo_user()`, the `demo` columns, the per-operation `reels_delete`/`cards_delete`/`tasks_delete` policies, and `seed_demo`/`reset_demo` are all absent; reels/cards/tasks still carry the older blanket `"auth read"/"auth write"` policies. Drift was **isolated to 0049 only** — every other migration 0050→0075 is genuinely present. Per owner decision, applied 0076 **§1** (people privilege-escalation fix), **§3** (`attached_footage_items` authenticated-only), **§4** (`reel_dna` owner-or-`captured_by`-self) — all verified live — and **deferred §2** (owner-only DELETE), which depended on 0049's absent schema. Un-marked 0049 in tracking (now honestly `[pending]`) and added a `DO-NOT-BULK-APPLY` guard header to the file.

**Where:** live DB (0076 §1/§3/§4 applied; 0049 tracking row removed), `supabase/migrations/0076_rls_hardening.sql` (§2 body replaced with a deferred note), `supabase/migrations/0049_demo_sandbox.sql` (guard header), `api/monitor/migrations.manifest.json` (regenerated, 78 entries). Committed `5ddb520`.

**Path we took:** `npm run migrate:apply` errored mid-file → confirmed via `exec_sql` semantics that each file runs in ONE plpgsql call so the failure rolled back atomically (the "no transaction wrapper" comment was misleading) → wrote throwaway introspection scripts to dump the live catalog and a per-migration signature audit → `AskUserQuestion` to choose reconciliation strategy (owner picked "just fix tracking, defer §2") → edited 0076 to §1/§3/§4 only, applied (sole pending file so 0049 wasn't touched), then deleted the 0049 tracking row.

**What we learned:** (1) **`schema_migrations` can lie** — a migration can be marked applied without its objects existing (likely a past `--mark`/baseline). Don't trust the ledger; the live catalog is ground truth. (2) Un-marking 0049 makes it `[pending]`, so the next bulk `migrate:apply`/`/update-migrations` would build the unused demo sandbox against prod — hence the loud guard header (and item deferred per owner). (3) `exec_sql` (SECURITY DEFINER, `execute sql`) gives each migration file atomic all-or-nothing apply — a real safety net the docs undersold.

**Status:** **LIVE** — 0076 §1/§3/§4 applied + verified; §2 + 0049 demo sandbox deferred. Committed `5ddb520`, pushed.

---

## 2026-06-19 — Cleanup batch DEPLOYED (C1 Hetzner poller + C2 Vercel store fix) + pushed

**What changed:** Took the prior cleanup batch (committed `d930896`) live. **C2** (`persistUpdateReelDna` `contentType`→`content_type` remap) deployed via `vercel --prod` (`dpl_2YX69tRfyUmx1S7PKHocPSwged2p`, READY). **C1** (`ig_webhook.py` cross-platform link ingest: URL-host platform detect + plain-text URL capture) deployed to Hetzner (`scp` → `docker compose build/up backend`), verified `200` with `ingest_enabled:true`. 17 local commits (plus the two fixes above) pushed to `origin/main` + the `ig-ingest-reconcile-contenttype` branch.

**Where:** Hetzner `/srv/footagebrain/footage-brain-test/backend/app/api/ig_webhook.py` (remote backup `.bak-pre-c1` left for rollback) + backend image rebuild; Vercel prod; `origin/main`.

**Path we took:** Validated `ig_webhook.py` syntax + SSH access first, md5-compared remote vs local (confirmed a real change), backed up the remote file, then scp + rebuild + restart + verify `/api/ig/status`. External `curl` from the local Bash env returned `000` (TLS connect error) for BOTH `api.footagebrain.com` and `footagebrain.com` — but the same endpoints return `200` from the Hetzner box and the Vercel/Supabase node calls worked, so it's a **local curl-TLS quirk, not an outage**; the box's own external request is the authoritative check.

**What we learned:** (1) The Bash tool's `curl` can't complete TLS to these domains from this machine (`exit 35`) even though node-based HTTPS works — don't read prod health from local `curl`; verify from the server or via a node client. (2) `docker compose up -d backend` recreates the container but Caddy re-resolves the upstream fine (no proxy reload needed here).

**Status:** **LIVE** — C1 + C2 deployed + verified, `main` + branch pushed.

---

## 2026-06-19 — Cleanup batch: cross-platform IG-DM ingest + content_type persistence + RLS hardening (committed, NOW DEPLOYED — see entries above)

**What changed:** A housekeeping pass via `/workflow` (3 disjoint components, one wave) addressing loose ends from the parallel-agent IG session. **C1 (`backend-handoff/ig_webhook.py`)** — IG-DM ingest now (a) derives `platform` from the URL host (`yt`/`fb`/`tiktok`/`ig`) on all three insert paths instead of hardcoding `"ig"`, (b) gives the webhook path content_type parity with the poller, and (c) **captures plain-text URLs** pasted into a DM — previously the poller acted only on messages with a `shares` edge, so a pasted YouTube/Facebook link was silently dropped. **C2 (`src/store/store.jsx`)** — `persistUpdateReelDna` now maps `contentType` → `content_type`, so in-app content_type corrections actually persist (they updated local state then vanished on reload). **C3 (`supabase/migrations/0076_rls_hardening.sql`, new)** — backs the UI permission gating with real RLS: closes a `people` privilege-escalation hole, makes reel/card/task DELETE owner-only (preserving the demo predicate), fixes `attached_footage_items` `using(true)` → authenticated, and scopes `reel_dna` writes to owner-or-`captured_by`-self.

**Where:** `backend-handoff/ig_webhook.py` (+57/-3: `_detect_platform`, `_content_type_from_url`, text-URL capture in the no-`shares` branch), `src/store/store.jsx` (+1: the `contentType` remap branch), `supabase/migrations/0076_rls_hardening.sql` (new, ~255 lines). Committed `d930896`. Discord→RocketChat alert fix deferred by owner.

**Path we took:** `/qa-verified-plan` (plan `.claude/plans/i-have-a-big-logical-pixel.md`) → 3 parallel Explore agents (Discord/RC bug; git/sync state; bug hunt) → 2 more Explore agents (cross-platform link ingest feasibility; UI-gating-vs-RLS audit) → `/workflow` with one Senior Architect + dedicated adversarial QA per component under locked file ownership. Plan-mode initially blocked the agents from writing (they only designed); after exiting plan mode the same agents re-ran to implement. Integration build green (8.71s).

**What we learned:** (1) **The real reason YT/FB DM links don't appear in Reel DNA is two-fold** — the poller skipped any message without a `shares` edge (so pasted external links were never seen), *and* platform was hardcoded `ig`. Both fixed; but whether Meta's Graph API even returns the DM `message` text body for the Page IG inbox is still UNVERIFIED — only an empirical DM-test after the Hetzner deploy confirms it (inspect `ig_ingest_log`). (2) **The UI's own permission gating was never enforced at the DB** (Roles Admin literally says so) — the highest-risk hole was the `people` table letting any authenticated user INSERT `role='owner'`; a naïve RLS `WITH CHECK (role = role)` self-promotion guard is a no-op because the check only sees the proposed NEW row, so 0076 uses a `BEFORE UPDATE` trigger (service_role exempt) to pin `role`/`id`. (3) **A general verbal "do these steps" does NOT lift the safety system's per-action gates** — applying migration 0076 (live DB) and `git push origin main` (default branch) were both blocked by the classifier this session despite owner authorization; they need explicit per-action authorization or a Bash allow rule. Surfaced rather than routed around.

**Status:** **Committed `d930896` (local main fast-forwarded to it), NOT deployed.** Pending human-gated actions: apply migration `0076` (`/update-migrations`), deploy `ig_webhook.py` to Hetzner, `vercel --prod` for the store fix, and `git push origin main` (15 commits unpushed). See HANDOFF.

---

## 2026-06-18 — Reel DNA: "Check IG Sync" button — on-demand reconciliation report (LIVE)

**What changed:** A 🔎 **Check IG Sync** button in the Reel DNA toolbar. Clicking it re-pulls the poller's run history + per-message issue log from Supabase and opens a report: **what landed in the sheet** (new / deduped / seen + total IG-DM rows), **coverage this run** (conversations / messages / skipped / graph + insert errors), and **every logged issue** with its type badge + detail text (e.g. the `graph_error` "messages fetch: 500 …subcode 99"). Separate from **Refresh** (which forces a brand-new poll) — Check just inspects what's already recorded.

**Where:** `src/store/store.jsx` (`reloadIgSync()` action + `SET_IG_SYNC_RUNS`/`SET_IG_INGEST_LOG` reducers), `src/pages/reel-dna.jsx` (button, handler, `igDmCount`, expandable report; `IgSyncHealth` now takes `igDmCount`/`open`/`onToggle`), `src/pages/reel-dna.css` (report grid + issue-badge styling).

**Path we took:** Modest-scope UI built inline (no workflow) on the reconciliation plumbing from the change below — the panel, state, and realtime channel already existed; this added an explicit fetch + detail view. Build green (8.80s).

**What we learned:** The realtime channel keeps the panel fresh passively, but an owner "check on demand" needs an active DB re-pull because a sleeping tab / dropped socket can miss run rows — so the button doesn't trust in-memory state.

**Status:** **LIVE** — committed `0b244d9`, deployed (`vercel --prod` `dpl_CmqkcozUP93USUyGQqvXita362dH`), pushed.

---

## 2026-06-18 — IG DM reconciliation/monitoring + non-reel content-type ingest (LIVE; Hetzner poller deployed + verified)

**What changed:** Three-part batch on the Reel DNA pipeline. **(A) Reconciliation/monitoring** — every IG DM the Graph API returns is now either captured or logged with the *reason* it wasn't; a new **IG Sync Health** strip shows the last poll's seen-vs-accounted counts, a red Mismatch badge, and an amber "coverage may be incomplete" caveat when Graph caps/errors hit; owner Discord alert on mismatch. **(C)** The IG poller now captures **carousels, photos, and stories** (not just reels) and classifies each via `content_type`; new **Type** column + filter on the spreadsheet. **(B)** `docs/ig-crosspost-feasibility.md` — a writeup of FB/YT→IG cross-post options/limits (no build, by request).

**Where:** new migrations `0073_ig_sync_runs.sql`, `0074_ig_ingest_log.sql`, `0075_reel_dna_content_type_extend.sql` (`content_type += story/video`); `backend-handoff/ig_webhook.py` (Hetzner poller — all-shares capture with composite `external_ref={mid}:{i}`, per-message issue logging, run-summary + reconciliation, `_classify_content_type`, `_post_sync_alert`); `src/store/store.jsx` (`igSyncRuns`/`igIngestLog` state + mappers + reducers + `ig-sync-realtime` channel); `src/pages/reel-dna.jsx`/`.css` (panel, Type column/badge); `src/lib/reel-dna.jsx` (`CONTENT_TYPES`/`contentTypeLabel`); `src/lib/reel-dna-filters.jsx` (Type select); `api/ai/suggest.js` (`?action=ig-sync-alert`).

**Path we took:** `/qa-verified-plan` (3 AskUserQuestion forks: B = writeup-only, C = carousels/photos/stories, A = panel + Discord + error-log) → plan at `.claude/plans/use-qa-verified-plan-for-sending-ethereal-hinton.md` → committed the prior local Reel DNA batch on `main` (`f24421f`) and branched `ig-ingest-reconcile-contenttype` for a clean baseline → `/workflow` (5 disjoint components, 2 waves) built it green → applied migrations to live DB → deployed frontend → deployed the updated poller to Hetzner (`scp` + `docker compose build/up`) and verified a live sync run.

**What we learned:** (1) **IG's true new-DM total is unknowable via the polling API** — reconciliation can only assert "captured == seen *this run*"; conversation/message caps, the ext-ref preload limit, and Graph errors all hide DMs silently, so the panel surfaces an amber coverage caveat rather than letting green imply completeness. (2) The **first live sync proved it**: 24 shares all deduped (healthy) but **`graph_errors: 3`** — Instagram's conversations/messages edge intermittently 500s with `error_subcode:99`, logged as a `graph_error` row. A concrete cause of "some DMs aren't recorded." (3) **Multi-share dedupe**: items past the first need composite `external_ref={mid}:{i}` and the `known`-set check must move off bare `mid`, or every poll re-inserts. (4) **Prod-backend SSH writes and live DB migrations are human-gated** by the safety system — they needed explicit owner authorization this session (a blanket `Bash(*)` allow doesn't cover hard-to-reverse production actions). Surface denials to the owner rather than routing around them.

**Status:** **LIVE** — migrations applied, frontend deployed, Hetzner poller deployed + verified (`/api/ig/status` ingest_enabled:true, first run row reconciled). Committed `e4e7823`, pushed. **Follow-up:** Discord notify is currently broken (owner will fix); the IG mismatch alert then needs `APP_BASE_URL=https://footagebrain.com` set on Hetzner (`.env` + compose passthrough).

---

## 2026-06-18 — Locations map: classic Marker (Maps crash fix) (LIVE)

**What changed:** The Locations map uses the classic Google Maps `Marker` instead of `AdvancedMarker`, fixing a Maps crash.

**Where:** `src/pages/locations.jsx` (committed `532d227`).

**Path we took:** Landed during the IG workflow session window; isolated and unrelated to the IG work, shipped in the same prod deploy.

**What we learned:** `AdvancedMarker` requires a Map ID + the marker library loaded; the classic `Marker` avoids that dependency and the crash.

**Status:** **LIVE** — shipped in the same `vercel --prod`.

---

## 2026-06-18 — Reel DNA bug-batch: 7 fixes shipped via a generated multi-agent workflow (LOCAL — built green, not deployed)

**What changed:** A 7-issue fix/feature batch on the Reel DNA tab: (1) **column-header filters keep focus** while typing a whole word (were kicking out after 1 char); (2) **attaching one asset no longer spawns duplicates**; (3) **footage rows now render a thumbnail + Google Drive link** when present; (4) the **Thumbnail DNA spreadsheet view** now mirrors the Reels grid (removed the thumbnail image, the "Playlist" badge, and the timestamp); (5) **column filter headers persist when a filter matches 0 rows** (you can still see/clear the filter); (6) **Send-to-Pipeline migrates assets** — footage copied into `attached_footage_items`, locations appended to `linked_reel_ids`, news upserted into `monitor_event_links`, plus new read-only **Thumbnails / News / "From Reel DNA — Notes & Tags"** boxes in the pipeline reel's left column; (7) a **"Hide all assets" toggle** next to the gallery global search collapses every card's assets to main details.

**Where:** `src/pages/reel-dna.jsx` (hoisted `TextCell`/`SelectCell` out of `ColumnFilterRow`; `DnaTable` empty-row notice), `src/components/reel-dna-comprehensive.jsx` (grid always renders the table; `hideAllAssets` state + toggle), `src/components/unified-dna-card.jsx` (optional `hideAssetsOverride` prop), `src/store/store.jsx` (`UPSERT_REEL_DNA_ASSET` composite-key dedupe; `sendReelDnaToPipeline` asset migration), `src/components/reel-assets.jsx` (footage thumbnail via `footageBrainThumbnailUrl` + Drive link), `src/pages/thumbnail-dna.jsx` (spreadsheet row trim, `ThumbPreview` export kept), `src/pages/detail.jsx` (left-column hook), `src/components/pipeline-dna-assets.jsx` (NEW — read-only DNA-asset boxes for the pipeline detail). Generator: `.claude/workflows/reel-dna-bug-batch.js` (NEW).

**Path we took:** Ran `/qa-verified-plan` → deep Explore/Read pass root-caused all 7 issues (plan at `.claude/plans/use-qa-verified-plan-in-the-composed-treehouse.md`); two AskUserQuestion forks resolved (physically migrate footage+locations AND add display boxes; hide-toggle default off, session state). Then `/workflow-file-creation` authored a self-contained 4-team workflow under locked disjoint file ownership (Team A grid/gallery, B store, C footage render, D thumbnail+pipeline), with frozen cross-team contracts (K1–K5), per-team adversarial QA + a single integration build gate, and a bounded fix loop. The workflow ran ~19 min; `npm run build` green (✓ 19.57s); user testing on localhost:8007.

**What we learned:** (1) The duplication root cause was a **key mismatch**: `reel_dna_assets.id` is `gen_random_uuid()`, but `attachAsset` dispatches an optimistic row keyed `${reelDnaId}:${assetType}:${assetId}` while the realtime echo carries the DB uuid — the reducer deduped by `id` only, so both rows survived and the resolver emitted the asset twice. Fix = dedupe by the composite business key. (2) Issue 5 ("headings disappear") was the comprehensive view replacing the **whole** `DnaTable` (header + filters included) with an empty `<div>` at 0 results. (3) The footage thumbnail/Drive fields already existed (`thumbnail_url`/`drive_url` on `attached_footage_items`) and a working render pattern lived in `AttachedFootageList.jsx` — the fix was reuse, not new data. (4) **Workflow build-gate gotcha:** running `npm run build` from many parallel agents clobbers the shared `dist/` and produces false failures, so the generated workflow centralizes the build to single-agent steps (integration QA + re-QA) only.

**Status:** **LIVE** — deployed via full-tree `vercel --prod` (`dpl_7yr9At3svKX7V74N7XKz41DkejwB`, READY, aliased www.footagebrain.com). Build green; **committed `f24421f` on `main`** (2026-06-18, as the clean baseline before the IG-ingest branch).

---

## 2026-06-18 — Training manual: YouTube embed state now persists (LIVE)

**What changed:** In the Training manual, clicking a YouTube link's **Embed** toggle to reveal the inline player now **persists** — the player stays open after clicking away / collapsing the module / refreshing, and the owner's choice shows for every editor. Previously the embed was local component state that reverted the instant the component re-rendered, so it looked like "the setting doesn't save."

**Where:** `src/lib/linkify.jsx` (`YoutubeEmbedLink` now seeds from / re-syncs to an `embedded` prop and fires `onToggleEmbed(url, next)` when flipped; `linkifyText(text, embedOpts)` forwards `{ embeddedUrls, onToggleEmbed }` — both optional, fully backward-compatible); `src/components/EditableText.jsx` (new optional `embeddedUrls`/`onToggleEmbed` props passed through to `linkifyText` in both the read-only and editable-not-editing branches); `src/pages/training.jsx` (`embedUrlsFor`/`toggleEmbed` helpers persist the embedded-URL set as a sibling `training_module_content` row keyed `"<fieldPath>::embed"` — a JSON URL array — riding the existing owner-write RLS + store; threaded a per-field `getEmbedProps()` through `ModuleCard` → `ProseBlock`/`ListBlock` + every inline `EditableText`).

**Path we took:** Read training.jsx → EditableText → linkify to trace the toggle. The link *text* already persisted via `setModuleContent`; only the embed-shown boolean was ephemeral (`useState(false)` in `YoutubeEmbedLink`). Chose to persist per-(module, field) into the same module-content store the text uses (rather than a new table or app_settings), so it shares RLS/load/realtime and shows for all editors. Used a `"::embed"` suffixed field path so the embed row is never rendered as prose (`resolveField` is only called for real field keys). `npm run build` green (815 modules); user verified on localhost; deployed `vercel --prod`.

**What we learned:** (1) The embed toggle and the manual text are two different persistence problems — the text was fine; only the toggle state leaked. (2) Storing UI sub-state as a suffix-keyed sibling row in an existing key/value content table avoids a migration entirely and inherits the table's RLS + realtime for free. (3) `linkifyText`'s new 2nd arg is optional, so the signature change is safe for all other callers (only `EditableText` calls it).

**Status:** **LIVE** — deployed to prod (`dpl_GGuS8FEC5azMBNf7twphPuGkv2Sm`, aliased www.footagebrain.com, 816 modules).

---

## 2026-06-18 — Roles & permissions: "Edit the training manual" capability (LIVE)

**What changed:** Added a per-person/per-role **"Edit the training manual"** toggle under Roles & permissions → Actions. Default **Off** for all editor roles (preserving today's owner-only behavior); the owner flips it On to grant a specific person edit access to the Training course content. Training's edit gate now reads this capability instead of a hard-coded owner check.

**Where:** `src/lib/permissions-catalog.js` (new `editManual` entry in `ACTION_CAPS`; `defaultPermsForRole` sets `actions.editManual = false` so editor roles default to restricted — owner always returns `true` via `can()`); `src/pages/training.jsx` (imports `usePermissions`; `canEdit = can("editManual")` replaces `me?.role === "owner"`). The toggle row auto-renders in the existing admin matrix — no roles-admin.jsx change needed.

**Path we took:** Modeled it as a real capability rather than a one-off button so it slots into the existing `VIEW_CAPS`/`ACTION_CAPS` matrix and persistence (app_settings, fail-open merge). Set the default to `false` for editor roles specifically so switching the gate from `me.role === "owner"` to `can("editManual")` changes nothing for existing users. Bonus: the owner's perspective-preview now correctly shows the restricted (read-only) Training view, matching how every other gated action behaves during QA preview.

**What we learned:** (1) `can(actionKey)` short-circuits to `true` when the effective role is `owner`, so an owner-only default is expressed by defaulting the cap `false` for the editable roles — not by special-casing owner. (2) The demo account stays read-only automatically (`DEMO_ACTIONS` is fail-closed and omits `editManual`). (3) Per the in-app amber disclaimer, this is UI-gating only — not yet DB-enforced.

**Status:** **LIVE** — shipped in the same `vercel --prod` (`dpl_GGuS8FEC5azMBNf7twphPuGkv2Sm`).

---

## 2026-06-18 — Training manual: linkify URLs + YouTube embed everywhere (LIVE)

**What changed:** In the Training manual, pasted URLs now render as clickable cyan links across **every** module section (not just the 3 prose blocks), and YouTube URLs get an inline **Embed** toggle that opens a small, right-aligned 16:9 player. Previously only *Why this matters / Skill definition / What good looks like* linkified — and even there the **owner never saw it** because owners always render in the editable branch. Now the owner sees links + embeds too, and link/embed clicks no longer drop the field into edit mode.

**Where:** `src/lib/linkify.jsx` (NEW — extracted `linkifyText` + `YoutubeEmbedLink` verbatim out of `training.jsx`; added `stopPropagation` on links/buttons; shrank the embed to a 260px right-aligned `min(260px,100%)` block using `<span display:block>` wrappers to avoid invalid `<div>`-in-`<span>` nesting); `src/components/EditableText.jsx` (new `linkify` prop, default off; applied in **both** the read-only branch and the owner editable-not-editing branch); `src/pages/training.jsx` (deleted the inline linkify defs; collapsed `ProseBlock`'s duplicated read-only `<span>` into a single `EditableText … linkify`; added `linkify` to `ListBlock` + every inline `EditableText` — gold/poor examples + breakdowns, exercise, checklist, pro tips).

**Path we took:** Planned in plan-mode (1 Explore + read of the two critical files), built inline (modest ~3-file scope). First pass only wired `linkify` into `EditableText`'s read-only branch — the user (owner) reported seeing nothing. Root-caused it: `canEdit = me?.role === "owner"` (training.jsx:40) means the owner **always** hits the editable branch, so the read-only-only linkify was invisible to them (and had been for the old prose blocks too). Fixed by also linkifying the editable-not-editing branch and `stopPropagation`-ing link/button clicks so the click-to-edit span doesn't fire. Then the user asked for a smaller, right-aligned player; shrank from full-width to 260px right-aligned. Verified the URL/YouTube regex parsing with a standalone node check (all 3 YT URL forms + plain links + mixed text); `npm run build` green; deployed `vercel --prod`.

**What we learned:** (1) `EditableText` has **three** render branches, not two — read-only (`!canEdit`), editing, and **editable-not-editing**; any "viewer-only" treatment is invisible to the owner unless it's also applied to the editable-not-editing branch. (2) `YoutubeEmbedLink` is rendered inside `<span>`/`<li>` contexts, so its expanded player must use `<span display:block>` not `<div>` to stay valid HTML. (3) When a clickable child lives inside a click-to-edit parent, the child needs `stopPropagation` or every link click also opens the editor.

**Status:** **LIVE** — deployed to prod (`dpl_3kuHzejE9WtFg3eTceZK2LEpqG6h`).

---

## 2026-06-18 — Reel DNA: comprehensive-only overhaul + bug batch (LOCAL, not deployed)

**What changed:** Reel DNA was reworked into a single, well-connected view and a batch of comprehensive-mode bugs were fixed. (1) **Removed the Classic view entirely** — no more Classic/Comprehensive toggle, status/source pills, Cards/Spreadsheet sub-toggle, `unified_cards` flag gate, or the legacy `DnaCard` component. Comprehensive is now the only view. (2) **Removed the left facet rail**; filtering is now a single global search box (narrows both Grid + Gallery) plus per-column filter headers in the Grid. (3) **Grid rows get a "⤢ Card" button** that opens the rich `UnifiedDnaCard` in a centered modal so assets can be attached without leaving the grid. (4) **Gallery now uses `UnifiedDnaCard`** (was the legacy `DnaCard`), so the multi-select attach pickers appear everywhere. (5) Bug fixes: the dead "Assets →" / count-badge button now opens the full-screen Assets page; **video thumbnails** fall back to the stored `thumbnailUrl` when `videoId` is missing; **location pins** are now Google-Maps links (lat/lng → address/name search) and **footage filenames** link to their Drive URL; **asset detach (✕)** now rolls back on persist failure; `baseList` also excludes tombstoned (`deletedAt`) rows. Also widened the card grid to `minmax(560px,1fr)` so the two-column card (text + 240px assets column) stops crushing the text into one-char-per-line (the originally-reported "font messed up").

**Where:** `src/pages/reel-dna.jsx` (deleted Classic state/branches/`DnaCard`/`DNA_VIEW_KEY`; added `onOpenCard` to `DnaTable`; `baseList` `!deletedAt`; wired `onOpenAssets`/`isOwner` into the comprehensive view; trimmed now-dead imports); `src/components/reel-dna-comprehensive.jsx` (full rewrite — global search + column filters + `UnifiedDnaCard` for grid-modal & gallery + centered modal); `src/components/reel-assets.jsx` (thumbnail `thumbnailUrl` fallback, location Maps link, footage Drive link); `src/store/store.jsx` (`detachAsset` snapshot-and-rollback); `src/lib/reel-dna-filters.jsx` (`export searchHaystack`); `src/pages/reel-dna.css` (grid width; `.rdc-root--solo`, search-in-bar, `.rd-row-btn--open`, asset-link, `.rdc-modal*`).

**Path we took:** Two passes. First an inline fix for the reported "font messed up" — diagnosed it as a *layout* bug, not a font one (the `.rd-card` flex-row with a fixed 240px assets column was crushed inside `minmax(340px)` grid cells), and surfaced the attach pickers by defaulting to `UnifiedDnaCard`. Then the user reported broader breakage and asked for `/qa-verified-plan`; ran 3 Explore agents + 1 Plan agent which pinpointed the root cause: `reel-dna-comprehensive.jsx` imported the **legacy** `DnaCard`/`DnaTable` directly and never forwarded `onOpenAssets`, so the rich attach UI and the assets page were simply unreachable from Comprehensive — and that the `unified_cards` flag-default change from the prior session never reached Comprehensive at all. Confirmed design choices with the user (column-header filters + top search, centered-modal row-open, UnifiedDnaCard everywhere) before implementing.

**What we learned:** (1) The prior session's `DnaCardComponent = unifiedCards ? UnifiedDnaCard : DnaCard` switch in `reel-dna.jsx` was **dead for the Comprehensive view** — Comprehensive imports `DnaCard` itself and bypasses the page-level switch, so toggling the flag did nothing there. (2) The "delete doesn't work" report was actually two *other* bugs (the dead Assets button + a non-rolling-back detach); reel delete itself was correct (tombstone + `DELETE_REEL_DNA_BY_ID` reducer + hydrate `.is("deleted_at", null)`). (3) The resolved asset rows are **raw source rows** (footage carries `drive_url`/`drive_folder_url`, thumbnails carry `thumbnailUrl`, locations carry `lat`/`lng`/`address`) — the renderers just weren't using those fields. (4) The new `reel-dna → comprehensive → unified-card → reel-dna` import cycle builds fine (same render-time-only pattern as the existing cycle); build went 815→814 modules after deleting `DnaCard`.

**Status:** **Now LIVE (incidentally).** Was built-green-but-not-deployed, but the 2026-06-18 training-linkify `vercel --prod` builds the whole working tree, so this overhaul shipped to prod alongside it (`dpl_3kuHzejE9WtFg3eTceZK2LEpqG6h`). It had NOT received separate owner visual sign-off before going live — re-verify on prod.

---

## 2026-06-18 — Reel DNA: font fix + quick multi-attach + unified card UX (LIVE)

**What changed:** Four Reel DNA improvements shipped together. (1) The Reel DNA page font no longer renders as smeared faux-bold. (2) A new searchable **multi-select attach picker** — a `+` per asset category (Footage/Locations/Thumbnails/News) opens a popover with a search box + checkboxes to attach many existing assets in one go (attaching previously had NO UI, only detach). (3) The new **UnifiedDnaCard** adds the quick-attach pickers, inline "create + attach" for a new YouTube thumbnail and a new news item, a "Hide assets" toggle, and a "↓ Pull from pipeline" shortcut — all behind the owner `unified_cards` flag (default OFF, flip in Roles & Permissions → Feature flags). (4) Fixed a latent bug where detaching a **location or thumbnail silently failed**.

**Where:** `index.html` (Google Fonts link — added the missing weights); `src/components/asset-attach-picker.jsx` + `.css` (NEW reusable popover); `src/components/unified-dna-card.jsx` + `.css` (NEW card, reuses the pure `ReelAssets` renderer + existing store actions); `src/pages/reel-dna.jsx` (exported `relTime`/`resolveTags`/`BriefBlock`/`GeneEditor` for reuse; renderer switch `unifiedCards ? UnifiedDnaCard : DnaCard`); `src/store/store.jsx` (`unified_cards` flag: reducer `SET_UNIFIED_CARDS` + initial state + HYDRATE read + realtime sync + `setUnifiedCards` setter, mirroring `gamify_enabled`); `src/pages/roles-admin.jsx` (`FeatureFlagsPanel` toggle); `src/components/reel-assets.jsx` (detach-type fix).

**Path we took:** Planned via the plan-mode workflow (Explore → Plan agents) but built **directly inline** rather than `/qa-verified-plan` + `/workflow` — judged the ~5-file scope too small to justify the multi-agent token premium (that's reserved for the next-phase pipeline-card merge). Diagnosed the font issue by reading the actual CSS: ~10 `font-weight: 600/700` rules across `reel-dna.css`, almost all on `--f-mono` elements, while `index.html` only loaded `JetBrains Mono:wght@400;500` (+ Inter without 700). Fixed by requesting `;600;700` for both. The detach bug surfaced while tracing types: `ReelAssets` passed **plural** detach labels (`"locations"`, `"thumbnails"`) that never matched the **singular** stored `asset_type` (`"location"`, `"thumbnail"`) used by `attachAsset`/the resolver/`seedAssetsFromPipeline` — so those deletes were silent no-ops. Corrected to singular.

**What we learned:** (1) Google-Fonts faux-bold is the cause of "messed up" mono text — if a CSS `font-weight` isn't in the loaded weight set, the browser synthesizes it and it looks broken; the fix is the font *request*, not the CSS. (2) The asset system's `assetType` is **singular** everywhere that matters (resolver switch in `store.jsx`, `attachAsset`, `seedAssetsFromPipeline`) — any new attach/detach code MUST use singular; the legacy plural detach was a real bug. (3) The page↔component circular import (unified-dna-card imports helpers from reel-dna.jsx which imports the card) resolves cleanly because all the shared symbols are **hoisted function declarations** used only at render time — same pattern as `reel-dna-comprehensive.jsx`. (4) `createMonitorEvent` is `async` (must `await` before attach) while `createThumbnailDnaCapture` is sync and returns the row directly.

**Status:** Live on www.footagebrain.com (deploy `dpl_DoXXLQtF6kz8j8MYPCM7hgGoQFiR`, build green — 815 modules). No DB migration (the `unified_cards` flag rides the existing `app_settings` + owner-write RLS). Owner must flip the toggle on once to see the new card; default OFF keeps the grid identical to before.

---

## 2026-06-18 — Daily-use bug/feature batch: 6 items via /qa-verified-plan (LIVE)

A backlog screenshot of hand-written notes was organized and run through `/qa-verified-plan` (3 domain agents + 1 adversarial QA agent, 1 QA loop), then implemented. Six distinct changes shipped together. Migrations 0070–0072 applied to the live DB; `vercel --prod` green (815 modules), aliased to www.footagebrain.com.

### 1. Pipeline reel collapse — now persists per-user + more compact

**What changed:** Collapsing a reel card on the pipeline board now survives logout/reload (was ephemeral `useState`). Each team member has their own collapse state. Collapsed cards are also visually tighter (~32px vs ~62px — title chip + Expand control only). Per-lane hide/show is now also persisted to the DB (was localStorage-only, so it didn't follow you across devices).

**Where:** new migration `0070_user_preferences.sql` (per-user prefs table, self-RLS via `people.user_id`); `src/store/store.jsx` (`collapsedReelIds`/`hiddenLaneIds` state + reducers + `toggleReelCollapsed`/`toggleLaneHidden` actions + a separate auth-gated hydration effect); `src/components/components.jsx` (ReelCard reads store, dropped local state); `src/pages/pipeline.jsx` (bridges existing localStorage lane-hide to the store); `src/styles.css` (`.reel.collapsed` compact rules).

**Path we took:** QA flagged that `app_settings` is owner-write-only, so a per-user table was required. Chose a new `user_preferences(person_id, key, value)` table over localStorage so state follows the user across devices. Kept `Set` out of reducer state (plain arrays) per QA — Sets aren't JSON-serializable and break React's immutability contract.

**What we learned:** The hydration must be a **separate effect keyed on `_authPerson?.id`**, not folded into the main all-or-nothing hydrate `Promise.all` — a missing 0070 table would otherwise brick boot. Composite PK `(person_id, key)` is a FULL unique index, so it's a valid `onConflict` upsert arbiter (avoids the partial-index 42P10 trap).

**Status:** Live.

### 2. Discord notifications on reel assignment

**What changed:** When a reel moves to **In Progress** (or is **sent back** for revision), a Discord webhook ping fires to the assigned editor + Paul + Leroy. Owner configures per-person webhook URLs and a trigger-mode toggle (**All team members** vs **Owner only**) from a new "Discord notifications" panel in Roles Admin.

**Where:** `api/ai/suggest.js` (`?action=discord-notify` — no new Vercel fn, stays under the 12-fn cap); `src/store/store.jsx` (fire-and-forget fetch in `moveStage` when `stage==="in_progress"` and in `sendBack` with `sent_back:true`, both passing a Bearer JWT); `src/pages/roles-admin.jsx` (new `DiscordConfigPanel`); config stored in `app_settings` key `discord_config` `{ mode, webhooks }`.

**Path we took:** User wanted BOTH trigger modes selectable, so the mode lives in `discord_config.mode` and the toggle writes it via the owner-write `app_settings` RLS. QA caught that the frontend fetch needs `Authorization: Bearer <session.access_token>` — the suggest.js auth gate 401s without it.

**What we learned:** Discord webhook POSTs are kept fully fire-and-forget (`.catch(()=>{})` client-side, `Promise.allSettled` + always-200 server-side) so a webhook failure never surfaces as an app error or blocks the reel move.

**Status:** Live. **Owner action needed:** paste each member's Discord webhook URL into Roles Admin → Discord notifications before pings will fire (no URLs = silent no-op).

### 3. Training module — clickable links + YouTube click-to-embed

**What changed:** URLs typed into training prose fields now render as clickable links in read-only view. YouTube URLs get an inline **Embed** button that expands a responsive 16:9 iframe on demand (click-to-embed, not auto-load).

**Where:** `src/pages/training.jsx` — `linkifyText()` + `YoutubeEmbedLink` component; `ProseBlock` read-only branch now runs text through `linkifyText()`. Edit mode stays plain text.

**What we learned:** Linkify belongs scoped in `training.jsx`'s `ProseBlock`, NOT in the shared `EditableText` primitive (that would linkify every editable field app-wide). The module-level `_URL_RE` regex has the `g` flag so its `lastIndex` must be reset at the top of each `linkifyText()` call.

**Status:** Live.

### 4. Facebook Reels as a Reel DNA platform

**What changed:** "Facebook Reel" is now selectable in the Reel DNA platform dropdown, so FB reels can be tracked like IG/TikTok/YouTube.

**Where:** `src/lib/reel-dna.jsx` (added `{ key: "fb", label: "Facebook Reel" }` to `PLATFORMS`); defensive migration `0071_reel_dna_platform_fb.sql`.

**What we learned:** The 0044 `reel_dna.platform` column never had a real CHECK constraint (the `'ig'|'tiktok'|'yt'` was a comment only) — so `'fb'` was already insertable. 0071 just formalizes the allowed set. FB **auto-ingest** (Graph API polling like the IG inbox) is out of scope / Hetzner-gated for a later session.

**Status:** Live.

### 5. Tasks & Comms — drag-select text in notes

**What changed:** You can now drag to select text in a task's notes textarea to copy/paste (was being hijacked by the row's drag-reorder handler).

**Where:** `src/pages/my-work.jsx` — `onMouseDown={e => e.stopPropagation()}` on both the inline and expanded-modal note textareas.

**What we learned:** Root cause was unconfirmed (the row already disables `draggable` while notes are open and bails on textarea targets) — the `stopPropagation` on mousedown is the safe belt-and-suspenders fix that prevents any ancestor drag gesture from stealing the selection.

**Status:** Live.

### 6. IG carousel groundwork — content_type column

**What changed:** Added a `content_type` column to `reel_dna` (reel/carousel/photo/unknown) and threaded it through the store's `reelDnaToDb()` mapper, prepping for the IG DM poller to distinguish carousels/photo posts from reels.

**Where:** migration `0072_reel_dna_content_type.sql`; `src/store/store.jsx` (`reelDnaToDb` now writes `content_type`).

**What we learned:** The actual poller change (parse DM `message` text for `/p/` and `/reel/` URLs, not just `shares.data[].link`) lives in the **private Hetzner backend repo** — DB + mapper are the in-app half; the poller half is a separate human-gated SSH session.

**Status:** DB + mapper live. Hetzner poller change pending (out of scope this session).

---

## 2026-06-18 — Thumbnails shortcut pill added to Reel DNA filter bar (LIVE)

**What changed:** Added a **Thumbnails** pill button to the Reel DNA filter bar in the gap between the "source" filter group and the "view" toggle. It lights up when the Thumbnails tab is active and switches to it from any Reels view state — a more discoverable entry point than the header tab-strip which users were missing.

**Where:** `src/pages/reel-dna.jsx` — one `<DPill active={tab === "thumbnails"} onClick={() => setTab("thumbnails")}>Thumbnails</DPill>` inserted between the `<span style={{ flex: 1 }} />` spacer and the "view" pills. No CSS changes needed.

**Path we took:** User couldn't find the Thumbnails tab (it existed in `rd-tabs` at the page header but was easy to overlook). Added a second entry point in the always-visible filter bar where users' eyes scan for controls.

**What we learned:** The `rd-tabs` strip at the top is visually small relative to the filter bar row — a second pill in the filter bar provides much better discoverability without removing the header tabs.

**Status:** Live on www.footagebrain.com (deploy `dpl_D1QJk7EPHeQLPNDKP8zfDzcihR73`, build green 811 modules).

---

## 2026-06-18 — YT-sync cron SSH-verified + fresh-capture confirmed (7 new thumbnails auto-ingested)

**What changed:** Operationally confirmed two things for the YouTube-playlist auto-ingest feature: (1) a manual live poll returned `{items_seen:15, inserted:7}` — the playlist grew 2 → 15 videos and all 7 new ones were auto-cataloged into `thumbnail_dna`, re-poll `{inserted:0}` confirmed dedup intact. (2) The Hetzner `*/15` cron is present in `/var/spool/cron/crontabs/root` and **actively firing** — `journalctl -u cron` shows it executing at :00/:15/:30/:45. Polling is now genuinely hands-off.

**Where:** No code changes. Operational verification via SSH to Hetzner (178.105.14.144) and a live `node fetch` to `https://footagebrain.com/api/ai/suggest?action=yt-sync`.

**Path we took:** SSH'd into Hetzner, ran `crontab -l` (confirmed line present at line 4), then `journalctl -u cron --since "2 hours ago"` to confirm execution. Hit the live endpoint separately to observe `inserted:7` on the grown playlist.

**What we learned:** `/var/log/syslog` on this Hetzner box was **frozen at Jun 17 23:45** (rsyslog file-write lag) while the server clock was Jun 18 12:11 — syslog falsely looked like cron had died. The systemd journal (`journalctl -u cron`) is the source of truth for cron health on this box. **Don't trust `/var/log/syslog` — use `journalctl -u cron`.**

**Status:** Verified live. No code deployed this change. Memory `project_yt-thumbnail-autoingest` updated.

---

## 2026-06-18 — Reel DNA unified Assets system (collapsible column + full-screen page, LIVE)

**What changed:** Every Reel DNA card now has an **Assets** column with four collapsible sections — **Footage / Locations / Thumbnails / News** — collapsed by default, each showing a per-category **count badge**, expandable on demand. An **"Assets →"** heading opens an in-app **full-screen Assets page** with all four sections expanded plus a **"Pull from pipeline reel"** seed button (gathers the linked pipeline reel's footage/locations/news). The spreadsheet view gets an **Assets count cell** that opens the same page. Any asset can be attached to any card on demand; News is now readable team-wide.

**Where:** New migrations `supabase/migrations/0068_reel_dna_assets.sql` (polymorphic `reel_dna_assets(reel_dna_id, asset_type, asset_id, label)` join table + **FULL** unique index `(reel_dna_id, asset_type, asset_id)` as the upsert arbiter + team-wide RLS + realtime) and `0069_monitor_events_team_read.sql` (authenticated SELECT policy on `monitor_events`; writes stay owner-only). `src/store/store.jsx` — hydrate + realtime for `reelDnaAssets`, actions `attachAsset`/`detachAsset`/`seedAssetsFromPipeline`, pure exports `resolveReelDnaAssets`/`assetCountsForReelDna`. New UI: `src/components/asset-section.jsx`, `reel-assets.jsx`, `reel-assets-panel.jsx`, `src/lib/reel-dna-assets.jsx` (the `useReelDnaAssets` hook), `src/pages/reel-assets-page.jsx`; wiring in `src/pages/reel-dna.jsx` + `.css`; `ThumbPreview` exported from `src/pages/thumbnail-dna.jsx` for reuse.

**Path we took:** `/qa-verified-plan` (Architect + Backend/Data + Frontend domain agents + an adversarial QA agent) — the QA pass **adjudicated a real architecture conflict**: Architect wanted to resolve assets through the existing `reel_dna.reel_id` → pipeline-reel bridge; Backend wanted a polymorphic join table on the card uuid. QA verified that `reel_dna.reel_id` is set only by an explicit "Send to Pipeline" action, so **nearly every card has no `reel_id`** — the bridge would show 0/0/0/0 everywhere. Polymorphic table won. Four owner decisions locked via AskUserQuestion (explicit-attach + pipeline seed · in-app full-screen page, no router · open News team-wide · count-cell in table view). Built with `/workflow`: T-SCHEMA + T-STORE in parallel (Wave 1), then T-UI (Wave 2), each a Senior Architect with implementer subagents + one dedicated QA agent under locked file ownership. A **session-limit interruption killed T-UI mid-run** — but it had already created all 5 new files; only the `reel-dna.jsx`/`.css` wiring was missing (verified via grep: zero Asset refs), so a focused continuation finished those two files. Applied 0068/0069 via `npm run migrate:apply`, verified `reel_dna_assets` live (rows=0), `vercel --prod`.

**What we learned:** (1) **QA-as-adjudicator earns its keep** — the "obvious" pipeline-bridge design would have shipped a feature that's inert on ~all cards; only verifying how often `reel_id` is actually populated exposed it. (2) **Mixed PK types force polymorphism** — footage/locations PKs are `text`, thumbnail_dna/monitor_events are `uuid`; a single typed FK can't span them, so `reel_dna_assets.asset_id` is `text` with `String()` coercion on every write, and the resolver skips orphan links. (3) **Provider split**: locations live in `useLocations()` (a separate provider), NOT `useWorkflow().locations` (a dead `[]`), so the store's pure resolver takes all source arrays as a parameter and the UI hook supplies locations — the store can't call the locations hook. (4) **Migration numbering races** — `0067` was already taken on disk by the sibling yt-thumbnail wave, so T-SCHEMA correctly shifted to 0068/0069; downstream was unaffected because contracts key on table/column names, not file numbers. (5) **A workflow agent dying mid-wave is recoverable** — checking `git status` + grepping for the wiring symbols pinpointed exactly the unfinished file, and a scoped continuation under the same ownership contract completed it without re-running the whole wave.

**Status:** **Live** on www.footagebrain.com (deploy `dpl_G5rkbTJFjcFnWJP9Yu4GpUSY6aJt`, READY). Migrations 0068/0069 applied. Build green (811 modules). **Not yet code-reviewed**; runtime UI not yet visually walked through (recommended: attach one of each asset type and confirm badges + full-screen page). Tree uncommitted on `bugfix-daily-use-batch`.

---

## 2026-06-18 — YouTube-playlist → Thumbnails auto-ingest (public-playlist RSS poller, LIVE)

**What changed:** Dropping a video into a dedicated **public** YouTube playlist now auto-catalogs its thumbnail in the **Thumbnails** tab — no manual paste. A 15-min poll reads the playlist's **RSS/Atom feed** (`youtube.com/feeds/videos.xml?playlist_id=…`) and inserts each video into `thumbnail_dna`, deduped on `video_id`. The Thumbnails tab also gained a **"↻ Refresh"** button (on-demand poll) and an "already captured" guard on manual paste. Live on footagebrain.com; live endpoint verified returning `{items_seen:2, inserted:0}`.

**Where:** New migration `supabase/migrations/0067_thumbnail_dna_video_id_uidx.sql` (**FULL** unique index on `video_id` — the `ON CONFLICT` arbiter + anti-resurrection guard). New `parseYouTubePlaylistFeed()` in `api/ai/_rss.js`. New `?action=yt-sync` branch in `api/ai/suggest.js` (reads `YT_THUMBNAIL_PLAYLIST_ID`, fetches feed, upserts `onConflict:'video_id', ignoreDuplicates:true`, `source='yt_playlist'`; folded — no new Vercel fn). `triggerYtSync()` in `src/store/store.jsx`; `yt_playlist` source + Refresh button + 409 guard in `src/lib/thumbnail-dna.jsx` + `src/pages/thumbnail-dna.jsx`. Workflow file `.claude/workflows/yt-thumbnail-autoingest.js`.

**Path we took:** `/qa-verified-plan` (3 domain agents + adversarial QA) resolved the design, then `/workflow-file-creation` emitted a 2-team locked-file-ownership workflow which built the code. Chose **public-playlist RSS over the YouTube Data API + Hetzner poller** — RSS needs no Google API key, no quota, and keeps the whole pipeline in this repo folded into `suggest.js`. Applied migration `0067` alone via a bespoke node one-off, ran the real poller logic locally to verify, then `vercel --prod` + live curl check.

**What we learned:** (1) The `yt-sync` endpoint is a **Vercel serverless function — `vite` does not serve it**, so the in-app Refresh button only works on prod/`vercel dev`; to test locally, run the poll logic via node (importing the real `parseYouTubePlaylistFeed`) and the inserted rows appear live via the existing `thumbnail_dna` realtime sub (zero store-mapper changes needed). (2) Dedupe key = **`video_id`** with a **FULL** (not partial) unique index — a partial index can't be an `ON CONFLICT` arbiter (the 0061 42P10 gotcha); NULL `video_id`s stay distinct so paste-fail rows don't collide. (3) `curl` fails with SSL exit-35/HTTP-000 in this Git Bash env — use `node fetch` to hit endpoints. (4) `scripts/migrate.mjs` has no single-file apply, so 0067 (and earlier 0063) were applied via a one-off `exec_sql` + `schema_migrations` upsert to avoid pushing the pending World Monitor 0064–0066.

**Status:** **Live** on footagebrain.com (deploy `dpl_EBcUouQZXy2RH5DWiubQ9erE1i1p`, aliased www). Migration 0067 applied. Remaining for fully hands-off: the Hetzner `*/15` cron line (memory `project_yt-thumbnail-autoingest` records it with secret `fbai_cron_2026` = `SUGGEST_CRON_SECRET`; confirm on Hetzner). Until then the Refresh button polls on demand.

---

## 2026-06-18 — Thumbnail DNA: a YouTube "Thumbnails" tab in Reel DNA (paste-in capture, LIVE)

**What changed:** New **Thumbnails** tab inside the Reel DNA page: paste a YouTube link → the thumbnail renders (derived client-side, zero-key) → tag it with six manual **design genes** (color, typography, face, layout, mood, subject) → catalog it in a grid/spreadsheet. A "Reels | Thumbnails" toggle switches the page; the existing Reels flow is untouched.

**Where:** New migration `supabase/migrations/0063_thumbnail_dna.sql` (new `thumbnail_dna` table mirroring `reel_dna` + `deleted_at` tombstone). New `src/lib/thumbnail-dna.jsx` (`extractYouTubeId`, `thumbnailUrlFromId`, GENES/SOURCES), `src/pages/thumbnail-dna.jsx` + `.css`. `src/store/store.jsx` (mappers, reducer, persist, hydrate, realtime sub, `createThumbnailDnaCapture`/`deleteThumbnailDna`/`reloadThumbnailDna`). `src/pages/reel-dna.jsx` tab toggle. `api/ai/suggest.js` `?action=youtube-oembed` (best-effort title/channel; folded). Workflow file `.claude/workflows/thumbnail-dna-tab.js`.

**Path we took:** Scoped via AskUserQuestion (paste-in only · manual tagging only · a tab inside Reel DNA), built by the `thumbnail-dna-tab` workflow (locked disjoint file ownership + adversarial QA + build gate). Applied migration 0063 alone (bespoke one-off), tested on localhost, then shipped with the auto-ingest deploy.

**What we learned:** (1) The IG-DM poller only captures **Instagram reel shares** (`shares.data[].link`), **not** a YouTube URL typed into a DM (that's plain text) — which is why DM'ing a YouTube link to the Page never created a row. Hence paste-in + the separate playlist poller. (2) oEmbed enrichment is best-effort and Vercel-only, so title/channel stay blank on localhost — the thumbnail + manual tagging still work.

**Status:** **Live** on footagebrain.com (deploy `dpl_EBcUouQZXy2RH5DWiubQ9erE1i1p`). Migration 0063 applied.

---

## 2026-06-18 — Reel DNA: per-column filters on Classic + new Comprehensive (faceted Grid/Gallery) view (LIVE)

**What changed:** The Reel DNA spreadsheet ("Classic") gained a **per-column filter row** — text filters for Reel/Location/Music/Font/SFX/Story + Source/Status selects + a clear button — so you can isolate reels without scrolling. A new **Classic ⇄ Comprehensive** toggle (persisted) adds a second view: a left **faceted filter rail** (multi-select Platform/Status/Source/Genes chips with live counts + a global search + a location search) and a content area with its own **Grid ⇄ Gallery** sub-toggle. Live on footagebrain.com.

**Where:** New `src/lib/reel-dna-filters.jsx` (pure filter model — `applyColumnFilters`, `computeFacets`, `applyFacets`, `toggleFacet`; reads rows through `resolveBrief` so note-derived fields filter like promoted ones). New `src/components/reel-dna-comprehensive.jsx` (rail + Grid/Gallery, **reuses** the page's `DnaTable`/`DnaCard`). `src/pages/reel-dna.jsx` — exported `DnaTable`/`DnaCard`, added a `ColumnFilterRow`, `dnaView` (localStorage `reel_dna_view`) + `colFilters` state, split `visible` into a `baseList` (archived-respecting) feeding both views. CSS appended to `src/pages/reel-dna.css` (`.rd-viewtoggle*`, `.rd-colfilter*`, `.rdc-*`).

**Path we took:** Asked the user (AskUserQuestion w/ ASCII previews) to lock the layout direction before coding; they chose **both** filterable Classic columns **and** a Comprehensive Grid+Gallery view. Built the shared filter lib first so Classic columns and Comprehensive facets match a reel identically, then reused the existing `DnaTable`/`DnaCard` renderers in the new view rather than duplicating the editable spreadsheet/card. `npm run build` green (806 modules), then `vercel --prod`.

**What we learned:** (1) The page↔component **circular import** (`reel-dna-comprehensive` imports `DnaTable`/`DnaCard` from `reel-dna.jsx`, which imports the component) resolves cleanly because both sides are **hoisted function declarations** referenced lazily at render — ESM live bindings handle the cycle and Vite built it without complaint. (2) Reusing the row renderers means edits behave identically in Classic, Grid, and Gallery — no second editable-cell implementation to keep in sync. (3) Facet counts are computed against the unfiltered `baseList` so the rail shows what *exists*, not what's left after filtering.

**Status:** **Live** on footagebrain.com (deploy `dpl_6Wh8G87Je8PDgE2ovXQM2k4BgJ5E`, READY, aliased www). No DB/schema changes. Code-review skipped before deploy (owner deployed directly). All edits uncommitted on `bugfix-daily-use-batch`.

---

## 2026-06-18 — Pulse: comprehensive Classic view with 4 layouts + inline row tag editing (LIVE)

**What changed:** The Pulse Classic feed gained a **layout switcher** (persisted) offering four ways to view the same filtered list — **Timeline** (day-grouped rows), **Cards** (magazine grid), **Table** (dense, sortable columns), **Board** (Kanban by severity). Clicking any row/card now **expands it inline** into a detail editor where you add/remove **tags** (chip editor), flip severity/status, star, mark-read, archive, or delete. Previously tags could only be set at creation time. Live on footagebrain.com.

**Where:** New `src/components/pulse-comprehensive.jsx` (the four layouts + a shared `PulseDetail`/`TagEditor` inline editor). `src/pages/pulse.jsx` — swapped `PulseFeed` for `PulseComprehensive`, added `layout` state (localStorage `pulse_layout`) + a layout-switcher bar + an `onSave(id, patch)` callback wired to the existing `actions.updateMonitorEvent`. CSS appended to `src/pages/pulse.css` (`.pc-*`; `.pulse-feed[data-layout]` drops its box for the card grids). The old `pulse-feed.jsx` stays (still used by `pulse-world.jsx`).

**Path we took:** Confirmed scope with AskUserQuestion — user picked **all four** layouts and **inline expand** for tagging. Reused the existing `.pulse-sev`/`.pulse-platform`/`.pulse-tag`/`.pulse-act` tokens so the new layouts match the established look; built one shared `PulseDetail` so every layout edits the same way. The store's `updateMonitorEvent` already supported a `tags` array, so no store/schema work was needed. `npm run build` green, then `vercel --prod`.

**What we learned:** (1) `monitorEvents` already carried a `tags` array end-to-end (`updateMonitorEvent` → `dbPatch.tags`) — the only thing missing was an editing surface, so this was pure UI. (2) Keeping a single `expandedId` at the component root (one row open at a time) made the inline editor trivial to share across four very different layouts. (3) The bordered `.pulse-feed` wrapper suits the row/table layouts but fights the card grids — a `data-layout` attribute lets one wrapper adapt instead of branching the markup.

**Status:** **Live** on footagebrain.com (deploy `dpl_6Wh8G87Je8PDgE2ovXQM2k4BgJ5E`, READY, aliased www). No DB changes. Code-review skipped before deploy (owner deployed directly). All edits uncommitted on `bugfix-daily-use-batch`.

---

## 2026-06-18 — World Monitor hybrid: world-events feed in Pulse + filming-location linking (LIVE)

**What changed:** Added a "World Monitor" view to the owner-only Pulse tab. A **Classic⇆World toggle** switches Pulse to a world-events feed (USGS earthquakes, NASA FIRMS fires, ACLED conflicts) shown alongside an embedded **worldmonitor.app live map**; each event can be **linked to a Reel DNA reel, a review-lane card, or a filming location** (the filming-location signal the user wanted). A new **"World Monitor" card** on the Monitor screen tracks free-API usage and holds **off-by-default paid-API toggles** (Finnhub/FRED/IMF/NASDAQ/flights). Live on footagebrain.com.

**Where:** New migrations `0064_monitor_events_geo.sql` (lat/lng/event_type/metric on `monitor_events` + `source_type` CHECK extended to include `geo`), `0065_monitor_event_links.sql` (polymorphic event→reel/review_card/location link table + FULL unique index + owner/service RLS), `0066_world_monitor_settings.sql` (seeds `app_settings.world_monitor` free/paid flags + `world_monitor_usage` counters). New `api/ai/_world-feeds.js` (`ingestWorldEvents`, underscore = not a Vercel fn) folded into `api/ai/suggest.js?action=world-ingest`. New `src/components/pulse-world.jsx` + `pulse-event-link.jsx`; `src/pages/pulse.jsx` (toggle, localStorage `pulse_view`, mirrors landing.jsx), `pulse.css`. `api/monitor/status.js` (`fetchWorldMonitorStats`→`worldMonitor`) + `src/pages/monitor.jsx` (`WorldMonitorSection`). `src/store/store.jsx` (`triggerWorldIngest`/`createEventLink`/`deleteEventLink` + `eventLinks` state/realtime/mappers). Workflow file: `.claude/workflows/world-monitor-hybrid.js`.

**Path we took:** User asked to self-host World Monitor on Hetzner (free APIs only, paid toggled off), then mid-research asked whether to just iframe it. Researched the repo + live HTTP headers: it's **AGPL-3.0** and architected for **Vercel Edge + Railway + Upstash Redis** (infeasible on the 4 GB/2-vCPU box already running Mongo+Rocket.Chat); the full dashboard blocks framing (`X-Frame-Options: SAMEORIGIN`) but `worldmonitor.app/embed.html` allows it (`frame-ancestors *`). Confirmed a **HYBRID** via AskUserQuestion: iframe the embed for the visual + natively ingest the same FREE feeds it aggregates into our existing `monitor_events`/Pulse pipeline so events can link to pipeline cards. Generated a 4-team build workflow via `/workflow-file-creation`; it built the feature. Applied 0064–0066 with `npm run migrate:apply`, verified `/api/monitor/status` returns the `worldMonitor` block, deployed `vercel --prod`.

**What we learned:** (1) A cross-origin iframe is a sealed box — you can't read its data — so "show World Monitor" and "wire events into the pipeline" are two different problems: the embed gives the visual, but the *data* must come from the underlying free APIs ingested ourselves. (2) Iframing offloads to the embed's origin + the viewer's browser → ~zero added Hetzner load, which is exactly why hybrid fits a nearly-full 4 GB box where self-hosting never could. (3) A parallel `0063_thumbnail_dna` migration had bumped our numbers, so World Monitor landed at **0064–0066**, and the settings JSON shipped in a **flat** shape the live code binds to (not the nested shape in the original plan) — the build agents correctly refused to "fix" it to spec, which would have broken the contract. (4) Reused the **0061 FULL unique index** for `geo` dedup (a partial index can't be an ON CONFLICT arbiter). (5) Licensing: USGS + NASA FIRMS are US-gov/public-domain (fine commercially); **ACLED is free for *non-commercial* use only** — needs review since FootageBrain is a business.

**Status:** **Live** on footagebrain.com (deploy `dpl_5jtsJt7WK3gtW6BZJo8PENnFmUpN`, READY, aliased www). Migrations 0064/0065/0066 applied to the shared Supabase DB. USGS works keyless now; FIRMS/ACLED stay dormant until `FIRMS_MAP_KEY`/`ACLED_KEY`/`ACLED_EMAIL` env + the Hetzner `world-ingest` cron are added. **Code-review was skipped before deploy** (owner's call). All edits uncommitted on `bugfix-daily-use-batch`.

---

## 2026-06-18 — Display & accessibility: text-size buttons now actually work + wider size/font ranges (LIVE)

**What changed:** Fixed the "Text size" buttons in the Display & accessibility panel that "sometimes" did nothing, and broadened the choices. Text size is now a true **display zoom** with 8 steps (80/90/100/110/125/150/175/200%) that works in **any** mode (no longer requires Comfortable mode), and the Font picker grew from 3 to 6 (added Serif, Rounded = Nunito, Mono). Deployed to footagebrain.com.

**Where:** `src/theme-accessible.css` — replaced the theme-gated root-`font-size` scale (`html[data-theme="accessible"][data-fontscale="large|xl"]`) with `html[data-fontscale="N"] body { zoom: N/100 }` rules (independent of theme) + new `--f-sans` overrides for `serif`/`rounded`/`mono` and a lazy Nunito `@font-face` (fontsource CDN, mirrors the OpenDyslexic pattern). `src/lib/theme.jsx` — `DEFAULTS.fontScale` `"normal"`→`"100"`; default still emits no `data-fontscale` attribute (zero-surface invariant preserved). `src/components/PreferencesModal.jsx` — new 8-value size SegRow with `%` labels, 6-value font SegRow, dropped the "enable Comfortable mode to use" hint.

**Path we took:** User reported the size buttons "aren't sometimes working" and asked for a wider range. Read the three (still-untracked) theme files and found two compounding causes: (1) the size CSS required BOTH `data-theme="accessible"` AND `data-fontscale`, so in Default mode the buttons were inert; (2) even in Comfortable mode it only nudged the root `font-size`, but the app sizes nearly all text in absolute `px` (13/11px…), which ignores root font-size — so it barely moved. Switched the mechanism to CSS `zoom` on `<body>` (a real percentage — matches the user's "% Readability" framing) which scales px text/icons/spacing/the modal uniformly. `.m-seg` already wraps, so 8 size + 6 font pills lay out fine. `npm run build` clean, then `vercel --prod`.

**What we learned:** (1) Root `font-size`/`rem` scaling is useless for this codebase — it's px-everywhere; `zoom` on the rendered body is the only reliable cross-cutting size control. (2) Gating an accessibility control behind another mode is the trap that made it read as "sometimes broken." (3) `zoom` is supported in all current Chromium/Safari and Firefox 126+; older browsers no-op gracefully. (4) Keeping size independent of theme but still emitting no attribute at the `"100"` default preserves the byte-for-byte default render.

**Status:** **Live** on footagebrain.com (deploy `dpl_2Jat5Ajzv18qUeEPEq6gAUd6aD2E`, READY). Three theme files still untracked + edits uncommitted on `bugfix-daily-use-batch`. NOTE: this supersedes the "NOT deployed" status of the entry below — the Comfortable mode feature is now live as part of this deploy.

---

## 2026-06-18 — Opt-in "Comfortable" display / accessibility toggle (owner-only test mode)

**What changed:** Added an owner-only **Display & accessibility** panel (avatar menu → new row) that switches the dashboard into a more legible "Comfortable" mode: larger base text (13→15px), line-height 1.45→1.6, brighter text tuned to WCAG AA contrast (esp. `--fg-mute`/`--fg-dim`, which were borderline/failing), solid instead of thin-dashed card borders, roomier card padding, and responsive auto-fit card grids on Analytics/Monitor. Also exposes a **Text size** scale (Normal/Large/XL) and a **Font** choice (Inter / System / Readable = OpenDyslexic). It's a non-destructive *test version*: per-browser, off by default, and fully reversible — turning it off renders the site byte-for-byte as today.

**Where:** New `src/lib/theme.jsx` (`ThemeProvider` + `useTheme()`; localStorage keys `wb_theme`/`wb_fontscale`/`wb_font`; writes `data-theme`/`data-fontscale`/`data-font` to `<html>`). New `src/theme-accessible.css` (all overrides scoped under those attributes; imported once in `src/main.jsx` after `styles.css`). New `src/components/PreferencesModal.jsx` (reuses the shared `Modal`/`Field`/`SegRow`). `src/app.jsx` — wrap AppShell in `ThemeProvider`, owner-gated avatar-menu row, render the modal. `index.html` — tiny inline no-flash `<script>` that applies saved prefs before the bundle loads. **`styles.css` and `:root` were NOT touched.**

**Path we took:** `/qa-verified-plan` → Explore agents mapped the styling system (all ~50 colors/fonts/sizes already flow through `:root` CSS variables; only 2 hardcoded title colors, both already bright), the nav/tab shell, and the existing localStorage-pref pattern. A Plan agent designed the isolation strategy. Confirmed scope with the user via AskUserQuestion: **owner-only for now**, controls = comfortable mode + text size + font family (light theme deferred), and **cards now / tab reorg later**. The core safety trick: when a pref is at its default the provider *removes* the attribute (never sets `data-theme="default"`), so an unconfigured browser has zero selector surface and the default cascade wins untouched.

**What we learned:** (1) Because the whole app cascades through CSS variables, re-declaring the tokens under one `html[data-theme="accessible"]` block restyles ~90% of the UI with no per-component edits. (2) The cleanest reversibility guarantee is *attribute absence*, not an explicit "default" value — additive overrides + no attribute = identical render. (3) An inline head script is the standard fix for the one-frame default→accessible FOUC on opted-in reloads (no-op when no pref is set). (4) The pre-auth landing page has its own `.lp` namespace and renders before the provider mounts, so it's unaffected; the provider also strips all attributes on unmount.

**Status:** Built; `npm run build` passes clean. **NOT deployed** — per project rule the owner visually verifies (`npm run dev`) before `vercel --prod`. Three new files untracked, edits uncommitted on `bugfix-daily-use-batch`.

---

## 2026-06-18 — Reel DNA: delete is now a tombstone (IG poller stops resurrecting deleted reels)

**What changed:** Deleting a Reel DNA card used to be a permanent failure mode — deleted reels kept reappearing on the next IG sync. Delete is now a **soft-delete tombstone**: it stamps `deleted_at` and KEEPS the row (so its `external_ref` stays in the poller's "already captured" set), while hiding the row from every view. User-facing behavior is unchanged (instant removal, not restorable from the UI, distinct from Archive) — but deleted reels now stay deleted.

**Where:** `supabase/migrations/0062_reel_dna_deleted_at.sql` (new `deleted_at timestamptz` + index, applied via `npm run migrate:apply`). `src/store/store.jsx` — `deleteReelDna` now soft-deletes (`persistUpdateReelDna({deletedAt})` instead of a hard `DELETE`); `reelDnaFromDb`/`reelDnaToDb`/`persistUpdateReelDna` map the field; both load queries (hydrate + `reloadReelDna`) add `.is("deleted_at", null)`; the realtime handler treats a `deleted_at` UPDATE as a removal so a soft-delete doesn't re-add the row across tabs. Deployed `vercel --prod` (bundle `index-Cj1WIrdU.js`, READY). `persistDeleteReelDna` (hard delete) left in place but now unused.

**Path we took:** User reported deleted cards kept coming back. Read the Hetzner poller (`backend-handoff/ig_webhook.py` `_do_sync` + `_existing_ext_refs`) and found it dedupes new reels against the `external_ref`s of rows *currently in the table* — so a hard `DELETE` frees the ref and the very next poll (cron OR Refresh) re-inserts the same DM'd reel. Archive never hit this because it keeps the row. Chose a frontend-only soft-delete (no Hetzner redeploy needed): keep the row as a tombstone so the poller keeps skipping it. After deploy the user still saw reels return; queried the live DB and found **all 36 rows had `deleted_at: null`** — confirmed the deploy + bundle + column were correct, so the cause was a stale cached bundle in the browser. No service worker, so a hard refresh (Ctrl+Shift+R) loads the fix.

**What we learned:** (1) **Hard delete is the wrong primitive for any row a poller re-creates from an external source** — the IG DM still lives in the inbox, so only a tombstone (or deleting the source DM) stops resurrection. (2) The poller's dedup set is built from live rows only, so it has no memory of deletions — the tombstone gives it that memory for free. (3) Diagnosing "fix didn't work": checking the **deployed bundle hash == local build** + grepping the live JS for the new code + querying the DB for the expected mutation cleanly separated a real bug from a browser cache. (4) Soft-deletes arrive over Supabase realtime as UPDATEs, not DELETEs — the realtime handler must special-case `payload.new.deleted_at` or the row pops back in. See [[reel-dna-ig-dm-ingest]].

**Status:** Live (deployed to footagebrain.com; migration 0062 applied + verified). One-time caveat: reels hard-deleted under the OLD code before this fix may reappear once via the poller; deleting them again after a hard refresh sticks.

---

## 2026-06-18 — IG-sync Refresh button: deploy the missing handler + stop accidental Claude billing

**What changed:** The Reel DNA **↻ Refresh** button was failing with `Instagram pull couldn't start (IG sync failed (500))`. Root cause: the `?action=ig-sync` handler in `api/ai/suggest.js` existed only in the working tree and was **never deployed** — so in prod the request fell through to the daily Claude-suggestions generator, which times out on Vercel Hobby (~10s) into a bare non-JSON 500 AND **billed `ANTHROPIC_API_KEY` on every click**. Deployed the handler and added a guard so an unrecognized action can never trigger the LLM path again.

**Where:** `api/ai/suggest.js` — committed + deployed the `ig-sync` block; added an **unknown-action guard** (any unhandled `action` → `400` before the kill-switch/Claude path); made the Hetzner call **truly fire-and-forget** via an 8s `AbortController` (abort → `202 {started, pending}`) so a slow poll can't blow the function timeout. Deployed `vercel --prod` twice this session (this fix, then the tombstone fix).

**Path we took:** The front-end only shows the bare `IG sync failed (500)` when the response has no JSON `error` field — but every coded path in the handler returns one, which meant the handler wasn't being reached. `git show HEAD:api/ai/suggest.js` confirmed the deployed code had no `ig-sync` case (last commit `4455424` predates the button). Probed the live Hetzner endpoint (`POST /api/ig/sync`) — healthy and fast: `{"ok":true,"started":true}` in ~1s with the real secret, `403 {"error":"forbidden"}` on a bad one. `vercel env ls` showed `IG_SYNC_SECRET` was added to prod 25m earlier — but adding an env var doesn't redeploy, and the code that reads it wasn't live.

**What we learned:** (1) **Adding a Vercel env var does NOT redeploy** — both the secret and the code that reads it must be live; the secret sat unused for 25 min. (2) A **bare `(500)` with no JSON body = the coded handler was never reached** (Vercel platform/timeout page), vs. a JSON `error` = our code ran — a fast way to localize the failure. (3) An authed POST with an **unrecognized `action` silently ran the expensive Claude job** — a real latent cost/timeout flaw, now guarded. (4) Local curl on Windows hits `CRYPT_E_NO_REVOCATION_CHECK` (schannel) — use `--ssl-no-revoke` to probe prod endpoints. (5) `footagebrain.com` 307-redirects to `www`; a POST+Authorization across that redirect can drop the auth header (latent — keep the app on `www`).

**Status:** Live (deployed to footagebrain.com; route returns JSON 401 at the auth gate, Hetzner trigger verified). Refresh button now costs zero Claude tokens.

---

## 2026-06-18 — Pulse: feed-URL diagnostics on "Add source"

**What changed:** Adding a news/algorithm source in **Pulse → Sources** now pre-flights the URL and tells the owner *why* a bad URL won't work plus offers one-click **"Use this"** buttons with verified replacement feed URLs. A new **Check feed** button validates without adding; a valid feed shows "✓ Valid RSS feed — N items found"; a bad one shows the reason (web page not a feed / HTTP error / site won't respond / platform has no RSS) with pasteable fixes, and an **"Add it anyway"** escape hatch. This closes the gap where pasting a homepage or a social profile silently logged "ok · +0" and produced no articles.

**Where:** `api/ai/_rss.js` (new `validateFeedUrl()` engine + helpers: `discoverFeeds` `<link>` autodiscovery, `discoverFeedLinks` on-page href scan, `youtubeChannelFeed` channel-id resolver, `NEWS_FEED_DIRECTORY` curated map for CNN/NYT/Guardian/NPR/etc., `NO_RSS_HOSTS`/`ALGO_FALLBACKS` for IG/TikTok/X/FB, `quickFeedCheck` candidate verifier). `api/ai/suggest.js` (`?action=validate-feed` folded into the existing route — **no new Vercel function**, stays under the 12-cap; owner JWT or cron secret). `src/store/store.jsx` (`validateMonitorFeed()` action). `src/components/pulse-sources.jsx` + `src/pages/pulse.css` (Check-feed button, diagnostics panel, Use-this / Add-anyway). Deployed `vercel --prod` (dpl_FECTS58…, READY, aliased www.footagebrain.com).

**Path we took:** User reported "added more sources but no new articles after refresh." Queried live `monitor_sources` + `monitor_events` via the service-role key: 5 sources but only 2 were real feeds (BBC, a YouTube `videos.xml`) — those had already pulled their 15 items each (dedup → +0 on re-run, correct behavior). The other 3 were a homepage (`edition.cnn.com/`), an IG profile (`instagram.com/mosseri/`), and a TikTok page (`tiktok.com/creators`) — none are RSS. Triggered the live ingest to confirm the pipeline itself was healthy (`{sources:5,inserted:0}` + the TikTok 502). Root cause was bad source URLs, not a bug. Built the validator to catch it at entry: fetch → parse → if not a feed, gather candidates (curated directory → `<link>` autodiscovery → on-page feed links → common paths → per-host rules) → **re-fetch & confirm each candidate actually parses** before surfacing it. Verified against the user's real URLs locally, then on prod.

**What we learned:** (1) The ingester was working perfectly the whole time — a non-feed URL that returns HTTP 200 (CNN homepage) parses to zero items and writes the misleading status **"ok · +0"**, which hid the real problem; the new validator surfaces it. (2) **Instagram/TikTok/X don't publish RSS for profiles** — the only paths are platform newsrooms or third-party feeds (we suggest Social Media Today / TechCrunch Social). (3) **YouTube channels do have feeds** at `youtube.com/feeds/videos.xml?channel_id=UC…`; the channelId can be scraped from an `@handle` page (`"channelId":"UC…"`), so a pasted handle URL auto-resolves. (4) Big news sites (CNN, NYT) host feeds on a **different subdomain** (`rss.cnn.com`, `rss.nytimes.com`) that path-guessing and on-page scans miss — a small curated directory is the reliable fix. (5) Browsers can't fetch arbitrary cross-origin feeds, so validation **must** run server-side; folded into `suggest.js` to respect the Vercel function cap. (6) Local verify needs `vercel dev` on :3001 (the vite `/api` proxy target) — otherwise just verify on prod.

**Status:** Live (deployed to footagebrain.com; `validate-feed` endpoint confirmed in prod).

---

## 2026-06-18 — Reel DNA: Refresh button, hard Delete, Send-to-Pipeline brief

**What changed:** Three daily-use additions to the Reel DNA page. (1) A **↻ Refresh** button (top-right) that force-runs the Hetzner IG poller *now* instead of waiting for its 15-min cron, then reloads from Supabase — a reel just DM'd appears within seconds, with two auto follow-up reloads (~7s, ~16s) to catch the background poll's results. (2) A **hard Delete** on every card + table row (permanent `DELETE`, distinct from the restorable Archive) — no confirm dialog, so the owner can mass-delete fast. (3) A **production-brief block** inside each card showing the logged Location/Music/Font/SFX/Story/Hook/Note in pipeline-matching wording, plus a **→ Send to Pipeline** button that creates a real `reels` row from those fields (mapped 1:1), links it via `reel_id`, flips the card to *in progress*, and shows a green "▸ In pipeline · REEL-NNN" badge (idempotent).

**Where:** `src/pages/reel-dna.jsx` (Refresh/Delete/Send handlers + `BriefBlock` + footer layout), `src/pages/reel-dna.css` (brief block, notice line, send/delete buttons, foot wrap), `src/lib/reel-dna.jsx` (new pure helpers `resolveBrief` + `reelDnaToPipelineFields`), `src/store/store.jsx` (`deleteReelDna`, `reloadReelDna`, `triggerIgSync`, `sendReelDnaToPipeline` actions + `SET_REEL_DNA` reducer case + `persistDeleteReelDna`), `api/ai/suggest.js` (new `?action=ig-sync` — fire-and-forget call to Hetzner `/api/ig/sync`, secret kept server-side). Vercel env `IG_SYNC_SECRET` added (Production + Development) + `.env.local`. Deployed `vercel --prod` (dpl_4eS59…, READY).

**Path we took:** Explored the Reel DNA + reels/pipeline code first to map fields. The Refresh button's real job is beating the 15-min cron latency, so it triggers the poller — but the IG_SYNC_SECRET can't ship to the browser, and we're at the Vercel 12-function cap, so we folded an `ig-sync` action into the existing `/api/ai/suggest` route (owner JWT auth, secret server-side). Send-to-Pipeline reuses the `createReelWithFootage` reel shape (`nextReelId`, stage `not_started`, owner=capturer). First pass used a `window.confirm` on delete and persisted the reel + the reel_dna link concurrently via `wrap()`.

**What we learned:** (1) The **`reel_dna_reel_id_fkey` FK fired** because the two persists raced — `persistUpdateReelDna({reelId})` hit Supabase before `persistCreateReel` finished, so the FK saw a non-existent reel. Fix: dispatch both optimistically but **persist sequentially** (reel first, then the link), same pattern as `createReelWithFootage`. The earlier concurrent bug can leave an orphan reel in the pipeline (the insert succeeded, only the link failed) — worth a manual check/delete. (2) Owner explicitly wanted **no delete confirmation** (mass-delete workflow) — Archive remains the safe restorable option. (3) The card footer overflowed the card edge once it had View/Edit/Deconstruct/Send + Archive/Delete — fixed with `flex-wrap` on `.rd-card-foot`. (4) `vercel env add <NAME> preview` prompts for a git branch and stalls non-interactively; Production + Development is enough since deploy is `vercel --prod`.

**Status:** Live (deployed to footagebrain.com).

---

## 2026-06-18 — Instagram DM → Reel DNA spreadsheet: WORKING via Page-inbox poll

**What changed:** The "DM a reel to @paulvictortravels (with a tag note) → it auto-logs to the Reel DNA spreadsheet" flow is **live and automatic**. After the webhook approach hit a wall (Instagram only delivers real-DM webhooks once the app is *published* + App-Review'd — dev mode delivers only the synthetic "Test" event), we **pivoted to polling the Business-Suite Instagram inbox**. A new `GET/POST /api/ig/sync` reads the Page's Instagram conversations, pulls each shared reel's permalink from `shares.data[].link`, pairs it with the adjacent tag-note text message, and inserts a `reel_dna` row (`source='ig_dm'`, deduped on the share-message id). A **15-min Hetzner cron** runs it; `parseTagNote` on the frontend splits the note into Location/Music/Font columns. **33 reels captured live.**

**Where:** `backend-handoff/ig_webhook.py` (added `/sync` + `_do_sync` + `_list_ig_conversations` + `_existing_ext_refs` dedup pre-check; webhook handler kept for the future published path) → deployed to Hetzner `backend/app/api/`. Hetzner `deploy/hetzner/.env` + compose: `IG_APP_SECRET`, `IG_SYNC_SECRET`, `FEATURE_IG_DM_INGEST=1`, `FEATURE_IG_DM_DEBUG=0`. New root crontab line `*/15 * * * * curl .../api/ig/sync`. Committed `01046fd`; Vercel redeploy (frontend unchanged — feature is backend-only).

**Path we took:** Built + deployed the webhook handler first; Meta verified the callback but delivered **zero** real-DM POSTs (only the dashboard "Test"). Chased it down through: wrong signing secret → correct payload parsing → page/IG subscription → tester roles → and finally the dashboard's own note *"To receive webhooks, your app must be in published state."* Rather than go through App Review, used the user's idea — read the messages already landing in Business Suite. A read-only probe proved the Page conversations endpoint was accessible (it 500'd on volume, not permission), and the reel link was sitting in `shares.data[].link`. Built the poller, paginated around the conversations 500, made it async to dodge nginx's 60s timeout, added a dedup pre-check, and cron'd it.

**What we learned:** (1) **Real Instagram DM webhooks require the app to be Published/Live + Advanced Access** (App Review for `instagram_business_manage_messages`) — Development mode only emits Meta's synthetic Test event, never real messages. (2) The **"Instagram API with Instagram Login" signs webhooks with a SEPARATE Instagram App Secret**, not the Facebook App Secret — verification needs `IG_APP_SECRET`. (3) Instagram's webhook payload is `entry[].changes[].value` where `value` *is* the message (`{sender,recipient,message{mid,text,attachments}}`), not `entry[].messaging[]`. (4) **The reliable, no-review path: poll** — `GET /{page-id}/conversations?platform=instagram`; the shared reel's permalink is in the message's `shares.data[].link`, and the tag note is a separate text message (same sender, ~same second). (5) The conversations edge **500s (subcode 99) when asked for >1 at a time** — paginate `limit=1` following `paging.next`. (6) A long sync **504s at nginx's 60s** even though the work completes — run it via `asyncio.create_task` and return immediately for the cron. (7) Dev-mode delivery needs **both** sender and receiver as *accepted* Instagram Testers; you can't DM your own account (test from a second one). (8) Cost: the cron hits Hetzner (not Vercel) — **zero website-traffic impact**; the dedup pre-check keeps steady-state Supabase writes at ~0.

**Status:** **LIVE.** Poller deployed to Hetzner, 15-min cron running, 33 reels captured, committed + deployed. The webhook handler stays dormant (works only if the app is later published). **Follow-ups:** rotate the `IG_APP_SECRET` + IG access tokens that were pasted in chat; delete the one leftover `(debug …)` row from the spreadsheet; branch `bugfix-daily-use-batch` still unpushed to GitHub/main.

## 2026-06-18 — Pulse: automated news/RSS ingestion (algorithm updates + world news)

**What changed:** Built the automated half of the owner-only **Pulse** monitor. The owner curates RSS/Atom feeds in a **Sources** manager (add/toggle/delete, with per-feed health); a scheduler pulls each feed's latest items, classifies them (free OpenRouter, falling back to per-source defaults), dedups, and writes them into the Pulse feed as `source_type='poller'`. A **Refresh now** button does an on-demand pull; a **Hetzner cron** runs it every 30 min. Added a **News Monitor health card** on the Monitor page and a **60-day retention prune** so the table stays bounded. (This session also covers the manual Pulse feature itself — tab, store slice, feed UI, manual entry — which had been built but never committed.)

**Where:** Migrations `0059_monitor_events.sql`, `0060_monitor_sources.sql`, `0061_monitor_events_dedup_full_index.sql`. NEW `api/ai/_rss.js` (zero-dep RSS/Atom parser + classify + ingest + prune); `api/ai/suggest.js` gained `?action=news-ingest`. Store slice in `src/store/store.jsx`. UI: `src/components/pulse-sources.jsx`, the other `pulse-*` components, `src/pages/pulse.jsx`/`.css`, and a card in `src/pages/monitor.jsx`. Committed as `4455424`; deployed to prod (vercel `--prod`); Hetzner crontab updated.

**Path we took:** Reused the proven `suggest.js` cron pattern (dual auth: `?secret=` or owner JWT, `maxDuration: 45`) and folded the ingest in as a new `?action=` — **no new Vercel function** (we're at the 12-cap). Chose a zero-dependency XML parser over `rss-parser`/`fast-xml-parser` to avoid an install + keep the serverless bundle small; verified it against live BBC (RSS) and YouTube (Atom). Automation = Hetzner crontab curling the endpoint (matches the existing insights cron), classification = AI-with-source-default-fallback. First live run inserted 0 with an error on every feed; fixing that (below) then ingested 30 articles, second run 0 (dedup proven).

**What we learned:** (1) **The partial unique index breaks upserts.** `monitor_events`' dedup index from 0059 was `... WHERE external_id IS NOT NULL` — Postgres won't use a partial index as an `ON CONFLICT` arbiter (PostgREST can't pass the predicate), so every ingest failed with *"no unique or exclusion constraint matching the ON CONFLICT specification"* and inserted 0. **Fix:** 0061 swaps it for a full unique index on `(source_type, external_id)`; NULLs are DISTINCT by default so manual rows (NULL external_id) are still multiply-allowed. (This is the same partial-index-vs-ON CONFLICT trap the IG-DM webhook hit with `42P10` — worth remembering as a project-wide gotcha.) (2) **The apex domain 308-redirects to `www`** for API routes — `curl` without `-L` from Hetzner just gets "Redirecting...", so the cron must hit `www.footagebrain.com` directly. The pre-existing insights cron was on the apex and had been silently hitting the redirect; fixed both crontab lines to `www` this session. (3) `SUGGEST_CRON_SECRET` is **absent** from `.env.local` (real value `fbai_cron_2026` lives only on Hetzner/Vercel) — added it locally. (4) Realtime only pushes rows inserted *while the tab is open*; server-side cron inserts need a page reload to appear — not a bug.

**Status:** **LIVE on prod** (footagebrain.com). Migrations 0059–0061 applied to Supabase; deployed; Hetzner cron every 30 min (verified `{ok, sources, inserted, pruned, errors}`). Owner adds feeds via Pulse → Sources. 30 real articles flowing, dedup + prune verified.

## 2026-06-17 — Instagram DM → Reel DNA spreadsheet (backend webhook handler drafted)

**What changed:** Drafted the Hetzner backend piece that completes the "DM a reel to @paulvictortravels → it logs to the Reel DNA spreadsheet" flow. A FastAPI router (`GET/POST /api/ig/webhook`) verifies Meta's handshake, validates `X-Hub-Signature-256` over the raw body, pulls the shared-reel URL + the sender's typed tag note out of the `messages` payload, and inserts a `reel_dna` row (`source='ig_dm'`, `quick_notes`=the note) via the service role — deduped on the IG message id. The dashboard already shows it live via realtime + `parseTagNote`. Built with a **calibration mode** (`FEATURE_IG_DM_DEBUG`) that logs the raw payload and, when no reel URL is found, captures the raw event JSON into a spreadsheet row so the real IG payload shape is observable from one live test.

**Where:** NEW `backend-handoff/ig_webhook.py` (deploy target: Hetzner `backend/app/api/`), NEW `backend-handoff/IG-DM-DEPLOY.md` (step-by-step deploy + Meta config + calibration). No Vercel-app code (the frontend half shipped already).

**Path we took:** Paul asked to build the IG-message-to-self path. Scouting confirmed the frontend + realtime + parser were done; the only gap was the webhook handler, which lives on the SSH-only Hetzner backend (not in this repo). Mirrored the existing `whatsapp.py` router pattern (env-only secrets, always-200 ack, service-role REST insert) and the `docs/reel-dna-ig-webhook.md` spec, adding `message.text` capture for the tags. Assessed end-to-end confidence at ~55–65% on first try — the unknowns are Meta's messaging permission and the exact reel-share payload shape — so baked in the debug/calibration path to make the first real share maximally informative.

**What we learned:** You can't DM your own IG account, so the test is a share from a *second* account → @paulvictortravels. The signature must be HMAC'd over the **raw** request bytes (read `await request.body()` before `json.loads`). The signature reuses the existing **`FB_APP_SECRET`** (same Meta app as FB OAuth) — no new secret needed. Dedupe: PostgREST `?on_conflict=external_ref` **fails with `42P10`** because `reel_dna_external_ref_uidx` is a *partial* index (`WHERE external_ref IS NOT NULL`) and PostgREST won't accept a partial index as the conflict arbiter — so the handler does a plain insert and treats the resulting `409` (unique violation on Meta retries) as "already captured." Live stack is `deploy/hetzner/docker-compose.yml` (NOT the root `docker-compose.yml`), backend code is **baked into the image** (no source bind-mount) so adding the router needs a `docker compose build`.

**Status:** **Backend DEPLOYED to Hetzner and verified live** (2026-06-17). `ig_webhook.py` copied to `backend/app/api/`, registered in `app/api/__init__.py`, env added to `deploy/hetzner/.env` (`IG_WEBHOOK_VERIFY_TOKEN`, `FEATURE_IG_DM_DEBUG=1`, `FEATURE_IG_DM_INGEST=1`) + compose passthrough, image rebuilt, container recreated. Verified: handshake echoes the challenge, `GET /api/ig/status` healthy, bad-sig→403 / good-sig→200, service-role insert + 409-dedupe both proven (test rows cleaned up), existing `/api/auth/facebook/status` still 200. **Remaining (owner-only, web console):** Meta app → add `instagram_manage_messages` + Webhooks subscription (callback `https://api.footagebrain.com/api/ig/webhook`, verify token `footagebrain_ig_2026`, field `messages`), then a calibration share from a second account. Rollback `.bak.igwh` copies left on the server.

## 2026-06-17 — 3D spinning Reel-DNA helix on the public landing page

**What changed:** The landing-page "DNA breakdown" now renders a real **3D, slowly-spinning** double-helix (was the flat SVG `HelixFlat`). The strand eases to ~20% speed while the pointer is over it so a node is catchable; hovering a gene still lights its timeline lane (the existing co-visibility). A **3D / Classic** toggle (persisted to `localStorage`) reverts to the flat SVG, and non-WebGL visitors get Classic automatically. Then, per Paul's art direction, a visual overhaul: continuous **tube strands** (not dotted spheres); each gene is now **one base-pair crossbar** rendered as two **ACTG nucleotide molecules** (color-coded spheres + billboarded letters) tinted by the gene's identity colour; the helix is **tilted + pushed back**; the panel sits in a warm **"inside a mitochondria cell"** environment (layered gradients + fractal-noise membrane grain + slow-drifting organelle blobs + floating in-scene motes); and the helix box is stretched to match the timeline column's height.

**Where:** `src/components/dna-helix.jsx` (added `slowOnHover`/`spinFactor`, then rewrote the geometry: `StrandTube`, `LadderRungs`, `GeneCrossbar` w/ ACTG bases + letter-sprite textures, `Motes`, a static tilt group, camera `z` 8.5→10.5), `src/pages/landing.jsx` (lazy-load `DnaHelix`, a local `webglAvailable()`, `helixView` state + the 3D/Classic toggle, render swap), `src/pages/landing.css` (canvas fill via `position:absolute;inset:0`, toggle styles, lazy skeleton, the mitochondria-cell background on `.lp-helix-wrap`, and `.lp-stage--split` `align-items: start → stretch`).

**Path we took:** Planned with `/qa-verified-plan`. Exploration found the hard parts already existed: `DnaHelix` — a fully-built 3D spinning helix with the *identical* `{ genes, hoveredGene, onHoverGene, onSelectGene }` contract as the flat helix — had been written for the original landing POC but never wired into a live page, and `HomeView`/`ReelDnaView` already owned the gene↔timeline highlight. So v1 was essentially a component swap + lazy-load + a slow-on-hover prop. Paul then asked for the molecular/cellular overhaul + a classic-view toggle, which became a focused rewrite of the helix internals and the panel CSS. Verified on the dev server, then `vercel --prod`.

**What we learned:** `React.lazy(DnaHelix)` plus a **local** `webglAvailable()` copy (NOT imported from dna-helix.jsx — a static import would pull three.js into the main chunk) keeps three.js out of the landing's initial bundle — confirmed by the build: landing chunk stays ~41 kB while three.js sits in the lazy 834 kB `OrbitControls` chunk, downloaded only when a WebGL visitor views the 3D helix. Slowing the spin on **canvas-region** hover (not gene-hover) is what makes a node catchable. Each crossbar is oriented by a quaternion from local +Y to the strandA→strandB vector, converted to **Euler** for R3F's `rotation` prop (sidesteps the `quaternion`-array ambiguity). ACTG letters drawn as canvas-texture **sprites** stay readable as it spins (billboarded, no font loading). The R3F canvas needs its box pinned (`absolute; inset:0`) to dodge the flex %-height gotcha.

**Status:** **Live on prod** (www.footagebrain.com).

## 2026-06-17 — Production deploy: shipped the full working tree to prod

**What changed:** Ran `vercel --prod`, which deploys the entire working tree — so every feature that had been sitting `[LOCAL]`/`[STAGED]` is now **live** on www.footagebrain.com in one shot: the new 3D DNA helix landing, the **Reel Inspiration Library** (Reel DNA tag-note + Cards⇄Spreadsheet), the **daily-use batch** (series/playlist grouping, duplicate reel, card readability/collapse-to-title + Discuss-icon removal, Leroy → Co-Founder & CTO), the **`/space`** cinematic expansion (owner-only), and the **training pillar** modules.

**Where:** Vercel production — deployment `dpl_HVosZfDVwhCA4NpLGyUo9k7iP159`, aliased to `www.footagebrain.com`. No code change; a deploy of the existing tree. Branch `bugfix-daily-use-batch`.

**Path we took:** After the 3D helix was built and visually verified on the dev server, Paul said "make it live." Flagged that `vercel --prod` ships the *whole* tree (not just the helix) given the accumulated uncommitted work, got his go-ahead, and deployed. Vercel build ran clean (790 modules, 10.2 s). Migrations 0056/0057/0058 were already applied to the live DB, so the shipped frontend matched the schema.

**What we learned:** A single `vercel --prod` collapses all pending work onto prod simultaneously — there is no per-feature deploy from one working tree. Net effect: the long-standing "build green but not deployed" backlog cleared in one go. The branch is still **not merged to `main`** (deploy is from the working tree), so `main` lags prod — merging it is the backup step.

## 2026-06-17 — Reel Inspiration Library: tag-note auto-fill + spreadsheet view on Reel DNA

**What changed:** Turned the existing Reel DNA tab into the "1-click inspiration logger" Paul wanted. (1) A **tag-note parser** lets a one-line note like `location=Bali, music=phonk house, font=Aktiv Grotesk, sfx=whoosh @0:02` auto-populate the structured gene fields + a new `location` field + light the gene chips, instead of typing each field by hand. (2) A **Cards ⇄ Spreadsheet** toggle adds a scannable table view (Reel · Location · Music · Font · SFX · Story · Source · Status) with inline-editable cells; clicking a row's DNA/timeline button opens the **existing** `ReelDnaView` helix + `ReelDeconstructor` so the spreadsheet is the fast log and any row drops into the full visual breakdown. (3) IG-DM/manual rows whose note still holds tag syntax **parse-on-read** so columns fill even before fields are promoted.

**Where:** `src/lib/reel-dna.jsx` (new `parseTagNote()` + alias table), `src/pages/reel-dna.jsx` (parse on capture; `DnaTable` + `EditableCell`; lifted `viewing`/`deconstructing` overlays to page level so cards and rows share them; `resolveTags()` parse-on-read), `src/pages/reel-dna.css` (table + tag-hint styles), `src/store/store.jsx` (`createReelDnaCapture` passthrough for `location` + gene objects; `reelDnaFromDb`/`reelDnaToDb` carry `location`), new `supabase/migrations/0058_reel_dna_location.sql`, `docs/reel-dna-ig-webhook.md` (Phase-2 note: capture `message.text`).

**Path we took:** Started from "what's next?" → the Obsidian backlog "Reel Inspiration Library." Exploration revealed the feature was ~75% built: the `reel_dna` table already has `music/font/hook/sfx/story` + `quick_notes`, and the IG-share-to-DM → realtime pipeline already exists. So instead of a new `inspirations` table or "Library" tab, we layered onto Reel DNA — parser + spreadsheet + one `location` column. Paul then clarified the exact flow (DM a reel with tags → spreadsheet row → click to develop), which we confirmed maps onto the existing `ReelDnaView`/`ReelDeconstructor` overlays (lifted them to page scope rather than writing new viewers).

**What we learned:** The parser intentionally requires `key=value` (a bare word like "SFX" does **not** register) — this avoids ordinary prose words spuriously lighting gene chips; bare text is preserved in the quick note. `location` needs no camel/snake remap in `persistUpdateReelDna` (same name both sides), so editing it "just works." Crucially: the *Instagram DM* path is the one piece that still needs a Hetzner change — the webhook currently stores only the reel's caption in `quick_notes`; capturing Paul's typed tags requires it to also read `message.text`. The frontend parser already handles whatever lands there.

**Status:** Built locally, **build green** (790 modules). Migration `0058_reel_dna_location` **applied** to live DB (`60 applied · 0 pending`). **Not committed, not deployed.**

## 2026-06-17 — Reel card readability + collapse-to-title + removed Discuss icon

**What changed:** Reel cards on the Pipeline board are more legible and no longer spill long titles/loglines into adjacent cards. Collapsing a card now shows **only the title** (+ an Expand control) instead of leaving the id row, pill, posted-date, menu, and foot visible. Removed the always-on white **💬 "Discuss in team chat"** action button + its inline share-to-channel popover from each card (the chat-ref *count* badge that deep-links an existing conversation is kept).

**Where:** `src/components/components.jsx` (`ReelCard`), `src/styles.css` (`.reel` block + new `.reel.collapsed`; removed the dead `.reel-discuss-btn` rule).

**Path we took:** Pulled the exact requested wording from the Obsidian backlog, then made the edits in one pass. For collapse, wrapped the id-row / posted-date / pill / menu in `!collapsed` guards and blanked the foot metadata. For the discuss removal, deleted the button, popover, its `discuss*` state/handlers, and the now-unused `shareReelToChannel` / `inputStyle` / `useAuth` imports (verified each was only used by that popover before removing).

**What we learned:** The titles-spilling-into-neighbours bug was a flexbox default, not a font issue — the card's left head column inherits `min-width:auto`, so a long unbroken title forces the card wider. Fix is `min-width:0` on `.reel .head > div:first-child` plus `overflow-wrap:anywhere` on the title/note; the size/contrast bumps were secondary. Also: `components.jsx` and `roles-admin.jsx` each define their **own** module-local `inputStyle`, so removing the one in components.jsx was safe.

**Status:** Built locally, build green. **Not deployed.**

## 2026-06-17 — Duplicate reel (card menu)

**What changed:** Added a **Duplicate** option to the reel card `⋯` menu. It clones a reel into a fresh `REEL-NNN` id — title (`…(copy)`), owner, tone, stage, the full detail blob (script / beat plan / pins / rubric notes) and the attached-footage rows — so the owner can template a reel and reassign the copy to another editor. The copy starts with a clean comment thread and ungraded rubric.

**Where:** `src/store/store.jsx` (new `duplicateReel(id)` action), `src/components/components.jsx` (menu option, gated by `can("createReel")`; `showMenu` now also opens for create-capable roles).

**Path we took:** Reused the existing `nextReelId()` for numbering and mirrored the `createReelWithFootage` sequencing (dispatch optimistically, then persist the reel **before** its footage). Cloned `attachedFootage` rows for the source id with fresh `footage-<ts>-<rand>` ids pointing at the new `reel_id`.

**What we learned:** Attached footage rows carry a `reel_id` FK to `reels.id`, so the reel must be inserted first or the footage inserts race ahead and fail silently — the same ordering trap `createReelWithFootage` was written to avoid. `reelToDb` whitelists columns and drops `board_order`, so the clone naturally lands unsorted (Infinity) rather than overlapping the original's slot.

**Status:** Built locally, build green. **Not deployed.**

## 2026-06-17 — Series / playlist grouping on the Pipeline board

**What changed:** Reels can be tagged with a **series** (e.g. "Nepal series") via a "+ Series" tag in the reel detail header. The Pipeline board gets an optional **"Group by series"** toggle (persisted in localStorage, off by default) that clusters same-series reels within each cell under a thin series label; every card also shows a small series chip when tagged.

**Where:** new `supabase/migrations/0057_reel_series.sql` (`ALTER TABLE reels ADD COLUMN IF NOT EXISTS series TEXT`); `src/store/store.jsx` (`reelToDb` now maps `series`); `src/pages/detail.jsx` (series tag via the existing `editRefLink` prompt pattern); `src/pages/pipeline.jsx` (toggle + cell sort + in-cell `pipe-series-header`); `src/components/components.jsx` + `src/styles.css` (card chip + header styles).

**Path we took:** Single nullable column + reuse of existing plumbing — `reelFromDb` already passes unknown columns through via `...rest`, so only the write side (`reelToDb`) needed the field; the detail input reuses `editRefLink`, and the board reuses the `pipeline_hidden_lanes` localStorage pattern. Applied the migration with `/update-migrations` (`node scripts/migrate.mjs --apply`) → **59 applied · 0 pending**.

**What we learned:** The migration manifest (`api/monitor/migrations.manifest.json`) is regenerated automatically by the `prebuild` script on `npm run build`, so a new migration only needs the `.sql` file — no manual manifest edit. Grouping is purely a render/sort concern: clustering is done in the `cells` sort (`series` key, untagged sorts last via `￿`) and headers are emitted inline with a `React.Fragment` so drag-drop reorder stays intact.

**Status:** Migration **applied to live DB**; code built green. **Not deployed.**

## 2026-06-17 — Landing: Leroy title → Co-Founder & CTO

**What changed:** The public marketing site's Team section now lists Leroy Crosby as **"Co-Founder & CTO"** (was "Co-Founder & Creative Director").

**Where:** `src/lib/site-content.jsx` (one line in the `TEAM` array).

**Path we took:** Straight one-line edit per the Obsidian backlog.

**Status:** Built locally, build green. **Not deployed.**

## 2026-06-17 — `/space` cinematic scene expansion (7 features, multi-agent build)

**What changed:** Turned the `/space` owner-only 3D homepage into an explorable star system. (F1) Each cube face now shows its **topic name** centered, anchored to the face, hidden when it turns away. (F2) **Empty grid slots** render as dim, non-interactive boxes so the full per-face structure is visible. (F3) **Continuous-zoom camera**: scroll = smooth dolly (OrbitControls owns the wheel); a `ZoneWatcher` maps camera distance → `free` (orbit+pan to roam celestials) / `assembled` (drag-rotate) / `stacked` (zoom into the column view), with a hysteresis deadband. (F4) Galaxy spin slowed 0.12→0.045 + a large additive **nebula** on the −X "western" sky. (F5) **Metallic** gold/silver/bronze cubes (keyed per face) with `RoundedBox` edges and a baked drei `Environment` for sweeping reflections, plus a distant **sun** (opposite the black hole) with 4 orbiting planets and a real `directionalLight`. (F7) A spinning blue/purple **neutron star** with pulsing polar jets below the cube. (F8) A stylized **space-battle** vignette above (alien ships from hyperspace, a Death-Star-like station, red/green beams).

**Where:** new `src/components/space/{Galaxy,Nebula,Sun,NeutronStar,SpaceBattle}.jsx` + `celestial-shared.js`; edits to `RubikCube.jsx`, `space3d.jsx`, `space3d.css`, `space-cube-config.jsx`, `SpaceSettings.jsx`. Owner-only, lazy-loaded `space3d` chunk (now ~935 kB).

**Path we took:** `/qa-verified-plan` (Explore + Plan agents) produced a layered plan; user picked continuous-zoom, metallic palette (supersedes the earlier black+yellow idea), and fill-the-gaps slots. Executed as Senior Architect: a gate wave (config + `celestial-shared.js` extraction + Galaxy mounts) I did directly, then **4 parallel sub-agents** built the isolated set-piece files (Nebula/Sun/NeutronStar/SpaceBattle — one file each), while the cube (F1/F2/F5) and camera (F3) changes — which share `RubikCube.jsx`/`space3d.jsx` — were done directly and sequentially to avoid clobbering.

**What we learned:** (1) The two big camera landmines: OrbitControls' `enableZoom` consumes the wheel, so the old manual 480ms wheel-step handler had to be **deleted** or it double-fires; and the old `CameraRig` (damping the camera every frame) **fights** an always-mounted OrbitControls → had to be removed. (2) Distance→mode needs **hysteresis** or it flickers at a boundary; `controls.getDistance()` is null on the first frames, so fall back to `camera.position.length()`. (3) A drei `<Environment frames={1}>` bakes the cubemap once (highlights sweep as the cube rotates, no per-frame cost); `<color attach="background">` inside it tints the *env* scene only, leaving the canvas transparent over the CSS gradient. (4) directionalLight needs its `target` in the scene graph — a child `<primitive object={target}>` whose local offset cancels the group translation aims it at the origin. (5) Decorative meshes (empty slots, set-pieces) must set `raycast={()=>null}` / carry no handlers so they never steal cube clicks. (6) Parallel sub-agents are safe only for disjoint files — the 4 set-pieces qualified; the shared cube/camera files did not.

**Status:** **Built locally, build green (789 modules); NOT visually verified and NOT deployed.** Likely tuning needed on metallic brightness (ambient dropped to 0.25, per-tile gold edges removed for non-wire) and the zone thresholds / set-piece distances+scales.

## 2026-06-17 — 3D Milky-Way galaxy backdrop for `/space`

**What changed:** Added a real in-Canvas galaxy behind the cube: thousands of GPU-twinkling stationary distant stars, a Sagittarius A* black hole with photon ring + bulge glow, a tilted rotating accretion disk (hot blue-white → orange particles), a co-rotating near-star bulge, and subtle asteroids drifting in straight lines across the view. Replaced the flat SVG `StarWeb` in the 3D path (kept it for the reduced-motion/no-WebGL fallback).

**Where:** new `src/components/space/Galaxy.jsx`; mounted as the first child of the Canvas in `src/pages/space3d.jsx`.

**Path we took:** `/qa-verified-plan` → user chose realistic Milky-Way colors and to bundle the asteroids in. Implemented as `THREE.Points` + a small additive `ShaderMaterial` (custom `aColor`/`aSize`/`aPhase` attributes, GPU twinkle via a time uniform) so thousands of stars cost one draw call; mobile halves the counts.

**What we learned:** Use a **custom `aColor` attribute** + manual `attribute vec3 aColor` in the shader rather than three's auto `vertexColors`/`color` (avoids cross-version redeclaration issues); keep all additive points `depthWrite:false` + `toneMapped:false` so they layer over the transparent canvas and the black-hole sphere (default depthWrite) still occludes correctly. Build all geometry/materials in `useMemo`, dispose in `useEffect` cleanup, and never allocate in `useFrame`.

**Status:** **Built locally, build green; superseded/extended by the scene expansion above. NOT deployed.**

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
