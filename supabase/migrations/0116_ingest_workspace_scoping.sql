-- 0116_ingest_workspace_scoping.sql
-- Extends workspace scoping (0115: workspaces + reels.workspace_id) to the
-- Content-Forge-adjacent ingest tables — processing_jobs, transcript_clips,
-- content_opportunities — so raw-footage ingest, transcript mining, and
-- AI-discovered content opportunities are all scoped per client workspace.
--
-- WHAT THIS ADDS:
--   * workspace_id TEXT NOT NULL DEFAULT 'paul' on all three tables, matching
--     the 0115 precedent EXACTLY: NO FK to workspaces.slug (loose UX/data-
--     hygiene scoping, not a security boundary). All pre-existing rows backfill
--     to 'paul' (today's only tenant), so nothing changes behaviourally until a
--     frontend .eq('workspace_id', slug) filter ships.
--   * a workspace_id index on each table for the scoped reads.
--
-- SAFETY (CLAUDE.md rule 10b — schema_migrations can lie: a file can be marked
-- applied without its objects existing live, e.g. 0049_demo_sandbox never ran).
-- Each table's ALTER is wrapped in its own guarded DO $$ block probing
-- information_schema.tables first — mirrors 0092_music_tracks.sql's guard on
-- reel_dna_assets (0115 itself does NOT guard; it alters the foundational
-- `reels` table directly). Because this file touches THREE tables in one
-- exec_sql transaction, one missing table would otherwise raise and roll back
-- scoping for ALL three — the guard makes a missing table a silent no-op.
--
-- RLS: UNCHANGED. Audited all three tables' policies (0037 processing_jobs;
--   0101 transcript_clips; 0102 content_opportunities + follow-ons) — none is
--   column-scoped in a way workspace_id collides with (the only column ref is
--   content_opportunities' auth_pick_hook checking `status`). No new policy.
--
-- GRACEFUL DEGRADATION: the frontend reads that will filter these tables
--   (.eq('workspace_id', slug)) strip-retry UNFILTERED on
--   /workspace_id|column|42703|PGRST/ (mirroring store.jsx's reels pattern), so
--   a pre-0116 DB behaves byte-identically to today. Deploy ORDER is still
--   migration-FIRST, frontend-second (see plan Layer 4).
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (CLAUDE.md rule 10d). Authorize with:
--   "Apply migration 0116_ingest_workspace_scoping.sql"
--
-- Fully idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- guarded existence checks + backfill). NO 'concurrently'. Safely re-runnable.

-- ── processing_jobs (0037) ───────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'processing_jobs') THEN
    ALTER TABLE public.processing_jobs
      ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'paul';
    UPDATE public.processing_jobs SET workspace_id = 'paul' WHERE workspace_id IS NULL;
    CREATE INDEX IF NOT EXISTS processing_jobs_workspace_id_idx
      ON public.processing_jobs (workspace_id);
  END IF;
END $$;

-- ── transcript_clips (0101) ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'transcript_clips') THEN
    ALTER TABLE public.transcript_clips
      ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'paul';
    UPDATE public.transcript_clips SET workspace_id = 'paul' WHERE workspace_id IS NULL;
    CREATE INDEX IF NOT EXISTS transcript_clips_workspace_id_idx
      ON public.transcript_clips (workspace_id);
  END IF;
END $$;

-- ── content_opportunities (0102) ─────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'content_opportunities') THEN
    ALTER TABLE public.content_opportunities
      ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'paul';
    UPDATE public.content_opportunities SET workspace_id = 'paul' WHERE workspace_id IS NULL;
    CREATE INDEX IF NOT EXISTS content_opps_workspace_id_idx
      ON public.content_opportunities (workspace_id);
  END IF;
END $$;
