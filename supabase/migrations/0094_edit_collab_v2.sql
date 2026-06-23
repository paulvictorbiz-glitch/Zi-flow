-- 0094_edit_collab_v2.sql
-- OpenCut editor -> collaborative multi-track workspace. Phase G of plan
-- for-my-open-cut-wild-owl.md.
--
-- apply is HUMAN-GATED (npm run migrate:apply / Supabase SQL editor).
--
-- Fully idempotent (IF EXISTS / IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
-- guarded DO $$ blocks). NO 'concurrently'. NO RLS self-reference (the 0076
-- infinite-recursion class is avoided — every USING/WITH CHECK is auth.role()
-- only, never a subquery on the same table).
--
-- ── DESIGN NOTE (RLS posture, owner-approved) ─────────────────────────────────
-- This migration OPENS edit_projects / edit_project_versions / render_jobs from
-- "owner manage" (0082/0083) to "authenticated manage". That means ANY signed-in
-- team member can write ANY project / version / draft render job. This is
-- intentional and matches the codebase Phase-1 posture (cf. edit_sessions 0025,
-- editor_locks 0082): the single-writer guarantee is APPLICATION-LEVEL — enforced
-- by the project-level `editor_locks` sentinel lock + the iAmHolder-guarded
-- autosave + read-only viewer UI, NOT by row-level security. editor_locks was
-- already "authenticated manage" in 0082 and is intentionally left untouched.
--
-- ── CONTRACT DEVIATION (FLAGGED — type-safety override) ───────────────────────
-- The frozen contract (§G / DB2) specifies `reel_id UUID REFERENCES reels(id)`.
-- BUT public.reels.id is TEXT (0001_init.sql) and public.edit_sessions.reel_id is
-- TEXT (0025). A `uuid` column CANNOT carry a foreign key to a `text` primary key
-- (Postgres: "foreign key constraint cannot be implemented ... incompatible types:
-- uuid and text") — the migration would HARD-FAIL on apply. reel_id is therefore
-- created as TEXT to match reels.id, which is also what makes the edit_sessions
-- backfill (reel_id = s.reel_id) and the reels.title lookup type-check with no
-- casts. STORE/GALLERY: reel_id is a TEXT reel id (e.g. "r_abc"), NOT a uuid.
-- (reel_dna_id stays UUID — that FK targets reel_dna(id), which IS uuid.)


-- ════════════════════════════════════════════════════════════════════════════
-- DB1 + DB2 + DB3 — edit_projects: RLS open, new columns, indexes
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.edit_projects ENABLE ROW LEVEL SECURITY;

-- DB1: open RLS (drop the 0082 owner-gate, recreate authenticated manage + view)
DROP POLICY IF EXISTS "owner manage edit_projects"         ON public.edit_projects;
DROP POLICY IF EXISTS "authenticated manage edit_projects" ON public.edit_projects;
DROP POLICY IF EXISTS "authenticated view edit_projects"   ON public.edit_projects;

CREATE POLICY "authenticated manage edit_projects"
  ON public.edit_projects FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated view edit_projects"
  ON public.edit_projects FOR SELECT
  USING (auth.role() = 'authenticated');

-- DB2: additive columns (existing id/reel_dna_id/created_by/title/timeline_json/
-- version/status/export_url/created_at/updated_at all survive untouched).
-- reel_id is TEXT (matches reels.id — see CONTRACT DEVIATION note above).
ALTER TABLE public.edit_projects
  ADD COLUMN IF NOT EXISTS reel_id       TEXT        REFERENCES public.reels(id)  ON DELETE SET NULL;
ALTER TABLE public.edit_projects
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE public.edit_projects
  ADD COLUMN IF NOT EXISTS last_editor   TEXT        REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.edit_projects
  ADD COLUMN IF NOT EXISTS locked_by     TEXT        REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE public.edit_projects
  ADD COLUMN IF NOT EXISTS locked_until  TIMESTAMPTZ;

-- DB3: indexes (keep the existing edit_projects_reel_dna_id_uidx from 0082 — NOT dropped)
CREATE INDEX IF NOT EXISTS edit_projects_updated_idx
  ON public.edit_projects (updated_at DESC);
CREATE INDEX IF NOT EXISTS edit_projects_reel_idx
  ON public.edit_projects (reel_id)
  WHERE reel_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- DB1 — edit_project_versions: RLS open
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.edit_project_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage edit_project_versions"         ON public.edit_project_versions;
DROP POLICY IF EXISTS "authenticated manage edit_project_versions" ON public.edit_project_versions;
DROP POLICY IF EXISTS "authenticated view edit_project_versions"   ON public.edit_project_versions;

CREATE POLICY "authenticated manage edit_project_versions"
  ON public.edit_project_versions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated view edit_project_versions"
  ON public.edit_project_versions FOR SELECT
  USING (auth.role() = 'authenticated');


-- ════════════════════════════════════════════════════════════════════════════
-- DB1 — render_jobs: RLS open (editors trigger DRAFT renders)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage render_jobs"         ON public.render_jobs;
DROP POLICY IF EXISTS "authenticated manage render_jobs" ON public.render_jobs;
DROP POLICY IF EXISTS "authenticated view render_jobs"   ON public.render_jobs;

CREATE POLICY "authenticated manage render_jobs"
  ON public.render_jobs FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated view render_jobs"
  ON public.render_jobs FOR SELECT
  USING (auth.role() = 'authenticated');


-- ════════════════════════════════════════════════════════════════════════════
-- DB4 — edit_ai_jobs: NEW poll table for captions / silence (mirrors render_jobs)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.edit_ai_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES public.edit_projects(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('captions', 'silence')),
  source_drive_id TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  progress        INTEGER NOT NULL DEFAULT 0,      -- 0-100 percent
  result          JSONB,                           -- {captions:[...]} | {suggestedCuts:[...]}
  error           TEXT,
  submitted_by    TEXT REFERENCES public.people(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS edit_ai_jobs_project_idx
  ON public.edit_ai_jobs (project_id, created_at DESC);

ALTER TABLE public.edit_ai_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated manage edit_ai_jobs" ON public.edit_ai_jobs;
DROP POLICY IF EXISTS "authenticated view edit_ai_jobs"   ON public.edit_ai_jobs;

CREATE POLICY "authenticated manage edit_ai_jobs"
  ON public.edit_ai_jobs FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated view edit_ai_jobs"
  ON public.edit_ai_jobs FOR SELECT
  USING (auth.role() = 'authenticated');


-- ════════════════════════════════════════════════════════════════════════════
-- DB5 — BACKFILL edit_sessions -> edit_projects (idempotent, non-destructive)
-- ════════════════════════════════════════════════════════════════════════════
-- One project per reel_id (latest edit_sessions row by updated_at). Skips any
-- reel_id that already has an edit_projects row (WHERE NOT EXISTS) so re-running
-- is a no-op. KEEPS edit_sessions intact — the legacy editor degrades gracefully.
-- The flat edit_plan.timeline array is normalized into the v2 timeline_json shape
-- (one 'video' track named 'Main video'); a missing/null timeline -> empty clips.

INSERT INTO public.edit_projects
  (reel_id, created_by, title, timeline_json, status, export_url)
SELECT DISTINCT ON (s.reel_id)
  s.reel_id,
  s.editor_id,
  COALESCE((SELECT r.title FROM public.reels r WHERE r.id = s.reel_id), 'Imported edit'),
  jsonb_build_object(
    'version', 2,
    'output',  jsonb_build_object('width', 1080, 'height', 1920, 'fps', 30, 'crf', 23),
    'duration', 0,
    'tracks',  jsonb_build_array(
      jsonb_build_object(
        'id',    'video_0',
        'type',  'video',
        'name',  'Main video',
        'clips', COALESCE(s.edit_plan -> 'timeline', '[]'::jsonb)
      )
    )
  ),
  'draft',
  s.export_url
FROM public.edit_sessions s
WHERE s.reel_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.edit_projects ep WHERE ep.reel_id = s.reel_id
  )
ORDER BY s.reel_id, s.updated_at DESC;


-- ════════════════════════════════════════════════════════════════════════════
-- DB6 — REALTIME: ensure all collab tables are in supabase_realtime
-- ════════════════════════════════════════════════════════════════════════════
-- edit_projects / edit_project_versions / editor_locks already ADDed in 0082;
-- render_jobs in 0083. ADD is additive and re-running errors with
-- "table already member" -> swallowed by EXCEPTION WHEN OTHERS THEN NULL.
-- edit_ai_jobs is the only genuinely-new member here.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.edit_projects;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.edit_project_versions;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.editor_locks;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.render_jobs;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.edit_ai_jobs;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
