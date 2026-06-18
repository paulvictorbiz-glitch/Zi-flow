-- Extend reel_dna.content_type to capture stories + video (in addition to the
-- reel/carousel/photo/unknown from 0072). Lets the IG DM poller ingest carousels,
-- photos, and stories shared to DM — not just reels — and classify each by type.
-- ('carousel'/'photo' already exist from 0072; this adds 'story' + 'video'.)
-- Idempotent: DROP the old CHECK constraint if present, then re-ADD with the wider
-- vocabulary. No index change — dedupe still rides the existing partial unique index
-- via raw-POST -> 409. Apply via `npm run migrate:apply`.

ALTER TABLE public.reel_dna DROP CONSTRAINT IF EXISTS reel_dna_content_type_check;
ALTER TABLE public.reel_dna
  ADD CONSTRAINT reel_dna_content_type_check
  CHECK (content_type IN ('reel','carousel','photo','story','video','unknown'));
