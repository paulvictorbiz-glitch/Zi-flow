-- 0035_location_reel_links.sql
-- Adds an external-video-links list to each location: the actual reels /
-- shots filmed at a place (Instagram / YouTube / TikTok URLs). Stored as
-- JSONB array of { id, label, url }, mirroring `reelLinks` in
-- src/lib/locations-data.jsx (makeLocation / normalizeReelLinks).
-- This is separate from `linked_reel_ids` (which links internal reel cards);
-- a pin can carry both. Additive + backwards compatible — defaults to [].

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS reel_links JSONB NOT NULL DEFAULT '[]'::jsonb;
