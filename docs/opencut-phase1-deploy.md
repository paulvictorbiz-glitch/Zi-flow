# OpenCut-AI Phase 1 — deploy doc (SSO + shared timeline storage)

> **Scope:** decisions **A1 + B1 + C1** — embed the self-hosted OpenCut-AI editor in
> FootageBrain via an iframe, SSO it with the user's Supabase JWT (no OpenCut login),
> and persist the project doc (timeline JSON + metadata) to a shared `oc_projects`
> Supabase table so any teammate can open the same project. **Media import is deferred
> to Phase 1B** (projects only carry the timeline doc for now).
>
> **Two repos, never crossed:**
> - **FOOTAGEBRAIN** = `C:/Users/Mi/Downloads/ziflow project-final` (this repo; Vite, npm; Vercel)
> - **FORK** = `C:/Users/Mi/Downloads/opencut-ai` (OpenCut-AI fork; bun; Hetzner Docker)
>
> **Build state at hand-off (2026-06-24):** both build green — `npm run build` ✅ and
> `bun run build:web` ✅. Nothing committed, pushed, deployed, or migrated. Everything
> below is **HUMAN-GATED**.

---

## What ships where

| Repo | Changes | What it does |
|---|---|---|
| FOOTAGEBRAIN | `supabase/migrations/0095_oc_projects.sql` | new `oc_projects` shared table (timeline doc + metadata), team-wide RLS, realtime |
| FOOTAGEBRAIN | `src/app.jsx` | `EDITOR_EMBED_ENABLED` flag (default **OFF**) + `EDITOR_ORIGIN` |
| FOOTAGEBRAIN | `src/pages/editor.jsx` | `EmbeddedEditor` — iframe + parent-side `postMessage` SSO (`EDITOR_READY` → `FB_AUTH`) |
| FORK | `apps/web/next.config.ts` | CSP `frame-ancestors` (allows footagebrain.com to frame the editor) |
| FORK | `packages/env/src/web.ts` | 4 new optional env vars (Supabase SSO bridge) |
| FORK | `apps/web/src/lib/external-auth/{client,server}.ts` | resolve + verify the injected JWT |
| FORK | `apps/web/src/services/storage/supabase-{client,project-adapter}.ts` + `service.ts`/`types.ts` | `oc_projects`-backed projects adapter (gated on Supabase env; IndexedDB fallback otherwise) |

**The feature is inert until every step below is done AND the flag is flipped.** With
`EDITOR_EMBED_ENABLED = false` and no Supabase env on the fork, the native in-app editor
renders exactly as today and the fork behaves like upstream OpenCut (IndexedDB projects).

---

## Order of operations (do NOT skip the flag-last rule)

```
1. DNS            → editor.footagebrain.com → Hetzner (178.105.14.144)
2. Migration 0095 → scoped one-off against live Supabase
3. Fork on Hetzner→ throwaway PG + web container, with the 4 new env vars
4. Caddy          → handle editor.footagebrain.com → opencut web container
5. Smoke (direct) → load https://editor.footagebrain.com/editor/<uuid> standalone
6. Commit + push  → BOTH repos
7. Flip flag      → EDITOR_EMBED_ENABLED = true, vercel --prod  ← LAST
8. Smoke (embed)  → open the editor inside footagebrain.com
```

Rationale: prove the editor stands up and SSO works **before** the parent app starts
framing it. The flag is the only thing that exposes the iframe to users — flip it last.

---

## 1. DNS (Porkbun)

Add an A record (see memory `porkbun-dns-config.md` — mind the `*` wildcard-parking trap):

```
editor.footagebrain.com.   A   178.105.14.144
```

Wait for propagation before standing up Caddy (LE cert issuance needs the record live).

---

## 2. Migration 0095 — apply to live Supabase (HUMAN-GATED)

`oc_projects` is fully additive and idempotent. Per CLAUDE.md rule #8d, **do NOT run
`npm run migrate:apply` / `/update-migrations`** — that would also fire the held-back
0086/0092/0093. Apply **only** 0095 via a scoped one-off that mirrors `migrate.mjs
applyOne()` (`exec_sql` RPC + `schema_migrations` upsert), placed inside the project tree
so it resolves `node_modules`, run with `node --env-file=.env.local`, then deleted.

`exec_sql` is atomic per file (one plpgsql txn) — a failed apply rolls back fully; fix and
re-run. Verify afterward under a **real authenticated session** (an `anon`-key probe
silently passes `to authenticated` policies):

```sql
-- expect: table exists, RLS enabled, 3 indexes, in supabase_realtime publication
select tablename from pg_tables where tablename = 'oc_projects';
select polname from pg_policies where tablename = 'oc_projects';
```

> **reel_id / owner are TEXT** (FK → `reels.id` and `people.id`, both TEXT) — matches
> 0094. A UUID column would hard-fail the FK. Adapter leaves `owner` NULL on write (the
> injected JWT's `sub` is the auth-user UUID, not the `people.id` slug — see the long note
> at the top of `supabase-project-adapter.ts`). RLS is **team-wide** (`auth.role() =
> 'authenticated'` only) — attribution, not a per-user boundary — deliberately mirroring 0094.

---

## 3. Stand up the fork on Hetzner (HUMAN-GATED)

OpenCut keeps its **own** DB physically separate — a **throwaway Postgres** in the editor's
compose (Decision C1). It is NOT our Supabase and holds no FootageBrain data; with Phase 1
storage going to `oc_projects`, OpenCut's better-auth/PG is effectively unused but the build
expects `DATABASE_URL` to be set, so we keep the local PG service.

### 3a. Get the fork onto the box
Push the fork to its own private GitHub repo and clone onto Hetzner (or `rsync` the working
tree). Keep it OUT of the FootageBrain backend tree — it's an independent service.

### 3b. `.env.production` for the web container
The fork's web `Dockerfile` builds a Next.js `output: standalone` runner on port 3000
(compose maps host `3100:3000`). Build args use dummy values; **runtime** env is what matters.
Set the 4 new SSO-bridge vars (all are optional in the Zod schema — the build stays green
without them, but the feature is inert until they're real):

```env
# ── FootageBrain SSO bridge (NEW — packages/env/src/web.ts) ──
NEXT_PUBLIC_SUPABASE_URL=https://kjruhbaahqkuajseoojn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<FootageBrain Supabase anon key>   # SAME project as the dashboard
SUPABASE_JWT_SECRET=<Supabase project JWT secret>                # Dashboard → Settings → API → JWT Secret; verifies injected JWTs server-side
NEXT_PUBLIC_PARENT_ORIGIN=https://www.footagebrain.com           # parent that may inject FB_AUTH

# ── OpenCut's own (throwaway) — keep as-is, NOT our data ──
DATABASE_URL=postgresql://opencut:opencut@db:5432/opencut
BETTER_AUTH_SECRET=<random 32+ char>
NEXT_PUBLIC_SITE_URL=https://editor.footagebrain.com
# leave transcription/R2/Modal/AI vars at their compose defaults (Phase 1 doesn't use them)
```

> `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` MUST point at the **same**
> Supabase project as the FootageBrain dashboard — the iframe re-uses the dashboard's JWT,
> so the editor must talk to the same auth/DB. `SUPABASE_JWT_SECRET` is server-side only
> (no `NEXT_PUBLIC_`); it's how the fork verifies the injected token.

### 3c. Bring up just the web + db services
The full `docker-compose.yml` also defines Ollama and a fleet of AI services (clip/face/
tts/whisper/…) — **Phase 1 needs none of them.** Bring up only `db` and `web`:

```bash
cd opencut-ai
docker compose up -d db
docker compose up -d --build web      # builds apps/web/Dockerfile, serves :3100→:3000
docker compose ps                     # web healthy, db healthy
```

(If `serverless-redis-http`/`redis` are hard deps of `web` in your compose, bring those two
up as well — they're tiny. They are NOT used by the SSO/storage path.)

---

## 4. Caddy edge — expose editor.footagebrain.com (HUMAN-GATED)

The edge is the two-layer proxy from CLAUDE.md rule #7 (`fb-caddy` bind-mounts
`deploy/hetzner/Caddyfile`). Add a NEW site block for the editor subdomain pointing at the
opencut web container (NOT `backend:8000`). Caddy and the opencut container must share a
Docker network, or use the host-published `3100`:

```caddyfile
editor.footagebrain.com {
    reverse_proxy opencut-web:3000      # or 178.105.14.144:3100 if not on the same network
}
```

Then reload (no image rebuild): `docker exec fb-caddy caddy reload`.

> **Framing is already handled in code, not Caddy.** `next.config.ts` emits
> `Content-Security-Policy: frame-ancestors 'self' https://footagebrain.com
> https://www.footagebrain.com http://localhost:8000` and **deliberately no
> `X-Frame-Options`** (it would override frame-ancestors and break the embed). Do NOT add an
> `X-Frame-Options` header in Caddy. If you front the editor with extra Caddy headers, make
> sure you don't clobber the CSP the app sets.

---

## 5. Smoke test — direct (before flipping the flag)

```bash
curl -I https://editor.footagebrain.com/editor/00000000-0000-0000-0000-000000000000
#   → 200, and the response carries the frame-ancestors CSP header
```

Open `https://editor.footagebrain.com/projects` and `/editor/<uuid>` in a browser directly:
the editor UI should render (standalone). Without an injected JWT it falls back to its own
behavior — that's expected; the SSO path is exercised only when embedded.

---

## 6. Commit + push — BOTH repos (HUMAN-GATED)

```bash
# FORK
cd opencut-ai && git add -A && git commit && git push   # to the fork's OWN private repo

# FOOTAGEBRAIN — commit migration + embed code, flag still OFF
cd "ziflow project-final" && git add supabase/migrations/0095_oc_projects.sql src/app.jsx src/pages/editor.jsx
git commit && git push origin feat/opencut-collab-multitrack
```

> ⚠️ The FootageBrain working tree is dirty with unrelated WIP (CHANGELOG/HANDOFF/SETUP/etc.).
> Per CLAUDE.md rule #1, **stage only the OpenCut files explicitly** — never `git add -A` here.

---

## 7. Flip the flag + deploy FootageBrain (HUMAN-GATED — LAST)

In `src/app.jsx`:

```js
const EDITOR_EMBED_ENABLED = true;   // was false
```

Then per CLAUDE.md rule #1: `git status --short`, reconcile the tree (a clean, intentional
tree is a precondition — `vercel --prod` ships the ENTIRE working tree), `npm run build` to
confirm green, then `vercel --prod`. Remember the no-clean-ref==live trap: verify any
live-but-uncommitted file is preserved.

---

## 8. Smoke test — embedded

In `www.footagebrain.com`, open the editor (a reel's editor / Projects). The iframe should:
1. load `editor.footagebrain.com/editor/<id>`,
2. post `EDITOR_READY` → parent replies `FB_AUTH` with the live Supabase JWT (origin-pinned),
3. the editor authenticates silently (no OpenCut login screen),
4. saving a project writes a row to `oc_projects`; a teammate opening the same project sees it.

If framing is blocked or the iframe doesn't load within 9s, `editor.jsx` flips `frameBlocked`
and falls back — check the CSP header and `NEXT_PUBLIC_PARENT_ORIGIN`/`EDITOR_ORIGIN` match.

---

## Rollback

- **Fastest (no redeploy):** nothing — but the clean revert is to set `EDITOR_EMBED_ENABLED
  = false` and `vercel --prod`. The native editor returns; `oc_projects` rows are harmless.
- **Migration 0095** is additive (new table only) — leaving it applied is safe even with the
  app reverted. To fully remove: `DROP TABLE public.oc_projects;` (compensating migration).
- **Fork:** `docker compose stop web db` takes the editor offline; the iframe then frame-blocks
  and the parent falls back to the native editor (flag still gates exposure anyway).

---

## Phase 1B (deferred, NOT in this deploy)

Media import — fork imports media by URL-reference via a FootageBrain backend proxy
(fetch-on-demand, no Supabase blob re-upload). Seam noted in the plan; separate workflow.
