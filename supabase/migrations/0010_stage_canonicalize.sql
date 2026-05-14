-- ============================================================
-- Migration 0010: canonicalize stage values.
--
-- The pipeline used to have 7 stages (idea / selected / main /
-- review / variants / ready / posted). We collapsed it to 5:
-- not_started · in_progress · review · completed · posted.
-- This migration rewrites existing rows so the new UI doesn't
-- need a per-read mapper indefinitely. Application code also
-- normalizes on read as a safety net.
-- ============================================================

UPDATE reels
SET    stage = CASE stage
                 WHEN 'idea'     THEN 'not_started'
                 WHEN 'selected' THEN 'not_started'
                 WHEN 'main'     THEN 'in_progress'
                 WHEN 'variants' THEN 'in_progress'
                 WHEN 'ready'    THEN 'completed'
                 ELSE stage
               END
WHERE  stage IN ('idea','selected','main','variants','ready');

UPDATE review_lane_cards
SET    stage = CASE stage
                 WHEN 'idea'     THEN 'not_started'
                 WHEN 'selected' THEN 'not_started'
                 WHEN 'main'     THEN 'in_progress'
                 WHEN 'variants' THEN 'in_progress'
                 WHEN 'ready'    THEN 'completed'
                 ELSE stage
               END
WHERE  stage IN ('idea','selected','main','variants','ready');
