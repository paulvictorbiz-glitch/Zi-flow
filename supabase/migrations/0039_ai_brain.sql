-- AI Brain: message classification, FAQ bot, improvement suggestions, bot audit log.
-- Apply in Supabase SQL editor.

-- Enable pgvector (idempotent — safe to run if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── ai_notes ─────────────────────────────────────────────────────────────────
-- Tagged observations extracted from RC channel messages or social inbox threads.
CREATE TABLE IF NOT EXISTS public.ai_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL,   -- 'rocketchat'|'facebook'|'instagram'|'youtube'|'tiktok'
  source_id   text,                   -- RC message id or social thread id
  channel     text,                   -- RC channel name or social handle
  author      text,
  body        text        NOT NULL,   -- original message text (truncated to 2000 chars)
  topic       text        NOT NULL,   -- 'SOP'|'Process'|'Bug'|'Question'|'Todo'|'Improvement'|'Other'
  tags        text[]      DEFAULT '{}',
  severity    text        DEFAULT 'low',   -- 'low'|'medium'|'high'
  resolved    boolean     DEFAULT false,
  resolved_at timestamptz,
  note        text,                   -- Paul's annotation
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_notes_topic_idx    ON public.ai_notes (topic);
CREATE INDEX IF NOT EXISTS ai_notes_resolved_idx ON public.ai_notes (resolved);
CREATE INDEX IF NOT EXISTS ai_notes_source_idx   ON public.ai_notes (source, created_at DESC);

ALTER TABLE public.ai_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_ai_notes"
  ON public.ai_notes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_ai_notes"
  ON public.ai_notes FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_update_ai_notes"
  ON public.ai_notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ── faq_pairs ────────────────────────────────────────────────────────────────
-- Approved Q&A pairs used by the FAQ bot. Embeddings stored as pgvector.
CREATE TABLE IF NOT EXISTS public.faq_pairs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question           text        NOT NULL,
  answer             text        NOT NULL,
  question_embedding vector(1536),          -- text-embedding-3-small output
  source_note_id     uuid        REFERENCES public.ai_notes(id) ON DELETE SET NULL,
  use_count          integer     DEFAULT 0,
  last_used_at       timestamptz,
  approved           boolean     DEFAULT false,
  approved_at        timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- ivfflat index for cosine similarity search (requires >= 1 row to be useful)
CREATE INDEX IF NOT EXISTS faq_pairs_embedding_idx
  ON public.faq_pairs
  USING ivfflat (question_embedding vector_cosine_ops)
  WITH (lists = 50);

ALTER TABLE public.faq_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_faq_pairs"
  ON public.faq_pairs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_faq_pairs"
  ON public.faq_pairs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_all_faq_pairs"
  ON public.faq_pairs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ── improvement_suggestions ──────────────────────────────────────────────────
-- Periodic AI-generated suggestions surfaced from ai_notes patterns.
CREATE TABLE IF NOT EXISTS public.improvement_suggestions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category         text        NOT NULL,   -- 'workflow'|'app'|'content'|'sop'
  title            text        NOT NULL,
  body             text        NOT NULL,
  priority         text        DEFAULT 'medium',  -- 'low'|'medium'|'high'
  source_note_ids  uuid[]      DEFAULT '{}',
  status           text        DEFAULT 'pending', -- 'pending'|'in_progress'|'done'|'dismissed'
  dismissed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.improvement_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_suggestions"
  ON public.improvement_suggestions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_suggestions"
  ON public.improvement_suggestions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_all_suggestions"
  ON public.improvement_suggestions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ── bot_conversations ─────────────────────────────────────────────────────────
-- Audit log of every bot interaction so Paul can promote good Q&A to faq_pairs.
CREATE TABLE IF NOT EXISTS public.bot_conversations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text        NOT NULL,  -- 'rocketchat'|'direct'
  channel      text,
  author       text        NOT NULL,
  question     text        NOT NULL,
  answer       text        NOT NULL,
  faq_pair_id  uuid        REFERENCES public.faq_pairs(id) ON DELETE SET NULL,
  confidence   numeric(4,3),          -- cosine similarity score (0–1)
  was_helpful  boolean,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.bot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_bot_convos"
  ON public.bot_conversations FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_bot_convos"
  ON public.bot_conversations FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_update_bot_convos"
  ON public.bot_conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Add realtime for the notes table so the AI Brain tab updates live
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_notes;
