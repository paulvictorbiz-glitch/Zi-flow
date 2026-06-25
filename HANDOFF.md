# Handoff — last updated 2026-06-25 (session s)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Planning-only session for a NEW, separate project — "MapForge".** No FootageBrain code, migrations, deploys, or config changed. The FootageBrain app remains exactly at the session-r state (graph view live, 99 migs applied).
- **MapForge** = an owner-triggered engine: pick a city → scrape Google Maps businesses → auto-build websites for the no/bad-site ones → host live on branded subdomains → digital-first outreach (preview link + optional QR card) → track interest → convert to paid monthly maintenance; dead leads cold-rotate after 30 days.
- **4 decisions locked:** digital-first outreach · category templates + AI fill · human approval gates · public previews with their branding (default mitigation: noindex + watermark + takedown).
- **Deliverables:** plan file `C:\Users\Mi\.claude\plans\this-is-a-pure-frolicking-ripple.md`; new Obsidian area `obsidian-vault/MapForge/` (10 linked nodes, linked from the FootageBrain MOC); memory `project_mapforge-plan.md`.
- **Key conclusions:** the tech is cheap/high-confidence; the real risks are email deliverability + conversion. Multi-tenant Worker+R2 hosting (no project cap) makes storage trivial. Lean (OSS scraper, no/Haiku AI) cuts variable cost to ~$0.03–0.06/site but the **fixed email infra dominates** the all-in. Batch all-in: 100 ≈ $80–150, 500 ≈ $250–400, 1000 ≈ $400–600.

## Where we left off
MapForge is fully blueprinted (plan + vault + memory) but **has no repo and no code**. FootageBrain itself is untouched this session and stays at session-r: Pipeline ◉ Graph live, all migrations applied (99 · 0 pending), full-tree deploy `dpl_…clt1lspj7…` live.

## Open blockers
- **None** for MapForge (planning stage). FootageBrain: none new (Epidemic Music Library remains pre-existing-blocked on owner DevTools calibration).

## Pending (written but not yet live)
- **MapForge:** nothing built — next step is scaffolding the `mapforge` repo (separate from this one) on owner go-ahead.
- **Carried over from session r/q (FootageBrain, owner-gated, unchanged):**
  - **OD-2** — owner must re-save the Reviewer role in Roles & Permissions admin so stored `app_settings.role_permissions` picks up reviewer Analytics+Inbox (until then Leroy lost Monitor but hasn't gained Analytics/Inbox).
  - Owner visual check of the Pipeline ◉ Graph view.
  - Batch 3 RLS delete-hardening — write as **`0099_…`** (0098 is now used by reel_dup_group).
  - Carried: Scout backend redeploy; OpenCut SSO smoke + caddy-bridge persist.

## Next session — start here
1. **If continuing MapForge:** decide repo location + name (`mapforge`), then scaffold Phase 0 (DB schema + multi-tenant Worker + R2 + wildcard DNS proving one site serves). Pick the first test city + category. Register email sending domains early (2–4-week warmup). See `obsidian-vault/MapForge/Roadmap.md`.
2. **If returning to FootageBrain:** OD-2 admin re-save (Reviewer role) + owner graph visual check.

## Verification commands (to confirm current state on resume)
```
# FootageBrain unchanged this session — confirm clean working state:
cd "c:/Users/Mi/Downloads/ziflow project-final" && git status --short && git log --oneline -3
# MapForge artifacts exist:
ls "C:/Users/Mi/.claude/plans/this-is-a-pure-frolicking-ripple.md"
ls "obsidian-vault/MapForge/"
```
