-- 0113_reels_blueprint.sql
-- Content Forge — blueprint_json: the REEL-360/REEL-377 gold-standard blueprint blob.
--
-- Adds a nullable JSONB blueprint_json column to BOTH:
--   * public.reels                -- Team C reads/renders it (detail.jsx panel +
--                                    blueprint-pdf.js); Team A persists it opaque
--                                    via the store helper createReelWithFootage().
--   * public.content_opportunities -- Team D persists the freshly-generated blueprint
--                                    here (forge-script mode=blueprint); Team A
--                                    re-seeds the re-opened ForgeModal from
--                                    opportunity.blueprint_json.
--
-- The blueprint_json shape is the frozen BlueprintJson schema (fact_sheet,
-- claim_framings, variations[3], hook_bank[6], captions, hashtags,
-- posting_checklist, footage_refs, + optional topic/logline/format_assumed/
-- verified_facts_intro). Stored OPAQUE — no column-level validation; the app
-- treats it as a JSON blob. reels.id is TEXT (migration 0001);
-- content_opportunities is migration 0102.
--
-- Nullable + additive — existing rows stay NULL. No backfill. No RLS change
-- (inherits each table's existing policies).
--
-- GRACEFUL DEGRADATION: until this file is hand-applied, both write paths swallow
-- the missing-column error — the store strip+retries on /blueprint_json|column|
-- PGRST204/ so script/vo/logline/creative_brief still persist, and Team D's
-- opportunity write reports persisted:false. Applying this migration flips both
-- paths to full persistence with no code change.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files are intentionally held back — see
-- CLAUDE.md rule 8d). Never applied by any agent.
--
-- Fully idempotent (ALTER TABLE … ADD COLUMN IF NOT EXISTS). NO 'concurrently'.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS blueprint_json JSONB;

ALTER TABLE public.content_opportunities
  ADD COLUMN IF NOT EXISTS blueprint_json JSONB;
