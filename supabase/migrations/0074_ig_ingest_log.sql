-- IG DM reconciliation — per-message reason log for NON-happy-path outcomes only.
-- One row per share/message that was seen-but-not-captured (or errored), so the
-- "spreadsheet new-row count != IG new-DM count" gap is finally diagnosable. Keeps the
-- table small (a literal error log): successful inserts and expected dedupe-skips are
-- NEVER logged here — those counts live on ig_sync_runs. Each row FKs back to the run
-- that produced it (run row is POSTed first, so the FK is satisfied during the loop);
-- ON DELETE CASCADE so pruning a run also prunes its log rows.
-- Append-only INSERT — no upsert, so NO unique index is needed.
-- Mirrors the monitor_events RLS/realtime template (0059 + 0069 team-read) and the
-- guarded realtime publication add from 0044_reel_dna.sql. Apply via `npm run migrate:apply`.

-- ── ig_ingest_log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_ingest_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid        NOT NULL REFERENCES public.ig_sync_runs(id) ON DELETE CASCADE,
  conversation_id  text,                                 -- IG conversation id (Graph)
  message_id       text,                                 -- IG message id / external_ref
  issue_type       text        NOT NULL
                               CHECK (issue_type IN (
                                 'skipped_no_link',
                                 'multi_share_extra',
                                 'parse_fail',
                                 'insert_error',
                                 'graph_error'
                               )),
  detail           text,                                 -- human-readable reason / error body
  occurred_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ig_ingest_log_run_idx
  ON public.ig_ingest_log (run_id);
CREATE INDEX IF NOT EXISTS ig_ingest_log_issue_idx
  ON public.ig_ingest_log (issue_type);
CREATE INDEX IF NOT EXISTS ig_ingest_log_occurred_idx
  ON public.ig_ingest_log (occurred_at DESC);

ALTER TABLE public.ig_ingest_log ENABLE ROW LEVEL SECURITY;

-- Mirrors the monitor_events template: the whole authenticated 4-person team READS
-- (so the panel can group issues by issue_type for non-owners), the Hetzner poller
-- WRITES via service_role (FOR ALL), and the owner keeps god-mode FOR ALL for cleanup.
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "auth_read_ig_ingest_log"    ON public.ig_ingest_log;
DROP POLICY IF EXISTS "service_all_ig_ingest_log"  ON public.ig_ingest_log;
DROP POLICY IF EXISTS "owner_all_ig_ingest_log"    ON public.ig_ingest_log;

CREATE POLICY "auth_read_ig_ingest_log"
  ON public.ig_ingest_log FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_all_ig_ingest_log"
  ON public.ig_ingest_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "owner_all_ig_ingest_log"
  ON public.ig_ingest_log FOR ALL
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

-- Realtime so a fresh ingest-log row appears live under the IG Sync Health panel's
-- grouped issue list. Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table is
-- already a member, so only add it when it isn't (re-runnable). From 0044_reel_dna.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ig_ingest_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ig_ingest_log;
  END IF;
END $$;
