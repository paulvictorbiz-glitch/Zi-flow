-- Reel DNA spreadsheet: per-row color tag + favorite/star flag.
-- Lets the owner color-tag rows and star ones, then filter the sheet by either.
-- row_color = a CSS hex string (matches the resources/locations row-color
-- convention) or NULL; favorite = a boolean toggled by the row star button.
ALTER TABLE public.reel_dna ADD COLUMN IF NOT EXISTS row_color TEXT;
ALTER TABLE public.reel_dna ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT false;
