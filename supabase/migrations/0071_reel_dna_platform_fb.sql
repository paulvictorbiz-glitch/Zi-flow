-- Add 'fb' (Facebook Reel) as an allowed platform value in reel_dna.
-- The original migration 0044 used a text comment, not a CHECK constraint,
-- so this is a defensive no-op that formalises the allowed values.

ALTER TABLE public.reel_dna DROP CONSTRAINT IF EXISTS reel_dna_platform_check;

ALTER TABLE public.reel_dna
  ADD CONSTRAINT reel_dna_platform_check
    CHECK (platform IN ('ig', 'tiktok', 'yt', 'fb'));
