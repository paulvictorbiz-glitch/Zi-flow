-- Training progress — per-person, per-module progress for the Training tab.
-- One row per (person, module): whether the module is marked done and which
-- lesson checklist items are ticked. The Training page upserts on
-- (person_id, module_id). Modeled on 0044_reel_dna.sql (RLS triad + realtime +
-- set_updated_at trigger). Apply via `npm run migrate:apply`.

-- ── training_progress ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_progress (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    text        NOT NULL,                 -- people.id ('paul', uuid, …)
  module_id    text        NOT NULL,                 -- 'm1'…'m12'
  done         boolean     NOT NULL DEFAULT false,
  lessons_done jsonb       NOT NULL DEFAULT '[]',    -- array of checked lesson indices
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT training_progress_person_module_uniq UNIQUE (person_id, module_id)
);

CREATE INDEX IF NOT EXISTS training_progress_person_idx ON public.training_progress (person_id);

-- updated_at bump on every UPDATE (function defined in 0001_init.sql).
DROP TRIGGER IF EXISTS trg_training_progress_updated_at ON public.training_progress;
CREATE TRIGGER trg_training_progress_updated_at
  BEFORE UPDATE ON public.training_progress
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;

-- Reads are open to any authenticated user so the owner can see every editor's
-- progress (powers the perspective-switcher view). Writes are restricted to the
-- person who owns the row — person_id must map to the caller's people row —
-- with the owner keeping god-mode for cleanup.
-- DROP-then-CREATE so this migration is safely re-runnable.
DROP POLICY IF EXISTS "auth_read_training_progress"   ON public.training_progress;
DROP POLICY IF EXISTS "self_insert_training_progress" ON public.training_progress;
DROP POLICY IF EXISTS "self_update_training_progress" ON public.training_progress;
DROP POLICY IF EXISTS "owner_all_training_progress"   ON public.training_progress;

CREATE POLICY "auth_read_training_progress"
  ON public.training_progress FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "self_insert_training_progress"
  ON public.training_progress FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE people.id = training_progress.person_id
        AND people.user_id = auth.uid()
    )
  );

CREATE POLICY "self_update_training_progress"
  ON public.training_progress FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE people.id = training_progress.person_id
        AND people.user_id = auth.uid()
    )
  );

CREATE POLICY "owner_all_training_progress"
  ON public.training_progress FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so a checked lesson / completed module reflects live (e.g. the owner
-- watching an editor's progress). Guarded so the migration stays re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'training_progress'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.training_progress;
  END IF;
END $$;
