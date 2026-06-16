-- Reel DNA Phase 2: timeline column.
-- Stores manually-logged timeline segments as a jsonb array:
--   [ { id, label, gene, startTs, endTs, notes, downloadUrl }, ... ]
-- Each segment maps to a "gene" (music/hook/font/sfx/story/other) and can
-- have an optional download URL set by the user (clip link, font file, etc.).
-- This column is additive — existing rows get NULL (treated as []).
-- Apply via the Supabase SQL editor or `npm run migrate:apply`.

ALTER TABLE public.reel_dna
  ADD COLUMN IF NOT EXISTS timeline jsonb DEFAULT NULL;

COMMENT ON COLUMN public.reel_dna.timeline IS
  'Ordered array of timeline segments: [{id,label,gene,startTs,endTs,notes,downloadUrl}]';
