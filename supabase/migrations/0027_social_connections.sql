-- 0027_social_connections.sql
-- Seeds social platform connection metadata into app_settings so
-- social-client.js reads live connection state from Supabase instead
-- of a hardcoded object. Token material NEVER goes here — it stays on
-- the Hetzner backend. This row stores: connected bool, handle,
-- follower count, token_kind, and timestamps only.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'social_connections',
  '[
    {"platform":"facebook",  "connected":true,  "handle":"@samuelpaulvictor","followers":8420,"token_kind":"page","expires_at":null,"connected_at":"2025-01-01T00:00:00Z","note":"Live — Page token via api.footagebrain.com"},
    {"platform":"instagram", "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"note":"Connect via Facebook Business Login (same FB app, instagram_basic scope)"},
    {"platform":"youtube",   "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"note":"Connect via Google OAuth 2.0 (YouTube Data API v3)"},
    {"platform":"tiktok",    "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"note":"Connect via TikTok Login Kit (requires app approval)"}
  ]'::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = now();
