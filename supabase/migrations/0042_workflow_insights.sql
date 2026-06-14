-- Workflow Intelligence Log: AI-distilled insights about how to improve FootageBrain itself.
-- Sourced from bot_conversations + ai_notes (Bug/Improvement/Process/SOP) + manual entries.
-- Apply in Supabase SQL editor.

-- ── workflow_insights ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_insights (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type  text        NOT NULL,   -- 'bot_conversation'|'ai_note'|'manual'
  source_id    text,                   -- id of the originating record (dedup key)
  category     text        NOT NULL,   -- 'code_change'|'workflow_change'|'feature_request'|'bug'|'process'
  summary      text        NOT NULL,   -- 1–2 sentence distilled insight
  raw_excerpt  text,                   -- original message excerpt (truncated to 500 chars)
  tags         text[]      DEFAULT '{}',
  priority     text        DEFAULT 'medium',  -- 'low'|'medium'|'high'
  status       text        DEFAULT 'open',    -- 'open'|'noted'|'promoted'|'dismissed'
  paul_note    text,                   -- owner annotation
  promoted_at  timestamptz,
  dismissed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_insights_status_idx   ON public.workflow_insights (status);
CREATE INDEX IF NOT EXISTS workflow_insights_category_idx ON public.workflow_insights (category);
CREATE INDEX IF NOT EXISTS workflow_insights_source_idx   ON public.workflow_insights (source_id);
CREATE INDEX IF NOT EXISTS workflow_insights_created_idx  ON public.workflow_insights (created_at DESC);

ALTER TABLE public.workflow_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_workflow_insights"
  ON public.workflow_insights FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_workflow_insights"
  ON public.workflow_insights FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_all_workflow_insights"
  ON public.workflow_insights FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so the Insights tab and My Work panel update live.
ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_insights;
