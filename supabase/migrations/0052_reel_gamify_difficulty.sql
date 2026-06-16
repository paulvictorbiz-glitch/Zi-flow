-- =========================================================
-- 0052_reel_gamify_difficulty.sql
--
-- Per-reel skill difficulty for Gamify lives in its own column instead
-- of the shared `detail` jsonb blob. The detail page owns a debounced
-- writer for `detail` (comments etc.) that would otherwise clobber a
-- difficulty value written by the spider-chart drag. A dedicated column
-- removes that two-writer contention.
--
-- Shape: { "<skillKey>": 0..100, ... }  (difficulty per tagged skill)
-- =========================================================

ALTER TABLE reels
  ADD COLUMN IF NOT EXISTS gamify_difficulty jsonb NOT NULL DEFAULT '{}';
