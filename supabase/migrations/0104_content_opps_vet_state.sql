-- 0104_content_opps_vet_state.sql — Content Forge vetting marker (additive, idempotent).
-- Owner vets discovered opportunities on title+angle (no LLM spend). 'shortlisted'
-- gates the explicit Elevate/Expound action so tokens are only spent on vetted picks.
--
-- vet_state is kept ORTHOGONAL to `status` on purpose: expanding flips status →
-- 'hook_generated', and a separate column means that never erases the vet marker.
--
-- NO RLS change needed: owner_write_content_opps (0102) is FOR ALL TO authenticated
-- USING auth_is_owner() WITH CHECK auth_is_owner(), which already authorizes the
-- owner to UPDATE this new column. The owner is the only one who vets.
--
-- APPLY IS HUMAN-GATED — scoped one-off (NOT `npm run migrate:apply`, since other
-- migrations are intentionally held back). Frontend treats a missing column / value
-- as 'new', so the page is safe to ship before this is applied.

ALTER TABLE public.content_opportunities
  ADD COLUMN IF NOT EXISTS vet_state TEXT NOT NULL DEFAULT 'new'
    CHECK (vet_state IN ('new','shortlisted','rejected'));

ALTER TABLE public.content_opportunities
  ADD COLUMN IF NOT EXISTS vetted_at TIMESTAMPTZ;   -- audit only

CREATE INDEX IF NOT EXISTS content_opps_vet_state_idx
  ON public.content_opportunities (vet_state);
