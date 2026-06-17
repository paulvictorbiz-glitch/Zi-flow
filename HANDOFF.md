# Handoff — last updated 2026-06-17

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Built a **3D spinning Reel-DNA helix** on the public landing page (planned via `/qa-verified-plan`). The 3D `DnaHelix` component already existed but was never wired in — so v1 was a lazy-loaded component swap of the flat SVG helix, plus a **slow-on-hover** spin and a **3D / Classic toggle** (localStorage-persisted; non-WebGL → Classic).
- **Visual overhaul** of the helix per Paul: continuous **tube strands**, each gene = one **ACTG base-pair crossbar** (color-coded nucleotide molecules + billboarded letters), **tilt + pushed back**, a warm **"mitochondria cell"** background, and the helix box **stretched** to match the timeline column.
- **Deployed the entire working tree to prod** (`vercel --prod` → www.footagebrain.com). This shipped not just the helix but ALL previously-staged work live at once: Reel Inspiration Library, the daily-use batch (series grouping, duplicate reel, card readability, Leroy→CTO), `/space`, and the training pillar.
- **Committed + pushed** the working tree to GitHub on branch `bugfix-daily-use-batch`.
- three.js stays lazy on the landing — confirmed in the build (landing ~41 kB; three.js in the on-demand 834 kB chunk).

## Where we left off
The 3D DNA helix is **live** on www.footagebrain.com and was visually verified on the dev server before deploy. The whole working tree is deployed and committed. The dev server may still be running locally (background task, port 8002).

## Open blockers
- **None for the helix.** It's live and verified.
- **Instagram-DM-to-self ingest — handler now DRAFTED, deploy pending (Hetzner + Meta, not from this repo):** the webhook handler is written at `backend-handoff/ig_webhook.py` (+ `backend-handoff/IG-DM-DEPLOY.md`), with a `FEATURE_IG_DM_DEBUG` calibration mode. Remaining = owner/SSH actions only: SCP to `/srv/.../backend/app/api/`, register the router, set env (`IG_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, flags), `docker compose build/up`, then Meta config (`instagram_manage_messages` + Webhooks subscription on `messages`). Test = share a reel from a *second* account → @paulvictortravels. See memory `reel-dna-ig-dm-ingest`.

## Pending (written but not yet live)
- **None pending deploy** — the backlog of "built but not deployed" work cleared this session (it's all live now).
- **Branch not merged to `main`:** the deploy is from the working tree on `bugfix-daily-use-batch`; `main` lags prod. Merge it for backup/cleanliness.
- **Rocket.Chat config (owner action, no code):** set Leroy's role label to **Owner**; disable Owner self-assignment — both in `chat.footagebrain.com` admin.

## Next session — start here
1. **Merge `bugfix-daily-use-batch` → `main`** so the repo's default branch matches what's live on prod.
2. **Deploy the Instagram-message-to-self ingest** (handler already drafted in `backend-handoff/ig_webhook.py`): SCP to Hetzner + register router + set env + `docker compose build/up`, then Meta app config — follow `backend-handoff/IG-DM-DEPLOY.md`. Run the `FEATURE_IG_DM_DEBUG` calibration share first, then flip `FEATURE_IG_DM_INGEST=1`.
3. Any **helix visual tweaks** Paul wants after seeing it live (tilt angle, spin speed, background warmth, base-sphere colour = ACTG vs gene colour, mote density, letter legibility/depthTest).

## Verification commands (to confirm current state on resume)
- `curl -sI https://www.footagebrain.com | head -1` — site responds (200).
- Open `https://www.footagebrain.com/` → scroll to the breakdown → 3D helix spins, slows on hover, hovering a gene lights its timeline lane; 3D/Classic toggle works.
- `npm run build` — confirm build still green (790 modules; landing chunk ~41 kB; three.js isolated in the `OrbitControls` chunk).
- `git log --oneline -3` — confirm this session's commit is on `bugfix-daily-use-batch`.
- `git branch --contains main` / `git log main..bugfix-daily-use-batch --oneline` — see what still needs merging to `main`.
