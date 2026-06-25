-- Reel duplication grouping: a shared content-group id across a reel and its
-- copies. When a reel is duplicated / fanned out to one or more editors
-- (duplicateReel / createReelForEditors), every copy now carries the same
-- dup_group_id so the owner-only Pipeline graph can cluster them under one
-- "shared content" hub exactly (instead of inferring from the " (Name)" title
-- suffix). Nullable + additive — existing reels stay NULL and fall back to the
-- title-base inference in the graph. No backfill, no RLS change.
ALTER TABLE public.reels ADD COLUMN IF NOT EXISTS dup_group_id TEXT;
CREATE INDEX IF NOT EXISTS reels_dup_group_id_idx ON public.reels (dup_group_id);
