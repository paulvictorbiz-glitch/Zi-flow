-- RPC for pgvector cosine similarity search on approved FAQ pairs.
-- Apply in Supabase SQL editor.

CREATE OR REPLACE FUNCTION match_faq_pairs(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.65,
  match_count     int   DEFAULT 5
)
RETURNS TABLE (
  id                 uuid,
  question           text,
  answer             text,
  use_count          int,
  similarity         float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    fp.id,
    fp.question,
    fp.answer,
    fp.use_count,
    1 - (fp.question_embedding <=> query_embedding) AS similarity
  FROM public.faq_pairs fp
  WHERE fp.approved = true
    AND fp.question_embedding IS NOT NULL
    AND 1 - (fp.question_embedding <=> query_embedding) >= match_threshold
  ORDER BY fp.question_embedding <=> query_embedding
  LIMIT match_count;
$$;
