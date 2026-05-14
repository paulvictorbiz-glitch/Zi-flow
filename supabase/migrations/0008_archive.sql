-- =========================================================
--  Soft-archive support for reels.
--
--    archived_at IS NULL  →  live (shows in all normal views)
--    archived_at IS NOT NULL → archived (only shown in the
--                              dedicated Archived view, with a
--                              Restore action)
--
--  Hard delete (actions.deleteReel) is still available; the UI
--  exposes it only to the owner role. Archived rows can be
--  restored without data loss; deleted rows are gone.
-- =========================================================

alter table public.reels
  add column if not exists archived_at timestamptz;

create index if not exists reels_archived_idx on public.reels (archived_at);
