-- #5 My Work drag-reorder: persist task display order.
-- Nullable so existing rows (and new rows created before this migration runs)
-- degrade gracefully; the store assigns max(existing)+1 on insert and reindexes
-- 0..n-1 on reorder. Last-write-wins across clients, same as before.
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER;
