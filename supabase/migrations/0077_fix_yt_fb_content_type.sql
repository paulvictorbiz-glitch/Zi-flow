-- 0077 — Retroactive content_type fix for existing YT/FB/TikTok rows.
--
-- The IG DM poller was inserting content_type='unknown' for YouTube, Facebook,
-- and TikTok links shared via IG DM (attach_type='media_share'/'share' maps to
-- 'unknown' in _classify_content_type). This one-time UPDATE promotes those rows
-- to content_type='video', which is provably correct: platform='yt'/'fb'/'tiktok'
-- means the URL is a video platform link, even without the native attachment type.
--
-- Safe to re-run (no-op on already-fixed rows). Does NOT touch platform='ig'
-- rows — those could be reels, carousels, or photos and require human review.

UPDATE public.reel_dna
SET    content_type = 'video'
WHERE  platform IN ('yt', 'fb', 'tiktok')
  AND  (content_type IS NULL OR content_type = 'unknown')
  AND  deleted_at IS NULL;
