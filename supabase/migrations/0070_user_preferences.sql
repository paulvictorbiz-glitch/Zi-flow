-- Per-user UI preferences (collapse state, hidden lanes, etc.)
-- Each user can only read/write their own rows via RLS.
-- Upsert key: (person_id, key) — PRIMARY KEY is the onConflict arbiter.

CREATE TABLE IF NOT EXISTS public.user_preferences (
  person_id   TEXT        NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  key         TEXT        NOT NULL,
  value       JSONB       NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_all_user_preferences"  ON public.user_preferences;
DROP POLICY IF EXISTS "owner_all_user_preferences" ON public.user_preferences;

-- Any authenticated user can read/write their own rows
CREATE POLICY "self_all_user_preferences" ON public.user_preferences FOR ALL
  USING  (person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()))
  WITH CHECK (person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()));

-- Owner can read/write any row (for admin inspection)
CREATE POLICY "owner_all_user_preferences" ON public.user_preferences FOR ALL
  USING (EXISTS (SELECT 1 FROM public.people WHERE user_id = auth.uid() AND role = 'owner'));
