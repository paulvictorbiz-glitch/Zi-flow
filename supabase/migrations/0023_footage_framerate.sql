-- Add frame rate (fps) to footage clip references.
ALTER TABLE public.attached_footage_items
  ADD COLUMN IF NOT EXISTS frame_rate FLOAT;

-- Enable realtime on new tables (ignore errors if already subscribed)
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_columns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_rows;
ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_cells;
