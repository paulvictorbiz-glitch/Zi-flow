-- 0114_reel_dna_team_update.sql
-- Reel DNA — let ANY authenticated teammate UPDATE a reel_dna row.
--
-- WHY (the bug this fixes):
--   Migration 0076 tightened auth_update_reel_dna so a NON-owner could only
--   update rows whose captured_by equalled their own people.id. But:
--     * IG-DM-ingested reels are inserted by the service_role poller and NEVER
--       set captured_by (nullable, no default in 0044) -> captured_by IS NULL.
--     * Reels captured "from the owner's account" carry captured_by = 'paul'.
--   So when an editor (e.g. Judy / 'alex') sent one of those cards to the
--   pipeline, sendReelDnaToPipeline's reel_dna UPDATE (reel_id link + status)
--   matched ZERO rows under RLS and returned NO error -> the link silently never
--   persisted. On reload the card looked un-sent, got re-sent, and spawned
--   DUPLICATE pipeline reels. The same silent no-op also broke that editor's
--   archive / delete / favorite / notes / row-color on any IG-ingested card.
--
-- FIX: this is a trusted 4-person team and the sibling tables already allow
--   open authenticated writes (reels: "auth write reels"; attached_footage_items:
--   "attached_footage_*_all", 0076 sec.3). Bring reel_dna UPDATE in line: any
--   authenticated session may update. INSERT stays as 0076 left it (owner OR
--   captured_by-self) — manual captures set captured_by to the caller, and the
--   IG poller inserts via service_role (bypasses RLS), so inserts are unaffected.
--   owner_all_reel_dna (0044) + service_insert_reel_dna (0044) remain intact.
--
-- SECURITY NOTE: this widens who may EDIT existing capture rows from
--   owner+capturer to any authenticated teammate. That is the intended trust
--   model here (the whole team curates the capture library); it does NOT grant
--   anon access (still `to authenticated`) and does NOT touch DELETE or the
--   people/privilege-escalation hardening from 0076 sec.1.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files — 0112, 0113 — are intentionally held
-- back; see CLAUDE.md rule 8d). Never applied by any agent.
--
-- Idempotent: drop-if-exists then create. Safely re-runnable.

drop policy if exists "auth_update_reel_dna" on public.reel_dna;
create policy "auth_update_reel_dna" on public.reel_dna
  for update
  to authenticated
  using (true)
  with check (true);
