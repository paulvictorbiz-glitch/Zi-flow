-- =========================================================
--  Step 6a — enable Supabase realtime broadcasts on the
--  workflow tables.
--
--  Supabase's realtime engine watches the postgres logical
--  replication slot named `supabase_realtime`. Tables only
--  emit change events to clients once they are added to that
--  publication. This file is idempotent — it skips any table
--  that is already a member.
-- =========================================================

do $$
declare
  t text;
begin
  foreach t in array array['reels', 'review_lane_cards', 'tasks', 'people'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
