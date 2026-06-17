-- =========================================================
--  Step 55 — training_module_content: owner-editable training overrides
--
--  The training curriculum (src/lib/training-curriculum.jsx) ships rich
--  default content per pillar module. This table holds the OWNER's
--  per-field edits, which override the code defaults at render time so
--  all editors see the same updated text live.
--
--  One row per (module_id, field_path):
--    · module_id  — the gamify skill key, e.g. 'cutting-pacing'
--    · field_path — the section field, e.g. 'whyMatters',
--                   'commonMistakes.2' (array index), 'checklist.0'
--    · value      — the override text
--
--  RLS (mirrors "owner write app_settings" from 0014_app_settings.sql):
--    · Any authenticated user can SELECT.
--    · Only the owner (people.role = 'owner') can write.
--
--  set_updated_at trigger reused from 0001_init.sql; table added to the
--  supabase_realtime publication (guarded, mirroring 0054) so an owner
--  edit reflects live for editors. Idempotent / re-runnable.
--  Apply manually in the Supabase SQL editor (per CLAUDE.md).
-- =========================================================

create table if not exists public.training_module_content (
  module_id   text not null,
  field_path  text not null,
  value       text not null,
  updated_at  timestamptz default now(),
  primary key (module_id, field_path)
);

alter table public.training_module_content enable row level security;

-- DROP-then-CREATE so this migration is safely re-runnable.
drop policy if exists "auth read training_module_content"   on public.training_module_content;
drop policy if exists "owner write training_module_content" on public.training_module_content;

create policy "auth read training_module_content"
  on public.training_module_content for select
  using (auth.role() = 'authenticated');

create policy "owner write training_module_content"
  on public.training_module_content for all
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

-- updated_at bump on every UPDATE (function defined in 0001_init.sql).
drop trigger if exists trg_training_module_content_updated_at on public.training_module_content;
create trigger trg_training_module_content_updated_at
  before update on public.training_module_content
  for each row execute procedure public.set_updated_at();

-- Realtime so an owner edit reflects live for editors. Guarded so the
-- migration stays re-runnable (ADD TABLE errors if already a member).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'training_module_content'
  ) then
    alter publication supabase_realtime add table public.training_module_content;
  end if;
end $$;
