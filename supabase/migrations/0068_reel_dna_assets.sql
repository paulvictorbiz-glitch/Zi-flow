-- Reel DNA — reel_dna_assets: the polymorphic Assets join table that attaches a
-- footage clip, a saved location, a thumbnail, or a news item to a reel_dna card
-- by uuid. asset_type tags which library the asset_id points at; asset_id is text
-- so it can hold any of those id shapes (footage uuid, location/thumbnail/news id).
-- people.id is TEXT ('paul','alex','sam','maya', ...), NOT uuid — see 0002.
-- The FULL unique index below is the ON CONFLICT / PostgREST upsert arbiter; it is
-- never partial (0061 gotcha: a partial unique index inserts 0 rows / errors 42P10
-- when used as an upsert arbiter). Team-wide RLS mirrors 0044_reel_dna.sql: any
-- authenticated user who can edit a card can attach/detach its assets.
-- Apply via `npm run migrate:apply`.

-- ── reel_dna_assets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reel_dna_assets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_dna_id  uuid        NOT NULL REFERENCES public.reel_dna(id) ON DELETE CASCADE,
  asset_type   text        NOT NULL CHECK (asset_type IN ('footage','location','thumbnail','news')),
  asset_id     text        NOT NULL,
  label        text,
  -- people.id is text ('paul','alex','sam','maya', ...), NOT uuid. See 0002.
  created_by   text        REFERENCES public.people(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Dedup guard: one attachment per (card, asset_type, asset_id). FULL unique index so
-- it is a valid ON CONFLICT / PostgREST upsert arbiter (0061 gotcha: never partial).
CREATE UNIQUE INDEX IF NOT EXISTS reel_dna_assets_uidx
  ON public.reel_dna_assets (reel_dna_id, asset_type, asset_id);

-- Helper indexes: list assets for one card, and reverse-lookup cards for one asset.
CREATE INDEX IF NOT EXISTS reel_dna_assets_card_idx
  ON public.reel_dna_assets (reel_dna_id);
CREATE INDEX IF NOT EXISTS reel_dna_assets_asset_idx
  ON public.reel_dna_assets (asset_type, asset_id);

ALTER TABLE public.reel_dna_assets ENABLE ROW LEVEL SECURITY;

-- Team-wide reads + writes (mirrors 0044_reel_dna.sql): any authenticated user who
-- can edit a card can attach/detach its assets. Service role gets a broad FOR ALL
-- (background ingest), and owner keeps god-mode for cleanup.
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "auth_read_reel_dna_assets"    ON public.reel_dna_assets;
DROP POLICY IF EXISTS "auth_insert_reel_dna_assets"  ON public.reel_dna_assets;
DROP POLICY IF EXISTS "auth_update_reel_dna_assets"  ON public.reel_dna_assets;
DROP POLICY IF EXISTS "auth_delete_reel_dna_assets"  ON public.reel_dna_assets;
DROP POLICY IF EXISTS "service_all_reel_dna_assets"  ON public.reel_dna_assets;
DROP POLICY IF EXISTS "owner_all_reel_dna_assets"    ON public.reel_dna_assets;

CREATE POLICY "auth_read_reel_dna_assets"
  ON public.reel_dna_assets FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "auth_insert_reel_dna_assets"
  ON public.reel_dna_assets FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "auth_update_reel_dna_assets"
  ON public.reel_dna_assets FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "auth_delete_reel_dna_assets"
  ON public.reel_dna_assets FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE POLICY "service_all_reel_dna_assets"
  ON public.reel_dna_assets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "owner_all_reel_dna_assets"
  ON public.reel_dna_assets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so a new attachment / detachment appears live on the Reel DNA card.
-- Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table is already a
-- member, so only add it when it isn't (keeps the migration re-runnable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reel_dna_assets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reel_dna_assets;
  END IF;
END $$;
