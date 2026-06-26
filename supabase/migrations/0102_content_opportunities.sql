-- 0102_content_opportunities.sql
-- Content Forge — content_opportunities: ranked content angles + hook versions.
--
-- The second of three Content Forge migrations (0101 transcript_clips,
-- 0102 content_opportunities, 0103 reels.creative_brief). One row per discovered
-- content angle: virality-tiered (S/A/B/C), carrying soft refs to the source
-- transcript_clips / footage, the 3 generated hook_versions (JSONB), the owner's
-- pick, and a status state machine (discovered → hook_generated → attached →
-- sent → archived). The IG-performance columns exist but their write-back is
-- DEFERRED out of v1 (lean core).
--
-- Written by the Hetzner discovery + expansion engine
-- (backend-handoff/content_forge.py: POST /content-forge/discover writes rows,
-- POST /content-forge/expand fills hook_versions). selected_by / created_by /
-- sent_by FK people(id) (TEXT slug) ON DELETE SET NULL; reel_id FK reels(id)
-- (TEXT) ON DELETE SET NULL — none of these block opportunity rows.
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files are intentionally held back — see
-- CLAUDE.md rule 8d).
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER, DROP POLICY IF EXISTS before CREATE POLICY, guarded
-- DO $$ block for realtime). NO 'concurrently'. NO RLS self-reference (the 0076
-- infinite-recursion class is avoided — read / pick-hook are auth.role() only;
-- owner write goes through the public.auth_is_owner() SECURITY DEFINER helper
-- from migration 0076, never a subquery on this table). updated_at is driven by
-- the public.set_updated_at() trigger function from migration 0001.
--
-- ── FULL unique index NOTE (deliberate) ──────────────────────────────────────
-- content_opps_run_country_title_uidx is a genuinely FULL unique index on
-- (discovery_run_id, country, title) — NO partial WHERE predicate — so it CAN
-- serve as a PostgREST/Supabase on_conflict= arbiter for the discovery upsert
-- (the Hetzner content_forge.py writer upserts via PostgREST, exactly like
-- ig_webhook.py / reel_chat.py, and cannot repeat a partial predicate). A PARTIAL
-- unique index can NOT be an ON CONFLICT arbiter: PostgREST's onConflict only
-- takes column names and can't carry the WHERE clause Postgres needs to infer a
-- partial index, so the upsert fails with 42P10 and inserts 0 rows. This is the
-- exact trap monitor_events hit (fixed in 0061 by dropping the WHERE to make the
-- index FULL) and reel_dna hit (ig_webhook.py falls back to plain-insert-catch-409
-- precisely because its index is partial). We take the 0061 resolution here.
-- Run-less rows stay multiply-allowed for free: Postgres treats NULLs as DISTINCT
-- by default in a unique index, so multiple (NULL discovery_run_id, ...) rows are
-- permitted; only run-tagged rows are deduped. (ref:
-- reference_partial-index-onconflict / 42P10).


-- ════════════════════════════════════════════════════════════════════════════
-- content_opportunities: NEW ranked-angles + hook-versions store
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.content_opportunities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT        NOT NULL,
  angle_summary         TEXT,
  country               TEXT        NOT NULL DEFAULT 'global',
  topics                TEXT[]      NOT NULL DEFAULT '{}',
  keywords              TEXT[]      NOT NULL DEFAULT '{}',
  source_clip_ids       UUID[]      NOT NULL DEFAULT '{}',   -- soft refs to transcript_clips.id
  footage_file_ids      TEXT[]      NOT NULL DEFAULT '{}',
  virality_tier         TEXT        NOT NULL DEFAULT 'C' CHECK (virality_tier IN ('S','A','B','C')),
  virality_score        FLOAT       NOT NULL DEFAULT 0.0 CHECK (virality_score >= 0.0 AND virality_score <= 1.0),
  hook_versions         JSONB       NOT NULL DEFAULT '[]',   -- [{version:1, style:"curiosity|controversy|personal_stakes", text:"..."}]
  selected_hook_version INTEGER,                            -- 1|2|3
  selected_by           TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  selected_at           TIMESTAMPTZ,
  drive_file_id         TEXT,                               -- Google Drive permanent file ID (NOT a URL)
  reel_id               TEXT        REFERENCES public.reels(id) ON DELETE SET NULL,
  sent_to_pipeline_at   TIMESTAMPTZ,
  sent_by               TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  fact_check_result     JSONB,                              -- {verified:bool, sources:[...], checked_at:iso}
  ig_post_id            TEXT,
  ig_views              INTEGER,
  ig_likes              INTEGER,
  ig_shares             INTEGER,
  ig_saves              INTEGER,
  ig_reach              INTEGER,
  performance_score     FLOAT,
  performance_updated_at TIMESTAMPTZ,
  status                TEXT        NOT NULL DEFAULT 'discovered'
                        CHECK (status IN ('discovered','hook_generated','attached','sent','archived')),
  discovery_run_id      UUID,
  created_by            TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- indexes — FULL unique upsert arbiter + status / tier / country / reel filters
-- ════════════════════════════════════════════════════════════════════════════

-- FULL unique index (no WHERE predicate) — required so PostgREST on_conflict= can
-- use it as the discovery-upsert arbiter; a partial index would fail with 42P10
-- (ref: reference_partial-index-onconflict, same fix as 0061 monitor_events).
-- NULLs are DISTINCT by default, so run-less (discovery_run_id NULL) rows stay
-- multiply-allowed without a partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS content_opps_run_country_title_uidx
  ON public.content_opportunities (discovery_run_id, country, title);

CREATE INDEX IF NOT EXISTS content_opps_status_idx    ON public.content_opportunities (status);
CREATE INDEX IF NOT EXISTS content_opps_tier_score_idx ON public.content_opportunities (virality_tier, virality_score DESC);
CREATE INDEX IF NOT EXISTS content_opps_country_idx   ON public.content_opportunities (country);
CREATE INDEX IF NOT EXISTS content_opps_reel_idx      ON public.content_opportunities (reel_id) WHERE reel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_opps_perf_idx      ON public.content_opportunities (performance_score DESC) WHERE performance_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_opps_created_idx   ON public.content_opportunities (created_at DESC);


-- ════════════════════════════════════════════════════════════════════════════
-- updated_at trigger — public.set_updated_at() from migration 0001
-- ════════════════════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER (CREATE TRIGGER is NOT idempotent).

DROP TRIGGER IF EXISTS trg_content_opps_updated_at ON public.content_opportunities;

CREATE TRIGGER trg_content_opps_updated_at
  BEFORE UPDATE ON public.content_opportunities
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- RLS: all authenticated read; owner write (via auth_is_owner helper); any
-- authenticated may pick a hook (UPDATE) on non-terminal rows; service all
-- ════════════════════════════════════════════════════════════════════════════
-- DROP POLICY IF EXISTS before each CREATE POLICY (CREATE POLICY is NOT idempotent).

ALTER TABLE public.content_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_content_opps"   ON public.content_opportunities;
DROP POLICY IF EXISTS "owner_write_content_opps" ON public.content_opportunities;
DROP POLICY IF EXISTS "auth_pick_hook"           ON public.content_opportunities;
DROP POLICY IF EXISTS "service_all_content_opps" ON public.content_opportunities;

CREATE POLICY "auth_read_content_opps"   ON public.content_opportunities FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "owner_write_content_opps" ON public.content_opportunities FOR ALL    TO authenticated USING (public.auth_is_owner()) WITH CHECK (public.auth_is_owner());
CREATE POLICY "auth_pick_hook"           ON public.content_opportunities FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated' AND status NOT IN ('sent','archived'))
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "service_all_content_opps" ON public.content_opportunities FOR ALL   TO service_role  USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════════════════════
-- REALTIME: add to supabase_realtime (guarded — mirrors 0095/0096/0097) so the
-- Content Forge discovery list MAY live-update; harmless if it only polls.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.content_opportunities;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
