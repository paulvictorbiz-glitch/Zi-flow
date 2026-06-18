-- World Monitor (hybrid) — geo intake for the existing Pulse monitor_events table.
-- A fourth source writes here: a native free-feed ingester (api/ai/_world-feeds.js)
-- that pulls USGS earthquakes, NASA FIRMS fires, and ACLED conflict events and lands
-- them as source_type='geo' rows. This migration is ADDITIVE on top of 0059_monitor_events.sql:
-- it widens the source_type CHECK, adds the four geo columns, and REUSES the existing
-- FULL unique dedup index from 0061 (do NOT add a new dedup index — see 0061 gotcha:
-- a PARTIAL index cannot be an ON CONFLICT / PostgREST upsert arbiter, error 42P10).
-- Apply via `npm run migrate:apply`.

-- ── geo columns (additive, idempotent) ─────────────────────────────────────────
-- Frozen names: lng (NOT lon) is the geo longitude column. Team B's ingest writes
-- lat/lng; Team C's auto-match reads lng. event_type ∈ earthquake|fire|conflict (free
-- text, written by the ingester); metric is the headline number (e.g. 'M5.4').
-- Other single-word geo fields the ingester emits (magnitude, place, confidence,
-- fatalities) ride through the store's ...rest mapper and are not typed here — the
-- FROZEN minimum is exactly these four columns.
ALTER TABLE public.monitor_events ADD COLUMN IF NOT EXISTS lat        double precision;
ALTER TABLE public.monitor_events ADD COLUMN IF NOT EXISTS lng        double precision;
ALTER TABLE public.monitor_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.monitor_events ADD COLUMN IF NOT EXISTS metric     text;

-- ── widen source_type CHECK to include 'geo' ───────────────────────────────────
-- 0059 created the named constraint monitor_events_source_type_check via the inline
-- CHECK on source_type. DROP-then-ADD the named constraint so this is re-runnable and
-- adds 'geo' alongside the original manual/vault/poller values.
ALTER TABLE public.monitor_events
  DROP CONSTRAINT IF EXISTS monitor_events_source_type_check;
ALTER TABLE public.monitor_events
  ADD CONSTRAINT monitor_events_source_type_check
  CHECK (source_type IN ('manual','vault','poller','geo'));

-- ── dedup index: REUSE the existing FULL unique index from 0061 ─────────────────
-- The geo ingester upserts with onConflict 'source_type,external_id' and
-- ignoreDuplicates:true. The FULL unique index monitor_events_source_external_uidx
-- created in 0061 is the arbiter. DO NOT recreate it and DO NOT add a partial index
-- (0061 gotcha). It is created here ONLY defensively (IF NOT EXISTS) so this migration
-- is self-sufficient if 0061 was somehow skipped; it is a no-op when 0061 ran.
CREATE UNIQUE INDEX IF NOT EXISTS monitor_events_source_external_uidx
  ON public.monitor_events (source_type, external_id);

-- Helper index for geo-feed map queries / type grouping in the Pulse World view.
CREATE INDEX IF NOT EXISTS monitor_events_event_type_idx
  ON public.monitor_events (event_type);
