-- World Monitor (hybrid) — monitor_event_links: attach a monitor_events row to a
-- pipeline object (a reel, a review-lane card, or a saved location). Created from the
-- Pulse "World" view link picker; mutations are owner-only from the app, with a broader
-- service_role policy mirroring 0059_monitor_events.sql. people.id is TEXT ('paul', ...),
-- NOT uuid — see 0002. Apply via `npm run migrate:apply`.

-- ── monitor_event_links ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.monitor_event_links (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES public.monitor_events(id) ON DELETE CASCADE,
  target_type text        NOT NULL CHECK (target_type IN ('reel','review_card','location')),
  target_id   text        NOT NULL,
  label       text,
  -- people.id is text ('paul','alex','sam','maya', ...), NOT uuid. See 0002.
  created_by  text        REFERENCES public.people(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Dedup guard: one link per (event, target_type, target_id). FULL unique index so it
-- is a valid ON CONFLICT / PostgREST upsert arbiter (0061 gotcha: never partial).
CREATE UNIQUE INDEX IF NOT EXISTS monitor_event_links_uidx
  ON public.monitor_event_links (event_id, target_type, target_id);

-- Helper indexes: list links for one event, and reverse-lookup links for one target.
CREATE INDEX IF NOT EXISTS monitor_event_links_event_idx
  ON public.monitor_event_links (event_id);
CREATE INDEX IF NOT EXISTS monitor_event_links_target_idx
  ON public.monitor_event_links (target_type, target_id);

ALTER TABLE public.monitor_event_links ENABLE ROW LEVEL SECURITY;

-- Owner-only from the app; service_role broad FOR ALL. Mirrors 0059_monitor_events.sql.
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "owner_all_monitor_event_links"   ON public.monitor_event_links;
DROP POLICY IF EXISTS "service_all_monitor_event_links" ON public.monitor_event_links;

CREATE POLICY "owner_all_monitor_event_links"
  ON public.monitor_event_links FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.people p
      WHERE p.user_id = auth.uid() AND p.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.people p
      WHERE p.user_id = auth.uid() AND p.role = 'owner'
    )
  );

CREATE POLICY "service_all_monitor_event_links"
  ON public.monitor_event_links FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Realtime so a new link / unlink appears live in the Pulse World view. Guarded:
-- ALTER PUBLICATION ... ADD TABLE errors if the table is already a member, so only add
-- it when it isn't (keeps the migration re-runnable). Pattern from 0059 / 0054.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'monitor_event_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.monitor_event_links;
  END IF;
END $$;
