-- =========================================================
-- 0051_gamify_rubric_per_row.sql
--
-- Grading moves from one grade PER SKILL to one grade PER SUB-SKILL ROW.
-- The single `reviewer_grade` text column (avg/decent/excellent) is
-- replaced by `reviewer_grades` jsonb: a map of { subId: grade }, e.g.
--   { "normalize": "excellent", "blend-tracks": "decent" }
--
-- Safe to run after 0050 (no real grading data yet). Keeps the old
-- column nullable for back-compat; the app reads/writes the jsonb map.
-- =========================================================

ALTER TABLE gamify_rubric
  ADD COLUMN IF NOT EXISTS reviewer_grades jsonb NOT NULL DEFAULT '{}';

-- The old single-grade column is no longer authoritative. Drop its CHECK
-- so nothing rejects writes, and leave it nullable for legacy rows.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'gamify_rubric' AND column_name = 'reviewer_grade'
  ) THEN
    -- constraint name is auto-generated; drop by discovering it
    EXECUTE (
      SELECT 'ALTER TABLE gamify_rubric DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'gamify_rubric'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%reviewer_grade%'
      LIMIT 1
    );
  END IF;
EXCEPTION WHEN others THEN
  -- no matching constraint; nothing to drop
  NULL;
END $$;
