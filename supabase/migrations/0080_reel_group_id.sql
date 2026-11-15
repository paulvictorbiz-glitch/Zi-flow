-- 0080 — Pipeline card grouping (group_id) for reels.
--
-- Adds a free-text group_id to public.reels so cards on the pipeline board can
-- be visually linked (Canva-style connector lines). Cards sharing a group_id
-- are drawn connected, and the link follows them as they move across stages and
-- lanes. Duplicating a reel copies the source's group_id so the same reel worked
-- by different editors stays connected.
--
-- Nullable text (no group = NULL = the current flat board). No RLS change — the
-- column inherits the table's existing reel policies. Safe to re-run.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS group_id text;

CREATE INDEX IF NOT EXISTS reels_group_id_idx
  ON public.reels (group_id);
