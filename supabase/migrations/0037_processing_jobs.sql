create table if not exists processing_jobs (
  id uuid primary key default gen_random_uuid(),
  folder_path text not null,
  root_id text,
  file_count int,
  files_done int default 0,
  stage text default 'transcript',
  status text default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  error_text text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table processing_jobs enable row level security;
create policy "auth users" on processing_jobs for all using (auth.role() = 'authenticated');
