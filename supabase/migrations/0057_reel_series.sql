-- Series / playlist grouping: tag a reel as part of a named series (e.g.
-- "Nepal series") so the Pipeline board can optionally group reels visually.
-- Nullable + idempotent so existing rows and pre-migration writes degrade
-- gracefully (the board only groups when "Group by series" is toggled on).
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS series TEXT;
