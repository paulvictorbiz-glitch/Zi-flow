-- Thumbnail DNA — YouTube thumbnail capture library.
-- Each row is a captured YouTube thumbnail + its six design "genes"
-- (color / typography / face / layout / mood / subject). MIRRORS the reel_dna
-- table (0044_reel_dna.sql) + its soft-delete tombstone (0062) but is a SEPARATE
-- table: it has NO reel_id / external_ref (no poller, no IG-DM, manual paste-in
-- only) and the six genes are PLAIN TEXT columns (not jsonb).
-- Modeled on 0044_reel_dna.sql (RLS triad + realtime publication) and the
-- set_updated_at() trigger from 0001_init.sql. Apply via `npm run migrate:apply`.

-- ── thumbnail_dna ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.thumbnail_dna (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_url          text        NOT NULL,
  video_id           text,                                  -- extracted YouTube id
  thumbnail_url      text,                                  -- client-derived i.ytimg.com URL
  title              text,                                  -- oEmbed enrichment (best-effort)
  channel            text,                                  -- oEmbed author_name (best-effort)
  platform           text        NOT NULL DEFAULT 'yt',     -- 'yt'
  genes_of_interest  text[]      DEFAULT '{}',              -- subset of the six genes
  quick_notes        text,
  -- the six design genes, plain text (manual tagging only, no jsonb).
  color              text,
  typography         text,
  face               text,
  layout             text,
  mood               text,
  subject            text,
  status             text        NOT NULL DEFAULT 'captured',  -- captured|in_progress|done
  source             text        NOT NULL DEFAULT 'manual',    -- manual
  captured_by        text,                                  -- people.id (text like 'paul')
  archived_at        timestamptz,
  deleted_at         timestamptz,                           -- soft-delete tombstone (see 0062)
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thumbnail_dna_status_idx   ON public.thumbnail_dna (status);
CREATE INDEX IF NOT EXISTS thumbnail_dna_source_idx    ON public.thumbnail_dna (source);
CREATE INDEX IF NOT EXISTS thumbnail_dna_created_idx    ON public.thumbnail_dna (created_at DESC);
CREATE INDEX IF NOT EXISTS thumbnail_dna_archived_idx   ON public.thumbnail_dna (archived_at);
CREATE INDEX IF NOT EXISTS thumbnail_dna_deleted_idx    ON public.thumbnail_dna (deleted_at);

-- updated_at bump on every UPDATE (function defined in 0001_init.sql).
DROP TRIGGER IF EXISTS trg_thumbnail_dna_updated_at ON public.thumbnail_dna;
CREATE TRIGGER trg_thumbnail_dna_updated_at
  BEFORE UPDATE ON public.thumbnail_dna
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.thumbnail_dna ENABLE ROW LEVEL SECURITY;

-- Same access model as reel_dna: the whole team captures thumbnails, so reads +
-- writes are open to any authenticated user; owner keeps god-mode for cleanup.
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "auth_read_thumbnail_dna"      ON public.thumbnail_dna;
DROP POLICY IF EXISTS "auth_insert_thumbnail_dna"    ON public.thumbnail_dna;
DROP POLICY IF EXISTS "auth_update_thumbnail_dna"    ON public.thumbnail_dna;
DROP POLICY IF EXISTS "service_insert_thumbnail_dna" ON public.thumbnail_dna;
DROP POLICY IF EXISTS "owner_all_thumbnail_dna"      ON public.thumbnail_dna;

CREATE POLICY "auth_read_thumbnail_dna"
  ON public.thumbnail_dna FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "auth_insert_thumbnail_dna"
  ON public.thumbnail_dna FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "auth_update_thumbnail_dna"
  ON public.thumbnail_dna FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_thumbnail_dna"
  ON public.thumbnail_dna FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_all_thumbnail_dna"
  ON public.thumbnail_dna FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so a manual capture appears live in the Thumbnails tab.
-- Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table is already a
-- member, so only add it when it isn't (keeps the migration re-runnable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'thumbnail_dna'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.thumbnail_dna;
  END IF;
END $$;
