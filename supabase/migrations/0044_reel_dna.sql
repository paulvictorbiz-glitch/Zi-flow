-- Reel DNA — Phase 1 capture library.
-- Each row is a captured reel + its "genes" (music / font / hook / sfx / story).
-- Three intakes write here: the in-app manual form (source='manual'), the
-- Instagram share-to-DM webhook on the Hetzner backend (source='ig_dm'), and
-- the PWA share-target / bookmarklet (source='share_target').
-- Modeled on 0042_workflow_insights.sql (RLS triad + realtime publication) and
-- the set_updated_at() trigger from 0001_init.sql. Apply via `npm run migrate:apply`.

-- ── reel_dna ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reel_dna (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_url           text        NOT NULL,
  platform           text        NOT NULL DEFAULT 'ig',   -- 'ig'|'tiktok'|'yt'
  genes_of_interest  text[]      DEFAULT '{}',            -- subset of music/font/hook/sfx/story
  quick_notes        text,
  -- per-gene structured fields, filled in later; jsonb keeps the table flat.
  music              jsonb,      -- { track, link, source }
  hook               jsonb,      -- { startTs, endTs, downloadLink }
  font               jsonb,      -- { names:[], links:[] }
  story              jsonb,      -- { styleNotes }
  sfx                jsonb,      -- { notes }
  status             text        NOT NULL DEFAULT 'captured',  -- captured|in_progress|done
  source             text        NOT NULL DEFAULT 'manual',    -- manual|ig_dm|share_target
  -- optional link to a production reel (reels.id is text 'REEL-NNN', NOT uuid).
  reel_id            text        REFERENCES public.reels(id) ON DELETE SET NULL,
  captured_by        text,                                -- people.id (text like 'paul')
  external_ref       text,                                -- ig_dm message id (dedupe key)
  archived_at        timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reel_dna_status_idx   ON public.reel_dna (status);
CREATE INDEX IF NOT EXISTS reel_dna_source_idx    ON public.reel_dna (source);
CREATE INDEX IF NOT EXISTS reel_dna_created_idx    ON public.reel_dna (created_at DESC);
CREATE INDEX IF NOT EXISTS reel_dna_archived_idx   ON public.reel_dna (archived_at);
CREATE INDEX IF NOT EXISTS reel_dna_reel_idx       ON public.reel_dna (reel_id);
-- Dedupe guard for the IG webhook: a repeated DM of the same message can't
-- create a second row. Partial so manual/share_target rows (null ref) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS reel_dna_external_ref_uidx
  ON public.reel_dna (external_ref) WHERE external_ref IS NOT NULL;

-- updated_at bump on every UPDATE (function defined in 0001_init.sql).
DROP TRIGGER IF EXISTS trg_reel_dna_updated_at ON public.reel_dna;
CREATE TRIGGER trg_reel_dna_updated_at
  BEFORE UPDATE ON public.reel_dna
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.reel_dna ENABLE ROW LEVEL SECURITY;

-- The whole team captures reels, so reads + writes are open to any authenticated
-- user (unlike app_settings, which is owner-write). The webhook inserts via the
-- service role; owner keeps god-mode for cleanup.
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "auth_read_reel_dna"    ON public.reel_dna;
DROP POLICY IF EXISTS "auth_insert_reel_dna"  ON public.reel_dna;
DROP POLICY IF EXISTS "auth_update_reel_dna"  ON public.reel_dna;
DROP POLICY IF EXISTS "service_insert_reel_dna" ON public.reel_dna;
DROP POLICY IF EXISTS "owner_all_reel_dna"    ON public.reel_dna;

CREATE POLICY "auth_read_reel_dna"
  ON public.reel_dna FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "auth_insert_reel_dna"
  ON public.reel_dna FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "auth_update_reel_dna"
  ON public.reel_dna FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_reel_dna"
  ON public.reel_dna FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_all_reel_dna"
  ON public.reel_dna FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so a manual/IG-DM/share capture appears live in the Reel DNA tab.
-- Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table is already a
-- member, so only add it when it isn't (keeps the migration re-runnable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reel_dna'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reel_dna;
  END IF;
END $$;
