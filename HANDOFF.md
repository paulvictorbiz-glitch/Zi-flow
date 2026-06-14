# Handoff — last updated 2026-06-14 (Claude kill switch)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
Added an **Anthropic (Claude) card to the Monitor page with a working kill switch.** It mirrors the Vercel card (links to `platform.claude.com/dashboard`, since Anthropic exposes no usage API) and has a **sliding toggle that genuinely pauses all server-side Claude usage** by flipping `app_settings.anthropic_enabled`. Deployed to prod.

## What's LIVE (this session)
- **Monitor → "Anthropic (Claude)" card** with dashboard link + sliding kill switch (green = active, grey = paused), owner-only via RLS.
- **Server gate enforced** on the 3 real Claude consumers: `api/generate.js` (anthropic provider only), `api/ai/ask.js` (synthesis → graceful FAQ fallback), `api/ai/suggest.js` (suggestions cron). All read `isAnthropicEnabled()` in `api/admin/_auth.js`, which **fails open** so a DB blip never breaks AI.
- Migration `0043_anthropic_killswitch.sql` seeds the flag (optional — upsert creates it on first toggle).

## Still LIVE from prior sessions
- **Rocket.Chat 7.13.8 + MongoDB** on Hetzner; `https://chat.footagebrain.com`; backend proxy authenticated; Team tab + Inbox Outbox deployed.
- IG per-reel analytics, social OAuth, Infra Monitor, etc. (see CHANGELOG).

## Gotchas discovered / reaffirmed this session
- **Vercel Hobby plan caps at 12 Serverless Functions.** A 13th fails the deploy. A first attempt at a dedicated `api/admin/toggle-anthropic.js` endpoint hit this — deleted it and had the UI write the flag **directly to `app_settings` via Supabase** (RLS "owner write" policy from migration 0014 enforces owner-only). **Prefer RLS-gated direct writes over new `api/*` routes for owner mutations.**
- `api/ai/_embed.js` imports Anthropic but actually calls **OpenRouter** embeddings — not a real Claude consumer, left ungated.
- `api/ai/suggest.js` now also serves `?action=insights` (folded in to stay under the function cap); that pass uses a free OpenRouter model and is intentionally NOT behind the kill switch.

## Remaining (optional, from prior sessions)
1. Run migration `0043` in the Supabase SQL editor (cleanliness; not blocking).
2. Rocket.Chat: create team accounts (Judy/Jay/Leroy), enable WhatsApp omnichannel.
3. See `TODO.md` for the longer backlog (Jarvis overlay, inbox AI replies, create-user blocker, etc.).

## DNS state (don't let Porkbun reset it)
- apex `footagebrain.com` → `A 76.76.21.21` (Vercel); `www` → `CNAME cname.vercel-dns.com`.
- `api`, `chat` → `A 178.105.14.144` (Hetzner) — leave alone. The `*` wildcard CNAME was deleted (it served the parking page).

## Files changed this session (all in-repo, deployed)
`api/admin/_auth.js`, `api/generate.js`, `api/ai/ask.js`, `api/ai/suggest.js`, `src/pages/monitor.jsx`, `src/pages/monitor.css`, + new `supabase/migrations/0043_anthropic_killswitch.sql`.
