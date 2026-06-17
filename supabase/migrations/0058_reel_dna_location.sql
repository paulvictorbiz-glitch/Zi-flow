-- Reel DNA: a top-level "location" tag for a captured inspiration reel (e.g.
-- "Bali", "Tokyo"). Lets a DM/paste tag note like `location=Bali` surface as
-- its own spreadsheet column alongside the per-gene fields. Nullable +
-- idempotent so existing rows and pre-migration writes degrade gracefully
-- (location is just another optional, editable cell).
ALTER TABLE public.reel_dna ADD COLUMN IF NOT EXISTS location TEXT;
