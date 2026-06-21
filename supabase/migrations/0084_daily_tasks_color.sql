-- Add optional color tag to daily_tasks (My Work → Tasks & Comms color picker).
-- One of the 8 app tone names (cyan/violet/green/amber/red/blue/orange/pink) or NULL.
ALTER TABLE public.daily_tasks ADD COLUMN IF NOT EXISTS color TEXT;
