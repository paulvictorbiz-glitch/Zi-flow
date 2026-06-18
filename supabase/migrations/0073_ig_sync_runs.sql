-- IG DM reconciliation — one row per `_do_sync()` run of the Hetzner IG poller
-- (`backend-handoff/ig_webhook.py`, runs every 15 min + on Refresh via ?action=ig-sync).
-- Holds the per-run counters the "IG Sync Health" panel reads (headline + mismatch
-- math): how many conversations/messages/shares the Graph API returned this run, how
-- many rows were inserted vs deduped, and a by-type breakdown of what was seen-but-not
-- captured. The poller POSTs an open row first (to get its id, so ig_ingest_log FK
-- rows can reference it during the loop), then PATCHes final counts + finished_at +
-- reconciled at the end. Append-only INSERT then one PATCH — no upsert, so NO unique
-- index is needed (partial-vs-full-index gotcha does not apply here).
-- Mirrors the monitor_events RLS/realtime template (0059 + 0069 team-read) and the
-- guarded realtime publication add from 0044_reel_dna.sql. Apply via `npm run migrate:apply`.

-- ── ig_sync_runs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ig_sync_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,                          -- null until the run PATCHes closed
  trigger          text        NOT NULL DEFAULT 'cron'
                               CHECK (trigger IN ('cron','manual','webhook')),
  conversations    integer     NOT NULL DEFAULT 0,       -- conversations the Graph API returned
  messages_seen    integer     NOT NULL DEFAULT 0,       -- messages iterated across all conversations
  shares_seen      integer     NOT NULL DEFAULT 0,       -- total shares.data[] items observed (the reconcile "seen")
  inserted         integer     NOT NULL DEFAULT 0,       -- new reel_dna rows created
  dedupe_skip      integer     NOT NULL DEFAULT 0,       -- 409 dedupe hits (healthy, not an error)
  skipped_no_link  integer     NOT NULL DEFAULT 0,       -- shares with no resolvable link
  multi_extra      integer     NOT NULL DEFAULT 0,       -- shares.data[] items at index >= 1
  parse_fail       integer     NOT NULL DEFAULT 0,       -- message/share could not be parsed
  insert_error     integer     NOT NULL DEFAULT 0,       -- POST returned a non-409 error
  graph_errors     integer     NOT NULL DEFAULT 0,       -- _graph_get / _list_ig_conversations non-200
  reconciled       boolean     NOT NULL DEFAULT false,   -- accounted == seen AND insert_error == 0 AND parse_fail == 0
  mismatch_count   integer     NOT NULL DEFAULT 0,       -- seen - accounted + insert_error + parse_fail
  note             text,                                 -- free-text run annotation
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ig_sync_runs_created_idx
  ON public.ig_sync_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS ig_sync_runs_started_idx
  ON public.ig_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS ig_sync_runs_reconciled_idx
  ON public.ig_sync_runs (reconciled);

ALTER TABLE public.ig_sync_runs ENABLE ROW LEVEL SECURITY;

-- Mirrors the monitor_events template: the whole authenticated 4-person team READS
-- (so the IG Sync Health panel renders for non-owners), the Hetzner poller WRITES via
-- service_role (FOR ALL — it POSTs the open row then PATCHes it closed), and the owner
-- keeps god-mode FOR ALL for cleanup.
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "auth_read_ig_sync_runs"    ON public.ig_sync_runs;
DROP POLICY IF EXISTS "service_all_ig_sync_runs"  ON public.ig_sync_runs;
DROP POLICY IF EXISTS "owner_all_ig_sync_runs"    ON public.ig_sync_runs;

CREATE POLICY "auth_read_ig_sync_runs"
  ON public.ig_sync_runs FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_all_ig_sync_runs"
  ON public.ig_sync_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "owner_all_ig_sync_runs"
  ON public.ig_sync_runs FOR ALL
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

-- Realtime so a fresh sync run appears live in the IG Sync Health panel. Guarded:
-- ALTER PUBLICATION ... ADD TABLE errors if the table is already a member, so only
-- add it when it isn't (keeps the migration re-runnable). Pattern from 0044_reel_dna.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ig_sync_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ig_sync_runs;
  END IF;
END $$;
