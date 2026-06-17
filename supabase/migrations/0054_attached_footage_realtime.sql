-- Add attached_footage_items to the realtime publication.
--
-- BUG THIS FIXES: the workflow-realtime channel (src/store/store.jsx) registers
-- a postgres_changes listener for attached_footage_items, but the table was
-- never added to the supabase_realtime publication (0009 created the table;
-- no migration ever published it). Supabase Realtime validates EVERY binding on
-- a channel against the publication at subscribe time — one unpublished table
-- sends the WHOLE channel to CHANNEL_ERROR, so none of its listeners fire,
-- including daily_tasks. Symptom: newly added daily tasks / notes don't appear
-- live and the list doesn't settle. Publishing the table fixes the channel.
--
-- Guarded so the migration is re-runnable (ADD TABLE errors if already a member).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'attached_footage_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attached_footage_items;
  END IF;
END $$;
