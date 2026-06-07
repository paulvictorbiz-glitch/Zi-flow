-- Give the service_role full access to the people table.
--
-- The existing RLS policies only allow auth.role() = 'authenticated',
-- which blocks the service_role key used by the admin API routes.
-- The service_role should always bypass RLS for admin operations.
-- Also adds the missing INSERT policy for authenticated users.

create policy "service role full access people"
  on public.people
  to service_role
  using (true)
  with check (true);

-- INSERT was missing entirely — add it for authenticated users so
-- the admin API (which runs as service_role) and any future
-- authenticated flows can insert new people rows.
create policy "auth insert people"
  on public.people for insert
  to authenticated
  with check (auth.role() = 'authenticated');
