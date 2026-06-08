-- 0026_vision_tags.sql
-- Persist structured vision tags for attached footage so editors can browse and
-- search the library by what's visually on screen (not just filename/transcript).
--
-- Shape (jsonb):
--   {
--     objects:    string[],   -- physical things visible ("person","mountain","drone")
--     scenes:     string[],   -- environment type ("outdoor market","beach","forest")
--     activities: string[],   -- what's happening ("walking","cooking","flying")
--     mood:       string[],   -- lighting/atmosphere ("golden hour","foggy")
--     setting:    string[],   -- context/geographic ("urban","rural","tropical")
--     tagged_at:  ISO-string  -- when the analysis was run
--   }
--
-- Generated on demand by /api/tag-footage.js (free OpenRouter vision model).
-- Stored per-attachment like full_transcript (0024); setFootageTags writes to
-- every row sharing a footage_file_id, and the library's groupByClip() reads the
-- first non-null set for a clip.
--
-- NOTE: already applied manually in Supabase (run 2026-06-08); this file tracks
-- the schema in the repo.

ALTER TABLE public.attached_footage_items
  ADD COLUMN IF NOT EXISTS vision_tags jsonb;
