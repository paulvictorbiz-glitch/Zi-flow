-- 0096_oc_locks.sql
-- OpenCut-AI Phase 2 (plan clever-leaping-clover.md) — project-level
-- SINGLE-WRITER lock for the iframe-embedded OpenCut fork editor.
--
-- This is the oc_* analog of the native editor's `editor_locks` (0082) sentinel
-- lock used by src/lib/editor-collab.jsx. ONE row per OpenCut project (PK =
-- project_id) marks the current writer; stale rows self-expire via expires_at.
-- The Phase-2 collab hook sweeps expired rows then INSERTs (PK conflict ==
-- another live holder), heartbeats expires_at/heartbeat_at every 10s, and
-- subscribes postgres_changes on oc_locks over the supabase_realtime publication.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply. REQUIRES 0095 applied first (oc_projects).
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS
-- before CREATE POLICY, guarded DO $$ block for realtime). NO 'concurrently'.
-- NO RLS self-reference (the 0076 infinite-recursion class is avoided — the
-- USING/WITH CHECK is auth.role() only, never a subquery on this table).
--
-- ── NO-FK NOTE (deliberate, mirrors 0095's NULL-owner posture) ────────────────
-- project_id is uuid (the oc_projects id) but carries NO foreign key: a
-- brand-new OpenCut project has no oc_projects row until its first save, so an
-- FK would block "take control" on an as-yet-unsaved project. Stale locks
-- self-expire (expires_at), so the FK adds little. locked_by is the JWT sub
-- (auth user UUID) as plain TEXT with NO FK — people.id is a slug and
-- people.user_id is the uuid, the same reason oc_projects.owner stays NULL in
-- the Phase-1 adapter.


-- ════════════════════════════════════════════════════════════════════════════
-- DB1 — oc_locks: NEW table (per frozen contract CC2)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.oc_locks (
  project_id     UUID        PRIMARY KEY,                 -- oc_projects id; NO FK
  locked_by      TEXT,                                    -- holder = JWT sub (auth uuid) as TEXT; NO FK
  locked_by_name TEXT,                                    -- display label for the "X is editing" pill
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ                              -- claim sets now()+30s; renewed every 10s by the holder
);


-- ════════════════════════════════════════════════════════════════════════════
-- DB2 — RLS: enable + single "oc_locks authenticated manage" policy (mirrors 0095)
-- ════════════════════════════════════════════════════════════════════════════
-- auth.role() only — NO subquery on oc_locks (recursion class avoided).
-- One FOR ALL policy is sufficient (it already grants SELECT/INSERT/UPDATE/DELETE).

ALTER TABLE public.oc_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oc_locks authenticated manage" ON public.oc_locks;

CREATE POLICY "oc_locks authenticated manage"
  ON public.oc_locks FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- ════════════════════════════════════════════════════════════════════════════
-- DB3 — index (expired-sweep helper)
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS oc_locks_expires_idx
  ON public.oc_locks (expires_at);


-- ════════════════════════════════════════════════════════════════════════════
-- DB2 (cont.) — REALTIME: add oc_locks to supabase_realtime (mirrors 0095 DB6)
-- ════════════════════════════════════════════════════════════════════════════
-- ADD is additive; re-running errors with "table already member" -> swallowed by
-- EXCEPTION WHEN OTHERS THEN NULL. Mirrors 0095/0094's exact guarded-block pattern.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.oc_locks;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
