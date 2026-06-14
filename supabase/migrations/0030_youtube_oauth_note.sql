-- 0030_youtube_oauth_note.sql
-- Refreshes the youtube row in app_settings.social_connections to reflect the
-- new Google OAuth 2.0 integration (metadata + analytics + reporting + captions).
-- Cosmetic only: the Hetzner backend overwrites connected/handle/expires_at/status
-- on connect. Token material still NEVER lives here — tokens stay on the backend.
--
-- Rebuilt wholesale (jsonb) to keep every row's shape consistent with 0028.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'social_connections',
  '[
    {"platform":"facebook",  "connected":true,  "handle":"@samuelpaulvictor","followers":8420,"token_kind":"page","expires_at":null,"connected_at":"2025-01-01T00:00:00Z","status":"connected","last_error":null,"last_checked_at":null,"note":"Live — Page token via api.footagebrain.com"},
    {"platform":"instagram", "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"status":"disconnected","last_error":null,"last_checked_at":null,"note":"Connect via Facebook Business Login (same FB app, instagram_basic scope)"},
    {"platform":"youtube",   "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"status":"disconnected","last_error":null,"last_checked_at":null,"note":"Connect via Google OAuth 2.0 — youtube.readonly + yt-analytics.readonly + yt-analytics-monetary.readonly + youtube.force-ssl (Testing mode: token refresh expires every 7 days)"},
    {"platform":"tiktok",    "connected":false, "handle":null,"followers":0,"token_kind":null,"expires_at":null,"connected_at":null,"status":"disconnected","last_error":null,"last_checked_at":null,"note":"Connect via TikTok Login Kit (requires app approval)"}
  ]'::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = now();
