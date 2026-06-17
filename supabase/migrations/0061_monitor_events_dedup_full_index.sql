-- Fix: the news-monitor ingester upserts poller rows with
--   ON CONFLICT (source_type, external_id) ... DO NOTHING
-- but 0059 created that unique index as PARTIAL (WHERE external_id IS NOT NULL).
-- Postgres cannot use a partial index for ON CONFLICT inference unless the
-- statement repeats the exact predicate (PostgREST's onConflict can't), so every
-- ingest failed with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" and 0 rows landed.
--
-- A FULL unique index on (source_type, external_id) fixes the inference and keeps
-- the same dedup guarantee: manual rows have external_id = NULL, and Postgres
-- treats NULLs as DISTINCT by default, so multiple ('manual', NULL) rows are still
-- allowed — only poller/vault rows (external_id set) are deduped.

DROP INDEX IF EXISTS public.monitor_events_source_external_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS monitor_events_source_external_uidx
  ON public.monitor_events (source_type, external_id);
