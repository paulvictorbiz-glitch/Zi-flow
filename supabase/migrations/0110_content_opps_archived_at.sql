-- 0110_content_opps_archived_at.sql
-- Content Forge — archive (never delete) an ingested opportunity.
--
-- Adds a soft-archive timestamp to content_opportunities (0102). The owner never
-- wants an ingested title/hook destroyed: archiving tucks the row into a "Show
-- archived" drawer (recoverable + re-sendable) instead of deleting it. The list
-- filters archived_at IS NULL by default; the drawer shows archived_at IS NOT NULL.
-- Mirrors reel_dna.archived_at (0044) — the parallel source table already has one.
--
-- content_opportunities is owner-write (RLS owner_write_content_opps via
-- public.auth_is_owner()) and Content Forge is owner-gated, so a plain table
-- column is correct (single owner curates the shared discovery list). No RLS
-- change — the existing owner_write_content_opps FOR ALL policy already covers it.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert), NOT
-- migrate:apply (other pending files are intentionally held back — CLAUDE.md rule 8d).
--
-- Fully idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
-- updated_at stays driven by trg_content_opps_updated_at (0102). No 'concurrently'.

ALTER TABLE public.content_opportunities
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial index — the default list filters archived_at IS NULL (the common read).
CREATE INDEX IF NOT EXISTS content_opps_active_idx
  ON public.content_opportunities (created_at DESC) WHERE archived_at IS NULL;
