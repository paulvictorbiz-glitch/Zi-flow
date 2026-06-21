-- 0086_perf_samples.sql
-- ⚠️ APPLY IS HUMAN-GATED — do NOT run via `npm run migrate:apply` automatically.
--    The owner applies this against the shared prod Supabase DB.
--
-- Frontend perf telemetry (web-vitals) for the lean-FootageBrain WS4 Monitor card.
-- Each authenticated client POSTs a single sample row per navigation/measurement:
-- page load + Core Web Vitals (LCP / INP / CLS / TTFB) keyed to the logged-in person.
-- The owner's Monitor page reads ALL rows to chart fleet-wide frontend perf.
--
-- RLS mirrors the monitor_events team-read pattern (0069 / 0083): writes are scoped
-- (a user may INSERT only their OWN row), reads are owner-only via the SECURITY DEFINER
-- helper public.auth_is_owner() (no self-referential policy → no recursion).
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS then CREATE POLICY,
-- since the runner has no transaction wrapping and CREATE POLICY is not idempotent.
-- NO `concurrently` anywhere (the runner runs single statements, not a CONCURRENTLY-safe
-- transactionless context for indexes here).

-- ── perf_samples table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.perf_samples (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   TEXT REFERENCES public.people(id) ON DELETE SET NULL,  -- canonical people.id (text slug or UUID)
  path        TEXT,                 -- route/path the sample was captured on
  load_ms     INTEGER,              -- full page load time (ms)
  lcp_ms      INTEGER,              -- Largest Contentful Paint (ms)
  inp_ms      INTEGER,              -- Interaction to Next Paint (ms)
  cls         DOUBLE PRECISION,     -- Cumulative Layout Shift (unitless ratio)
  ttfb_ms     INTEGER,              -- Time To First Byte (ms)
  ua          TEXT,                 -- user-agent string
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner Monitor reads the most recent rows; index the sort key.
CREATE INDEX IF NOT EXISTS perf_samples_created_at_idx
  ON public.perf_samples(created_at DESC);

ALTER TABLE public.perf_samples ENABLE ROW LEVEL SECURITY;

-- ── RLS policies ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth insert own perf_samples" ON public.perf_samples;
DROP POLICY IF EXISTS "owner read perf_samples"       ON public.perf_samples;

-- Authenticated users may INSERT only their OWN sample row. person_id must match the
-- caller's people.id (resolved from auth.uid() via people.user_id). NULL person_id is
-- rejected by the WITH CHECK so every row is attributable.
CREATE POLICY "auth insert own perf_samples"
  ON public.perf_samples FOR INSERT
  TO authenticated
  WITH CHECK (
    person_id IS NOT NULL
    AND person_id = (
      SELECT p.id FROM public.people p WHERE p.user_id = auth.uid() LIMIT 1
    )
  );

-- Owner SELECTs all rows (fleet-wide Monitor chart). Uses the SECURITY DEFINER helper
-- public.auth_is_owner() — never selects perf_samples itself, so no policy recursion.
CREATE POLICY "owner read perf_samples"
  ON public.perf_samples FOR SELECT
  TO authenticated
  USING (public.auth_is_owner());
