-- Music tracks — Epidemic Sound metadata CACHE.
-- Each row is one Epidemic track's display metadata, cached so that tracks
-- attached to a reel render in the UI WITHOUT re-hitting the Epidemic private API
-- (the proxy in api/ai/_epidemic.js). This is a NEW STANDALONE cache table.
--
-- Music attachment reuses the EXISTING polymorphic reel_dna_assets table (0068)
-- with asset_type='music' and asset_id = the Epidemic track id (already text) —
-- exactly like footage / locations / thumbnails / news. 0068 pinned asset_type
-- to a CHECK list that did NOT include 'music', so this migration EXTENDS that
-- constraint (below) — otherwise every music attach fails the CHECK at the DB.
--
-- RLS mirrors 0063_thumbnail_dna.sql: team-read + authenticated-write (editors
-- cache a track on attach) + service insert + owner god-mode. These are simple
-- auth.role() checks; a policy ON music_tracks NEVER selects music_tracks in its
-- USING / WITH CHECK (no self-reference → no infinite-recursion trap, see
-- reference_rls-self-reference-recursion).
--
-- apply is HUMAN-GATED (npm run migrate:apply / Supabase SQL editor)

-- ── music_tracks ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.music_tracks (
  id           text        PRIMARY KEY,   -- Epidemic track id
  title        text,
  artist       text,
  bpm          int,
  length_sec   int,
  cover_url    text,
  preview_url  text,
  moods        text[],
  genres       text[],
  raw          jsonb,                      -- the untouched mapped track, for forward-compat
  created_at   timestamptz DEFAULT now()
);

-- Recent-first listing for the Music Library tab.
CREATE INDEX IF NOT EXISTS music_tracks_created_idx ON public.music_tracks (created_at DESC);

-- ── extend reel_dna_assets.asset_type to allow 'music' ──────────────────────
-- 0068 created the column with an inline CHECK (auto-named
-- reel_dna_assets_asset_type_check) restricted to footage/location/thumbnail/news.
-- Attaching a track does INSERT ... asset_type='music', which would violate that
-- CHECK. Drop the old constraint and re-add it with 'music' included. Idempotent
-- (DROP IF EXISTS; the new constraint is a superset so re-running is safe).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'reel_dna_assets') THEN
    ALTER TABLE public.reel_dna_assets
      DROP CONSTRAINT IF EXISTS reel_dna_assets_asset_type_check;
    ALTER TABLE public.reel_dna_assets
      ADD  CONSTRAINT reel_dna_assets_asset_type_check
      CHECK (asset_type IN ('footage','location','thumbnail','news','music'));
  END IF;
END $$;

ALTER TABLE public.music_tracks ENABLE ROW LEVEL SECURITY;

-- Access model mirrors thumbnail_dna: the whole team browses/attaches tracks, so
-- reads + inserts + updates are open to any authenticated user; service_role can
-- insert; owner keeps god-mode for cleanup. DROP-then-CREATE so this migration is
-- safely re-runnable (the runner has no transaction wrapping, and CREATE POLICY
-- is not idempotent on its own).
DROP POLICY IF EXISTS "auth_read_music_tracks"      ON public.music_tracks;
DROP POLICY IF EXISTS "auth_insert_music_tracks"    ON public.music_tracks;
DROP POLICY IF EXISTS "auth_update_music_tracks"    ON public.music_tracks;
DROP POLICY IF EXISTS "service_insert_music_tracks" ON public.music_tracks;
DROP POLICY IF EXISTS "owner_all_music_tracks"      ON public.music_tracks;

CREATE POLICY "auth_read_music_tracks"
  ON public.music_tracks FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "auth_insert_music_tracks"
  ON public.music_tracks FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "auth_update_music_tracks"
  ON public.music_tracks FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_insert_music_tracks"
  ON public.music_tracks FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "owner_all_music_tracks"
  ON public.music_tracks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so a freshly-cached track appears live in the Music Library / asset
-- rollup. Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table is already
-- a member, so only add it when it isn't (keeps the migration re-runnable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'music_tracks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.music_tracks;
  END IF;
END $$;
