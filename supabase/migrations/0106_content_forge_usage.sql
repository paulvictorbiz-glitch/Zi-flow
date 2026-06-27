-- 0106_content_forge_usage.sql
-- Content Forge — content_forge_usage: one row per LLM call (token usage + estimated cost).
--
-- Powers the Monitor "API Budgets & Limits" card's LIVE Vertex spend: the Hetzner
-- content_forge.py writer (_log_usage) appends a row after every discover/expand pass with
-- the provider/model actually used, the token counts captured from the response, and a
-- cost_usd it stamps from a maintained price table. The owner reads an aggregated rollup via
-- GET /api/content-forge/usage (secret-gated, service-role) → the Monitor proxy, so no
-- per-user RLS read is required for the card itself; an owner SELECT policy is added anyway
-- for ad-hoc inspection.
--
-- The fourth Content Forge migration (0101 transcript_clips, 0102 content_opportunities,
-- 0103 reels.creative_brief, 0105 clip watermark). Append-only telemetry — no updates, no
-- soft refs, no FK (the writer must never fail on a missing parent), so the writes never
-- block the pipeline.
--
-- APPLY IS HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert), NOT
-- `npm run migrate:apply` (other pending files are intentionally held back — CLAUDE.md
-- rule 8d).
--
-- DEGRADE-SAFE: content_forge.py treats a missing table (insert 400 / rollup read non-200)
-- as best-effort — the discovery/expansion pipeline runs unchanged and the Monitor card
-- falls back to its static credit-window view until this is applied.
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS before CREATE
-- POLICY). NO 'concurrently'. NO RLS self-reference (owner read goes through the
-- public.auth_is_owner() SECURITY DEFINER helper from migration 0076, never a subquery on
-- this table — avoids the 0076 infinite-recursion class).


-- ════════════════════════════════════════════════════════════════════════════
-- content_forge_usage: append-only per-call LLM usage + cost log
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.content_forge_usage (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT,                                   -- vertex_gemini | gemini_api | anthropic | openrouter
  model              TEXT,                                   -- exact model id the call used
  kind               TEXT,                                   -- discovery | expansion
  prompt_tokens      INTEGER     NOT NULL DEFAULT 0,
  completion_tokens  INTEGER     NOT NULL DEFAULT 0,
  total_tokens       INTEGER     NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(12,6) NOT NULL DEFAULT 0,       -- estimated from the backend price table
  fell_back          BOOLEAN     NOT NULL DEFAULT false,     -- true if an earlier ladder rung errored first
  batch_id           UUID,                                   -- discovery_run_id for discovery calls; NULL for expansion
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- indexes — the rollup scans newest-first; provider/kind filters are cheap rollup aids
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS content_forge_usage_created_idx  ON public.content_forge_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS content_forge_usage_provider_idx ON public.content_forge_usage (provider);
CREATE INDEX IF NOT EXISTS content_forge_usage_batch_idx    ON public.content_forge_usage (batch_id) WHERE batch_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- RLS: service writes/reads everything (the Hetzner writer + the /usage proxy);
-- owner may read for ad-hoc inspection. No INSERT/UPDATE for non-owner roles.
-- ════════════════════════════════════════════════════════════════════════════
-- DROP POLICY IF EXISTS before each CREATE POLICY (CREATE POLICY is NOT idempotent).

ALTER TABLE public.content_forge_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_read_cf_usage"   ON public.content_forge_usage;
DROP POLICY IF EXISTS "service_all_cf_usage"  ON public.content_forge_usage;

CREATE POLICY "owner_read_cf_usage"  ON public.content_forge_usage FOR SELECT TO authenticated USING (public.auth_is_owner());
CREATE POLICY "service_all_cf_usage" ON public.content_forge_usage FOR ALL    TO service_role  USING (true) WITH CHECK (true);
