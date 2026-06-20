-- 0083_render_jobs.sql
-- Render job queue: frontend submits a timeline_json → Hetzner picks it up,
-- downloads Google Drive sources, runs ffmpeg, writes output_url.
-- Fire-and-forget + poll pattern (same as reel_deconstruct.py).

CREATE TABLE IF NOT EXISTS public.render_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_dna_id   UUID REFERENCES public.reel_dna(id) ON DELETE SET NULL,
  project_id    UUID REFERENCES public.edit_projects(id) ON DELETE SET NULL,
  project_json  JSONB NOT NULL,               -- full timeline spec sent to Hetzner
  render_mode   TEXT NOT NULL DEFAULT 'draft', -- draft (720p fast) | final (1080p+)
  status        TEXT NOT NULL DEFAULT 'queued', -- queued | rendering | done | failed
  progress      INTEGER NOT NULL DEFAULT 0,   -- 0–100 percent
  output_url    TEXT,                          -- HMAC-signed download URL when done
  output_bytes  BIGINT,
  error         TEXT,
  submitted_by  TEXT REFERENCES public.people(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Full unique index (NOT partial — per reference_partial-index-onconflict.md).
-- Enforces single-flight per reel_dna_id at the DB level. Python pre-checks
-- before INSERT; this is the safety net that rejects a second queued job.
-- Note: only one ACTIVE job per reel_dna_id — completed/failed jobs are
-- historical and can coexist. Python must check WHERE status IN ('queued','rendering')
-- rather than relying on this index alone.
CREATE INDEX IF NOT EXISTS render_jobs_active_reel_idx
  ON public.render_jobs(reel_dna_id)
  WHERE reel_dna_id IS NOT NULL AND status IN ('queued', 'rendering');

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage render_jobs"       ON public.render_jobs;
DROP POLICY IF EXISTS "authenticated view render_jobs" ON public.render_jobs;

CREATE POLICY "owner manage render_jobs"
  ON public.render_jobs FOR ALL
  USING (public.auth_is_owner())
  WITH CHECK (public.auth_is_owner());

CREATE POLICY "authenticated view render_jobs"
  ON public.render_jobs FOR SELECT
  USING (auth.role() = 'authenticated');

-- Add to realtime so the submitting client can poll status via Supabase subscription
-- rather than HTTP polling (optional but consistent with the project pattern).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.render_jobs;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
