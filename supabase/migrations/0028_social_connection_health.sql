-- 0028_social_connection_health.sql
-- Adds health/error fields to each row of app_settings.social_connections so the
-- new "Social accounts" panel in Roles & permissions can show connection status,
-- the last error returned by the platform, and when it was last checked.
--
-- Per-row fields (additive to the shape seeded in 0027):
--   status         text   -- connected | error | expiring | disconnected
--   last_error     text   -- user-facing error from the most recent health check
--   last_checked_at text  -- ISO timestamp of the last health check
--
-- Token material still NEVER lives here — tokens stay on the Hetzner backend.
-- This row holds connection metadata + health only.
--
-- We rebuild the value wholesale (jsonb) so the new fields exist on every row.
-- `status` is seeded from the existing `connected` bool; the live health check
-- in social-client.js overwrites it (and last_error / last_checked_at) at runtime.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'social_connections',
  '[
    {"platform":"facebook",  "connected":true,  "handle":"@samuelpaulvictor","followers":8420,"token_kind":"page","expires_at":null,"connected_at":"2025-01-01T00:00:00Z","status":"connected","last_error":null,"last_checked_at":null,"note":"Live — Page token via api.footagebrain.com"},
    {"platform":"instagram", "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"status":"disconnected","last_error":null,"last_checked_at":null,"note":"Connect via Facebook Business Login (same FB app, instagram_basic scope)"},
    {"platform":"youtube",   "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"status":"disconnected","last_error":null,"last_checked_at":null,"note":"Connect via Google OAuth 2.0 (YouTube Data API v3)"},
    {"platform":"tiktok",    "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"status":"disconnected","last_error":null,"last_checked_at":null,"note":"Connect via TikTok Login Kit (requires app approval)"}
  ]'::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = now();
