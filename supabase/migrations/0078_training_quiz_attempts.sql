-- Training quiz attempts — per-person, per-module best quiz score for the
-- Training tab's interactive self-check quizzes. One row per (person, module):
-- the editor's best score on that module's quiz. The Training page upserts on
-- (person_id, module_id) keeping the best score. Modeled 1:1 on
-- 0047_training_progress.sql (RLS triad + realtime + set_updated_at trigger).
-- Apply via `npm run migrate:apply`.

-- ── training_quiz_attempts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_quiz_attempts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    text        NOT NULL,                 -- people.id ('paul', uuid, …)
  module_id    text        NOT NULL,                 -- skillKey ('cutting-pacing', …)
  score        int         NOT NULL DEFAULT 0,       -- best correct count
  total        int         NOT NULL DEFAULT 0,       -- questions in that attempt
  answers      jsonb       NOT NULL DEFAULT '[]',    -- selected answers (per-question)
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT training_quiz_attempts_person_module_uniq UNIQUE (person_id, module_id)
);

CREATE INDEX IF NOT EXISTS training_quiz_attempts_person_idx ON public.training_quiz_attempts (person_id);

-- updated_at bump on every UPDATE (function defined in 0001_init.sql).
DROP TRIGGER IF EXISTS trg_training_quiz_attempts_updated_at ON public.training_quiz_attempts;
CREATE TRIGGER trg_training_quiz_attempts_updated_at
  BEFORE UPDATE ON public.training_quiz_attempts
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.training_quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Reads open to any authenticated user so the owner can see every editor's
-- quiz scores (perspective-switcher view). Writes restricted to the person who
-- owns the row — person_id must map to the caller's people row — with the owner
-- keeping god-mode for cleanup. DROP-then-CREATE so this migration is re-runnable.
DROP POLICY IF EXISTS "auth_read_training_quiz_attempts"   ON public.training_quiz_attempts;
DROP POLICY IF EXISTS "self_insert_training_quiz_attempts" ON public.training_quiz_attempts;
DROP POLICY IF EXISTS "self_update_training_quiz_attempts" ON public.training_quiz_attempts;
DROP POLICY IF EXISTS "owner_all_training_quiz_attempts"   ON public.training_quiz_attempts;

CREATE POLICY "auth_read_training_quiz_attempts"
  ON public.training_quiz_attempts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "self_insert_training_quiz_attempts"
  ON public.training_quiz_attempts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE people.id = training_quiz_attempts.person_id
        AND people.user_id = auth.uid()
    )
  );

CREATE POLICY "self_update_training_quiz_attempts"
  ON public.training_quiz_attempts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE people.id = training_quiz_attempts.person_id
        AND people.user_id = auth.uid()
    )
  );

CREATE POLICY "owner_all_training_quiz_attempts"
  ON public.training_quiz_attempts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so a new best score reflects live (e.g. the owner watching an
-- editor's progress). Guarded so the migration stays re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'training_quiz_attempts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.training_quiz_attempts;
  END IF;
END $$;
