-- Clear people.user_id values that point to deleted auth users.
-- Safe to run anytime — only nullifies rows where the referenced
-- auth.users record no longer exists.

update public.people
set user_id = null
where user_id is not null
  and not exists (
    select 1 from auth.users where id = people.user_id
  );
