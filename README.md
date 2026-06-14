# FootageBrain

**Owner-controlled video-production pipeline & social dashboard for a small team.**

A single-operator command center that runs a 4-person video team end to end: from idea
and shoot through edit, review, publish, and post-publish analytics — with footage search,
AI assistance, social/inbox management, and infrastructure monitoring built in.

🔗 Live: **[footagebrain.com](https://footagebrain.com)** · API: `api.footagebrain.com`

---

## What it does

**Pipeline & work**
- Kanban **pipeline** board with role-based stages and per-person lanes
- **My Work** command-center dashboard (owner view) + per-member task views
- **List**, **calendar**, **archived**, and **export** views of the same work
- **Coverage** tracking and **footage-status** sheet

**Footage & AI**
- **Footage library** with brain-style search and automatic **vision tagging** of clips
- **Locations** map (Google Maps) for shoot planning
- **Generate / idea generator** — multi-model LLM ideation (Claude, OpenRouter, etc.)
- **AI Brain** — ask & suggestion endpoints with embeddings-backed retrieval
- **Lossless** in-browser trimming via `ffmpeg.wasm`

**Social & comms**
- **Analytics** across multiple platforms (Facebook / Instagram Page Insights, per-reel)
- **Unified inbox** (outbox + replies)
- **Team chat** powered by a self-hosted Rocket.Chat
- Social **OAuth connect** flows (Facebook, Instagram, YouTube)

**Admin & infra**
- Owner-only **roles admin** and user provisioning (no open signup)
- **Monitor** page: Vercel, Supabase, and Anthropic (Claude) cards — including a
  **Claude kill switch** that pauses all server-side AI usage via a single DB flag

---

## Architecture

```
                          ┌────────────────────────────────┐
        Browser  ───────▶ │  React 18 SPA (Vite)           │
                          │  hosted on Vercel              │
                          │  footagebrain.com              │
                          └───────┬───────────────┬────────┘
                                  │               │
              Supabase JS / RLS   │               │  fetch
                                  ▼               ▼
                  ┌───────────────────────┐   ┌────────────────────────────┐
                  │  Supabase             │   │  Vercel serverless (api/*) │
                  │  Postgres + Auth      │   │  • api/admin  (user mgmt)  │
                  │  Row-Level Security   │   │  • api/ai     (ask/suggest)│
                  │  on every table       │   │  • api/monitor(status)     │
                  └───────────────────────┘   │  • api/generate (LLM)      │
                                  ▲            └─────────────┬──────────────┘
                                  │                          │
                                  │                          ▼
                                  │            ┌────────────────────────────┐
                                  └────────────│  Hetzner backend (Docker)  │
                                               │  api.footagebrain.com      │
                                               │  • social OAuth callbacks  │
                                               │  • FB / IG Page Insights   │
                                               │  • Rocket.Chat + MongoDB   │
                                               │    (chat.footagebrain.com) │
                                               └────────────────────────────┘
```

- The **SPA** talks directly to Supabase for most reads/writes (gated by RLS), and calls
  **Vercel serverless functions** for owner-only mutations and AI work.
- A separate **Hetzner-hosted backend** (Dockerized) handles long-running and stateful
  work that doesn't fit Vercel's serverless model — social OAuth, platform insights, and
  the Rocket.Chat instance — exposed under `api.footagebrain.com` / `chat.footagebrain.com`.

---

## Tech stack

| Layer        | Tech |
|--------------|------|
| Frontend     | Vite + React 18 SPA (`index.html → src/main.jsx`) |
| State        | `src/store/store.jsx` — `useWorkflow()` hook, Supabase-backed |
| Auth         | Supabase Auth + `src/auth.jsx`, RLS on all tables |
| Database     | Supabase (Postgres) |
| Hosting      | Vercel (frontend + serverless API) |
| Admin/AI API | `api/admin/*`, `api/ai/*`, `api/monitor/*`, `api/generate.js` (serverless) |
| Backend      | Hetzner Docker host: social OAuth, FB/IG insights, Rocket.Chat + MongoDB |
| AI           | Anthropic Claude (`@anthropic-ai/sdk`) + OpenRouter models; owner kill switch |

---

## Repo layout

```
src/
  main.jsx            app entry
  app.jsx             root + routing/tabs
  auth.jsx            sign-in (owner-provisioned; no open signup)
  pages/              feature screens — pipeline, my-work, footage-library,
                      analytics, inbox, team-chat, monitor, generate, …
  components/         shared UI (modals, FAB, notifications, search, …)
  lib/                roster, shared-data, supabase/social/footage clients
  store/              useWorkflow() Supabase-backed state
api/
  admin/              owner-only user management (RLS-aware)
  ai/                 ask / suggest / embeddings / monitor
  monitor/            infra status
  generate.js         multi-model LLM generation
supabase/
  migrations/         SQL migrations (apply via SQL editor)
scripts/              migration runner + manifest generator
```

---

## Local development

```bash
npm install
npm run dev        # Vite dev server on http://localhost:8000
```

> ⚠️ **Dev and prod share the same Supabase database.** Running `npm run dev` on
> localhost hits the **live** DB. Don't seed or mutate data without intent.

Environment variables live in `.env.local` for the client/runner. Note that
server-side secrets used by Vercel functions are configured on the **Vercel platform**
(`vercel env add`) — `vercel dev` reads from Vercel, not from `.env.local`.

---

## Database & migrations

Migrations live in `supabase/migrations/`. A tracking table (`schema_migrations`) records
what's applied.

```bash
npm run migrate          # report pending / changed migrations
npm run migrate:apply    # apply pending migrations
npm run migrate:manifest # regenerate the migration manifest
```

For DDL that the runner can't apply automatically, paste the SQL into the Supabase
**SQL editor**.

---

## Deploy

Deployment is **Vercel CLI only**:

```bash
vercel --prod
```

> `git push` does **not** deploy. Pushing to GitHub only updates the repository (and this
> README) — it never updates the live site. Always deploy explicitly with `vercel --prod`.

---

## Notes & conventions

- **No open signup.** Accounts are created by the owner via the admin panel
  (`api/admin/*`); the sign-in screen has no "create account" option.
- **Vercel Hobby plan caps at 12 serverless functions.** Prefer RLS-gated direct Supabase
  writes (or folding logic into an existing route via `?action=`) over adding new
  `api/*` routes for owner-only mutations.
- **AI kill switch.** Server-side Claude usage can be paused instantly from the Monitor
  page via an `app_settings` flag; the gate fails *open* so a DB blip never breaks AI.
- Maintainer context lives in **`CLAUDE.md`**; current work state and recent changes are
  in **`HANDOFF.md`** and **`CHANGELOG.md`**.
