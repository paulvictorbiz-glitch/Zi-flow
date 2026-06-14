-- 0029_locations.sql
-- Moves filming locations off per-browser localStorage onto a shared
-- team table so pins added by one operator are visible to everyone and
-- can be linked to reels. Mirrors the Location record shape in
-- src/lib/locations-data.jsx (makeLocation): id is the app-generated
-- "loc-xxxxx" string, coords are nullable (a place can be imported
-- without geocoding), and linked_reel_ids is the forward hook reels
-- attach through.

CREATE TABLE IF NOT EXISTS public.locations (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL DEFAULT 'Untitled place',
  category        TEXT DEFAULT '',
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  address         TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  tags            TEXT[] DEFAULT '{}',
  source          TEXT DEFAULT 'manual',     -- manual | kml | geojson | csv
  map_mid         TEXT,                       -- which My Maps mid it came from
  linked_reel_ids TEXT[] DEFAULT '{}',
  linked_note_ids TEXT[] DEFAULT '{}',
  created_by      TEXT REFERENCES public.people(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locations_created_idx ON public.locations (created_at);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='locations' AND policyname='locations_select_all'
  ) THEN
    EXECUTE 'CREATE POLICY locations_select_all ON public.locations FOR SELECT USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='locations' AND policyname='locations_insert_all'
  ) THEN
    EXECUTE 'CREATE POLICY locations_insert_all ON public.locations FOR INSERT WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='locations' AND policyname='locations_update_all'
  ) THEN
    EXECUTE 'CREATE POLICY locations_update_all ON public.locations FOR UPDATE USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='locations' AND policyname='locations_delete_all'
  ) THEN
    EXECUTE 'CREATE POLICY locations_delete_all ON public.locations FOR DELETE USING (true)';
  END IF;
END
$$;
