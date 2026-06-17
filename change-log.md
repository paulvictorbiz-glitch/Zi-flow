# FootageBrain / Workflow — Feature Change Log

Living inventory of every feature and change built. Grouped by pillar, newest first within each section.

**Legend:** `[LIVE]` = deployed to prod · `[STAGED]` = built, not yet deployed · `[LOCAL]` = uncommitted / in progress  
**Counts:** ~51 commits · 61 DB migrations · 7 feature pillars

---

## How to Use This File

- Scan by pillar to see what's built in a given area
- Use status badges to know what's actually on prod vs. local
- When starting a new feature, add a `[LOCAL]` entry here first, then update to `[LIVE]` after deploy
- Detailed session narratives + lessons learned live in `CHANGELOG.md`
- Current work state lives in `HANDOFF.md`

---

## 1. Gamification & Training

| Date | Feature | Key Files / Migration | Status |
|------|---------|----------------------|--------|
| 2026-06-17 | **Per-reel rubric archive + removed redundant self-assess toggle** — Archiving a rubric sub-skill row is now scoped per-reel (was global across all reels); removed the duplicate `selfAssessRubric` toggle from the Roles matrix (kept in DEMO_ACTIONS), Monitor Gamify card is the single self-assess control | `GamifyRubricSheet.jsx`, `store.jsx`, `permissions-catalog.js` | `[LIVE]` |
| 2026-06-16 | **Gold-standard rubric revamp + sheet UX** — Rebuilt rubric around a canonical quality standard; row-by-row grading sheet with UX fixes (collapse, scroll, submit) | `GamifyRubricSheet.jsx`, migration `0053_rubric_revamp.sql` | `[LIVE]` |
| 2026-06-16 | **Grading authority follows real role** — Rubric grading permission derived from the user's actual DB role, not the previewed perspective | `src/pages/detail.jsx`, `src/components/GamifyRubricSheet.jsx` | `[LIVE]` |
| 2026-06-16 | **Skill XP, spider charts, rubric grading, editor lock** — Full gamify system: XP per skill, radar/spider chart, per-row rubric grading, editor-role lock on grading panel | `SpiderChart.jsx`, `GamifyPanel.jsx`, `GamifyWelcomePopup.jsx`, `MedalBadge.jsx`, `gamify.css`, migrations `0050–0052` | `[LIVE]` |
| 2026-06-16 | **Training pillar modules** — Structured training curriculum with module content, progress tracking, per-user completion state | `training.jsx`, `training.css`, `training-curriculum.jsx`, `TrainingProgressWidget.jsx`, migrations `0047_training_progress.sql`, `0055_training_module_content.sql` | `[LIVE]` |
| 2026-06-08 | **Reel skill tags** — Tag reels with skill categories for XP attribution | migration `0048_reel_skill_tags.sql` | `[LIVE]` |
| 2026-06-08 | **Demo sandbox** — Isolated demo mode for onboarding/testing without affecting live data | `src/lib/demo-sandbox.jsx`, migration `0049_demo_sandbox.sql` | `[LIVE]` |

---

## 2. Public Marketing Site

| Date | Feature | Key Files / Migration | Status |
|------|---------|----------------------|--------|
| 2026-06-17 | **3D spinning Reel-DNA helix (landing)** — landing breakdown now renders the real R3F `DnaHelix`: continuous tube strands, ACTG base-pair crossbars, slow-on-hover spin, "mitochondria cell" backdrop, + a 3D/Classic toggle; lazy-loaded so three.js stays off the initial bundle | `dna-helix.jsx`, `landing.jsx`, `landing.css` | `[LIVE]` |
| 2026-06-17 | **Leroy title → Co-Founder & CTO** — Team section on the public marketing site now lists Leroy Crosby as "Co-Founder & CTO" (was "Creative Director") | `src/lib/site-content.jsx` | `[LIVE]` |
| 2026-06-17 | **/space cinematic scene expansion** (owner-only) — 3D homepage became an explorable star system: per-face topic names, empty slot boxes, metallic gold/silver/bronze cubes (RoundedBox + baked Environment reflections), continuous-zoom camera (free orbit → drag-rotate → stacked columns), western nebula, sun + planets + real light, neutron star w/ jets, space-battle vignette | `Galaxy.jsx`, `Nebula.jsx`, `Sun.jsx`, `NeutronStar.jsx`, `SpaceBattle.jsx`, `celestial-shared.js`, `RubikCube.jsx`, `space3d.jsx`, `space-cube-config.jsx` | `[LIVE]` |
| 2026-06-17 | **/space 3D galaxy backdrop** (owner-only) — In-Canvas Milky-Way behind the cube: thousands of twinkling distant stars, Sgr A* black hole + accretion disk, drifting asteroids | `src/components/space/Galaxy.jsx` | `[LIVE]` |
| 2026-06-15 | **Landing batch v2** — Added studio showcase, credits modal, repositioned timeline, updated logo, founders section, platform showcase card; fixed analytics chart crash | `content-studio.jsx`, `credits-modal.jsx`, `platform-showcase.jsx`, `landing.jsx`, `landing.css` | `[LIVE]` |
| 2026-06-15 | **Reel DNA landing + Product/About/Team pages** — Full public marketing site at `/`: 3D DNA helix (R3F), co-visible timeline, product page, about page, team section | `landing.jsx`, `dna-helix.jsx`, `helix-flat.jsx`, `timeline-view.jsx`, `asset-fan.jsx`, `about-page.jsx`, `product-page.jsx`, `team-section.jsx`, `reel-dna-view.jsx` | `[LIVE]` |

---

## 3. Monitor & Infrastructure

| Date | Feature | Key Files / Migration | Status |
|------|---------|----------------------|--------|
| 2026-06-18 | **Pulse — automated news/RSS ingestion** — Owner curates RSS/Atom feeds (Sources manager); a Hetzner cron (/30m) + "Refresh now" button fetch each feed, classify items (free OpenRouter, source-default fallback), dedup, and write them into the Pulse feed as `poller` rows. Zero-dep parser, 60-day retention prune, News Monitor health card. Folded into `suggest.js?action=news-ingest` (no new Vercel fn) | `api/ai/_rss.js`, `api/ai/suggest.js`, `src/components/pulse-sources.jsx`, `src/store/store.jsx`, `src/pages/monitor.jsx`, migrations `0060_monitor_sources.sql`, `0061_monitor_events_dedup_full_index.sql` | `[LIVE]` |
| 2026-06-18 | **Pulse monitor tab (manual)** — Owner-only live feed for algorithm updates + world/political news: category/platform/severity filters, status lens, manual "Add entry" form, realtime | `src/pages/pulse.jsx`/`.css`, `src/components/pulse-feed.jsx`, `pulse-filters.jsx`, `pulse-entry-modal.jsx`, `src/app.jsx`, `permissions-catalog.js`, migration `0059_monitor_events.sql` | `[LIVE]` |
| 2026-06-17 | **`/workflow` orchestrator skill** — Runs a `/qa-verified-plan` output by spinning up one Senior Architect agent per mission-critical component, each managing implementer subagents + exactly one dedicated QA agent, across parallel waves with inter-wave gates | `.claude/skills/workflow/SKILL.md` | `[LIVE]` |
| 2026-06-17 | **Migration manifest auto-regen (prebuild)** — Monitor "Check migrations" no longer errors on a stale manifest; a `prebuild` npm hook regenerates `migrations.manifest.json` on every build (was stale 54/57) | `package.json`, `api/monitor/status.js`, `api/monitor/migrations.manifest.json`, `supabase/MIGRATIONS.md` | `[LIVE]` |
| 2026-06-17 | **`/senior-architect` skill** — Executes an approved /qa-verified-plan output task-by-task with file ownership registry, per-task sub-agent teams (3–4 agents + QA), sequential layer execution, and cross-task contamination prevention | `.claude/skills/senior-architect/SKILL.md` | `[LIVE]` |
| 2026-06-17 | **`/update-migrations` skill + schema_migrations sync** — Claude skill that auto-applies pending SQL migrations to Supabase without manual dashboard pasting; also synced 10 previously-missed migrations (0045–0053, 0055) that were applied manually | `.claude/skills/update-migrations/SKILL.md`, `scripts/migrate.mjs` | `[LIVE]` |
| 2026-06-14 | **Anthropic (Claude) monitor card + kill switch** — Monitor page card showing Claude status with a sliding toggle that pauses all server-side Claude usage (Generate, FAQ bot, daily suggestions). Gate reads from `app_settings`; fails open so a DB hiccup never breaks AI features | `src/pages/monitor.jsx`, `src/pages/monitor.css`, `api/admin/_auth.js`, `api/generate.js`, `api/ai/ask.js`, `api/ai/suggest.js`, migration `0043_anthropic_killswitch.sql` | `[LIVE]` |
| 2026-06-14 | **Migration tracking + Monitor check button** — `schema_migrations` table tracks applied/pending/changed migrations; Monitor page has a "Check Migrations" button with status summary | `supabase/migrations/`, `src/lib/` migration utils | `[LIVE]` |
| 2026-06-14 | **AI Brain tab** — Searchable FAQ + AI synthesis layer using Supabase vector search (pgvector); owner can add/edit FAQ pairs | `src/pages/ai-brain.jsx`, `src/pages/ai-brain.css`, `api/ai/ask.js`, `api/ai/suggest.js`, migrations `0039–0042` | `[LIVE]` |
| 2026-06-13 | **Rocket.Chat integration** — Self-hosted team chat at `chat.footagebrain.com` (RC 7.13.8 + MongoDB on Hetzner); Team tab iframe-embeds chat; owner Outbox panel for DMs | `src/pages/team-chat.jsx`, `src/pages/inbox.jsx`, `src/lib/social-client.js`, Hetzner `docker-compose.yml` | `[LIVE]` |
| 2026-06-13 | **Workflow insights cron** — Daily AI-generated workflow suggestions stored in Supabase; surfaced in AI Brain | migration `0042_workflow_insights.sql` | `[LIVE]` |
| 2026-05-22 | **start-all.bat** — Single launcher that starts Content Desk, FootageBrain, and Ziflow apps together | `start-all.bat`, `launch.bat` | `[LOCAL]` |

---

## 4. Social & Analytics

| Date | Feature | Key Files / Migration | Status |
|------|---------|----------------------|--------|
| 2026-06-17 | **Reel Inspiration Library (on Reel DNA)** — Tag-note parser (`location=Bali, music=phonk, font=Aktiv, sfx=…`) auto-fills the gene fields + new `location` column + chips; Cards⇄Spreadsheet toggle with inline-editable columns; clicking a row opens the existing DNA helix/timeline; parse-on-read fills IG-DM/manual rows. The 1-click logger for inspiration reels | `src/lib/reel-dna.jsx` (`parseTagNote`), `src/pages/reel-dna.jsx` (`DnaTable`/`EditableCell`), `reel-dna.css`, `store.jsx`, migration `0058_reel_dna_location.sql` | `[LIVE]` |
| 2026-06-11 | **Instagram per-reel analytics grid** — Analytics tab shows 12-reel thumbnail grid; clicking opens detail panel with 8 lifetime metrics (reach, views, likes, comments, shares, saves, interactions, avg watch time) | `src/pages/analytics.jsx`, `src/lib/social-client.js`, Hetzner `backend/app/api/instagram.py` | `[LIVE]` |
| 2026-06-11 | **Fix Instagram Page selection** — Backend now probes all FB Pages for a linked IG account instead of blindly using `pages[0]`; fixed for multi-Page accounts | Hetzner `backend/app/api/instagram.py` | `[LIVE]` |
| 2026-06-11 | **Fix Instagram insights metric format** — Switched to `metric_type=total_value` for `profile_views`; `reach` remains daily time-series. Two-call approach keeps response shape stable | Hetzner `backend/app/api/instagram.py` | `[LIVE]` |
| 2026-06-11 | **Remove deprecated `pages_messaging` FB scope** — Cleared "Invalid Scopes" error blocking all social connects; DMs disabled until Meta App Review restores scope | Hetzner `deploy/hetzner/.env`, `docker-compose.yml` | `[LIVE]` |
| 2026-06-09 | **Social OAuth accounts panel + reconnect cards** — Settings-style panel showing connection status for each platform with one-click reconnect | `src/components/social-status.jsx`, migration `0028_social_connection_health.sql` | `[LIVE]` |
| 2026-06-08 | **YouTube OAuth + social connection health** — YouTube connect flow; connection health table tracks last-checked + error state | migrations `0027_social_connections.sql`, `0028_social_connection_health.sql`, `0030_youtube_oauth_note.sql` | `[LIVE]` |

---

## 5. Pipeline / Workflow Core

| Date | Feature | Key Files / Migration | Status |
|------|---------|----------------------|--------|
| 2026-06-17 | **Series / playlist grouping** — Tag reels with a `series` (via "+ Series" in detail); Pipeline gets a "Group by series" toggle that clusters same-series reels per cell under a label + shows a card chip | `pipeline.jsx`, `detail.jsx`, `store.jsx`, `components.jsx`, `styles.css`, migration `0057_reel_series.sql` | `[LIVE]` |
| 2026-06-17 | **Duplicate reel** — `⋯` card-menu option clones a reel (title/owner/detail-blob/footages/pins) into a fresh `REEL-NNN` for reassigning to another editor | `store.jsx` (`duplicateReel`), `components.jsx` | `[LIVE]` |
| 2026-06-17 | **Reel card readability + collapse-to-title + removed Discuss icon** — Fixed long titles spilling into adjacent cards (`min-width:0` + `overflow-wrap`); collapsed cards show only the title + Expand; removed the always-on white 💬 "Discuss in team chat" button + popover (kept the chat-ref count badge) | `components.jsx`, `styles.css` | `[LIVE]` |
| 2026-06-17 | **Permission enforcement + My Work task drag-reorder** — New `moveReel` capability actually gates reel-card moves on Pipeline / My Work / List view (completed needs `moveReel && moveToCompleted`); My Work daily tasks are now drag-reorderable via a new `daily_tasks.sort_order` column + `reorderDailyTasks()` action | `permissions-catalog.js`, `pipeline.jsx`, `list-view.jsx`, `my-work.jsx`, `store.jsx`, migration `0056` | `[LIVE]` |
| 2026-06-17 | **3D "Space" alternate homepage (`/space`)** — Owner-only interactive R3F Rubik's-cube map of the app: 6 category faces (drag-to-orbit, gold frame) → labelled column grid → per-box detail (summary + stat cards + bar graph + deep-link). ⚙ panel for cube color/style + background presets; nebula starfield + shooting stars. Fully isolated + lazy-loaded; reached via ▦ pill on owner My Work | `src/pages/space3d.jsx`, `src/pages/space3d.css`, `src/components/space/*` (RubikCube, StarWeb, SpaceMenu, DetailPanel, SpaceFallback, SpaceSettings, widgets), `src/lib/space-cube-config.jsx`, `src/app.jsx`, `src/pages/my-work.jsx`, `vite.config.js` | `[LIVE]` |
| 2026-06-14 | **Nav groups + back nav + coverage pills + footage status sheet** — Sidebar nav reorganized into logical groups; back navigation; coverage pills on reel cards; footage status overlay sheet; pipeline lane hide; resources row hide; mobile CSS | `src/app.jsx`, `src/pages/coverage.jsx`, `src/pages/footage-status.jsx`, `src/pages/training.css` | `[LIVE]` |
| 2026-06-13 | **Owner My Work command-center** — Dedicated `/my-work` page for owner: task queue, pending reviews, pipeline health summary, quick-action buttons | `src/pages/my-work.jsx` | `[LIVE]` |
| 2026-06-13 | **Remember last active tab** — `localStorage` persists the last-viewed tab so page reloads return to the same view | `src/app.jsx` | `[LIVE]` |
| 2026-06-11 | **Wrap-up / continue session handoff system** — `/wrap-up` skill refreshes HANDOFF.md + appends CHANGELOG; `/continue` skill bootstraps full context on session resume | `HANDOFF.md`, `CHANGELOG.md`, `CLAUDE.md`, `~/.claude/skills/` | `[LIVE]` |
| 2026-06-07 | **Major batch: roster-driven perspectives + per-person permissions + CapCut tracker widget** — Every UI view respects the live roster; granular per-person permission flags; CapCut tracker visible in sidebar | `src/store/store.jsx`, `src/lib/permissions.jsx`, `src/lib/permissions-catalog.js`, `src/lib/roster.jsx` | `[LIVE]` |
| 2026-06-07 | **Review queue: group by submitter + in-review timer** — Review tab groups cards by who submitted; shows elapsed time since submission; Variant role uses editor layout | `src/pages/detail.jsx` | `[LIVE]` |
| 2026-06-07 | **Stop auto-reassigning card owner on stage drag** — Stage drag no longer silently overwrites the assigned owner | `src/store/store.jsx` | `[LIVE]` |
| 2026-06-07 | **Activity tab on prod** — Live per-day activity log, previously local-only, deployed | `src/pages/activity.jsx` | `[LIVE]` |
| 2026-05-22 | **Pipeline card collapse** + search modal close-on-drag fix | `src/components/fab.jsx` | `[LIVE]` |
| 2026-05-15 | **App-wide refactor: pages/components/store/lib** — Reorganized flat file structure into proper subdirectories; extracted TaskModal/ReelModal/Modal from fab.jsx; hoisted PIPELINE_LANES; deduped PIPELINE_STAGES | All `src/` files | `[LIVE]` |
| 2026-05-14 | **Initial Workflow / Ziflow app** — Pipeline kanban, reel cards, team roles, stage drag, Supabase auth+RLS, admin panel | `src/app.jsx`, `src/store/store.jsx`, `src/auth.jsx`, `api/admin/` | `[LIVE]` |

---

## 6. Footage & CapCut

| Date | Feature | Key Files / Migration | Status |
|------|---------|----------------------|--------|
| 2026-06-08 | **Vision footage tagging** — Auto-tags footage via free OpenRouter vision models; tags stored in `vision_tags` jsonb column; pipeline lane-desync fix | `src/pages/footage-library.jsx`, migration `0026_vision_tags.sql` | `[LIVE]` |
| 2026-06-08 | **OpenCut editor tab + footage transcripts + beat-titles** — Embedded OpenCut editor; transcript storage per footage item; beat-title annotations; editor read-only permissions | `src/pages/editor.jsx`, `src/pages/editor.css`, migrations `0024_footage_transcripts.sql`, `0025_edit_sessions.sql` | `[LIVE]` |
| 2026-06-08 | **Edit sessions table** — Tracks who is editing what and when for the editor-lock feature | migration `0025_edit_sessions.sql` | `[LIVE]` |
| 2026-06-04 | **CapCut near-real-time tracking + project name from disk** — Agent reads active CapCut project name from OS; splits sessions by project; near-real-time heartbeat | `tools/capcut-agent/capcut_agent.py`, `public/capcut-agent/capcut_agent.exe` | `[LIVE]` |
| 2026-06-04 | **CapCut activity monitor (private, localhost-only)** — Background Python agent polls CapCut process and POSTs heartbeats to Supabase; install.bat for team | `tools/capcut-agent/`, `public/capcut-agent/`, migration `0019_capcut_activity.sql` | `[LIVE]` |
| 2026-06-04 | **Footage card: Drive link + folder/country label** — Footage cards show Google Drive link + country/folder label; filename persists without a migration | `src/pages/footage-library.jsx`, `src/lib/footage-brain-client.js` | `[LIVE]` |
| 2026-06-04 | **Footage attach: filename typeahead + folder browser** — Attaching footage uses a searchable typeahead; folder browser available; fixed card thumbnails | `src/components/AttachedFootageList.jsx`, `src/components/FootageBrainSearch.jsx` | `[LIVE]` |
| 2026-06-04 | **Activity tab: clickable per-day drill-down** — Each day row in Activity expands to show time log, projects worked, and hourly breakdown | `src/pages/activity.jsx` | `[LIVE]` |
| 2026-06-04 | **Reel title editing + create-time persistence fix** | `src/pages/detail.jsx`, `src/store/store.jsx` | `[LIVE]` |
| 2026-06-04 | **FootageBrain search URL: environment-aware** — Search URLs resolve at runtime (not build time) so prod and dev hit the right endpoint | `src/components/FootageBrainSearch.jsx` | `[LIVE]` |
| 2026-06-04 | **CORS fix: drop Content-Type on GET calls** — GET requests to FootageBrain API no longer send Content-Type, avoiding CORS preflight failures | `src/lib/footage-brain-client.js` | `[LIVE]` |
| 2026-05-15 | **Footage library: visual/caption/multimodal search** — Three search modes against the footage index; preview link fix | `src/pages/footage-library.jsx`, `src/components/FootageBrainSearch.jsx` | `[LIVE]` |

---

## 7. AI Generate & Search

| Date | Feature | Key Files / Migration | Status |
|------|---------|----------------------|--------|
| 2026-06-03 | **Generate: country scoping (parallel, cached)** — Country-scoped footage retrieval runs search+folder lookup in parallel; file listing cached; auto-detects country from footage tags | `src/pages/idea-generator.jsx`, `api/generate.js` | `[LIVE]` |
| 2026-06-03 | **Generate: multi-model (Puter + OpenRouter) + Quick mode** — Model picker (Claude/Puter/OpenRouter); Quick mode generates faster with reduced detail; dedup prevents duplicate footage picks; Drive links on output cards | `src/pages/idea-generator.jsx`, `api/generate.js` | `[LIVE]` |
| 2026-06-03 | **Generate: full publish pack output** — AI output expanded to full production pack (script, hashtags, description, music cue, hook) instead of just a draft | `api/generate.js` | `[LIVE]` |
| 2026-06-03 | **Generate: Supabase cross-device history sync** — Generation history persisted in `generated_drafts` table; syncs across devices | migration `0013_generated_drafts.sql` | `[LIVE]` |
| 2026-06-03 | **Coverage tab** — Shows which topics/territories are covered vs. gaps in the footage library | `src/pages/coverage.jsx` | `[LIVE]` |
| 2026-06-03 | **AI Generate tab** — First version of the idea generator tab with Claude-backed script generation | `src/pages/idea-generator.jsx` | `[LIVE]` |
| 2026-06-03 | **Mobile responsive layout** — Global mobile CSS pass; key pages usable on phone | `src/pages/` CSS files | `[LIVE]` |
| 2026-05-15 | **Visual/Caption/Multimodal footage search** — Three search modes (visual similarity, caption text, combined) via FootageBrain API | `src/components/FootageBrainSearch.jsx`, `src/lib/footage-brain-client.js` | `[LIVE]` |

---

## Database Migrations (through 0061)

Schema history in order. All applied to the Supabase `kjruhbaahqkuajseoojn` project.

| # | Migration | Area |
|---|-----------|------|
| 0001 | `init.sql` | Core schema |
| 0002 | `auth_and_people.sql` | Auth + people table |
| 0003 | `realtime.sql` | Supabase realtime subscriptions |
| 0004 | `reel_blueprint.sql` | Reel cards core schema |
| 0005 | `reel_detail_blob.sql` | Reel detail JSONB blob |
| 0006 | `sla_timestamps.sql` | SLA tracking timestamps |
| 0007 | `rename_people.sql` | People table rename |
| 0008 | `archive.sql` | Archive flag on reels |
| 0009 | `attached_footage.sql` | Footage attachments to reels |
| 0010 | `stage_canonicalize.sql` | Canonical stage values |
| 0011 | `reset_reels.sql` | Reset/seed reels |
| 0012 | `delete_stuck_seed_reels.sql` | Cleanup stuck seeds |
| 0013 | `generated_drafts.sql` | AI Generate history |
| 0014 | `app_settings.sql` | App-wide settings table |
| 0015 | `update_jay_email.sql` + `fix_jay_email.sql` | Team member email fix |
| 0016 | `clear_stale_user_ids.sql` | Auth cleanup |
| 0017 | `sync_canonical_people.sql` | People sync |
| 0018 | `service_role_people_access.sql` | RLS workaround for service role |
| 0019 | `capcut_activity.sql` | CapCut session tracking |
| 0020 | `reel_extensions.sql` | Extra reel fields |
| 0021 | `daily_tasks.sql` | Daily task checklist |
| 0022 | `resources.sql` | Resources rows (links/docs) |
| 0023 | `footage_framerate.sql` | Framerate field on footage |
| 0024 | `footage_transcripts.sql` | Transcript storage |
| 0025 | `edit_sessions.sql` | Editor lock sessions |
| 0026 | `vision_tags.sql` | AI vision tags jsonb |
| 0027 | `social_connections.sql` | OAuth social accounts |
| 0028 | `social_connection_health.sql` | Connection health checks |
| 0029 | `locations.sql` | Filming locations table |
| 0030 | `youtube_oauth_note.sql` | YouTube OAuth config note |
| 0031 | `whatsapp_messages.sql` | WhatsApp message log |
| 0032 | `whatsapp_social_connection.sql` | WhatsApp connection row |
| 0033 | `locations_row_color.sql` | Color coding for locations |
| 0034 | `resource_row_color.sql` | Color coding for resources |
| 0035 | `location_reel_links.sql` | Location ↔ reel linkage |
| 0036 | `location_photos.sql` + `daily_tasks_notes.sql` | Location photos + task notes |
| 0037 | `processing_jobs.sql` | Background job queue |
| 0038 | `resource_row_hidden.sql` | Hide/show resource rows |
| 0039 | `ai_brain.sql` | AI Brain FAQ pairs |
| 0040 | `match_faq_pairs_rpc.sql` | Vector similarity RPC |
| 0041 | `faq_vector_1024.sql` | 1024-dim vector column |
| 0042 | `workflow_insights.sql` | Daily AI suggestions |
| 0043 | `anthropic_killswitch.sql` | Claude enable/disable flag |
| 0044 | `reel_dna.sql` | Reel DNA gene schema |
| 0045 | `reel_dna_timeline.sql` | Reel DNA timeline markers |
| 0046 | `reel_chat_refs.sql` | Chat message ↔ reel links |
| 0047 | `training_progress.sql` | Per-user training progress |
| 0048 | `reel_skill_tags.sql` | Skill tags on reels |
| 0049 | `demo_sandbox.sql` | Demo sandbox isolation |
| 0050 | `gamify.sql` | XP + gamify core |
| 0051 | `gamify_rubric_per_row.sql` | Per-row rubric scores |
| 0052 | `reel_gamify_difficulty.sql` | Difficulty rating on reels |
| 0053 | `rubric_revamp.sql` | Gold-standard rubric schema |
| 0054 | `attached_footage_realtime.sql` | Realtime on footage attachments |
| 0055 | `training_module_content.sql` | Training module content blobs |
| 0056 | `daily_tasks_sort_order.sql` | My Work task drag-reorder ordinal (APPLIED 2026-06-17) |
| 0057 | `reel_series.sql` | Series/playlist tag on reels (APPLIED 2026-06-17) |
| 0058 | `reel_dna_location.sql` | Location tag column on reel_dna for the inspiration spreadsheet (APPLIED 2026-06-17) |
| 0059 | `monitor_events.sql` | Pulse monitor events (algo/news feed) — owner+service RLS, realtime (APPLIED 2026-06-17) |
| 0060 | `monitor_sources.sql` | Pulse owner-curated RSS/Atom feed list for auto-ingest (APPLIED 2026-06-18) |
| 0061 | `monitor_events_dedup_full_index.sql` | Swap partial dedup index → full unique index so ingest upsert ON CONFLICT resolves (APPLIED 2026-06-18) |

---

## Deployed & Committed (as of 2026-06-17)

**The full working tree is now LIVE on www.footagebrain.com.** This session ran `vercel --prod` from branch `bugfix-daily-use-batch`, which deploys the entire tree at once — clearing the long-standing "build green but not deployed" backlog. Shipped live together: the **3D DNA helix landing**, the **Reel Inspiration Library** (Reel DNA tag-note + Cards⇄Spreadsheet), the **daily-use batch** (series/playlist grouping, duplicate reel, card readability/collapse, Leroy→CTO), the **`/space`** cinematic expansion (owner-only), and the **training pillar**. Migrations 0056/0057/0058 applied. The tree was then committed + pushed to `bugfix-daily-use-batch`.

**2026-06-18 — Pulse automated news monitor shipped.** The owner-only Pulse tab (manual feed, migration 0059) plus **automated RSS ingestion** (Sources manager, `api/ai/_rss.js` ingester via `suggest.js?action=news-ingest`, Hetzner cron /30m, 60-day prune, Monitor health card) are LIVE. Migrations 0059/0060/0061 applied; committed `4455424`; deployed `vercel --prod`. Both Hetzner cron lines moved to `www` (apex 308-redirects API routes). Commit is on `bugfix-daily-use-batch`, not yet pushed/merged.

**Still pending (does not block prod):**

- **Branch not merged to `main`.** Prod deploys from the working tree on `bugfix-daily-use-batch`; merge → `main` so the default branch matches what's live (backup/cleanliness).
- **Instagram-DM-to-self ingest — backend handler DRAFTED, deploy pending.** `backend-handoff/ig_webhook.py` (+ `backend-handoff/IG-DM-DEPLOY.md`, with a `FEATURE_IG_DM_DEBUG` calibration mode) completes the "DM a reel → Reel DNA spreadsheet" flow. Remaining is owner/SSH + Meta-console work only (SCP to Hetzner `backend/app/api/`, register the router, set env `IG_WEBHOOK_VERIFY_TOKEN`/`META_APP_SECRET`/flags, `docker compose build/up`; then Meta `instagram_manage_messages` + a Webhooks subscription on `messages`). NOT deployable from this Vercel repo — see HANDOFF.md + memory `reel-dna-ig-dm-ingest`.
- **Rocket.Chat config (owner action, no code):** set Leroy's role to reflect **Owner** (currently `admin`); disable **self-assignment** of the Owner role — both in `chat.footagebrain.com` admin.

**Next step:** merge `bugfix-daily-use-batch` → `main`; then deploy the IG-DM webhook handler to Hetzner + configure Meta (`backend-handoff/IG-DM-DEPLOY.md`).

---

*Last updated: 2026-06-18 (wrap-up #9 — Pulse automated news/RSS ingestion: Sources manager + Hetzner cron + free-LLM classify + 60-day prune + Monitor health card; fixed the partial-index ON CONFLICT bug via 0061; committed 4455424 + deployed `vercel --prod`) — update this file after each deploy or feature addition.*
