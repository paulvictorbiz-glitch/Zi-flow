-- 0111_content_opps_entities_mentioned.sql
-- Content Forge — entities_mentioned: concrete named things pulled from the transcript.
--
-- The discovery LLM already reads the raw footage transcript; this column captures the
-- SPECIFIC, look-up-able nouns it names or clearly implies per opportunity — a place/
-- landmark, historical event, person, cultural tradition, record/number/date — as distinct
-- from the existing "topics" column (which stays thematic/generic: "food", "danger").
--
-- Why: expand()/script() web-grounding previously built its Tavily search query from
-- title+angle_summary (marketing copy — "The Bridge Locals Fear" returns nothing useful).
-- entities_mentioned lets that search target the actual named thing ("Zhangjiajie glass
-- bridge history"), so hooks/scripts can cite a real fact/date/number instead of staying
-- generic. Written by backend-handoff/content_forge.py's discover worker (degrade-safe:
-- _upsert_opportunities retries the batch with this column stripped if the migration
-- hasn't been applied yet, so discovery keeps working either way).
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert), NOT
-- migrate:apply (other pending files are intentionally held back — CLAUDE.md rule 8d).
--
-- Fully idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
-- updated_at stays driven by trg_content_opps_updated_at (0102). No 'concurrently'.

ALTER TABLE public.content_opportunities
  ADD COLUMN IF NOT EXISTS entities_mentioned TEXT[] NOT NULL DEFAULT '{}';

-- GIN index — lets a future "opportunities mentioning X" filter/search use the array
-- efficiently instead of a sequential scan.
CREATE INDEX IF NOT EXISTS content_opps_entities_gin_idx
  ON public.content_opportunities USING GIN (entities_mentioned);
