# Handoff — last updated 2026-06-20

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Built a NEW standalone product — "MicroSaaS Scout"** — in its own repo `C:/Users/Mi/Downloads/microsaas-scout` (NOT part of FootageBrain). Python(FastAPI) scrapers + React(Vite) UI + its own new Supabase project. Scrapes Product Hunt + Hacker News + GitHub → AI "opportunity dossier" per product → browse/filter/shortlist + pipeline kanban.
- **Built via a generated workflow file** `.claude/workflows/microsaas-scout-build.js` (4 disjoint-ownership teams, Opus leads/QA). Ran autonomously end-to-end; schema auto-applied to the new Supabase via the **Management-API PAT**, then live Phase-1 ingest.
- **Data is LIVE:** 97 products (HN 40, GitHub 37, PH 20) + 97 dossiers (1:1), DB 11 MB. Phase 2/3 sources coded but `enabled=false`. Anthropic deep-dive seam coded but disabled.
- **Fixed 3 dedup bugs + dossier dedup** in the Scout repo (PH recovered 1→20, GitHub 16→37, total 38→97, dossiers de-duped to 1 per product via migration `0003`). Root cause: domain-dedup collapsed distinct products onto the aggregator domain (producthunt.com / github.com).
- **Committed the Scout repo** — initial commit `c473b45` (62 files; secrets git-ignored, real `.env` confirmed untracked). No remote; not pushed.
- **Hardened the full-tree-deploy rule** (CLAUDE.md Rule #1 + memory) into a mandatory pre-deploy tree-conflict gate, and **cleaned 2 stray Scout artifacts** from the FootageBrain folder.

## Where we left off
MicroSaaS Scout MVP is **functionally complete, live with real data, and now committed** as a standalone repo. It is NOT integrated into FootageBrain and nothing is deployed to Hetzner/Vercel for it. FootageBrain itself is unchanged this session except documentation + the hardened deploy rule; the owner's **Monitor WIP** (`src/pages/monitor.jsx`/`monitor.css` + `api/monitor/*`) sits uncommitted in the FB tree, untouched.

## Open blockers
- None.

## Pending (written but not yet live / not committed)
- **FootageBrain tree is dirty by design** — this session's doc edits (`CHANGELOG.md`, `HANDOFF.md`, `change-log.md`, `CLAUDE.md`) + the owner's Monitor WIP (`monitor.jsx`/`monitor.css`/`api/monitor/*`) + known prior threads (`backend-handoff/*`, grid trio, `scripts/ig-sync-diagnose.mjs`) are all uncommitted. ⚠️ Do NOT `vercel --prod` FootageBrain until the Monitor WIP is finished or stashed — a full-tree deploy would ship it.
- **Scout repo:** committed locally (`c473b45`) but has **no git remote** — push to a remote (e.g. a private GitHub repo) if off-machine backup is wanted.
- **FootageBrain: `feat/reel-dna-phase1` already merged to main** (commits `8b5eeb4`/`c8d3417` present) but origin not pushed — owner-gated.

## Next session — start here
1. **Make the plan to incorporate MicroSaaS Scout into FootageBrain** (the explicit goal): an owner-gated **"Scout" view** + a **button next to Pulse** in `src/pages/monitor-hub.jsx`, reading the Scout Supabase via a **2nd supabase-js client**; **daily auto-refresh** via a Hetzner cron hitting the Scout backend `POST /scrape-all`; deploy the Scout Python backend to Hetzner behind a Caddy route (human-gated). Likely another `/workflow-file-creation` run. See memory `[[project_microsaas-scout]]`.
2. **(Optional) Give the Scout repo a remote** + push for backup. **Rotate the Scout secrets** (owner flagged).
3. **(Owner-gated) Finish or stash the Monitor WIP** before any FootageBrain deploy.

## Verification commands (to confirm current state on resume)
```bash
# Scout data is live (from microsaas-scout/backend; uses the Management-API PAT in .env):
cd /c/Users/Mi/Downloads/microsaas-scout/backend
REF=$(grep '^SUPABASE_URL=' .env | sed -E 's#.*//([a-z0-9]+)\.supabase\.co.*#\1#'); TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2)
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data '{"query":"select source,count(*) from products group by source;"}'
git -C /c/Users/Mi/Downloads/microsaas-scout log --oneline   # -> c473b45 Initial commit
# Scout runs locally (no Docker):  .venv/Scripts/python -m app.cli serve  then  curl localhost:8787/health
# Re-ingest:  .venv/Scripts/python -m app.cli scrape-all --limit 50
```
