-- 0103_reels_creative_brief.sql
-- Content Forge — reels.creative_brief: the hook brief carried into the pipeline.
--
-- The third of three Content Forge migrations (0101 transcript_clips,
-- 0102 content_opportunities, 0103 reels.creative_brief). When the owner picks a
-- hook in the ForgeModal and hits "Send to Pipeline", the chosen content
-- opportunity's hook is written onto the target reel as a JSONB brief, which the
-- reel detail view (src/components/detail.jsx) surfaces to editors. Nullable +
-- additive — existing reels stay NULL. No backfill, no RLS change (inherits the
-- reels table policies). reels.id is TEXT (migration 0001).
--
-- shape: {opportunity_id, selected_hook_version, hook_text, hook_style,
--         forged_by, forged_at, ig_performance}
--
-- v1 LEAN CORE: this migration intentionally adds ONLY the creative_brief column
-- and its index. The attached_footage_items Drive columns (drive_file_id /
-- link_status / link_checked_at) from the full CONTENT-FORGE-PLAN.md are DEFERRED
-- to a later pass alongside coverage-health badges/relink — NOT included here.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files are intentionally held back — see
-- CLAUDE.md rule 8d).
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- NO 'concurrently'.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS creative_brief JSONB;

CREATE INDEX IF NOT EXISTS reels_creative_brief_opp_idx
  ON public.reels ((creative_brief->>'opportunity_id'))
  WHERE creative_brief IS NOT NULL;
