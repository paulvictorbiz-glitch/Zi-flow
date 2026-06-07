-- 0024_footage_transcripts.sql
-- Persist full per-clip transcripts on attached footage so editors can read
-- what a clip contains in-app WITHOUT downloading the video.
--
-- Shape: jsonb array of chunks [{ text, start_time, end_time, score? }] —
-- the same shape getFootageTranscript() returns from FootageBrain.
-- Storage: ~5-8 KB per 5-min clip (30-50 chunks). 200 attached items ≈ 1.5 MB.
--
-- NOTE: already applied manually in Supabase (run 2026-06-08); this file
-- tracks the schema in the repo.

ALTER TABLE public.attached_footage_items
  ADD COLUMN IF NOT EXISTS full_transcript jsonb;
