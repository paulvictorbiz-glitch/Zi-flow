-- Pulse — owner-only monitoring feed for algo updates + world/political news.
-- Each row is one signal the owner cares about (a platform algorithm change, a
-- regional regulation, a geopolitical event that shifts content posture, etc).
-- Three intakes write here: the in-app manual form (source_type='manual'), a
-- one-shot seed from the local Obsidian vault (source_type='vault'), and a
-- Hetzner-side poller that watches feeds + classifies items (source_type='poller').
-- Modeled on 0044_reel_dna.sql (set_updated_at() trigger, DROP-then-CREATE RLS,
-- guarded realtime publication add per 0054_attached_footage_realtime.sql) and
-- the people(id) FK pattern from 0001_init.sql / 0002_auth_and_people.sql
-- (people.id is TEXT — e.g. 'paul' — not uuid). Apply via `npm run migrate:apply`.
--
-- Hetzner poller deploy: see `backend-handoff/NEWS-MONITOR.md`.

-- ── monitor_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.monitor_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   text        NOT NULL DEFAULT 'manual'
                            CHECK (source_type IN ('manual','vault','poller')),
  external_id   text,                                  -- dedup key: vault path / poller guid
  category      text        NOT NULL DEFAULT 'news'
                            CHECK (category IN ('algo','news')),
  platform      text,                                  -- free text (ig, tiktok, yt, x, ...)
  severity      text        NOT NULL DEFAULT 'info'
                            CHECK (severity IN ('info','watch','high')),
  status        text        NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new','read','archived')),
  starred       boolean     NOT NULL DEFAULT false,
  title         text        NOT NULL,
  summary       text,
  source_name   text,
  source_url    text,
  region        text,
  tags          text[]      NOT NULL DEFAULT '{}',
  published_at  timestamptz,
  -- people.id is text ('paul','alex','sam','maya', ...), NOT uuid. See 0002.
  created_by    text        REFERENCES public.people(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Dedupe guard for the vault seed + Hetzner poller: a repeated ingest of the
-- same vault path / feed guid cannot create a second row. Partial so manual
-- rows (null external_id) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS monitor_events_source_external_uidx
  ON public.monitor_events (source_type, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS monitor_events_created_idx
  ON public.monitor_events (created_at DESC);
CREATE INDEX IF NOT EXISTS monitor_events_status_idx
  ON public.monitor_events (status);
CREATE INDEX IF NOT EXISTS monitor_events_severity_idx
  ON public.monitor_events (severity);
CREATE INDEX IF NOT EXISTS monitor_events_category_idx
  ON public.monitor_events (category);
CREATE INDEX IF NOT EXISTS monitor_events_tags_gin
  ON public.monitor_events USING GIN (tags);

-- updated_at bump on every UPDATE (function defined in 0001_init.sql).
DROP TRIGGER IF EXISTS trg_monitor_events_updated_at ON public.monitor_events;
CREATE TRIGGER trg_monitor_events_updated_at
  BEFORE UPDATE ON public.monitor_events
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.monitor_events ENABLE ROW LEVEL SECURITY;

-- Pulse is owner-only: only Paul (people.role='owner') reads/writes from the
-- app. The Hetzner poller writes via service_role and re-classifies existing
-- rows on UPDATE, so service_role gets a broader FOR ALL policy (unlike 0044's
-- INSERT-only service policy).
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "owner_all_monitor_events"   ON public.monitor_events;
DROP POLICY IF EXISTS "service_all_monitor_events" ON public.monitor_events;

CREATE POLICY "owner_all_monitor_events"
  ON public.monitor_events FOR ALL
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

CREATE POLICY "service_all_monitor_events"
  ON public.monitor_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Realtime so a manual capture / vault seed / poller insert appears live in
-- the Pulse tab. Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table
-- is already a member, so only add it when it isn't (keeps the migration
-- re-runnable). Pattern mirrored from 0054_attached_footage_realtime.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'monitor_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.monitor_events;
  END IF;
END $$;
