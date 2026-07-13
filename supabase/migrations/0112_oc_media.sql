-- 0112_oc_media.sql
-- OpenCut 3-editors durability plan, Phase 1 / WS-DB (decision D1) — shared media backend.
-- Content-addressed media for the iframe-embedded OpenCut fork: PRIVATE bucket "oc-media"
-- (objects keyed sha256/<hex-hash>, immutable by construction) + public.oc_media metadata
-- table for cheap pre-upload dedup lookups ("does this hash exist?") without storage
-- list/HEAD calls. Companion to 0095_oc_projects / 0096_oc_locks.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- do NOT run migrate:apply (CLAUDE.md rule 8d). No dependency on other pending files.
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS, ON CONFLICT DO UPDATE for
-- bucket-config convergence, DROP POLICY IF EXISTS before CREATE POLICY). NO
-- 'concurrently'. NO RLS self-reference (0076 recursion class avoided — policies
-- use auth.role() and public.auth_is_owner() [SECURITY DEFINER, live since 0076] only).
--
-- ── IMMUTABILITY NOTE ─────────────────────────────────────────────────────────
-- Objects are content-addressed: same hash == same bytes, so authenticated users
-- get INSERT + SELECT only. No team UPDATE (nothing to update) and no team DELETE
-- (dedup means one object may back many projects — an editor deleting "their"
-- upload would break teammates' timelines). Cleanup/GC = owner-only via
-- auth_is_owner() (a future follow-up; these policies are the pre-provisioned hook).
--
-- ── FORK CONTRACT (K1–K5 of the Phase-1 plan) ─────────────────────────────────
-- * object key      = 'sha256/' || <64-char lowercase hex sha-256> (INSERT policy enforces prefix)
-- * upload          = supabase-js standard upload with upsert:false; HTTP 409
--                     "Duplicate" = SUCCESS (another editor won the race on the same bytes)
-- * ledger write    = .upsert(row, { onConflict: 'hash', ignoreDuplicates: true })
--                     (compiles to ON CONFLICT DO NOTHING — plain insert / merge-upsert
--                     would 4xx under the insert-only RLS below). Object FIRST, row second.
-- * mime            = normalized client-side before upload (empty File.type / odd
--                     containers like application/mp4 → derived from extension);
--                     the bucket's allowed_mime_types rejects empty/odd types.
-- * the fork NEVER deletes from oc-media (RLS refuses anyway).

-- ════════════════════════════════════════════════════════════════════════════
-- DB1 — PRIVATE Storage bucket "oc-media" (hash is the canonical reference;
--       resolution happens at load via authenticated storage.download —
--       URLs are never persisted, keeping the R2/Hetzner backend seam swappable)
-- 2 GiB per-file cap (runtime-ceilinged by the Supabase plan's GLOBAL upload cap —
-- Free 50MB / Pro 500MB-raisable; owner verifies in Dashboard at the deploy gate).
-- ON CONFLICT DO UPDATE so re-runs CONVERGE config (rule 8b: the ledger can lie).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'oc-media',
  'oc-media',
  false,                                        -- PRIVATE: team reads via RLS'd download / short signed url
  2147483648,                                   -- 2 GiB (footage can be hundreds of MB)
  ARRAY['video/*', 'audio/*', 'image/*']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ════════════════════════════════════════════════════════════════════════════
-- DB2 — storage.objects RLS scoped to bucket_id='oc-media'
-- RLS is already enabled on storage.objects by Supabase; we only add policies.
-- Distinct "oc-media ..." names so they never collide with reel-videos (0088).
-- ════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "oc-media authed read"   ON storage.objects;
DROP POLICY IF EXISTS "oc-media authed insert" ON storage.objects;
DROP POLICY IF EXISTS "oc-media owner manage"  ON storage.objects;

CREATE POLICY "oc-media authed read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'oc-media' AND auth.role() = 'authenticated');

CREATE POLICY "oc-media authed insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'oc-media'
    AND auth.role() = 'authenticated'
    AND name LIKE 'sha256/%'                    -- enforce the content-addressed key convention (K1)
  );

CREATE POLICY "oc-media owner manage"           -- future GC/cleanup path only
  ON storage.objects FOR ALL
  USING      (bucket_id = 'oc-media' AND public.auth_is_owner())
  WITH CHECK (bucket_id = 'oc-media' AND public.auth_is_owner());

-- ════════════════════════════════════════════════════════════════════════════
-- DB3 — oc_media: dedup/metadata ledger (hash PK = 64-char lowercase hex sha-256)
-- uploaded_by = JWT sub (auth uuid) as TEXT with NO FK — mirrors oc_locks.locked_by
-- (0096): people.id is a slug; the fork's scoped client only knows the JWT sub.
-- Rows are immutable for the team (INSERT+SELECT only); owner manages for GC/repair.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.oc_media (
  hash             TEXT        PRIMARY KEY,     -- lowercase hex sha-256; object key = 'sha256/'||hash
  size             BIGINT      NOT NULL DEFAULT 0,
  mime             TEXT,                        -- normalized content type (also set as storage contentType)
  original_name    TEXT,                        -- first-seen filename (display only; NOT part of identity)
  uploaded_by      TEXT,                        -- JWT sub (auth uuid) as TEXT; NO FK
  uploaded_by_name TEXT,                        -- display snapshot
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.oc_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oc_media authenticated read"   ON public.oc_media;
DROP POLICY IF EXISTS "oc_media authenticated insert" ON public.oc_media;
DROP POLICY IF EXISTS "oc_media owner manage"         ON public.oc_media;

CREATE POLICY "oc_media authenticated read"
  ON public.oc_media FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "oc_media authenticated insert"          -- rows immutable for the team: no UPDATE/DELETE
  ON public.oc_media FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "oc_media owner manage"                  -- owner GC + repair
  ON public.oc_media FOR ALL
  USING      (public.auth_is_owner())
  WITH CHECK (public.auth_is_owner());

CREATE INDEX IF NOT EXISTS oc_media_created_idx
  ON public.oc_media (created_at DESC);

-- NO realtime publication for oc_media (deliberate): dedup lookups are on-demand
-- point reads; nothing subscribes. Keeps Realtime fan-out load down (a stated
-- scaling concern of the 3-editors plan).
