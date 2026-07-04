# Handoff — last updated 2026-07-03

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Researched OSS font-detection models + VLM font accuracy → answered feasibility (build ~90% confident; identification accuracy modest, sharpens in Phase 2).
- Ran `/qa-verified-plan` → plan `golden-roaming-hammock.md`; owner approved + asked to add Gemini usage monitoring.
- **Built + SHIPPED LIVE: Font ID (Phase 1)** — owner-only "Fonts" tab that identifies the font in a reel frame (screenshot upload/paste OR reel-URL keyframes) → top-3 matches + confidence + legit download links, Gemini-vision only.
- Deployed the backend to Hetzner (merged into live `content_forge.py`, rebuilt `fb-backend`, verified a real vision call = 200) and the frontend via `vercel --prod` (`dpl_H8RmqVFiFNJYRyRDT2Fgu5BtYiWQ`).
- Monitoring: font-ID rides the same kill switch / daily cap + logs `kind="font_id"`; added a "Font ID" line item to the Monitor budgets card.

## Where we left off
Font ID Phase 1 is **live in production**. Backend routes (`/content-forge/font-id`, `/font-id-keyframes`) verified end-to-end (HTTP 200 via `vertex_gemini`/`gemini-2.5-flash`, 3 matches, usage logged $0.0013). Frontend + proxy deployed and aliased to www.footagebrain.com. The only unverified link is the authenticated proxy→backend hop, testable only from the owner's logged-in browser.

## Open blockers
- None. (One expected non-blocker: `api/ai/suggest.js` returns `401 {"error":"Unauthorized"}` to any unauthenticated call — it needs an owner Bearer JWT or `SUGGEST_CRON_SECRET` (not set in prod). Normal; the browser authenticates.)

## Pending (written but not yet live)
- **Owner in-browser confirm** (10s): open footagebrain.com → Monitor group → **Fonts** tab, drop a reel screenshot, hit "Identify font" → expect top-3 matches.
- **Uncommitted**: this shipped LIVE but is NOT committed (like Solarin). A future isolated/clean-baseline deploy would revert it — keep it in the working tree. Also still-uncommitted-but-live: whole-library mining, HUD (built-not-deployed), etc.
- **Phase 2** (not built): self-hosted ONNX classifier (~3k Google Fonts) + Gemini re-rank + optional WhatFontIs paid tier behind a `FONT_ID_MODE` flag; convert the reel-URL path to fire-and-forget (currently synchronous, 55s ceiling).

## Next session — start here
1. Owner confirms the Fonts tab works in-browser (authenticated hop).
2. If accuracy needs a boost → start Font ID Phase 2 (ONNX + WhatFontIs) per plan `golden-roaming-hammock.md`.
3. (Carried over) Owner expounds the 2,393 Content Forge seeds; `/space` HUD customization awaits sign-off → commit + deploy.

## Verification commands (read-only)
```bash
# Backend routes registered + gated (expect 401 = up, not 404):
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.footagebrain.com/api/content-forge/font-id -d '{}'
# font_id usage logged (needs the secret; run from a shell that can read it):
#   docker exec fb-backend printenv CONTENT_FORGE_SECRET  → then GET /api/content-forge/usage?secret=…  (look for by_kind font_id)
# Vercel proxy deployed (expect 401 Unauthorized JSON = handler reached; browser passes with JWT):
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://www.footagebrain.com/api/ai/suggest?action=font-id" -d '{}'
# Rollback on the box if ever needed:
#   cp /srv/footagebrain/footage-brain-test/backend/app/api/content_forge.py.bak-fontid  <same path minus .bak-fontid> ; rebuild
```
