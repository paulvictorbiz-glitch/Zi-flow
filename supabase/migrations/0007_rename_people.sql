-- =========================================================
--  Step "make-it-real" — rename the three non-owner slots.
--
--    Alex Rivera  (skilled)  → Judy Adawag
--    Sam Kafle    (variant)  → Jay
--    Maya Chen    (reviewer) → Leroy Crosby
--
--  Person row IDs ("alex", "sam", "maya") are kept as the
--  primary keys so every existing FK / lane mapping / role
--  switcher key keeps working. Only the display fields change.
--
--  This migration also rewrites mentions of the old names in
--  reel + task operational text (blocker / next / downstream /
--  note / instruction), so the dashboard's words match the new
--  identities without re-seeding.
-- =========================================================

update public.people set name = 'Judy Adawag',  short = 'Judy A',  avatar = 'JA' where id = 'alex';
update public.people set name = 'Jay',          short = 'Jay',     avatar = 'JY' where id = 'sam';
update public.people set name = 'Leroy Crosby', short = 'Leroy C', avatar = 'LC' where id = 'maya';

-- Word-boundary regex (Postgres \y) so "Alexandria" / "Sammy" /
-- "Mayan" wouldn't be touched — though none exist today, this
-- keeps the rule safe to re-run.
update public.reels set
  next       = regexp_replace(regexp_replace(regexp_replace(coalesce(next, ''),       '\yAlex\y', 'Judy', 'g'), '\ySam\y', 'Jay', 'g'), '\yMaya\y', 'Leroy', 'g'),
  blocker    = regexp_replace(regexp_replace(regexp_replace(coalesce(blocker, ''),    '\yAlex\y', 'Judy', 'g'), '\ySam\y', 'Jay', 'g'), '\yMaya\y', 'Leroy', 'g'),
  downstream = regexp_replace(regexp_replace(regexp_replace(coalesce(downstream, ''), '\yAlex\y', 'Judy', 'g'), '\ySam\y', 'Jay', 'g'), '\yMaya\y', 'Leroy', 'g'),
  note       = regexp_replace(regexp_replace(regexp_replace(coalesce(note, ''),       '\yAlex\y', 'Judy', 'g'), '\ySam\y', 'Jay', 'g'), '\yMaya\y', 'Leroy', 'g');

update public.tasks set
  instruction = regexp_replace(regexp_replace(regexp_replace(coalesce(instruction, ''), '\yAlex\y', 'Judy', 'g'), '\ySam\y', 'Jay', 'g'), '\yMaya\y', 'Leroy', 'g');
