# FootageBrain — Persistent TODO

Last updated: 2026-06-11

Items are grouped by category. Check off with `[x]` when done.
Add new items as they come up — this file persists across sessions.

---

## 🎙️ Jarvis / "Talk to my app" — AI command interface

Natural-language voice/text interface that lets Paul ask questions about the
pipeline, generate content, pull analytics, or trigger actions — like Jarvis
but wired to live FootageBrain data.

- [ ] **Design the command layer** — a floating "J" button (or keyboard shortcut
      `/`) opens an input overlay; typed or transcribed query is sent to Claude
      with a system prompt that includes current reels, tasks, and analytics
      context; Claude responds with both a natural-language answer AND a
      structured `action` the UI can execute (e.g. `{action:"createReel",…}`)
- [ ] **Live context injection** — attach a serialised snapshot of pipeline state
      (reel count per stage, overdue items, unreplied inbox count, top performer
      from analytics) so Claude can answer "what needs my attention?" without
      hallucinating
- [ ] **Actionable responses** — if Claude's structured response includes a known
      action (createReel, moveStage, replyThread, generateScript, pullAnalytics)
      show a confirm button in the overlay before executing it
- [ ] **Voice input** — browser `SpeechRecognition` API (or Whisper via
      OpenRouter free tier) so Paul can talk to the overlay hands-free
- [ ] **Generate anything** — "make a script for a temple bell reel targeting
      travel audiences in Germany" → calls the existing `/api/generate` route
      with the extracted params and shows the draft inline
- [ ] **Data queries** — "which reel got the most engagement this month?" →
      reads live analytics data (FB/IG/YT already in social-client) and
      formats a plain-English answer
- [ ] **Conversation history** — persist last 20 turns in localStorage so the
      assistant remembers context within a session
- [ ] **Vercel serverless route** `api/jarvis.js` — accepts `{query, context}`
      POST, calls Anthropic API with claude-sonnet-4-6, returns
      `{reply, action?}`. Keeps the API key server-side only.

---

## 📬 Inbox — efficiency improvements

The inbox is partially live (FB + IG real data) but lacks reply speed tools
and YouTube/TikTok write paths. Priority: reduce time-to-reply.

### Wiring (backend gaps)
- [ ] **YouTube replies** — `replyToThread()` today returns an explicit error for
      YouTube. Need a `POST /fb/api/auth/youtube/reply` Hetzner endpoint that
      calls the YouTube Data API `comments.insert` with the stored OAuth token
- [ ] **TikTok replies** — same pattern; requires TikTok Business API
      `comment.reply`. Blocked on TikTok app approval — placeholder in social-client
      already, just needs the backend route
- [ ] **Inbox live-reload** — `useEffect` runs once on mount. Add a manual
      "Refresh" button + optional 60-second interval so new comments appear
      without a full page reload
- [x] **YouTube inbox fetch** — wired alongside FB/IG in the `Promise.all`

### UX speed improvements
- [ ] **AI reply suggestions** — for each unanswered thread, show 2-3 short draft
      replies (pulled from `/api/generate` with the comment text + reel title as
      context). One-click to accept, then Send. This is the biggest time-saver.
- [x] **Keyboard navigation** — `j/k` move between threads, `/` focuses search, `Escape` clears
- [ ] **Bulk mark-as-replied** — checkbox on each thread + "Mark selected as
      replied" action in the toolbar (local state only, no platform write needed)
      so resolved-in-person or irrelevant comments don't clog the queue
- [x] **Sentiment / sort triage** — sort selector: newest, oldest, most liked, negatives first
- [x] **DM quick-templates** — ◂ button opens 3-option popover; one click fills draft
- [x] **Per-thread age urgency** — ⚠ yellow after 24h, red after 48h
- [x] **Reply-all undo** — 1.2-second "Undo" window before group reply hits the API
- [x] **Collapse replied threads by default** — "3 replied" expander; unreplied stay prominent
- [x] **Manual refresh button** — ↻ Refresh button + last-refreshed timestamp in header

### Search & filter
- [x] **Full-text search** — search bar above filters, live across comment text / handle / post title
- [x] **Sort options** — newest / oldest / most liked / negatives first
- [x] **"Not in pipeline" filter** — chip to show only unlinked groups

---

## 🔴 Unresolved blockers

- [ ] **"User not allowed" on `create-user`** — Supabase Auth admin.createUser()
      returns this when the service role key stored in Vercel is truncated.
      Fix: `vercel env add SUPABASE_SERVICE_ROLE_KEY` with the full key (check
      Supabase dashboard → Settings → API for the complete string, no line breaks)
- [ ] **TikTok OAuth** — requires TikTok Developer App approval; cannot unblock
      without submitting the app for review on developer.tiktok.com

---

## 📊 Analytics

- [ ] **Live YouTube analytics overlay** — `fetchLiveYouTubeAnalytics()` exists
      but analytics.jsx uses only FB. Wire YT the same way FB is overlaid.
- [ ] **Live TikTok analytics** — backend endpoint needed; no TikTok token yet
- [ ] **Per-reel cross-platform view** — click a reel on the Analytics tab to
      see views/likes/comments for that reel on every platform side-by-side
- [ ] **Scheduled post performance** — after a reel is posted, auto-link its
      platform metrics back to the card (needs socialSource to be set)

---

## 🗓️ Pipeline / workflow

- [ ] **Due-date picker on reel cards** — currently only editable in detail view;
      add inline date input to the card hover state on Pipeline board
- [ ] **Overdue indicator** — reels past `dueAt` that aren't posted get a red
      border / badge on their card; "X days overdue" in List view
- [ ] **Reel duplication** — "Duplicate reel" option in card menu to clone a
      template reel (title, script, audio, owner) without footage
- [ ] **Batch archive** — multi-select on Pipeline board → "Archive selected"
      to clean up completed reels without clicking each one individually
- [ ] **Reel series / playlist grouping** — tag reels as part of a series so
      Pipeline can optionally group them visually (e.g. "Nepal series")

---

## 🔧 Admin / infra

- [ ] **set-password.js** exists as an untracked file — wire it into the Admin
      panel UI so the owner can reset a team member's password without Supabase
      dashboard access
- [ ] **Auto-reconnect for expired tokens** — when a health check marks a
      connection as "error", send a Slack/email notification to Paul so he knows
      to re-authorise before the next posting window
- [x] **Migration runner UI** — DONE (2026-06-14). `schema_migrations` table +
      `scripts/migrate.mjs` (`npm run migrate` / `migrate:apply`) + pink "Check
      migrations" button on the Monitor → Supabase card (`?action=migrations` on
      status.js, compares `migrations.manifest.json` vs DB). See `supabase/MIGRATIONS.md`.

- [ ] **🔒 BACK UP THE HETZNER BACKEND** *(important — single point of failure)*.
      The `api.footagebrain.com` Docker backend lives only on the Hetzner box
      (ssh root@178.105.14.144). If that server dies, the backend code (FB/IG/YT
      OAuth, WhatsApp, ffmpeg/processing, metrics, Rocket.Chat config) would have
      to be rebuilt from scratch — it is NOT in this repo.
      → **Do this:** pull a FULL copy of the backend source off Hetzner and commit
        it to a **private GitHub repo** (e.g. `footagebrain-backend`).
        NOTE: `backend-handoff/` here only has 3 files (DEPLOY-CHECKLIST.md,
        tiktok.py, whatsapp.py) — that is NOT the whole backend. The real,
        complete source (all routes, OAuth, ffmpeg, metrics, docker-compose) lives
        only on the box. Get all of it.
        · document the Docker setup (`docker-compose.yml`, env vars by name,
          rebuild steps) in the new repo's README so a fresh box stands up fast;
        · optionally a periodic `rsync`/snapshot of the Hetzner volume.
      → Answer to "should I make a private GitHub repo?": **Yes — for the backend.**
        Free, off-box, version-controlled; the git history makes recovery + future
        edits far safer than a one-off copy.
        (The FRONTEND already has a GitHub remote: `paulvictorbiz-glitch/Zi-flow`.
        ⚠ But today's whole feature batch + migration work is UNCOMMITTED/UNPUSHED —
        commit & push the frontend too so it's actually backed up.)
        See memory `vercel-cap-and-architecture.md` for the Vercel/Hetzner split.

- [ ] **Code cleanup / bug-hunt pass** *(when you have time)* — revisit the
      Vercel function-cap architecture notes (`?action=` folding, the 10s timeout
      pushing heavy work to Hetzner) and decide whether to consolidate. Full
      analysis saved in memory `vercel-cap-and-architecture.md`. Good moment to run
      `/code-review` over the recent feature batch.

---

## 🎬 Editor / Lossless

- [ ] **CapCut deep link** — "Open in CapCut" button on reel cards that constructs
      the CapCut mobile deep link URI with the footage Drive URL pre-loaded
- [ ] **Export-to-Drive** — after Lossless export, offer to upload the output blob
      directly to the reel's Google Drive folder (needs Drive OAuth)
- [ ] **Editor progress visible on pipeline card** — `edit_sessions` is written
      when an editor saves progress in the Editor tab, but this isn't surfaced on
      the Pipeline card hover. Show "In editor — last saved 2h ago" on the card.

---

## ✅ Completed (recent)

- [x] Stage actions on reel detail (submit for review, verdict bar)
- [x] Tasks visible in My Work for assignees
- [x] Calendar live data (no more May-2026 fixtures)
- [x] Generate tab assign-to picker
- [x] Inbox "link to card" picker writes socialSource
- [x] Editor saved state triggers pipeline stage update
- [x] Needs-you badge correct logic for reviewer/owner
- [x] Export CSV uses AI publish-pack caption
- [x] Approval bypass blocked in My Work (not just Pipeline board)
- [x] nextReelId consolidated into store (no more ID collisions)
- [x] FK-safe reel+footage creation everywhere
- [x] Calendar week/month paging with real navigation
- [x] Global search includes logline + script
- [x] Scheduled post date visible on cards, list, export
