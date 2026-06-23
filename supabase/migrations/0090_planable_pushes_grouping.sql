-- 0090_planable_pushes_grouping.sql
-- apply is HUMAN-GATED (npm run migrate:apply / Supabase SQL editor)
-- depends on 0087_planable_pushes (table) and 0088_planable_media (media cols)
--
-- ADDITIVE-ONLY extension of public.planable_pushes for the new "Push to Planable"
-- grouping model. A single push now creates ONE Planable campaign that bundles
-- multiple reels; each reel becomes its OWN grouped cross-page post (its own
-- groupId) fanned across the selected channels (pageIds). The recording grain
-- moves from one row per (reel, platform) to one row per (reel, batch).
--
-- This migration ONLY adds nullable columns + two indexes. It does NOT drop,
-- rename, or retype any existing column. 0087's columns
--   (id, reel_id, platform, planable_post_id, scheduled, with_media,
--    pushed_by, created_at)
-- and 0088's columns (media_path, media_deleted_at) all survive UNTOUCHED.
--
-- RLS is INHERITED from 0087: that migration already ENABLEd row level security
-- and created the "owner manage planable_pushes" (auth_is_owner()) +
-- "authenticated view planable_pushes" policies. Adding columns inherits those
-- policies, so this file deliberately does NOT re-enable RLS or DROP/CREATE any
-- policy (re-creating would be needless and error-prone).
--
-- Fully idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
-- No CONCURRENTLY. No unique constraint (re-push / force must stay allowed;
-- dedupe remains an app-code concern, per 0087).

-- ─────────────────────────────────────────────────────────────────────────────
-- DB1 — new nullable grouping columns (ALTER ONLY — table lives in 0087)
--   campaign_id  = Planable campaign id bundling this push's reels (NULL if the
--                  /campaigns create failed → posts still group per-reel via group_id)
--   group_id     = Planable groupId of this reel's fanned cross-page post
--   page_ids     = allow-listed Planable pageIds this post fanned across
--   batch_id     = server-minted UUID per push; the new idempotency axis
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.planable_pushes
  ADD COLUMN IF NOT EXISTS campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS group_id    TEXT,
  ADD COLUMN IF NOT EXISTS page_ids    TEXT[],
  ADD COLUMN IF NOT EXISTS batch_id    UUID;

-- ─────────────────────────────────────────────────────────────────────────────
-- DB2 — indexes for the new recording grain. Keep 0087's planable_pushes_reel_idx
-- (NOT dropped here). No unique constraint anywhere — re-push/force stays allowed.
--   batch_idx    = dedupe within a push by (reel_id, batch_id)
--   campaign_idx = look up all rows for a campaign
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS planable_pushes_batch_idx
  ON public.planable_pushes (reel_id, batch_id);

CREATE INDEX IF NOT EXISTS planable_pushes_campaign_idx
  ON public.planable_pushes (campaign_id);
