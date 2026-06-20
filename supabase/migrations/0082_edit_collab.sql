-- 0082_edit_collab.sql
-- Editor collaboration tables: live timeline state, version checkpoints, track locks.
-- auth_is_owner() SECURITY DEFINER helper already live from 0076 — reused here.

-- ── edit_projects ─────────────────────────────────────────────────────────────
-- One row per reel_dna item being edited. Stores the live timeline_json (the
-- "project file"). Autosaved on every edit (debounced 5s); manual checkpoints
-- live in edit_project_versions.
CREATE TABLE IF NOT EXISTS public.edit_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_dna_id   UUID REFERENCES public.reel_dna(id) ON DELETE SET NULL,
  created_by    TEXT REFERENCES public.people(id) ON DELETE SET NULL,
  title         TEXT,
  timeline_json JSONB NOT NULL DEFAULT '{"tracks":[],"duration":0}',
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft | template
  export_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Full unique index (NOT partial) so PostgREST upsert can use it as arbiter.
-- Per project gotcha in reference_partial-index-onconflict.md: partial indexes
-- can't be upsert arbiters, so this MUST be a full index.
CREATE UNIQUE INDEX IF NOT EXISTS edit_projects_reel_dna_id_uidx
  ON public.edit_projects(reel_dna_id)
  WHERE reel_dna_id IS NOT NULL;

ALTER TABLE public.edit_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage edit_projects"       ON public.edit_projects;
DROP POLICY IF EXISTS "authenticated view edit_projects" ON public.edit_projects;

CREATE POLICY "owner manage edit_projects"
  ON public.edit_projects FOR ALL
  USING (public.auth_is_owner())
  WITH CHECK (public.auth_is_owner());

CREATE POLICY "authenticated view edit_projects"
  ON public.edit_projects FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── edit_project_versions ─────────────────────────────────────────────────────
-- Manual checkpoint saves. Autosave does NOT write here — only "Save version"
-- button and "restore" safety-checkpoint do. Rows accumulate; prune later with
-- a cron (DELETE WHERE saved_at < now() - interval '30 days').
CREATE TABLE IF NOT EXISTS public.edit_project_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.edit_projects(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  label      TEXT,                              -- e.g. "Before color grade"
  timeline_json JSONB NOT NULL,
  saved_by   TEXT REFERENCES public.people(id) ON DELETE SET NULL,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

ALTER TABLE public.edit_project_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage edit_project_versions"       ON public.edit_project_versions;
DROP POLICY IF EXISTS "authenticated view edit_project_versions" ON public.edit_project_versions;

CREATE POLICY "owner manage edit_project_versions"
  ON public.edit_project_versions FOR ALL
  USING (public.auth_is_owner())
  WITH CHECK (public.auth_is_owner());

CREATE POLICY "authenticated view edit_project_versions"
  ON public.edit_project_versions FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── editor_locks ──────────────────────────────────────────────────────────────
-- Soft track-level ownership. Primary key on (project_id, track_id) makes the
-- second INSERT throw a unique-violation — caught by claimTrack() in
-- editor-presence.jsx as "Track just claimed by [Name]".
-- Heartbeat renewal: every 20s the active editor UPDATEs expires_at + heartbeat_at.
-- Lock is considered stale when expires_at < now() — swept by claimTrack() before
-- each new INSERT. "Release lock" button DELETEs the row immediately.
CREATE TABLE IF NOT EXISTS public.editor_locks (
  project_id   UUID NOT NULL REFERENCES public.edit_projects(id) ON DELETE CASCADE,
  track_id     TEXT NOT NULL,                   -- e.g. "video_0", "audio_1", "text_0"
  locked_by    TEXT REFERENCES public.people(id) ON DELETE CASCADE,
  locked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,                     -- now() + 30s; renewed every 20s
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, track_id)
);

ALTER TABLE public.editor_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated manage editor_locks" ON public.editor_locks;

-- All authenticated team members can claim, renew, and release locks.
-- Owner can also forcibly release any lock.
CREATE POLICY "authenticated manage editor_locks"
  ON public.editor_locks FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── Realtime publication ──────────────────────────────────────────────────────
-- Wrap each in its own BEGIN/EXCEPTION so a partial prior apply (e.g. only
-- edit_projects was added) doesn't block the rest. A CHANNEL_ERROR fires if
-- a table is missing from the publication — see reference_clean-baseline-reconciliation.md.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.edit_projects;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.edit_project_versions;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.editor_locks;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
