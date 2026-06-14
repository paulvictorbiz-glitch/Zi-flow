-- 0032_whatsapp_social_connection.sql
-- Appends a WhatsApp row to app_settings.social_connections (the jsonb array the
-- social-status panel reads), only if a "whatsapp" entry isn't already present.
-- WhatsApp uses a static System User token set in the Hetzner env, so there is
-- no OAuth connect flow — the row stays connected:false until the backend
-- /status probe (via syncLiveConnections) flips it.
--
-- Apply manually in the Supabase SQL editor (project kjruhbaahqkuajseoojn).
-- NOT auto-applied — review before running against the shared prod DB.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'social_connections',
  (
    SELECT COALESCE(value, '[]'::jsonb) ||
      '[{"platform":"whatsapp","connected":false,"handle":null,"followers":0,
        "token_kind":"static","expires_at":null,"connected_at":null,
        "status":"disconnected","last_error":null,"last_checked_at":null,
        "note":"Static System User token — set WHATSAPP_TOKEN in Hetzner env vars"}]'::jsonb
    FROM public.app_settings WHERE key = 'social_connections'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(
    (SELECT value FROM public.app_settings WHERE key='social_connections')
  ) el WHERE el->>'platform' = 'whatsapp'
);
