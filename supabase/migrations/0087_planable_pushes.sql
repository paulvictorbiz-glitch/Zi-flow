-- 0087_planable_pushes.sql
-- apply is HUMAN-GATED (npm run migrate:apply / Supabase SQL editor)
--
-- Durable audit + idempotency table for "Push to Planable" from the Export tab.
-- One row per successful push of a reel to a Planable page. The server-side
-- proxy (suggest.js ?action=planable-push) checks for an existing row before
-- pushing (dedupe by reel_id + platform, in app code) and INSERTs after a
-- successful Planable create-draft. NO unique constraint: re-push with force
-- must be allowed; dedupe is done in app code, not the DB.
--
-- RLS mirrors render_jobs (0083) EXACTLY: owner manages via auth_is_owner();
-- authenticated users may SELECT. The server writes via the JWT-as-authenticated
-- workaround (CLAUDE.md / api/admin/_auth.js), so owner-manage covers writes.

CREATE TABLE IF NOT EXISTS public.planable_pushes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id          TEXT NOT NULL,                 -- workflow reel id (text, not FK — reels live in a JSONB-backed store)
  platform         TEXT NOT NULL,                 -- platform key resolved server-side to a page id (ig|fb|tiktok|yt|...)
  planable_post_id TEXT,                          -- id returned by Planable on successful create-draft
  scheduled        TEXT,                          -- composed schedule string sent to Planable (date+time, owner TZ)
  with_media       BOOLEAN NOT NULL DEFAULT FALSE,-- whether media attached; false = caption-only fallback
  pushed_by        TEXT REFERENCES public.people(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server dedupe queries by reel_id (+ platform). NOT unique: re-push (force) allowed.
CREATE INDEX IF NOT EXISTS planable_pushes_reel_idx
  ON public.planable_pushes(reel_id);

ALTER TABLE public.planable_pushes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage planable_pushes"       ON public.planable_pushes;
DROP POLICY IF EXISTS "authenticated view planable_pushes" ON public.planable_pushes;

CREATE POLICY "owner manage planable_pushes"
  ON public.planable_pushes FOR ALL
  USING (public.auth_is_owner())
  WITH CHECK (public.auth_is_owner());

CREATE POLICY "authenticated view planable_pushes"
  ON public.planable_pushes FOR SELECT
  USING (auth.role() = 'authenticated');

-- Add to realtime so the Export tab can reflect push status live (optional,
-- consistent with render_jobs / 0083).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.planable_pushes;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
