-- =========================================================
-- 0053_rubric_revamp.sql
--
-- Revamps the Gamify rubric to the "gold standard" reel-editing rubric:
--   · 10 skills → 9 (6 Core Pillars + 3 Bonus Craft Pillars)
--   · grade values renamed average/decent/excellent
--       → junior-editor/skilled-editor/professional
--   · two skills are absorbed and their data is DELETED (no XP carryover):
--       keyframing, reels-retention
--   · three skills are renamed (keys change, XP preserved):
--       storytelling          → story-creative
--       color-grading         → color-visual
--       workflow-organization → revisions-time
--
-- Touches: gamify_rubric, reels.skill_tags, gamify_progress.skill_scores.
-- Run AFTER the frontend deploy. Idempotent-ish: the renames only match
-- old keys, so re-running is a no-op once migrated.
--
-- NOTE: app_settings keys "gamify_rubric_desc_mode" (owner toggle for
-- grade-description visibility) and "gamify_hidden_subskills" (owner-archived
-- rubric rows, value { keys: ["skillKey:subId", ...] }) need no schema change —
-- app_settings is a generic key/value(jsonb) table and the row is created on
-- first write.
-- =========================================================

-- 1. Delete absorbed-skill rubric rows (keyframing, reels-retention).
DELETE FROM gamify_rubric
WHERE skill_key IN ('keyframing', 'reels-retention');

-- 2. Rename the remaining old skill keys on the surviving rubric rows.
UPDATE gamify_rubric
SET skill_key = CASE skill_key
  WHEN 'storytelling'          THEN 'story-creative'
  WHEN 'color-grading'         THEN 'color-visual'
  WHEN 'workflow-organization' THEN 'revisions-time'
  ELSE skill_key
END
WHERE skill_key IN ('storytelling', 'color-grading', 'workflow-organization');

-- 3. Rename grade value strings inside reviewer_grades jsonb.
--    reviewer_grades is a map { "<subId>": "<grade>" }.
UPDATE gamify_rubric
SET reviewer_grades = (
  SELECT jsonb_object_agg(
    key,
    CASE value::text
      WHEN '"average"'   THEN '"junior-editor"'::jsonb
      WHEN '"decent"'    THEN '"skilled-editor"'::jsonb
      WHEN '"excellent"' THEN '"professional"'::jsonb
      ELSE value
    END)
  FROM jsonb_each(reviewer_grades))
WHERE reviewer_grades IS NOT NULL
  AND reviewer_grades <> '{}'::jsonb;

-- 4. Rewrite reels.skill_tags arrays: drop absorbed keys, rename the rest.
UPDATE reels
SET skill_tags = array_replace(array_replace(array_replace(
  array_remove(array_remove(skill_tags, 'keyframing'), 'reels-retention'),
  'storytelling',          'story-creative'),
  'color-grading',         'color-visual'),
  'workflow-organization', 'revisions-time')
WHERE skill_tags && ARRAY[
  'storytelling', 'color-grading', 'workflow-organization',
  'keyframing', 'reels-retention'
]::text[];

-- 5. Migrate gamify_progress.skill_scores jsonb: drop old keys, re-add the
--    renamed ones with their prior score. Absorbed keys are dropped (their
--    XP is gone, per the "delete" decision). The store recomputes scores
--    from rubric rows on the next grade anyway; this keeps the snapshot sane
--    in the meantime.
UPDATE gamify_progress
SET skill_scores = (
  skill_scores
    - 'storytelling' - 'color-grading' - 'workflow-organization'
    - 'keyframing'   - 'reels-retention'
  || jsonb_build_object(
       'story-creative', COALESCE((skill_scores ->> 'storytelling')::numeric, 0),
       'color-visual',   COALESCE((skill_scores ->> 'color-grading')::numeric, 0),
       'revisions-time', COALESCE((skill_scores ->> 'workflow-organization')::numeric, 0)
     ))
WHERE skill_scores ?| ARRAY[
  'storytelling', 'color-grading', 'workflow-organization',
  'keyframing', 'reels-retention'
];
