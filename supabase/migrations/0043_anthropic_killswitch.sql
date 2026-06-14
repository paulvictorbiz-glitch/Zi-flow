-- =========================================================
--  Step 43 — Anthropic (Claude) API kill switch
--
--  A single app_settings flag the owner can flip from the
--  Monitor page to pause all Claude usage. When disabled, the
--  server-side endpoints that call Anthropic (generate.js with
--  provider=anthropic, ai/ask.js synthesis, ai/suggest.js) bail
--  out early with a 503 instead of spending tokens.
--
--  Stored shape:  { "enabled": true }
--  RLS: inherited from app_settings (auth read, owner write).
-- =========================================================

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('anthropic_enabled', '{"enabled": true}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
