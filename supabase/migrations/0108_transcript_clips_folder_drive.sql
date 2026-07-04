-- 0108_transcript_clips_folder_drive.sql
-- Content Forge — folder-scoped discovery + per-clip Google Drive links.
--
-- Adds four nullable columns to transcript_clips (0101) so a discovery pass can:
--   · folder           — the country/trip folder a clip lives in (e.g. "Japan"),
--                        derived at ingest from attached_footage_items.source_path by
--                        content_forge.py:_folder_label() — a Python port of the frontend
--                        footageFolderLabel() (src/lib/footage-brain-client.js) so the
--                        UI picker's label MATCHES the stored value byte-for-byte. Lets
--                        the discover endpoint scope to ONE folder (&folder=eq.Japan) and
--                        walk it ~20 clips at a time.
--   · source_path      — the clip's absolute disk path, so a folder-scoped pass can order
--                        sequentially (source_path.asc, start_time.asc) — "first 20 clips".
--   · drive_url        — the clip's Google Drive *file* link, and
--   · drive_folder_url — its Drive *folder* link, both stamped at ingest from the parent
--                        reel's detail.footageDrive{footage_file_id} map (migration 0005),
--                        so the Content Forge opportunity modal can hyperlink source clips
--                        directly (no attached_footage_items round-trip — those drive cols
--                        do not exist there; 0009 only has source_path).
--
-- All columns are NULLABLE and additive: existing rows read NULL until a re-ingest
-- backfills them. The ingest upsert key (footage_file_id, start_time, end_time) is
-- UNCHANGED, so a plain re-Ingest idempotently backfills these columns on existing clips.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert), NOT
-- migrate:apply (other pending files are intentionally held back — CLAUDE.md rule 8d).
--
-- Fully idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). No RLS change
-- (transcript_clips policies from 0101 already cover these columns). No 'concurrently'.

ALTER TABLE public.transcript_clips
  ADD COLUMN IF NOT EXISTS folder            TEXT,
  ADD COLUMN IF NOT EXISTS source_path       TEXT,
  ADD COLUMN IF NOT EXISTS drive_url         TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_url  TEXT;

-- Partial index — folder-scoped discovery filters &folder=eq.<label> on non-NULL folders.
CREATE INDEX IF NOT EXISTS transcript_clips_folder_idx
  ON public.transcript_clips (folder) WHERE folder IS NOT NULL;
