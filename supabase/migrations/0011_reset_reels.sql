-- ============================================================
-- Migration 0011: wipe all reels.
--
-- This is a destructive reset so future reels start with the new
-- sequential id scheme (REEL-000, REEL-001, …) from a clean base.
-- Dependent rows in review_lane_cards / tasks / attached_footage_items
-- are removed via FK ON DELETE CASCADE (declared in 0001_init and
-- 0009_attached_footage).
--
-- DO NOT APPLY if you want to keep existing reel rows. Once
-- applied, the data is gone — there is no rollback.
-- ============================================================

DELETE FROM reels;
-- Defensive cleanup in case any rows were orphaned in past schema
-- changes (cascade should have handled them, but this is a no-op
-- when everything is already clean):
DELETE FROM review_lane_cards;
DELETE FROM attached_footage_items;
