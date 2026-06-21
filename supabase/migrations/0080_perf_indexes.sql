-- 0080_perf_indexes.sql — pure-additive performance indexes for the store boot path.
--
-- WHY: At ~15 concurrent users the store's boot does ORDERED (and in some cases
-- windowed) SELECTs on tables that grow without bound. Each CREATE INDEX below
-- maps 1:1 to a store boot query so Postgres can do an index scan instead of a
-- full seq-scan + in-memory sort once the big growers pass a few thousand rows.
--
-- Index → store-boot-query map:
--   · reel_dna             — boot: .is("deleted_at", null).order("created_at" DESC)
--                            → PARTIAL index on (created_at DESC) WHERE deleted_at IS NULL
--   · thumbnail_dna        — boot: .is("deleted_at", null).order("created_at" DESC)
--                            → PARTIAL index on (created_at DESC) WHERE deleted_at IS NULL
--   · reel_dna_assets      — boot: .order("created_at" DESC)
--                            → index on (created_at DESC)
--   · monitor_event_links  — boot: .order("created_at" DESC)
--                            → index on (created_at DESC)
--   · attached_footage_items — boot: ordered/windowed on created_at
--                            → index on (created_at DESC)
--   · monitor_events       — boot: .gte(created_at, now-90d).limit(500).order(created_at DESC)
--                            → ALREADY EXISTS as monitor_events_created_idx from
--                              0059_monitor_events.sql. Intentionally NOT re-created here.
--
-- SAFETY / CONSTRAINTS (per project rules):
--   · PURE-ADDITIVE: only CREATE INDEX. NO data mutation, NO schema/column
--     changes, NO RLS/policy changes, NO trigger/publication changes.
--   · IDEMPOTENT + re-runnable: every statement is CREATE INDEX IF NOT EXISTS.
--   · NO CONCURRENTLY: `npm run migrate:apply` runs each file inside a
--     transaction, and CREATE INDEX CONCURRENTLY cannot run in a transaction.
--     These are plain (table-locking) builds — fine at current table sizes. If a
--     table ever grows large enough that the brief write-lock matters, build that
--     one index CONCURRENTLY by hand OUTSIDE this runner; the IF NOT EXISTS guard
--     then makes a re-run a no-op.
--
-- APPLY IS HUMAN-GATED: this writes to the shared prod Supabase DB. Apply via
-- `npm run migrate:apply` or by pasting into the Supabase SQL editor — never
-- automatically. The owner regenerates the manifest; this file does not touch it.
--
-- PARTIAL-vs-bare note: where the boot query filters `deleted_at IS NULL`, the
-- index is PARTIAL (WHERE deleted_at IS NULL) so soft-deleted rows are excluded
-- from the index and live rows come back already in display order. Where the
-- boot query applies no soft-delete filter, a bare (created_at DESC) index is
-- the correct shape.

-- ── reel_dna ──────────────────────────────────────────────────────────────────
-- Boot: .is("deleted_at", null).order("created_at" DESC)
CREATE INDEX IF NOT EXISTS reel_dna_live_created_idx
  ON public.reel_dna (created_at DESC)
  WHERE deleted_at IS NULL;

-- ── thumbnail_dna ─────────────────────────────────────────────────────────────
-- Boot: .is("deleted_at", null).order("created_at" DESC)
CREATE INDEX IF NOT EXISTS thumbnail_dna_live_created_idx
  ON public.thumbnail_dna (created_at DESC)
  WHERE deleted_at IS NULL;

-- ── reel_dna_assets ───────────────────────────────────────────────────────────
-- Boot: .order("created_at" DESC)  (no soft-delete filter → bare index)
CREATE INDEX IF NOT EXISTS reel_dna_assets_created_idx
  ON public.reel_dna_assets (created_at DESC);

-- ── monitor_event_links ───────────────────────────────────────────────────────
-- Boot: .order("created_at" DESC)  (no soft-delete filter → bare index)
CREATE INDEX IF NOT EXISTS monitor_event_links_created_idx
  ON public.monitor_event_links (created_at DESC);

-- ── attached_footage_items ────────────────────────────────────────────────────
-- Boot: ordered/windowed on created_at  (no soft-delete filter → bare index)
CREATE INDEX IF NOT EXISTS attached_footage_created_idx
  ON public.attached_footage_items (created_at DESC);

-- ── monitor_events ────────────────────────────────────────────────────────────
-- Boot: .gte(created_at, now-90d).limit(500).order(created_at DESC)
-- ALREADY EXISTS as monitor_events_created_idx (created_at DESC) from
-- 0059_monitor_events.sql — intentionally NOT re-created here. The bare
-- (created_at DESC) index is the correct shape: monitor_events has no deleted_at
-- column, and one (created_at DESC) index serves both the range scan
-- (created_at >= now-90d) and the ORDER BY created_at DESC LIMIT 500.
