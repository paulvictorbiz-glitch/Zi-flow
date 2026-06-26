# Handoff — last updated 2026-06-26 (session x)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Content Forge is LIVE end-to-end.** Verified migrations 0101–0103 on the live DB, set `CONTENT_FORGE_SECRET` on Vercel, deployed `content_forge.py` to Hetzner (router registered + secret + image rebuild + recreate), redeployed Vercel. Health: 401 gated / 200 with secret. Runs on the **free OpenRouter/Gemini tier** by default.
- **UI batch shipped (LIVE, `f0011ee`, dpl_GFyiddry):** Pulse/Scout "date pulled" tracking (toggle + sortable Pulled column + group-by-pulled) and Reel DNA Classic-spreadsheet **clickable column sort** (A→Z/Z→A) + always-visible card kebab.
- **RC reel-state Phase 2 committed (`2ee56a7`, NOT deployed):** Rocket.Chat `/reel-state` slash command + message-action under `backend-handoff/reel-rc-app/` — separate RC app deploy.
- **Deploys this session:** `vercel --prod` ×2 (dpl_GFyiddry, dpl_ikznc3gp); Hetzner backend image rebuild + `up -d --force-recreate`; Vercel env `CONTENT_FORGE_SECRET`.
- **Branch:** `feat/capcut-replica-v2` @ `2ee56a7` (pushed). Tree clean.
- **Learned:** the auto-mode classifier needs the **specific action/host NAMED** ("authorization to apply migrations", "SSH into root@178.105.14.144 …") — general "deploy everything"/"continue" is rejected for live-DB + Hetzner.

## Where we left off
Content Forge is functional on prod (owner-only tab). All code committed + pushed; tree clean. The only unverified piece is the **authenticated owner UI flow** (Discover → Expand) — needs the owner to click through it.

## Open blockers
- None. (Pre-deploy gates were all cleared with explicit per-action authorization.)

## Pending (written but not yet live / follow-up)
- **Content Forge UI smoke test** — owner opens the tab, runs Discover → Expand (free tier) to confirm end-to-end.
- **Content Forge pro tier (optional)** — add `ANTHROPIC_API_KEY` (+ `TAVILY_API_KEY` for grounding) to the Hetzner backend env block + rebuild → discovery uses Haiku, expansion uses Sonnet. Currently `anthropic_set:false` (free Gemini).
- **Box hygiene** — delete `.forgebak` backups on Hetzner once stable; fold the `backend/app/api/__init__.py` router-registration into the `footagebrain-backend` repo so a fresh snapshot doesn't drop it.
- **RC reel-state app** — `2ee56a7` committed but needs a separate Rocket.Chat deploy.
- **Triage tasks 1–3 (deferred, now unblocked):** (1) manually add a URL news link to a card; (2) raise the ~10-clip cap + add a slow-flashing neon asset-count badge on cards (like the analytics world-map dots) + auto-collapse asset cards; (3) fix no-audio on local MP4 upload for the finished reel state (HEVC→H.264/AAC transcode on Hetzner). All live in `detail.jsx`/`components.jsx` (now committed, so editable) — task 3 also needs a Hetzner backend change.
- **Carried from prior sessions:** OD-2 Reviewer re-save, 0099 RLS delete-hardening (unwritten), Scout backend redeploy, OpenCut caddy-bridge persist, Epidemic calibration, migration 0100 (CapCut install events) committed-not-applied.

## Next session — start here
1. **Owner: smoke-test Content Forge** (Discover → Expand). If anything errors, check `docker logs fb-backend` + the Vercel function logs.
2. **Tackle triage tasks 1–3** in `detail.jsx`/`components.jsx` (now collision-free) — start with the flashing asset-count badge (reuse `.an-pulse-dot`/`pulseGlow` from the analytics map).
3. Optional: wire Content Forge pro tier (Anthropic key) if free-tier quality is insufficient.

## Verification commands (to confirm current state on resume)
```bash
# Git: clean tree on feat/capcut-replica-v2 @ 2ee56a7
git -C "c:/Users/Mi/Downloads/ziflow project-final" log --oneline -4
# → 2ee56a7 (reel-state), f0011ee (ui), b592d23 (content-forge), 051279f

# Content Forge backend live + gated (expect 401)
curl -s -o /dev/null -w "%{http_code}\n" "https://api.footagebrain.com/api/content-forge/health"
# With the secret → JSON {"ok":true,"secret_set":true,"supabase_configured":true,"openrouter_set":true,...}
curl -s "https://api.footagebrain.com/api/content-forge/health?secret=841342afbe2f531dbfd82f3c67e7f720f29549a5198c8273a60b95d52943d225"

# Live site (expect 200)
curl -s -o /dev/null -w "%{http_code}\n" "https://www.footagebrain.com"
```
