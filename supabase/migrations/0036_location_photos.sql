create table if not exists location_photos (
  id uuid primary key default gen_random_uuid(),
  location_id text references locations(id) on delete cascade,
  url text not null,
  caption text default '',
  created_at timestamptz default now()
);
alter table location_photos enable row level security;
create policy "auth users" on location_photos for all using (auth.role() = 'authenticated');
