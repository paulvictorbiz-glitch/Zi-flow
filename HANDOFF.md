# Handoff — last updated 2026-06-26 (session v)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Content strategy conversation:** User is a travel content creator with 4TB of already-transcribed footage. Generated reel scripts for 14 topics (Kosovo, North Korea abduction, Korean jimjilbangs, Japan, Luxembourg, Philippines, Northern Ireland, Syria/HTS, Denmark Christiania, Netherlands Kapsalon, Al-Hamidiyah Souq + more).
- **Content Forge feature designed end-to-end:** AI-powered content discovery (Haiku batch) + hook generation (Sonnet expansion) inside FootageBrain; reads already-transcribed footage from Hetzner backend, surfaces S/A/B/C ranked opportunities, expands selected topics into 3 hook versions.
- **QA-verified multi-agent plan produced:** 4 domain agents (DB, Backend, Frontend, Infra) + adversarial QA pass → 8 blocking issues found, 6 resolved, 2 escalated to owner.
- **`CONTENT-FORGE-PLAN.md`** written to project root — full layered implementation plan (Layer 0–4).
- **Obsidian node created:** `obsidian-vault/02 - Features/Content Forge.md`.
- No code written, no migrations applied, no deployment this session.

## Where we left off
Content Forge is fully planned with a QA-verified spec. Nothing has been built yet — the plan document (`CONTENT-FORGE-PLAN.md`) is the artefact. Owner needs to answer 5 open decisions before implementation begins (see below).

## Open blockers
- **Owner must answer 5 questions before Content Forge build can start:**
  1. Where do Whisper transcripts actually live on Hetzner? (SSH + `ls /srv/footagebrain/...` to confirm path + format)
  2. Does the stored Facebook page token have `instagram_manage_insights` scope? (Check token scopes; if absent, defer IG writeback subsystem)
  3. Sonnet expansion prompt is ~180 tokens — below 1024-token caching threshold. Pad to >1024 or accept ~3x uncached pricing?
  4. Cross-run dedup: same angle discovered in two runs = two rows currently. Want cross-run dedup (needs `angle_fingerprint` column)?
  5. Hook generation confirmed on Hetzner (not Vercel) — suggest.js is thin proxy only. Confirm this architecture.

## Pending (written but not yet live)
- **`CONTENT-FORGE-PLAN.md`** — plan written, nothing built yet
- **Migration `0100_capcut_install_events.sql`** — committed but NOT applied (human-gated, from session t)
- **OD-2 carry (session q):** Reviewer role re-save (Leroy hasn't gained Analytics/Inbox yet)
- **Batch 3 RLS delete-hardening** → write as `0099_…` (0098+0100 used; next free is 0101; Content Forge uses 0101-0103 → 0099 still available)
- **Scout backend redeploy**, **OpenCut SSO smoke + caddy-bridge persist**, **Epidemic calibration** — carried from prior sessions
- **Phase 2 RC chat recording** (session t): Rocket.Chat-native `/reel-state` slash command

## Next session — start here
1. **Answer the 5 Content Forge open decisions** (owner SSH + token check) then begin Layer 0: migrations 0101–0103
2. **Optionally clear carried follow-ups:** OD-2 Reviewer re-save, 0099 RLS hardening, Scout backend redeploy
3. Phase 2 RC chat recording if prioritised over Content Forge

## Verification commands (to confirm current state on resume)
```bash
# Confirm git state (no Content Forge code yet — plan files only)
git -C "c:/Users/Mi/Downloads/ziflow project-final" log --oneline -3
# → f77a39b, ef91b06, ed9cf49 (no new commits from this session)

# Confirm CONTENT-FORGE-PLAN.md exists
ls "c:/Users/Mi/Downloads/ziflow project-final/CONTENT-FORGE-PLAN.md"

# Confirm transcript path on Hetzner (owner runs this)
# ssh root@178.105.14.144 "ls /srv/footagebrain/footage-brain-test/backend/transcripts/ 2>/dev/null || echo NOT_FOUND"

# Confirm instagram_manage_insights scope (owner runs this)
# ssh root@178.105.14.144 "docker exec fb-backend python3 -c \"import os,httpx; r=httpx.get('https://graph.facebook.com/me/permissions',params={'access_token':os.environ['FB_PAGE_TOKEN']}); print([p for p in r.json()['data'] if 'insight' in p['permission']])\""
```
