-- 0107_content_opp_script.sql
-- Content Forge — add script_json JSONB column to content_opportunities.
--
-- Stores the generated VO/full-script for an opportunity, produced by the new
-- POST /api/content-forge/script endpoint (3rd token step: Discover → Expound
-- → Script). Shape:
--   {
--     text:          string,         -- the full voice-over script (~150-200 words)
--     template:      string,         -- "fact-reveal" | "hot-take" | "question-hook" | "story-first"
--     grounding_mode: string,        -- "footage" | "model" | "web"
--     tone:          string,         -- "neutral" | "punchy" | "educational" | "provocative"
--     word_count:    int,
--     citations:     [{beat, clip_id, quote}] | null,  -- only in footage mode
--     generated_at:  iso,
--     provider:      string,
--     model:         string
--   }
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files are intentionally held back — see
-- CLAUDE.md rule 8d).
--
-- Fully idempotent (ALTER TABLE … ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.content_opportunities
  ADD COLUMN IF NOT EXISTS script_json JSONB;
