-- 0034_resource_row_color.sql
-- Adds a row_color column to resource_rows so rows in the Resources
-- table can be color-tagged for quick visual scanning. Stores a CSS
-- hex color string (e.g. '#c0392b') or null (no color).

ALTER TABLE public.resource_rows
  ADD COLUMN IF NOT EXISTS row_color TEXT DEFAULT NULL;
