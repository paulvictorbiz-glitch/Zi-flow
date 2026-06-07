-- =========================================================
--  Step 14 — app_settings: shared config table
--
--  Stores arbitrary key/value settings as JSONB so the owner
--  can write once and all users read the same config.
--
--  Initial use: role_permissions (replaces localStorage so
--  Jay and others get the same permission toggles as the owner
--  set in the Roles & permissions admin page).
--
--  RLS:
--    · Any authenticated user can SELECT.
--    · Only the owner (people.role = 'owner') can write.
-- =========================================================

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz default now()
);

alter table public.app_settings enable row level security;

create policy "auth read app_settings"
  on public.app_settings for select
  using (auth.role() = 'authenticated');

create policy "owner write app_settings"
  on public.app_settings for all
  using (
    exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
  );
