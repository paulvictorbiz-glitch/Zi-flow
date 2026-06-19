-- Reel DNA — Phase 0 (Longform Story MVP) deconstruction columns.
-- Stands up the auto-deconstruct spine: paste a YouTube URL (or flip a capture to
-- format='long'), click Analyze → a Hetzner worker pulls audio/captions, runs one
-- free-LLM narrative pass, and writes the analysis back via the service role.
-- All columns are additive + nullable-or-defaulted so every EXISTING reel_dna row
-- degrades safely (defaults format='short', media_status='idle' = untouched).
--
-- Column roles:
--   format              'short' | 'long' — only 'long' rows get auto-deconstructed.
--   media_status        state machine: idle -> pending_analyze -> analyzing ->
--                       analyzed | analyze_failed (re-analyze flips analyzed|
--                       analyze_failed -> pending_analyze).
--   source_url_resolved canonical URL after normalize (what the worker fetched).
--   narrative           jsonb — the LLM's machine-authored longform deconstruction
--                       (hook/arc/open_loops/emotion_curve/scorecard/verdict, etc).
--   progress            jsonb — { step, pct, msg, updated_at } live worker progress.
--   media_error         failure stderr tail when media_status='analyze_failed'.
--   analyzed_at         timestamptz the last successful analysis completed.
--
-- IMPORTANT: `narrative` is MACHINE-ONLY and must NOT be confused with the human
-- `timeline` column (the manual reel-deconstructor editor at
-- src/pages/reel-deconstructor.jsx). They are separate concerns — never write the
-- machine narrative into the human timeline, or vice versa.
--
-- No CHECK constraint on format/media_status (kept flexible so the state vocabulary
-- can evolve without a constraint-swap migration, mirroring the content_type path).
-- No RLS change: the existing 0044 reel_dna policies (team read/write +
-- service-role insert + owner-all) already cover these new columns row-by-row.
-- Idempotent (IF NOT EXISTS everywhere) — safe to re-run. Apply via `npm run migrate:apply`.

ALTER TABLE public.reel_dna
  ADD COLUMN IF NOT EXISTS format              text        NOT NULL DEFAULT 'short',
  ADD COLUMN IF NOT EXISTS media_status        text        NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS source_url_resolved text,
  ADD COLUMN IF NOT EXISTS narrative           jsonb,
  ADD COLUMN IF NOT EXISTS progress            jsonb,
  ADD COLUMN IF NOT EXISTS media_error         text,
  ADD COLUMN IF NOT EXISTS analyzed_at         timestamptz;

-- The worker claim-loop selects rows by media_status (e.g. format='long' AND
-- media_status IN ('pending_analyze')), so index it for the queue drain.
CREATE INDEX IF NOT EXISTS reel_dna_media_status_idx
  ON public.reel_dna (media_status);
