-- Reel DNA: a permanent-delete tombstone column.
--
-- WHY: the Hetzner IG-DM poller (ig_webhook.py _do_sync) dedupes new reels
-- against the external_ref of rows CURRENTLY in reel_dna. A hard DELETE removed
-- the row, so its external_ref dropped out of the "known" set and the very next
-- poll (15-min cron OR the Refresh button) re-inserted the same reel — deleted
-- cards kept coming back.
--
-- FIX: "delete" now soft-deletes by stamping deleted_at. The row (and its
-- external_ref) stays, so the poller keeps treating that IG message as already
-- captured and never re-inserts it, while the UI hides deleted_at rows from
-- every view (unlike archived_at, these are NOT restorable in the UI).
-- Nullable + idempotent so existing rows and pre-migration writes degrade fine.
ALTER TABLE public.reel_dna ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS reel_dna_deleted_idx ON public.reel_dna (deleted_at);
