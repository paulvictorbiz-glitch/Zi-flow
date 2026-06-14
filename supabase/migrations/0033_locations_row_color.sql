-- 0033_locations_row_color.sql
-- Adds a row_color column to locations so rows in the structured
-- table can be color-tagged for quick visual scanning.
-- Stores a CSS hex color string (e.g. '#e74c3c') or null (no color).

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS row_color TEXT DEFAULT NULL;
