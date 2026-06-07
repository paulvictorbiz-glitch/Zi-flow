-- Sync the four canonical team profiles to their real names/avatars so the
-- DB matches the app once the roster is read live from `public.people`
-- (instead of the old hardcoded JS constants).
--
-- Only touches presentation fields (name / short / role / avatar / tone).
-- Deliberately leaves `email` and `user_id` alone — those are managed from
-- the Roles & Permissions panel ("set up account" / "change email"), so the
-- owner can link Jay (sam) and Leroy (maya) without this migration clobbering
-- anything. Idempotent: safe to run repeatedly.

update public.people set
  name = 'Paul Victor', short = 'Paul V', role = 'owner',    avatar = 'PV', tone = 'amber'
where id = 'paul';

update public.people set
  name = 'Judy Adawag', short = 'Judy A', role = 'skilled',  avatar = 'JA', tone = 'cyan'
where id = 'alex';

update public.people set
  name = 'Jay',          short = 'Jay',    role = 'variant',  avatar = 'JY', tone = 'violet'
where id = 'sam';

update public.people set
  name = 'Leroy Crosby', short = 'Leroy C', role = 'reviewer', avatar = 'LC', tone = 'green'
where id = 'maya';

-- Verify the final state:
select id, name, short, role, avatar, tone, email, user_id
from public.people
order by id;
