-- 0101_transcript_clips.sql
-- Content Forge — transcript_clips: searchable footage transcript SEGMENTS.
--
-- The first of three Content Forge migrations (0101 transcript_clips,
-- 0102 content_opportunities, 0103 reels.creative_brief). This table is the
-- unified, searchable store of footage transcript segments that the discovery
-- engine reads to surface ranked content opportunities.
--
-- It is populated by the Hetzner disk-ingest worker
-- (backend-handoff/content_forge.py → POST /content-forge/ingest-transcript,
-- Whisper-JSON / SRT / plain-text → clips). The Supabase-reuse path reads
-- attached_footage_items.full_transcript (migration 0024) directly and MAY also
-- denormalize into this table for unified search.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files are intentionally held back — see
-- CLAUDE.md rule 8d).
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS
-- before CREATE POLICY, guarded DO $$ block for realtime). NO 'concurrently'.
-- NO RLS self-reference (the 0076 infinite-recursion class is avoided — read is
-- auth.role() only; owner write goes through the public.auth_is_owner()
-- SECURITY DEFINER helper from migration 0076, never a subquery on this table).
--
-- ── NO-FK NOTE on footage_file_id (deliberate) ───────────────────────────────
-- footage_file_id is a SOFT ref to attached_footage_items: clips may be ingested
-- from disk files that have no attached_footage_items row yet, so an FK would
-- block ingestion. embedding uses VECTOR(1536) — pgvector confirmed enabled
-- (migration 0039).


-- ════════════════════════════════════════════════════════════════════════════
-- transcript_clips: NEW searchable transcript-segment store
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.transcript_clips (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  footage_file_id TEXT        NOT NULL,       -- soft ref to attached_footage_items; NO FK
  filename        TEXT,
  start_time      FLOAT       NOT NULL,
  end_time        FLOAT       NOT NULL,
  transcript_text TEXT        NOT NULL,
  keywords        TEXT[]      NOT NULL DEFAULT '{}',
  topics          TEXT[]      NOT NULL DEFAULT '{}',
  embedding       VECTOR(1536),               -- pgvector confirmed enabled (0039)
  language        TEXT        NOT NULL DEFAULT 'en',
  confidence      FLOAT,
  ingest_run_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- indexes — footage lookup + topic/keyword GIN search + ingest-run filter
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS transcript_clips_footage_idx    ON public.transcript_clips (footage_file_id);
CREATE INDEX IF NOT EXISTS transcript_clips_topics_gin     ON public.transcript_clips USING GIN (topics);
CREATE INDEX IF NOT EXISTS transcript_clips_keywords_gin   ON public.transcript_clips USING GIN (keywords);
CREATE INDEX IF NOT EXISTS transcript_clips_ingest_run_idx ON public.transcript_clips (ingest_run_id) WHERE ingest_run_id IS NOT NULL;

-- FULL unique index (no WHERE predicate) — the ON CONFLICT arbiter for the
-- disk-ingest upsert in content_forge.py (_upsert_transcript_clips posts
-- ?on_conflict=footage_file_id,start_time,end_time with resolution=merge-duplicates).
-- Without it that upsert hard-fails 42P10 and lands 0 clips. All three columns are
-- NOT NULL so every clip row is covered (FULL, not partial — ref the 42P10 gotcha).
CREATE UNIQUE INDEX IF NOT EXISTS transcript_clips_footage_seg_uidx
  ON public.transcript_clips (footage_file_id, start_time, end_time);


-- ════════════════════════════════════════════════════════════════════════════
-- RLS: all authenticated read; owner write (via auth_is_owner helper); service all
-- ════════════════════════════════════════════════════════════════════════════
-- DROP POLICY IF EXISTS before each CREATE POLICY (CREATE POLICY is NOT idempotent).

ALTER TABLE public.transcript_clips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_transcript_clips"   ON public.transcript_clips;
DROP POLICY IF EXISTS "owner_write_transcript_clips" ON public.transcript_clips;
DROP POLICY IF EXISTS "service_all_transcript_clips" ON public.transcript_clips;

CREATE POLICY "auth_read_transcript_clips"   ON public.transcript_clips FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "owner_write_transcript_clips" ON public.transcript_clips FOR ALL    TO authenticated USING (public.auth_is_owner()) WITH CHECK (public.auth_is_owner());
CREATE POLICY "service_all_transcript_clips" ON public.transcript_clips FOR ALL    TO service_role  USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════════════════════
-- REALTIME: add to supabase_realtime (guarded — mirrors 0095/0096/0097) so the
-- Content Forge page MAY live-update; harmless if it only polls.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.transcript_clips;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
