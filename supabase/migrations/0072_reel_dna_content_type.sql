-- Add content_type to reel_dna to distinguish reels, carousels, and photos.
-- Used when the IG DM poller is extended to parse message text URLs (not just
-- native share attachments). Nullable so all existing rows degrade safely.

ALTER TABLE public.reel_dna
  ADD COLUMN IF NOT EXISTS content_type TEXT
    CHECK (content_type IN ('reel', 'carousel', 'photo', 'unknown'));

CREATE INDEX IF NOT EXISTS reel_dna_content_type_idx
  ON public.reel_dna (content_type);
