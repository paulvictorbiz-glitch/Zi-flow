-- ============================================================
-- Migration 0012: remove the two seed reels that kept reappearing.
--
-- Background: the seed script (seed/seed.mjs) used `upsert`, so
-- every `npm run seed` run was re-inserting REEL-188 ("Lalitpur
-- dusk") and REEL-195 ("Sunrise prayer flags") even after the
-- operator deleted them from the UI. The seed arrays are now
-- empty (no more re-seeds), and this migration removes the rows
-- one more time so the DB matches the operator's intent.
--
-- Related shadow cards (REEL-188-RV, REEL-195-RV) in
-- review_lane_cards are cleaned up via FK ON DELETE CASCADE,
-- but we delete them explicitly too as a belt-and-braces step.
-- ============================================================

DELETE FROM review_lane_cards WHERE parent_id IN ('REEL-188','REEL-195')
                                  OR id        IN ('REEL-188-RV','REEL-195-RV');

DELETE FROM tasks WHERE reel_id IN ('REEL-188','REEL-195');

DELETE FROM reels WHERE id IN ('REEL-188','REEL-195');
