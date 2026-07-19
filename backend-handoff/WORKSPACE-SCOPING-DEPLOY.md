# Deploy runbook — Multi-client workspaces: **Footage-search `client_id` scoping** (backend + backfill)

Goal: turn on per-client (per-workspace) scoping of **Footage search** on the live Hetzner
backend, so a search issued while the SPA's active workspace is `paul` returns only Paul's
footage — **without ever returning an empty result set for pre-existing (legacy) footage.**

This runbook covers the **backend repo + live-Postgres backfill** half of the feature. The
Supabase side (migration `0115_workspaces.sql`, which scopes `public.reels`) is a *separate,
independent* human-gated step against a *different* database — see step 4 below; it does not
gate, and is not gated by, anything here.

> **Everything in this runbook is HUMAN-GATED.** The workflow produced *code + this doc only*.
> No agent ran `scp`/SSH, rebuilt the image, ran ingest, wrote to the live Postgres/Qdrant,
> applied a migration, or ran `vercel --prod`. Perform the 🟡/🔴 steps below **in the exact
> order given** — the order is the whole point of this doc (see "Why this order" at the end).

Legend: 🟢 safe/read-only/idempotent · 🟡 writes the live Hetzner Postgres · 🔴 image rebuild / live deploy

Live box: `root@178.105.14.144` · compose dir `/srv/footagebrain/footage-brain-test/deploy/hetzner`
· Postgres container `fb-postgres` (db `footagebrain`, user `fb`) · backend container `fb-backend`
(in-container code path `/app/app/api/`, `/app/app/db/`, `/app/app/search/`, `/app/app/ingest/`).

---

## The sequencing risk this runbook exists to prevent

The SPA's active workspace slug (`getActiveWorkspaceSlug()`, Team A contract) is **never null —
it defaults to `'paul'`**. So the moment the SPA field ships, **every** `/search` call carries
`client_id='paul'`. The backend filter is **fail-closed**:

```python
# backend/app/search/engine.py  _apply_filters()
if filters.client_id:
    query = query.filter(VideoFile.client_id == filters.client_id)   # excludes NULL rows
```

Pre-existing `video_files` rows were ingested **before** the `client_id` column existed, so they
are all `client_id = NULL`. `NULL = 'paul'` is false → those rows are excluded. If the SPA starts
sending `client_id='paul'` while legacy rows are still `NULL`, **every default footage search
returns EMPTY.** The fix is to stamp the legacy data `'paul'` **before** anything filters on it.

**Invariant to preserve:** the `video_files`/`scan_roots` backfill to `'paul'` must complete
**before** the SPA (`vercel --prod`) starts sending `client_id`. This runbook does the backfill in
step 1 — before both the backend rebuild (step 2) and the SPA deploy (step 3).

---

## 0. Pre-checks 🟢 (read-only — safe to run now)

```bash
# On the box. How many rows would a client_id='paul' filter currently drop? (Columns may not
# exist yet — an "column does not exist" error here just means the new backend hasn't booted,
# which is fine: step 1 creates them.)
docker exec fb-postgres psql -U fb -d footagebrain -c \
  "SELECT count(*) AS total,
          count(*) FILTER (WHERE client_id IS NULL)     AS null_client,
          count(*) FILTER (WHERE client_id = 'paul')    AS paul_client
   FROM video_files;" 2>&1 || echo "(client_id column not present yet — expected pre-deploy)"
```

Record `total` — after step 1 you expect `null_client = 0` and `paul_client = total`.

---

## 1. Backfill the live Postgres — **DO THIS FIRST** 🟡

Stamp every legacy `video_files` row (and its owning `scan_roots` row) `client_id = 'paul'`
**before** any code filters on the column. This is a pure data step; it is safe with the OLD
backend still running (the old code never reads `client_id`).

The `client_id` columns are normally created by the new backend's boot-time `_migrate_db()`
(`ADD COLUMN … VARCHAR(255)`, nullable). We create them **manually + idempotently here** so the
backfill can run *before* the backend rebuild — that is what makes step 1 strictly precede
step 2, closing the empty-search window entirely.

```bash
# (a) Ensure the additive, nullable columns + indexes exist. Idempotent — if the new backend
#     already ran _migrate_db() these are no-ops. Matches backend/app/db/session.py exactly.
docker exec fb-postgres psql -U fb -d footagebrain -v ON_ERROR_STOP=1 -c "
  ALTER TABLE scan_roots  ADD COLUMN IF NOT EXISTS client_id VARCHAR(255);
  ALTER TABLE video_files ADD COLUMN IF NOT EXISTS client_id VARCHAR(255);
  CREATE INDEX IF NOT EXISTS ix_scan_roots_client_id  ON scan_roots  (client_id);
  CREATE INDEX IF NOT EXISTS ix_video_files_client_id ON video_files (client_id);
"

# (b) Backfill. WHERE client_id IS NULL is REQUIRED — it makes the statement idempotent AND
#     guarantees an already-onboarded client's rows are never clobbered back to 'paul'.
#     Tag scan_roots FIRST, then video_files (order below), for the reason in the note.
docker exec fb-postgres psql -U fb -d footagebrain -v ON_ERROR_STOP=1 -c "
  UPDATE scan_roots  SET client_id = 'paul' WHERE client_id IS NULL;
  UPDATE video_files SET client_id = 'paul' WHERE client_id IS NULL;
"

# (c) Verify: null_client must now be 0, paul_client must equal total from step 0.
docker exec fb-postgres psql -U fb -d footagebrain -c \
  "SELECT count(*) FILTER (WHERE client_id IS NULL) AS null_client,
          count(*) FILTER (WHERE client_id = 'paul') AS paul_client,
          count(*) AS total FROM video_files;"
```

> **Why `scan_roots` too, not just `video_files` — the scanner re-stamp trap.**
> The scanner (`backend/app/ingest/scanner.py`) lazily re-stamps each file from its root on every
> scan: `if not is_new and vf.client_id != root_client_id: vf.client_id = root_client_id`. If the
> root stayed `NULL` while the files were set to `'paul'`, then `'paul' != NULL` → the **next
> ingest run would silently revert every file back to `NULL`** and re-empty search. Tagging the
> roots `'paul'` too keeps the file stamps stable across future scans. Do **not** run ingest here
> — this is just so a *later* human-run ingest doesn't undo the backfill.

> **Note — no re-embedding needed.** `client_id` filtering is **SQL-side only** (`_apply_filters`
> post-filters the vector hits against `VideoFile.client_id`). The Qdrant payload also carries a
> `client_id` string for future defense-in-depth, but `engine.py` applies **no** Qdrant
> where-filter on it today, so the legacy vectors' empty `client_id` payload is inert. The SQL
> backfill above fully resolves the empty-search risk; **do not** re-ingest / re-embed.

---

## 2. Rebuild the backend image (the `client_id` filter) 🔴 — **AFTER step 1**

`backend/app/…` in this repo is a **stale snapshot**; the live copy may be ahead. **Merge, never
blind-overwrite** (CLAUDE.md rule 7). Files this feature touches (all additive):

| File | Change |
|---|---|
| `backend/app/db/models.py` | `ScanRoot.client_id`, `VideoFile.client_id` (nullable, indexed) |
| `backend/app/db/session.py` | `_migrate_db()` adds the two columns + indexes (idempotent — no-ops after step 1) |
| `backend/app/search/engine.py` | `SearchFilters.client_id`; `_apply_filters` adds the `client_id` predicate (optional — absent ⇒ global) |
| `backend/app/api/search.py` | passes `client_id=body.client_id` into `SearchFilters` |
| `backend/app/api/schemas.py` | `client_id` on `SearchRequest` + the `ScanRoot` create/patch bodies (all `Optional`, default `None`) |
| `backend/app/api/sources.py` | accepts/retags `client_id` on `POST`/`PATCH /api/sources` (C7 onboarding) |
| `backend/app/ingest/scanner.py` | stamps `VideoFile.client_id` from the root; lazy re-stamp (see step 1 note) |
| `backend/app/ingest/embedder.py` | writes `client_id` into the Qdrant payload (defense-in-depth) |

```bash
# For EACH changed file: pull the live copy down, CRLF-safe diff vs this repo, merge by hand.
scp root@178.105.14.144:/srv/footagebrain/footage-brain-test/backend/app/search/engine.py /tmp/engine.LIVE.py
diff --strip-trailing-cr /tmp/engine.LIVE.py backend/app/search/engine.py   # inspect, MERGE — don't clobber
# …repeat for models.py, session.py, api/search.py, api/schemas.py, api/sources.py,
#    ingest/scanner.py, ingest/embedder.py … then scp the MERGED files back up.

# Rebuild from the REAL compose (baked image, not volume-mounted). Plain `up -d` won't swap it.
cd /srv/footagebrain/footage-brain-test/deploy/hetzner
docker compose build backend && docker compose up -d --force-recreate backend

# Verify the served code, in-container:
docker exec fb-backend sha256sum /app/app/search/engine.py
docker exec fb-backend python -c "import app.main"   # imports clean
```

On boot the new backend runs `init_db() → _migrate_db()`; because step 1 already created the
columns, this is a no-op. **The filter is now live but DORMANT** — the current prod SPA does not
send `client_id`, so `body.client_id` is `None`, `if filters.client_id:` is false, and search
still returns everything. Safe. (And even the instant the SPA ships in step 3, the data is already
correct, so results are non-empty.)

---

## 3. Ship the SPA field (`vercel --prod`) 🔴 — **LAST**

This is the step that makes the SPA send `client_id=getActiveWorkspaceSlug()` (`='paul'` by
default) on `/search`. Only after steps 1–2 are done:

```bash
cd <ziflow SPA repo root>
# full-tree deploy ships the WHOLE working tree (CLAUDE.md rule 1) — confirm the tree first.
vercel --prod
```

Smoke test on live: run a footage search that you know matches Paul's library → confirm it
returns results (NOT empty). This is the assertion the whole runbook protects.

---

## 4. Related human-gated steps (independent — not part of the footage sequence)

- **🟡 Supabase migration `0115_workspaces.sql`** (scopes `public.reels` — a *different* DB from
  the Hetzner Postgres above). Apply as a **scoped one-off** (`exec_sql` RPC + `schema_migrations`
  upsert, `node --env-file=.env.local`). **Do NOT** bulk `/update-migrations` — pending files are
  intentionally held back (CLAUDE.md rule 8d). The store degrades gracefully pre-0115, so this can
  land before or after the SPA deploy; landing it together with step 3 is cleanest. Verify
  `workspaces` + `reels.workspace_id` against the LIVE catalog after.
- **Onboarding a real second client** (e.g. `leroy-crosby`): tag its scan root's `client_id` at
  create time (`POST /api/sources`) and let the scanner stamp its files — then step 1's `WHERE
  client_id IS NULL` guard leaves those rows untouched. Runs the `scripts/onboard-client.mjs` /
  ingest flow, which is its own human-gated action; out of scope for this runbook.

---

## Rollback

- **Backend:** re-deploy the previous image tag (or revert the merge + rebuild). The `client_id`
  column and the backfill are additive and harmless if the filter is gone.
- **SPA:** `vercel rollback` (or redeploy the prior build) — search stops sending `client_id`,
  filter goes dormant, everything is global again.
- **Data:** the backfill is not destructive (it only filled `NULL`s). To fully undo:
  `UPDATE video_files SET client_id = NULL WHERE client_id = 'paul';` (and the same for
  `scan_roots`) — only if no real second client has been onboarded yet.

---

## Why this order (the one thing to get right)

```
1. backfill video_files + scan_roots -> 'paul'   (data correct BEFORE anything filters on it)
2. rebuild backend  (filter live but DORMANT — SPA not sending client_id yet)
3. vercel --prod    (SPA sends client_id='paul' -> filter matches the already-stamped rows)
```

At no point between these steps can a default footage search return empty:
- after 1 only: old backend ignores `client_id` → global search, unchanged.
- after 1+2: new filter present but `body.client_id` is `None` → predicate skipped → global search.
- after 1+2+3: filter active, `client_id='paul'`, and every legacy row is already `'paul'` → full
  results.

Reversing 1 and 3 (shipping the SPA before the backfill) is exactly the failure this runbook
prevents: it would blank every default search until the backfill caught up.
