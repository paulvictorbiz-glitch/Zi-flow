-- 0095_oc_projects.sql
-- OpenCut-AI Phase 1 (decisions A1+B1+C1) — shared OpenCut project store.
-- Holds the OpenCut SerializedProject (timeline doc + metadata) verbatim so any
-- teammate can open the same project. Coexists with the native editor's
-- edit_projects (0082/0094) — this is the iframe-embedded OpenCut fork's store.
--
-- apply is HUMAN-GATED (do NOT run migrate:apply — scoped one-off only).
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS
-- before CREATE POLICY, guarded DO $$ block for realtime). NO 'concurrently'.
-- NO RLS self-reference (the 0076 infinite-recursion class is avoided — the
-- USING/WITH CHECK is auth.role() only, never a subquery on this table).
--
-- ── reel_id TYPE NOTE (mirrors 0094) ──────────────────────────────────────────
-- reel_id is TEXT, matching public.reels.id (TEXT, per 0001_init.sql). A uuid
-- column CANNOT carry a FK to a text primary key — the migration would HARD-FAIL.
-- reel_id is nullable + ON DELETE SET NULL so a deleted reel never orphans/blocks
-- a project. STORE/EMBED: reel_id is a TEXT reel id (e.g. "r_abc"), NOT a uuid.
--
-- ── owner NOTE ────────────────────────────────────────────────────────────────
-- owner REFERENCES public.people(id) (TEXT — FootageBrain person id, e.g. "paul")
-- ON DELETE SET NULL so removing a person never deletes their projects.


-- ════════════════════════════════════════════════════════════════════════════
-- DB1 — oc_projects: NEW table (per frozen contract C2)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.oc_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner       TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  reel_id     TEXT        REFERENCES public.reels(id)  ON DELETE SET NULL,
  title       TEXT,
  project_doc JSONB       NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- DB2 — RLS: enable + single "authenticated manage" policy (mirrors 0094)
-- ════════════════════════════════════════════════════════════════════════════
-- auth.role() only — NO subquery on oc_projects (recursion class avoided).
-- One FOR ALL policy is sufficient (it already grants SELECT/INSERT/UPDATE/DELETE).

ALTER TABLE public.oc_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oc_projects authenticated manage" ON public.oc_projects;

CREATE POLICY "oc_projects authenticated manage"
  ON public.oc_projects FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- ════════════════════════════════════════════════════════════════════════════
-- DB3 — indexes
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS oc_projects_owner_idx
  ON public.oc_projects (owner);

CREATE INDEX IF NOT EXISTS oc_projects_reel_idx
  ON public.oc_projects (reel_id)
  WHERE reel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS oc_projects_updated_idx
  ON public.oc_projects (updated_at DESC);


-- ════════════════════════════════════════════════════════════════════════════
-- DB2 (cont.) — REALTIME: add oc_projects to supabase_realtime (mirrors 0094 DB6)
-- ════════════════════════════════════════════════════════════════════════════
-- ADD is additive; re-running errors with "table already member" -> swallowed by
-- EXCEPTION WHEN OTHERS THEN NULL. Mirrors 0094's exact guarded-block pattern.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.oc_projects;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
