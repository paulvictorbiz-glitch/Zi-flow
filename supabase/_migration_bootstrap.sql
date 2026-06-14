-- ============================================================
--  Migration tracking bootstrap  (run ONCE in the Supabase SQL editor)
-- ------------------------------------------------------------
--  Creates:
--    1. public.schema_migrations  — records which migration files have run
--    2. public.exec_sql(text)     — lets the service role run a migration's
--                                   SQL from scripts/migrate.mjs
--
--  After running this once, use:  npm run migrate         (show status)
--                                 npm run migrate:apply   (apply pending)
--
--  Safe to re-run: everything is IF NOT EXISTS / OR REPLACE.
-- ============================================================

create table if not exists public.schema_migrations (
  version     text primary key,           -- the migration filename, e.g. 0043_anthropic_killswitch.sql
  applied_at  timestamptz not null default now(),
  checksum    text                        -- sha256 of the file content when applied
);

-- Tracking table is owner/service-role only; lock it down with RLS.
alter table public.schema_migrations enable row level security;
-- (No policies => only the service role / SQL editor can read & write.)

-- Helper so the migrate script can execute a migration file's SQL.
-- SECURITY DEFINER + service-role-only EXECUTE keeps this from being
-- callable by ordinary authenticated users.
create or replace function public.exec_sql(sql text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute sql;
end;
$$;

revoke all on function public.exec_sql(text) from public;
revoke all on function public.exec_sql(text) from anon;
revoke all on function public.exec_sql(text) from authenticated;
-- service_role retains EXECUTE as the function owner.
