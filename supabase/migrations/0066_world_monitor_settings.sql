-- =========================================================
--  Step 66 — World Monitor settings + usage seeds (app_settings)
--
--  Two app_settings keys for the hybrid World Monitor feature:
--
--   · world_monitor       — feature flags (the owner edits these from the
--                           Monitor page). FLAT shape, FROZEN by the integration
--                           plan because the sole reader (Monitor card, Team D)
--                           and the code paths must agree on exact key paths.
--                           free.* gate which free feeds the ingester runs.
--                           paid.* are OFF and have NO code path (enable later).
--                           Team D is the ONLY writer of this key.
--
--   · world_monitor_usage — ingest usage/limits telemetry. FLAT shape. Team B
--                           (the ingester) is the ONLY writer; Team D (Monitor
--                           card) is the ONLY reader. Seeded null/zero here.
--
--  SECRETS (FIRMS_MAP_KEY / ACLED_KEY / ACLED_EMAIL / SUGGEST_CRON_SECRET) live in
--  ENV ONLY (Vercel + .env.local) — NEVER in app_settings.
--
--  RLS: inherited from app_settings 0014 (auth read, owner write).
--  ON CONFLICT (key) DO NOTHING so re-running never clobbers owner edits.
-- =========================================================

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'world_monitor',
  '{
     "embed_enabled": true,
     "free": { "usgs": true, "firms": true, "acled": true },
     "paid": { "finnhub": false, "fred": false, "imf": false, "nasdaq": false, "flights": false }
   }'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'world_monitor_usage',
  '{
     "last_ingest_at": null,
     "firms_daily_used": 0,
     "firms_daily_limit": 1000,
     "acled_used": 0,
     "acled_limit": 0,
     "usgs_count": 0,
     "embed_ok": true
   }'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;
