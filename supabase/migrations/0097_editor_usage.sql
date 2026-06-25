-- 0097_editor_usage.sql
-- Editor usage tracking + HISTORY — append-only session log for the embedded
-- OpenCut editor (and the native editor fallback).
--
-- The live "who is editing right now" signal already exists (editor_locks 0082
-- for the native editor, oc_locks 0096 for the iframe-embedded fork) but those
-- rows are EPHEMERAL (deleted/expired on release) so they carry NO history. This
-- table is the durable log: one row per time a teammate OPENS a project in the
-- editor, heartbeated while open and stamped ended_at on close, so the owner's
-- Monitor tab can show per-person / per-project usage OVER TIME.
--
-- Written entirely FB-side by the iframe parent (src/lib/editor-usage.js, wired
-- in src/pages/editor.jsx) — the fork is NOT touched. Read by the owner-only
-- "Editor usage" card on the Monitor hub (src/pages/monitor-hub.jsx).
--
-- apply is HUMAN-GATED — scoped one-off (exec_sql + schema_migrations upsert),
-- NOT migrate:apply (other pending files are intentionally held back — see
-- CLAUDE.md rule 8d).
--
-- Fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS
-- before CREATE POLICY, guarded DO $$ block for realtime). NO 'concurrently'.
-- NO RLS self-reference (the 0076 infinite-recursion class is avoided — the
-- USING/WITH CHECK is auth.role() only, never a subquery on this table).
--
-- ── NO-FK NOTE on project_id (deliberate, mirrors oc_locks 0096) ──────────────
-- project_id is uuid but carries NO foreign key: it may point at EITHER an
-- oc_projects row (embed) OR an edit_projects row (native), and a brand-new
-- OpenCut project has no row until its first save. An FK to one table would
-- block logging for the other / for unsaved projects. person_id DOES FK
-- people(id) (TEXT slug, e.g. "paul") ON DELETE SET NULL so removing a person
-- never deletes their usage history.


-- ════════════════════════════════════════════════════════════════════════════
-- editor_usage_sessions: NEW append-only usage log
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.editor_usage_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID,                                          -- oc_projects OR edit_projects id; NO FK (may be unsaved)
  reel_id        TEXT,                                          -- optional bound reel (reels.id is TEXT); NO FK
  person_id      TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  person_name    TEXT,                                          -- display label snapshot
  preset         TEXT,                                          -- 'capcut' | 'classic'
  source         TEXT        NOT NULL DEFAULT 'embed',          -- 'embed' (iframe fork) | 'native'
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),            -- heartbeated ~every 60s while the editor is open
  ended_at       TIMESTAMPTZ                                    -- stamped on unmount / tab-close (best-effort)
);


-- ════════════════════════════════════════════════════════════════════════════
-- RLS: enable + single "authenticated manage" policy (mirrors editor_locks/oc_locks)
-- ════════════════════════════════════════════════════════════════════════════
-- auth.role() only — NO subquery on editor_usage_sessions (recursion class avoided).
-- All authenticated team members INSERT/UPDATE their own session rows; the owner
-- (also 'authenticated') SELECTs every row for the Monitor card. One FOR ALL
-- policy is sufficient (grants SELECT/INSERT/UPDATE/DELETE).

ALTER TABLE public.editor_usage_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editor_usage authenticated manage" ON public.editor_usage_sessions;

CREATE POLICY "editor_usage authenticated manage"
  ON public.editor_usage_sessions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- ════════════════════════════════════════════════════════════════════════════
-- indexes — history queries (by time, by person) + live "still open" sweep
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS editor_usage_started_idx
  ON public.editor_usage_sessions (started_at DESC);

CREATE INDEX IF NOT EXISTS editor_usage_person_idx
  ON public.editor_usage_sessions (person_id);

-- Partial index for the "currently open" lookup (ended_at IS NULL). Partial is
-- fine here — this is NOT an upsert arbiter (see reference_partial-index-onconflict).
CREATE INDEX IF NOT EXISTS editor_usage_open_idx
  ON public.editor_usage_sessions (last_active_at DESC)
  WHERE ended_at IS NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- REALTIME: add to supabase_realtime (guarded — mirrors 0095/0096) so the
-- Monitor card MAY live-update; harmless if the card only polls.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.editor_usage_sessions;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
