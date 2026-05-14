-- =========================================================
--  Attached Footage Items — references to Footage Brain clips
--  linked to reels for editorial reference and preview.
--
--  Notes:
--   · Stores lightweight references only — no video files.
--   · source_path is the absolute path on disk (e.g., D:\Videos\clip.mp4).
--   · footage_file_id allows future direct links back to Footage Brain.
--   · matched_chunks preserves transcript search context.
-- =========================================================

create table if not exists public.attached_footage_items (
  id              text primary key,
  reel_id         text not null references public.reels(id) on delete cascade,
  
  -- Footage Brain metadata reference
  footage_file_id text not null,                              -- FK to Footage Brain video_file.id
  filename        text not null,                              -- Source filename (e.g., "kathmandu_A7IV.mp4")
  source_path     text not null,                              -- Absolute path on disk (D:\Videos\...)
  extension       text,                                       -- ".mp4", ".mov", etc.
  
  -- Preview metadata
  duration_seconds float,                                     -- Total video duration
  thumbnail_url   text,                                       -- Local path or URL to thumbnail
  width           integer,                                    -- Video width in pixels
  height          integer,                                    -- Video height in pixels
  is_vertical     boolean default false,                      -- Portrait orientation flag
  
  -- Search context
  best_score      float,                                      -- Semantic search score (0-1)
  matched_chunks  jsonb,                                      -- Transcript matches [{text, start_time, end_time, score}]
  
  -- Timestamps
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Indexes for common queries
create index if not exists attached_footage_reel_idx on public.attached_footage_items(reel_id);
create index if not exists attached_footage_footage_file_idx on public.attached_footage_items(footage_file_id);

-- Auto-update trigger
drop trigger if exists trg_attached_footage_updated_at on public.attached_footage_items;
create trigger trg_attached_footage_updated_at
before update on public.attached_footage_items
for each row execute procedure public.set_updated_at();

-- Row Level Security (permissive for now, tighten in auth phase)
alter table public.attached_footage_items enable row level security;

create policy "attached_footage_select_all" on public.attached_footage_items
  for select using (true);

create policy "attached_footage_insert_all" on public.attached_footage_items
  for insert with check (true);

create policy "attached_footage_update_all" on public.attached_footage_items
  for update using (true) with check (true);

create policy "attached_footage_delete_all" on public.attached_footage_items
  for delete using (true);
