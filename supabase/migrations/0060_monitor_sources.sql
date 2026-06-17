-- Pulse sources — owner-curated list of RSS/Atom feeds the news monitor watches.
-- Each row is one "page to monitor" (a platform newsroom, a world-news feed, ...).
-- The ingester (api/ai/_rss.js, triggered by api/ai/suggest.js?action=news-ingest)
-- reads enabled sources, fetches each feed, classifies items, and upserts them
-- into monitor_events as source_type='poller'. It writes last_fetched_at /
-- last_status / item_count back here via service_role.
-- Modeled on 0059_monitor_events.sql (set_updated_at() trigger, DROP-then-CREATE
-- RLS, guarded realtime add). people.id is TEXT ('paul', ...), NOT uuid (see 0002).
-- Apply via `npm run migrate:apply`.

-- ── monitor_sources ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.monitor_sources (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  url              text        NOT NULL,              -- RSS / Atom feed URL
  category         text        NOT NULL DEFAULT 'news'
                               CHECK (category IN ('algo','news')),
  platform         text,                              -- ig|tiktok|youtube|facebook|x|null
  region           text,
  severity_default text        NOT NULL DEFAULT 'info'
                               CHECK (severity_default IN ('info','watch','high')),
  enabled          boolean     NOT NULL DEFAULT true,
  last_fetched_at  timestamptz,                       -- updated by the ingester
  last_status      text,                              -- 'ok' | 'error: …' (per-feed health)
  item_count       integer     NOT NULL DEFAULT 0,    -- rows inserted on the last run
  created_by       text        REFERENCES public.people(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS monitor_sources_enabled_idx
  ON public.monitor_sources (enabled);
CREATE INDEX IF NOT EXISTS monitor_sources_created_idx
  ON public.monitor_sources (created_at DESC);

-- updated_at bump on every UPDATE (function defined in 0001_init.sql).
DROP TRIGGER IF EXISTS trg_monitor_sources_updated_at ON public.monitor_sources;
CREATE TRIGGER trg_monitor_sources_updated_at
  BEFORE UPDATE ON public.monitor_sources
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.monitor_sources ENABLE ROW LEVEL SECURITY;

-- Owner-only from the app; the ingester writes last_* / item_count via
-- service_role, so service gets FOR ALL. DROP-then-CREATE keeps this re-runnable.
DROP POLICY IF EXISTS "owner_all_monitor_sources"   ON public.monitor_sources;
DROP POLICY IF EXISTS "service_all_monitor_sources" ON public.monitor_sources;

CREATE POLICY "owner_all_monitor_sources"
  ON public.monitor_sources FOR ALL
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

CREATE POLICY "service_all_monitor_sources"
  ON public.monitor_sources FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Realtime so toggling/adding a source (and the ingester's last_status writes)
-- reflect live in the Sources panel. Guarded so the migration is re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'monitor_sources'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.monitor_sources;
  END IF;
END $$;
