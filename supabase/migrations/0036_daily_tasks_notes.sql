-- Add optional notes field to daily_tasks (per-task freeform note).
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS notes TEXT;
