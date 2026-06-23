-- Music Library — favorites + playlists (per-user).
-- Builds on 0092 (music_tracks cache). These three tables let each user keep a
-- record of tracks: ♥ favorites and named playlists. track_id is LOOSE text (the
-- Epidemic track id, mirrored into music_tracks on save) — NO FK to music_tracks,
-- so a save never races the cache write and the client resolves orphan-safe
-- (exactly like reel_dna_assets.asset_id).
--
-- RLS is PER-USER, mirroring 0070_user_preferences: a row is visible/writable only
-- by the person who owns it (person_id = the caller's people.id), plus owner
-- god-mode. The person scoping selects public.people (NOT the table itself) so
-- there is no self-reference / infinite-recursion trap
-- (reference_rls-self-reference-recursion).
--
-- apply is HUMAN-GATED (npm run migrate:apply / Supabase SQL editor)

-- ── helper: the caller's people.id (inlined in each policy, kept here as a note) ──
--   (SELECT id FROM public.people WHERE user_id = auth.uid())

-- ── music_favorites ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.music_favorites (
  person_id   text        NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  track_id    text        NOT NULL,            -- Epidemic track id (mirrored into music_tracks)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, track_id)
);
CREATE INDEX IF NOT EXISTS music_favorites_person_idx ON public.music_favorites (person_id, created_at DESC);

-- ── music_playlists ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.music_playlists (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   text        NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  name        text        NOT NULL DEFAULT 'Untitled playlist',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_playlists_person_idx ON public.music_playlists (person_id, created_at DESC);

-- ── music_playlist_tracks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.music_playlist_tracks (
  playlist_id uuid        NOT NULL REFERENCES public.music_playlists(id) ON DELETE CASCADE,
  track_id    text        NOT NULL,            -- Epidemic track id (mirrored into music_tracks)
  position    int         NOT NULL DEFAULT 0,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX IF NOT EXISTS music_playlist_tracks_playlist_idx ON public.music_playlist_tracks (playlist_id, position);

-- ── RLS: per-user (mirrors 0070_user_preferences) ───────────────────────────
ALTER TABLE public.music_favorites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_playlists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_playlist_tracks  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_all_music_favorites"        ON public.music_favorites;
DROP POLICY IF EXISTS "owner_all_music_favorites"       ON public.music_favorites;
DROP POLICY IF EXISTS "self_all_music_playlists"        ON public.music_playlists;
DROP POLICY IF EXISTS "owner_all_music_playlists"       ON public.music_playlists;
DROP POLICY IF EXISTS "self_all_music_playlist_tracks"  ON public.music_playlist_tracks;
DROP POLICY IF EXISTS "owner_all_music_playlist_tracks" ON public.music_playlist_tracks;

-- favorites: own rows only
CREATE POLICY "self_all_music_favorites" ON public.music_favorites FOR ALL
  USING      (person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()))
  WITH CHECK (person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()));
CREATE POLICY "owner_all_music_favorites" ON public.music_favorites FOR ALL
  USING (EXISTS (SELECT 1 FROM public.people WHERE user_id = auth.uid() AND role = 'owner'));

-- playlists: own rows only
CREATE POLICY "self_all_music_playlists" ON public.music_playlists FOR ALL
  USING      (person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()))
  WITH CHECK (person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()));
CREATE POLICY "owner_all_music_playlists" ON public.music_playlists FOR ALL
  USING (EXISTS (SELECT 1 FROM public.people WHERE user_id = auth.uid() AND role = 'owner'));

-- playlist_tracks: rows of a playlist the caller owns. The EXISTS selects
-- music_playlists (a DIFFERENT table) — cross-table, not self-reference, so no
-- recursion. owner god-mode mirrors the others.
CREATE POLICY "self_all_music_playlist_tracks" ON public.music_playlist_tracks FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.music_playlists p
            WHERE p.id = playlist_id
              AND p.person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.music_playlists p
            WHERE p.id = playlist_id
              AND p.person_id = (SELECT id FROM public.people WHERE user_id = auth.uid()))
  );
CREATE POLICY "owner_all_music_playlist_tracks" ON public.music_playlist_tracks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.people WHERE user_id = auth.uid() AND role = 'owner'));

-- Realtime so a save in one tab appears in another. Guarded ADD so the migration
-- stays re-runnable (ALTER PUBLICATION errors if the table is already a member).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['music_favorites','music_playlists','music_playlist_tracks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
