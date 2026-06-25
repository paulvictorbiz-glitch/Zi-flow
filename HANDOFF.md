# Handoff — last updated 2026-06-25 (session t)

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- Built **Phase 1** of "attach a Rocket.Chat screen recording as a reel's Current reel state": a **↙ Pick from Chat** picker on the reel detail card (everyone, not owner-gated) → pick channel → pick a recent video → re-hosts it into the private `reel-videos` bucket and sets the reel's `media_path`.
- Fixed a **no-audio** bug: chat screen recordings are **HEVC/H.265** (browsers play them silent) → backend now **transcodes to H.264+AAC** on attach. Re-host is byte-perfect; the codec was the issue.
- **Removed** the legacy "+ Current reel state" URL button and **embedded the current-state video inline** below the Inspiration reel (signed URL).
- Deployed the backend to Hetzner `fb-backend` **twice** (endpoints, then transcode) — discovered the live stack is the `deploy/hetzner/docker-compose.yml` compose, not the stale sibling.
- Committed the whole working tree (chat-recording feature `cd60392` + in-tree CapCut agent installer `ed9cf49`), pushed `feat/capcut-replica-v2`, and ran a full-tree `vercel --prod` → **live on www.footagebrain.com**.

## Where we left off
Phase 1 is **live in production** and verified by the owner on localhost (audio + inline embed working after the transcode fix). The branch `feat/capcut-replica-v2` is committed clean and pushed; prod matches `ed9cf49`.

## Open blockers
- None.

## Pending (written but not yet live)
- **Phase 2** of the chat-recording feature (Rocket.Chat-native trigger): a message-action button "📎 Set as reel state" on file messages (preferred) or a `/reel-state REEL-201` slash command, extending `backend-handoff/reel-rc-app/` + a new shared-secret-gated `POST /rocketchat/app/attach-recording`. NOT built yet.
- Migration `0100_capcut_install_events.sql` — committed, **not applied** (human-gated). Needed if the Monitor CapCut install-events card writes to that table.
- (Carried) OD-2: owner must re-save the Reviewer role in admin for the session-q permission grant to take effect.

## Next session — start here
1. **Phase 2** — Rocket.Chat-native attach (message-action button / `/reel-state`). Plan section already written in `.claude/plans/when-editors-in-the-quirky-milner.md`.
2. Decide whether to **apply migration `0100`** (CapCut install-events) — human-gated.
3. (Optional) Re-attach any pre-fix HEVC recording so it gets the audio-working transcode.

## Verification commands (to confirm current state on resume)
```bash
# New chat-recording routes live (401 = up + JWT-gated; 404 = not deployed)
curl -s -o /dev/null -w "%{http_code}\n" "https://api.footagebrain.com/api/rocketchat/dashboard/channel-files?channel=pipeline"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.footagebrain.com/api/rocketchat/dashboard/attach-recording -H "Content-Type: application/json" -d '{}'
# New code baked into the running backend (expect >=1)
ssh root@178.105.14.144 'docker exec fb-backend grep -c "_to_web_mp4" /app/app/api/reel_chat.py'
# Git state (prod == ed9cf49)
git -C "c:/Users/Mi/Downloads/ziflow project-final" log --oneline -3
```
