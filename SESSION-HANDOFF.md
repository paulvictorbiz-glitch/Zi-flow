# Session Handoff

## Session 2026-06-02 / 2026-06-03

### What was done

**FootageBrain — Drive folder onboarding:**
- Re-crawled whole Google Drive (9,918 video rows, was ~5,180)
- Matched 6,215 videos to Drive URLs (exact name+size), 6,214 to parent folders, 119 distinct Drive folders
- Applied to local SQLite + live Hetzner Postgres (`pg_drive_all.sql`)
- Fixed Avast TLS interception permanently (Python `truststore` `.pth` + `NODE_EXTRA_CA_CERTS`)
- Coverage tab now shows Drive folder links per country
- Added `drive_folder_url` to search results (backend + frontend)

**footagebrain.com (ziflow) — mobile + UI:**
- Fixed viewport (was `width=1400`, now `device-width`) — site was unusable on phone
- Added full `@media` responsive layer (tab strip scrollable, page-head stacks, detail single-col, modals fullscreen)
- Fixed Coverage tab row layout (country name was collapsing to 0px on mobile)
- Music/Inspiration links now have a visible `✎` edit button (shift+click was impossible on phone)

**footagebrain.com — Generate tab (tab 9):**
- New `api/generate.js` Vercel serverless function: FootageBrain search → Anthropic Claude Sonnet 4.6 → title + description + footage clips with timecodes + Drive links
- `ANTHROPIC_API_KEY` set in Vercel env vars (~$0.02/generation)
- Drive URLs injected server-side (not relying on LLM to copy URLs — was the bug causing missing links)
- "Add to Pipeline" button creates reel card in Supabase + attaches clips with timecodes visible
- Generation history saved to localStorage, accessible via "History (N)" button
- Response time: ~12s (reduced from 65s by cutting context size)

**Skills library created:**
- `~/.claude/skills/` — 15 custom skills: deploy-ziflow, deploy-footagebrain, log-change, close, superpowers, gsd, openspec, task-observer, browser-use, test-driven-development, frontend-design, react-nextjs-performance, shadcn-ui-manager, postgresql-performance, docker-containerization

---

### Current state

- **footagebrain.com** — live, mobile-responsive, 9 tabs, Generate tab working
- **api.footagebrain.com** — live, search returns `drive_url` + `drive_folder_url`
- **Supabase** — free tier, well within limits; no self-hosting needed
- **Git (ziflow)** — working tree dirty, all changes deployed via Vercel CLI but NOT committed
- **Drive OAuth token** — will expire again in ~7 days (app still in "Testing" mode)
- **Anthropic API key** — was shared in conversation; should be rotated

---

### Open items

1. **Rotate Anthropic API key** — key was shared in chat. Go to console.anthropic.com → API Keys → disable old → create new → `vercel env rm ANTHROPIC_API_KEY production` → `vercel env add ANTHROPIC_API_KEY production --value <new-key> --yes` → `vercel --prod --yes`
2. **Google OAuth → "In production"** — stops the 7-day refresh token expiry. Google Cloud Console → OAuth consent screen → Publishing status → Publish
3. **Commit ziflow git** — all changes are live but uncommitted. Run `git add -A && git commit -m "Add Coverage tab, mobile responsive layer, Generate tab (LLM + footage)"` then `git push`
4. **Test Generate tab on phone** — verify the Syria haircut Drive links now appear after the server-side injection fix
5. **Coverage tab on phone** — verify the stacked row layout looks correct on mobile

---

### Next session should start with

1. Read this file
2. Rotate Anthropic API key (open item #1 above — takes 2 min)
3. Commit ziflow git (open item #3 above)
4. Then continue with whatever new feature is next

---

### Files changed this session

**FootageBrain backend:**
- `backend/app/search/engine.py` — added `drive_folder_url` field to `SearchResult`
- `backend/app/api/schemas.py` — added `drive_folder_url` to `SearchResultOut`
- `backend/app/api/search.py` — pass `drive_folder_url` in result mapping
- `backend/app/api/dashboard/folders.py` — natural folder sort + Drive folder links in coverage tree
- `backend/data/gen_pg_drive_all.py` — new script (replaces stale backup-based generator)
- `backend/data/pg_drive_all.sql` — generated SQL applied to live Postgres
- `Google drive api code/reauth_drive.py` — new: truststore-injected OAuth re-auth helper

**Ziflow (footagebrain.com):**
- `index.html` — viewport meta fixed
- `src/styles.css` — responsive layer + coverage row classes + idea generator styles
- `src/app.jsx` — tab 9 "Generate" added
- `src/pages/coverage.jsx` — new: Coverage tab
- `src/pages/idea-generator.jsx` — new: Generate tab
- `src/pages/detail.jsx` — Music/Inspiration edit buttons
- `api/generate.js` — new: Vercel serverless LLM function
- `package.json` / `vite.config.js` — `@anthropic-ai/sdk` added, `/api` proxy
- `CHANGES.md` — all entries logged

**Skills:**
- `~/.claude/skills/` — 15 new skill files
- `~/.claude/settings.json` — global permissions updated (bypassPermissions + Glob/Grep/WebFetch/WebSearch)
- `~/.claude/avast-root.pem` — Avast root CA for npm
- `C:\Users\Mi\AppData\Roaming\Python\Python314\site-packages\zz_truststore_autoinject.pth` — Python TLS fix
