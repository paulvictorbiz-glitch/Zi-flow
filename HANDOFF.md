# Handoff — last updated 2026-06-27 (session ae)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Continued **MapForge** (standalone repo `C:\Users\Mi\Downloads\mapforge`). Committed the parked **premium design tier** (`298e39d`).
- Built the next slice — the **MapForge owner dashboard**: new `apps/dashboard/` workspace (TS, Node-ESM, no framework), pure tested aggregate/render, a DataSource seam (offline fixture default / env-gated live Supabase PostgREST reader). Committed `1d2509c`.
- Owner asked to deploy the dashboard + preview gallery and add a Monitor button. Since the pages were localhost-only and MapForge has no live host, built them as **static files hosted inside FootageBrain at `/mapforge/`** via new `scripts/build-static.mjs`.
- Added an owner-only **"MapForge" sub-tab** to the Monitor hub (opens both pages in new tabs) and **deployed LIVE** (`vercel --prod`, `dpl_FdDnCz5…`, www.footagebrain.com). All pages verified 200.
- Committed FootageBrain side (`dec6b4e` bundle, `ac20744` monitor-hub), pushed `feat/capcut-replica-v2` to origin, closed the local dev servers.

## Where we left off
MapForge dashboard + premium tier are LIVE-accessible from footagebrain.com → **Monitor → MapForge** → opens `/mapforge/dashboard.html` (funnel + per-target status) and `/mapforge/index.html` (preview gallery, Standard vs Premium). The deployed dashboard is a **static snapshot** of the synthetic demo fixture; the **live-Supabase reader** in `apps/dashboard` activates only once `0001_init.sql` is applied (human-gated). MapForge repo is local-only (no git remote): HEAD `1d2509c` on `main`. FootageBrain branch `feat/capcut-replica-v2` @ `ac20744`, pushed.

## Open blockers
- **Live `--ai` still unverified** (unchanged from session ad) — Gemini free tier `limit:0` (billing-tainted account; $300 credit excluded from Gemini API) + OpenRouter free tokens exhausted. No code fault. See `reference_gemini-free-tier-billing-taint.md`.

## Pending (written but not yet live)
- MapForge **owner dashboard live-Supabase mode** — built + tested, but only serves real data once `0001_init.sql` is applied to a live DB (human-gated) and `MAPFORGE_SUPABASE_URL` + `MAPFORGE_SUPABASE_SERVICE_KEY` are set. The deployed `/mapforge/` pages are a static demo snapshot until then.
- All prior MapForge pending items unchanged (see `project_mapforge-plan.md`): live gosom scrape + R2/DNS go-live, A/B traffic-split+tracking (Worker+DB).
- FootageBrain tree still has the owner's other uncommitted WIP (app.jsx, content-forge.jsx, scout.jsx, etc.) — untouched this session, owner manages.

## Next session — start here
1. **Verify live `--ai`** the moment an LLM path frees (clean-account Gemini key via the 3 `MAPFORGE_AI_*` env vars, OR OpenRouter replenish) — run `--ai` on the SLC fixture, confirm `copy: ai` + no fallback.
2. **Wire the dashboard to live data** if/when ready: apply `0001_init.sql` (human-gated), set `MAPFORGE_SUPABASE_*`, run `npm run dashboard` locally to confirm the Supabase reader, then optionally re-deploy a live-backed dashboard.
3. **Next LLM-independent slice** otherwise: Astro/AstroWind richer generator, OR A/B traffic-split + conversion tracking (Worker + DB).

## Verification commands (to confirm current state on resume)
```bash
# Live MapForge pages (expect 200):
curl -s -o /dev/null -w "%{http_code}\n" https://www.footagebrain.com/mapforge/dashboard.html
curl -s -o /dev/null -w "%{http_code}\n" https://www.footagebrain.com/mapforge/index.html

# MapForge repo state (no remote; expect 1d2509c HEAD):
cd 'C:/Users/Mi/Downloads/mapforge' && git log --oneline -3 && npm run build && npm test   # 56 tests (15 dashboard + 31 orch + 10 worker)

# Regenerate + redeploy the static bundle after data/template changes:
node scripts/build-static.mjs --out "C:/Users/Mi/Downloads/ziflow project-final/public/mapforge"
```
