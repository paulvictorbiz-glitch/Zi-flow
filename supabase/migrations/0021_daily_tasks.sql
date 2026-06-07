-- Daily per-person tasks written by the owner, with checkbox completion.
-- This table was created manually; this migration makes it idempotent.
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_to  TEXT REFERENCES public.people(id) ON DELETE CASCADE,
  created_by   TEXT REFERENCES public.people(id),
  task_text    TEXT NOT NULL,
  completed    BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  task_date    DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_tasks_assigned_idx ON public.daily_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS daily_tasks_date_idx ON public.daily_tasks (task_date);

ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='daily_tasks' AND policyname='daily_tasks_select_all'
  ) THEN
    EXECUTE 'CREATE POLICY daily_tasks_select_all ON public.daily_tasks FOR SELECT USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='daily_tasks' AND policyname='daily_tasks_insert_all'
  ) THEN
    EXECUTE 'CREATE POLICY daily_tasks_insert_all ON public.daily_tasks FOR INSERT WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='daily_tasks' AND policyname='daily_tasks_update_all'
  ) THEN
    EXECUTE 'CREATE POLICY daily_tasks_update_all ON public.daily_tasks FOR UPDATE USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='daily_tasks' AND policyname='daily_tasks_delete_all'
  ) THEN
    EXECUTE 'CREATE POLICY daily_tasks_delete_all ON public.daily_tasks FOR DELETE USING (true)';
  END IF;
END
$$;
