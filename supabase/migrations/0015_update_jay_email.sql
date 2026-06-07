-- Update Jay's email from the shared footagebrain address to his personal one.
-- Also updates the auth.users email so sign-in works with the new address.

update public.people
set email = 'jayalamina2025@gmail.com'
where id = 'sam';

-- Update the corresponding auth.users record so Jay can sign in with the new email.
-- This uses auth.users directly (requires running via the Supabase dashboard SQL editor
-- with service_role / superuser access, or via the Auth admin panel).
update auth.users
set email          = 'jayalamina2025@gmail.com',
    email_confirmed_at = now()
where id = (
  select user_id from public.people where id = 'sam' and user_id is not null
);
