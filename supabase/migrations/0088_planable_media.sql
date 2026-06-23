-- 0088_planable_media.sql
-- apply is HUMAN-GATED (npm run migrate:apply / Supabase SQL editor); depends on 0087_planable_pushes
--
-- Final-video UPLOAD pipeline for "Push to Planable". Adds:
--   (DB2) a PRIVATE Storage bucket "reel-videos" for owner-uploaded final MP4s.
--         The bucket is PRIVATE (public=false): the server mints a short-lived
--         SIGNED url for Planable's POST /media to fetch server-side; the file is
--         NEVER world-readable.
--   (DB3) RLS on storage.objects scoped to bucket_id='reel-videos': owner manages
--         (INSERT/UPDATE/DELETE/SELECT via public.auth_is_owner()); authenticated
--         users may SELECT (the server reads/deletes via the JWT-as-authenticated
--         workaround — CLAUDE.md / api/admin/_auth.js). Mirrors render_jobs (0083).
--   (DB4) tracking columns on public.planable_pushes: media_path (what was attached,
--         so the cleanup cron knows the storage object to delete) + media_deleted_at
--         (when it was deleted; NULL = not yet deleted) + a partial cleanup-scan index.
--
-- Fully idempotent. Does NOT recreate the planable_pushes table (it lives in 0087) —
-- only ALTERs it; 0087's existing columns/RLS are untouched. No CONCURRENTLY.

-- ─────────────────────────────────────────────────────────────────────────────
-- DB2 — PRIVATE Storage bucket "reel-videos"
-- ~100 MB cap (104857600 bytes); MP4 + QuickTime only.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reel-videos',
  'reel-videos',
  false,                                       -- PRIVATE: server mints signed urls; never world-readable
  104857600,                                   -- ~100 MB
  ARRAY['video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- DB3 — storage.objects RLS scoped to bucket_id='reel-videos'
-- RLS is already enabled on storage.objects by Supabase; we only add policies.
-- Distinct names ("reel-videos ...") so they never collide with other buckets.
-- Owner: full manage. Authenticated: SELECT only (server read/delete path).
-- Mirrors the auth_is_owner() pattern from 0083_render_jobs.sql.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reel-videos owner manage" ON storage.objects;
DROP POLICY IF EXISTS "reel-videos authed read"  ON storage.objects;

CREATE POLICY "reel-videos owner manage"
  ON storage.objects FOR ALL
  USING      (bucket_id = 'reel-videos' AND public.auth_is_owner())
  WITH CHECK (bucket_id = 'reel-videos' AND public.auth_is_owner());

CREATE POLICY "reel-videos authed read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'reel-videos' AND auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- DB4 — tracking columns on public.planable_pushes (ALTER ONLY — table is in 0087)
-- media_path       = storage path that was attached (cleanup knows what to delete)
-- media_deleted_at = when the cron deleted it (NULL = not yet deleted)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.planable_pushes
  ADD COLUMN IF NOT EXISTS media_path       TEXT,
  ADD COLUMN IF NOT EXISTS media_deleted_at TIMESTAMPTZ;

-- Partial index for the cleanup scan: rows that have an attached media still
-- pending deletion. Keeps the cron's scan tiny as the audit table grows.
CREATE INDEX IF NOT EXISTS planable_pushes_cleanup_idx
  ON public.planable_pushes(media_deleted_at)
  WHERE media_path IS NOT NULL AND media_deleted_at IS NULL;
