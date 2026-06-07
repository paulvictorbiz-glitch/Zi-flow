# Workflow / FootageBrain Dashboard — Claude Context

Owner-controlled video production pipeline dashboard for a 4-person team (Paul, Judy, Jay, Leroy).
Live at **footagebrain.com** (Vercel). Backend at **api.footagebrain.com** (Hetzner Docker, IP 178.105.14.144).

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

1. **Deploy = `vercel --prod` only.** `git push` does NOT deploy. Never assume a push updated the live site.
2. **Dev and prod share the same Supabase database.** `npm run dev` on localhost hits the live DB. Never seed or mutate without confirming with user.
3. **File edits are pre-approved.** No need to ask "is it ok to edit X?" — proceed directly.
4. **No open signup.** Registration is owner-only via the admin panel (`/api/admin/create-user`). The sign-in screen has no "Create account" option.
5. **Vercel env vars ≠ `.env.local`.** `vercel dev` reads from the Vercel platform, not `.env.local`. Server-side secrets must be set via `vercel env add` AND in `.env.local`.

---

## Admin API — known constraints

- **RLS blocks service_role on `people` table.** The RLS policy uses `auth.role() = 'authenticated'`; service_role returns `'service_role'` which fails it. Workaround in `api/admin/_auth.js`: use the caller's JWT with the service role key as apikey so PostgREST sees `'authenticated'`.
- **`auth.admin.createUser()` requires a valid service role key** sent to Supabase Auth API. If this call returns "User not allowed", the most likely cause is the key stored in Vercel being truncated.
- **`api/admin/activate-slot.js`** links an existing unclaimed `people` slot to a new auth user. Requires migration 0018 to be run so the service role can read/write the `people` table.

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

- `src/lib/roster.jsx` — RosterProvider, useRoster(), module-level cache for store
- `src/lib/shared-data.jsx` — ROLES, STAGES, STAGE_ROLE (static); PEOPLE/PIPELINE_LANES removed
- `src/auth.jsx` — sign-in only (no signup), ClaimIdentityScreen shows "ask Paul" message
- `api/admin/_auth.js` — verifyOwner() with JWT workaround for RLS
- `supabase/migrations/` — apply manually in Supabase SQL editor

---

## Deeper context

Full memory files: `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\`
Current work state: see `current-state.md` in that directory
