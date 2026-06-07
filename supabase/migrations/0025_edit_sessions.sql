-- 0025_edit_sessions.sql
-- Track in-app video-edit progress per reel so the owner can see/edit where a
-- cut stands directly in the dashboard (replaces the CapCut-only signal).
-- One row per reel's active edit; the in-app editor tab reads/writes it.
--
-- NOTE: already applied manually in Supabase (run 2026-06-08); this file
-- tracks the schema in the repo.

CREATE TABLE IF NOT EXISTS public.edit_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id      TEXT NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  editor_id    TEXT,
  status       TEXT DEFAULT 'in_progress',   -- in_progress | exported | approved
  edit_plan    JSONB,                         -- ordered clips, trims, notes
  clips_used   TEXT[],                        -- footage_file_ids in the cut
  export_url   TEXT,                          -- final export link when done
  started_at   TIMESTAMPTZ DEFAULT now(),
  last_active  TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS edit_sessions_reel_idx ON public.edit_sessions(reel_id);

-- RLS: open read/write for all authenticated users (Phase-1 gating is in the
-- UI, mirroring resources/capcut_activity).
ALTER TABLE public.edit_sessions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol TEXT;
  stmt TEXT;
BEGIN
  FOREACH pol IN ARRAY ARRAY['select','insert','update','delete'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'edit_sessions' AND policyname = 'edit_sessions_' || pol || '_all'
    ) THEN
      IF pol = 'select' THEN
        stmt := 'CREATE POLICY edit_sessions_select_all ON public.edit_sessions FOR SELECT USING (true)';
      ELSIF pol = 'insert' THEN
        stmt := 'CREATE POLICY edit_sessions_insert_all ON public.edit_sessions FOR INSERT WITH CHECK (true)';
      ELSIF pol = 'update' THEN
        stmt := 'CREATE POLICY edit_sessions_update_all ON public.edit_sessions FOR UPDATE USING (true) WITH CHECK (true)';
      ELSE
        stmt := 'CREATE POLICY edit_sessions_delete_all ON public.edit_sessions FOR DELETE USING (true)';
      END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END
$$;
