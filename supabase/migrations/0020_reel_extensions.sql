-- Add status_color, scheduled_post_date, and display_number to reels
ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS status_color TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_post_date DATE,
  ADD COLUMN IF NOT EXISTS display_number INTEGER;

-- Backfill display_number for existing rows, ordered by created_at
-- (assigns sequential integers 1, 2, 3, ... to all existing reels)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY COALESCE(stage_entered_at, now()) ASC, id ASC) AS rn
  FROM public.reels
  WHERE display_number IS NULL
)
UPDATE public.reels r
SET display_number = ranked.rn
FROM ranked
WHERE r.id = ranked.id;

-- Ensure future uniqueness (non-unique during bulk backfill is fine)
CREATE UNIQUE INDEX IF NOT EXISTS reels_display_number_idx ON public.reels (display_number)
  WHERE display_number IS NOT NULL;
