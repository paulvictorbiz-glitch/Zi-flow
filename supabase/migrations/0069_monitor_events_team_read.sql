-- Pulse / Reel DNA Assets — loosen monitor_events READ RLS from owner-only to the
-- whole authenticated 4-person team (Paul, Judy, Jay, Leroy). Owner decision: open
-- News to the team, so the Reel DNA Assets feature's News section renders for
-- non-owners (current + future ingested rows). WRITES stay owner-only — the existing
-- owner_all_monitor_events (FOR ALL) policy from 0059_monitor_events.sql is intentionally
-- left intact and still gates every INSERT/UPDATE/DELETE; service_all_monitor_events
-- (service_role, used by the Hetzner poller) is likewise left untouched. This migration
-- ADDS ONLY one new SELECT policy — it does not touch ENABLE RLS (already on in 0059)
-- nor the realtime publication. DROP-then-CREATE so it is safely re-runnable (the runner
-- has no transaction wrapping, and CREATE POLICY is not idempotent on its own).
-- Apply via `npm run migrate:apply`.

-- ── monitor_events: add team-wide SELECT ────────────────────────────────────────
DROP POLICY IF EXISTS "auth_read_monitor_events" ON public.monitor_events;

CREATE POLICY "auth_read_monitor_events"
  ON public.monitor_events FOR SELECT
  TO authenticated
  USING (auth.role() = 'authenticated');
