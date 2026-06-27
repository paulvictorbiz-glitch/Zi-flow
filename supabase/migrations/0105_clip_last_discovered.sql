-- 0105_clip_last_discovered.sql — Content Forge incremental-discovery watermark (additive, idempotent).
-- Token-saver: discovery feeds ONLY clips not yet analyzed (last_discovered_at IS NULL),
-- and stamps last_discovered_at=now() on the clips it fed after a successful pass. A repeat
-- Discover then no longer re-spends the LLM on the same footage (?rescan=1 forces a full pass).
--
-- NO RLS change needed: owner_write_transcript_clips (0101) already authorizes the owner
-- to UPDATE this new column. The partial index makes the "undiscovered" scan cheap.
--
-- DEGRADE-SAFE: content_forge.py treats a missing column / 400 as "feed the full window" and
-- the mark-discovered PATCH as best-effort, so the backend is safe to deploy BEFORE this is
-- applied — behaviour just stays non-incremental until then.
--
-- APPLY IS HUMAN-GATED — scoped one-off (NOT `npm run migrate:apply`, since other
-- migrations are intentionally held back — see CLAUDE.md rule 8d).

ALTER TABLE public.transcript_clips
  ADD COLUMN IF NOT EXISTS last_discovered_at TIMESTAMPTZ;   -- NULL = not yet analyzed

-- Partial index: only the un-analyzed rows, which is exactly what the incremental read scans.
CREATE INDEX IF NOT EXISTS transcript_clips_undiscovered_idx
  ON public.transcript_clips (created_at DESC)
  WHERE last_discovered_at IS NULL;
