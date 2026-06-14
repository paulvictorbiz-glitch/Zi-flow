-- Resize faq_pairs embedding column from 1536 to 1024 dims (Cohere embed-english-v3.0)
-- Also recreate the ivfflat index and match_faq_pairs RPC to match.

ALTER TABLE public.faq_pairs ALTER COLUMN question_embedding TYPE vector(1024);

DROP INDEX IF EXISTS faq_pairs_embedding_idx;
CREATE INDEX faq_pairs_embedding_idx ON public.faq_pairs
  USING ivfflat (question_embedding vector_cosine_ops) WITH (lists = 50);

DROP FUNCTION IF EXISTS match_faq_pairs;
CREATE OR REPLACE FUNCTION match_faq_pairs(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.65,
  match_count     int   DEFAULT 5
)
RETURNS TABLE (id uuid, question text, answer text, use_count int, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT fp.id, fp.question, fp.answer, fp.use_count,
         1 - (fp.question_embedding <=> query_embedding) AS similarity
  FROM public.faq_pairs fp
  WHERE fp.approved = true
    AND fp.question_embedding IS NOT NULL
    AND 1 - (fp.question_embedding <=> query_embedding) >= match_threshold
  ORDER BY fp.question_embedding <=> query_embedding
  LIMIT match_count;
$$;
