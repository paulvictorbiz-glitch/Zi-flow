-- 0109_content_opps_favorite_color.sql
-- Content Forge — opportunity row tagging: favorite (★) + color, both filterable.
--
-- Adds two columns to content_opportunities (0102) mirroring the Reel DNA row-tagging
-- pattern (mig 0089): a boolean favorite star and a free-text color tag (one of the
-- 8-tone palette the UI offers; NULL = untagged). content_opportunities is owner-write
-- (RLS owner_write_content_opps via public.auth_is_owner()) and Content Forge is
-- owner-gated, so plain table columns — NOT per-user user_preferences — are correct: a
-- single owner tags the shared discovery list.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert), NOT
-- migrate:apply (other pending files are intentionally held back — CLAUDE.md rule 8d).
--
-- Fully idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). No RLS change
-- (the existing owner_write_content_opps FOR ALL policy already covers these columns).
-- updated_at stays driven by trg_content_opps_updated_at (0102). No 'concurrently'.

ALTER TABLE public.content_opportunities
  ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS color    TEXT;

-- Partial indexes — the header filters select favorite=true / color=eq.<tone>.
CREATE INDEX IF NOT EXISTS content_opps_favorite_idx
  ON public.content_opportunities (favorite) WHERE favorite = true;
CREATE INDEX IF NOT EXISTS content_opps_color_idx
  ON public.content_opportunities (color) WHERE color IS NOT NULL;
