-- Fix for 0015 failure: jayalamina2025@gmail.com already exists on the sam row
-- (set by a previous claimIdentity or activate-slot call).
-- This just ensures the auth.users email matches and is confirmed.
-- If sam has no linked account yet (user_id is null after 0016), this is a no-op.

update auth.users
set email               = 'jayalamina2025@gmail.com',
    email_confirmed_at  = now()
where id = (
  select user_id from public.people where id = 'sam' and user_id is not null
);

-- Verify the final state:
select id, name, email, user_id from public.people where id = 'sam';
