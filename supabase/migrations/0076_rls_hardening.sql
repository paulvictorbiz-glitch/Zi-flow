-- =========================================================
--  0076 — RLS hardening: back UI permission gating with DB enforcement
--
--  Hardens (priority order):
--    1. CRITICAL  people  — close privilege escalation: remove open INSERT
--                           (service_role-only onboarding) + restrict the
--                           claim-UPDATE so a user may only claim their OWN
--                           unclaimed slot and CANNOT change `role`.
--    2. CRITICAL  reels / review_lane_cards / tasks — DELETE is owner-only
--                           (INSERT/UPDATE/SELECT stay team-open). Preserves
--                           the 0049 demo-sandbox predicate.
--    3. HIGH      attached_footage_items — replace `using (true)` (anon could
--                           write) with `auth.role()='authenticated'`.
--    4. HIGH      reel_dna — tighten authenticated INSERT/UPDATE to owner OR
--                           the captured_by-self person (gamify self-update
--                           pattern). owner_all + service_insert kept intact.
--
--  Reuses the proven owner-gate from 0014_app_settings.sql:
--    exists (select 1 from public.people where user_id = auth.uid() and role = 'owner')
--
--  Idempotent: every change is `drop policy if exists` then `create policy`,
--  safely re-runnable (the migrate runner has no transaction wrapper).
--
--  IMPORTANT (service_role): NOTHING here adds a restrictive policy on, or
--  revokes access from, the service_role. The Hetzner IG poller and the
--  api/admin/* routes use the SERVICE_ROLE key, which BYPASSES RLS entirely,
--  so this migration does NOT break IG ingest or owner onboarding.
--
--  APPLY MANUALLY — human-gated (run via /update-migrations); DO NOT auto-apply.
--  Do NOT paste directly into the Supabase dashboard (breaks schema_migrations).
-- =========================================================


-- ---------------------------------------------------------
-- 1. CRITICAL — public.people privilege-escalation fix
-- ---------------------------------------------------------
-- Before: 0018 "auth insert people" let ANY authenticated user INSERT a row
--   with role='owner', user_id=self, passing every owner gate downstream.
--   0002 "auth claim people" let any authenticated user UPDATE ANY people row
--   (including changing role / re-pointing another user's slot).
--
-- After:
--   - No authenticated INSERT at all. New people rows are created ONLY by the
--     backend admin API (api/admin/create-user.js), which runs as service_role
--     and bypasses RLS via "service role full access people" (0018) - kept.
--   - The claim-UPDATE is restricted to: the caller may only touch an as-yet
--     UNCLAIMED slot (OLD.user_id is null) whose email matches the caller's
--     verified auth email, may only set user_id to THEIR OWN auth.uid(), and
--     may NOT change `role` (NEW.role must equal the slot's existing role).
--   - Owner retains full management of people via a dedicated owner_all policy
--     (so the owner can edit team rows from an authenticated session if ever
--     needed); service_role onboarding is unaffected.
--
-- NOTE: removing "auth insert people" is safe - create-user.js inserts with the
--       service_role client (see api/admin/_auth.js adminClient()), not a JWT.

drop policy if exists "auth insert people" on public.people;
-- (intentionally NOT recreated: authenticated users can no longer INSERT people.)

drop policy if exists "auth claim people" on public.people;
drop policy if exists "auth claim own unclaimed slot" on public.people;
create policy "auth claim own unclaimed slot" on public.people
  for update
  to authenticated
  using (
    -- OLD row: an unclaimed slot whose email matches the caller's verified email
    user_id is null
    and email is not null
    and lower(email) = lower(auth.jwt() ->> 'email')
  )
  with check (
    -- NEW row: caller links it to THEIR OWN uid.
    --
    -- NOTE: we do NOT attempt to pin `role` here. Postgres RLS WITH CHECK can
    -- only see the PROPOSED (new) row -- there is no OLD reference in a policy
    -- expression -- so any `role = (select role ... where id = <this id>)`
    -- self-reference would read the new row and reduce to NEW.role = NEW.role
    -- (always true), failing to block self-promotion. The no-self-promotion
    -- guarantee is enforced below by the BEFORE UPDATE trigger
    -- public.pin_people_claim_columns(), which forcibly restores `role` and `id`
    -- to their OLD values for any non-owner UPDATE. See that trigger.
    user_id = auth.uid()
  );

-- Hard enforcement of "a self-claim may NOT change role (or id)".
-- RLS WITH CHECK cannot compare against the OLD row, so a trigger pins the
-- security-sensitive columns. For a non-owner UPDATE, `role` and `id` are
-- forced back to their stored (OLD) values; the caller may still set user_id
-- (the actual claim) and any non-privileged column. Owner sessions (and the
-- service_role, which bypasses triggers? -- no: triggers DO run for service_role,
-- so we exempt the owner-or-service path explicitly) keep full control.
create or replace function public.pin_people_claim_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow privileged callers full control:
  --   - the service_role (backend admin API onboarding), and
  --   - an authenticated owner.
  if auth.role() = 'service_role'
     or exists (
       select 1 from public.people
       where user_id = auth.uid() and role = 'owner'
     ) then
    return new;
  end if;

  -- Non-owner self-claim: never allow role or id to change.
  new.role := old.role;
  new.id   := old.id;
  return new;
end;
$$;

drop trigger if exists trg_pin_people_claim_columns on public.people;
create trigger trg_pin_people_claim_columns
  before update on public.people
  for each row
  execute procedure public.pin_people_claim_columns();

-- Owner can manage any people row from an authenticated session.
drop policy if exists "owner manage people" on public.people;
create policy "owner manage people" on public.people
  for all
  to authenticated
  using (
    exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
  );


-- ---------------------------------------------------------
-- 2. CRITICAL — DELETE is owner-only on reels / review_lane_cards / tasks
-- ---------------------------------------------------------
-- Live policies are the 0049 per-operation names (reels_delete / cards_delete /
-- tasks_delete), guarded by the demo-sandbox predicate. We replace each DELETE
-- policy with one that additionally requires the caller to be the owner, while
-- preserving the demo predicate so the demo persona keeps its constrained access
-- to demo=true rows. INSERT/UPDATE/SELECT (reels_insert/update/select etc.) are
-- left untouched - the team still edits reels/cards/tasks.

drop policy if exists "reels_delete" on public.reels;
create policy "reels_delete" on public.reels
  for delete
  using (
    auth.role() = 'authenticated'
    and (not public.is_demo_user() or demo = true)
    and exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
  );

drop policy if exists "cards_delete" on public.review_lane_cards;
create policy "cards_delete" on public.review_lane_cards
  for delete
  using (
    auth.role() = 'authenticated'
    and (not public.is_demo_user() or demo = true)
    and exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
  );

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete
  using (
    auth.role() = 'authenticated'
    and (not public.is_demo_user() or demo = true)
    and exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
  );


-- ---------------------------------------------------------
-- 3. HIGH — attached_footage_items: require authentication (no anon writes)
-- ---------------------------------------------------------
-- 0009 used `using (true)` / `with check (true)` on insert/update/delete, so even
-- an anonymous (anon-key, signed-out) client could write. Tighten to require an
-- authenticated session. SELECT is left as-is (read stays open per 0009).

drop policy if exists "attached_footage_insert_all" on public.attached_footage_items;
create policy "attached_footage_insert_all" on public.attached_footage_items
  for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "attached_footage_update_all" on public.attached_footage_items;
create policy "attached_footage_update_all" on public.attached_footage_items
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "attached_footage_delete_all" on public.attached_footage_items;
create policy "attached_footage_delete_all" on public.attached_footage_items
  for delete
  using (auth.role() = 'authenticated');


-- ---------------------------------------------------------
-- 4. HIGH — reel_dna: authenticated write = owner OR captured_by-self
-- ---------------------------------------------------------
-- Keep "owner_all_reel_dna" (0044) and "service_insert_reel_dna" (0044) intact.
-- We only tighten the two blanket authenticated policies:
--   auth_insert_reel_dna : authenticated may insert only if owner OR the row's
--                          captured_by equals their own people.id.
--   auth_update_reel_dna : authenticated may update only rows whose captured_by
--                          is their own people.id (owner covered by owner_all).
-- Mirrors gamify_rubric's self-write/self-update pattern (0050).
--
-- NOTE (service_role / IG ingest): the Hetzner poller and webhook insert reel_dna
-- with the SERVICE_ROLE key, which BYPASSES RLS - these tightened authenticated
-- policies do NOT apply to it, so IG DM ingest (and cross-platform link ingest)
-- is UNAFFECTED. "service_insert_reel_dna" remains as an explicit safety net.

drop policy if exists "auth_insert_reel_dna" on public.reel_dna;
create policy "auth_insert_reel_dna" on public.reel_dna
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
    or captured_by = (
      select id from public.people where user_id = auth.uid() limit 1
    )
  );

drop policy if exists "auth_update_reel_dna" on public.reel_dna;
create policy "auth_update_reel_dna" on public.reel_dna
  for update
  to authenticated
  using (
    exists (
      select 1 from public.people
      where user_id = auth.uid() and role = 'owner'
    )
    or captured_by = (
      select id from public.people where user_id = auth.uid() limit 1
    )
  );
