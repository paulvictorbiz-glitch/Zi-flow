# footagebrain.com — local setup

This repo **is** footagebrain.com. It's a **Vite + React 18 SPA** (not Next.js —
there is no `next.config.js`). It's deployed to Vercel; the backend
(`api.footagebrain.com`) and the Supabase database are **separate live services**
the app talks to — you don't run them locally.

## Prerequisites
- **Node 20 LTS** (Vite 5; Node 18+ works, 20 recommended)
- A **login account** — there is no open signup. Ask Paul to create one for you
  in the admin panel.

## Steps
```bash
npm install
cp .env.local.example .env.local   # then paste the real values Paul sends you
npm run dev                        # opens http://localhost:8000
```

That's it. No Next.js, no Supabase CLI needed to run the app.

## Environment variables
Only the **first two** are required to boot. Everything else degrades gracefully
(the relevant page/feature just shows empty or hides) — fill them in as you need
those areas. The real values come from Paul privately (password manager / DM) —
never commit `.env.local`.

| Var | Required? | Powers |
|---|---|---|
| `VITE_SUPABASE_URL` | **yes** | auth + database (app throws on boot without it) |
| `VITE_SUPABASE_ANON_KEY` | **yes** | auth + database (app throws on boot without it) |
| `VITE_GOOGLE_MAPS_API_KEY` | optional | map on the Locations tab |
| `VITE_SCOUT_SUPABASE_URL` / `VITE_SCOUT_SUPABASE_ANON_KEY` | optional | MicroSaaS Scout tab |
| `VITE_FEEDBACK_FORM_URL` | optional | feedback link in the header |

Non-`VITE_` keys in the template (Resend, OpenRouter, Planable, Epidemic, cron
secrets, etc.) are **server-side only** — they're used by the `api/*` serverless
functions and Node scripts, **not** by `npm run dev`. You don't need them to run
the frontend and reproduce the UI locally. There is **no OpenCut env var.**

## How it connects
- **Supabase** (auth + DB) is read from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  If these are missing the app throws on boot ("Supabase env vars missing") — that's
  the #1 reason a fresh clone shows a broken/blank screen.
- The dev server **proxies** `/fb` and `/thumbnails` to the live Hetzner backend
  automatically (see `vite.config.js`), so the backend "just works."

## ⚠️ Important: dev and prod share ONE live database
`npm run dev` on your machine hits the **live production Supabase**. There is no
separate dev DB. Do not seed, bulk-edit, or run migrations without clearing it
with Paul first.

## Database schema
Migrations live in `supabase/migrations/` (see `supabase/MIGRATIONS.md`). Applying
migrations to the live DB is a production action — coordinate with Paul.

## Build / deploy
- `npm run build` produces the production bundle in `dist/`.
- Deploy is `vercel --prod` (a `git push` does NOT deploy). **`vercel --prod`
  ships the entire working tree** — but **you don't deploy.** Paul is the sole
  deployer/migrator. You work **branch + PR**; he reviews, merges, and ships.

## Working on the repo
Read **`docs/COLLAB-NOTES.md`** before you start — it's the collaborator rulebook
(branch/PR flow, what's owner-only, the shared-live-DB gotcha). Workflow in short:
```bash
git checkout -b fix/<short-name>    # branch off main, never commit to main
# ...make changes, npm run build to verify...
git push -u origin fix/<short-name> # then open a PR for Paul to review
```
