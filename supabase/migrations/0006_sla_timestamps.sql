-- =========================================================
--  Step 6b — SLA / clock engine schema
--
--  Adds real timestamps so the dashboard's age + due strings
--  ("6h 28m", "28h wait", "today 14:00", "scheduled", ...) stop
--  being frozen literals and start ticking forward in real time.
--
--    · reels.due_at            — when the next deliverable is due
--    · reels.stage_entered_at  — when the reel most recently
--                                landed in its current stage
--                                (refreshed by MOVE_STAGE /
--                                 APPROVE_REVIEW / SEND_BACK)
--    · tasks.due_at            — when a task is due
--
--  Existing `age` / `due` text columns are kept as fallback
--  display for any row that hasn't been re-seeded yet. The
--  client prefers timestamps when present.
-- =========================================================

alter table public.reels
  add column if not exists due_at           timestamptz,
  add column if not exists stage_entered_at timestamptz;

alter table public.tasks
  add column if not exists due_at timestamptz;
