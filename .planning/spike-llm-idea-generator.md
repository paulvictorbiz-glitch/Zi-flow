# Spike: LLM Idea Generator + Supabase Limits Assessment
**Date:** 2026-06-02  
**Status:** COMPLETE — recommendation ready

---

## What we explored

1. Can we add an LLM that generates longform/reel drafts backed by real FootageBrain footage?
2. Does the free Supabase tier hold, or do we need to self-host?

---

## 1. What the feature does (user flow)

```
User types a prompt:
  "Generate a YouTube vlog idea about arriving at a Buddhist temple,
   using footage from my library. Optimise for watch-time and reels."

→ System pulls relevant footage from FootageBrain (semantic search)
→ Fetches transcript snippets for the top clips
→ Sends everything to Claude with a viral-content system prompt
→ Returns a structured draft:

  HOOK       "You've never seen a crowd react like this…"
  SCRIPT     Shot-by-shot narration tied to actual clip IDs
  EDIT TMPL  [DJI_0214 00:42–00:50] → [A7IV_0331 02:01–02:11] → …
  DOWNLOAD   Drive links for every clip referenced
  SEO BRIEF  Title, description, 12 tags, thumbnail concept
```

Draft auto-attaches to the reel (same `attached_footage_items` table)
and saves to `reel.detail` blob — no new DB tables required.

---

## 2. Architecture: where does the LLM call live?

### Options considered

| Option | Pros | Cons |
|--------|------|------|
| **A. Browser → Anthropic directly** | Zero setup | API key exposed in bundle |
| **B. Supabase Edge Function** | Key hidden, already have Supabase | 10ms CPU limit per invocation (too tight for search + LLM chain) |
| **C. Vercel Serverless Function** ← **RECOMMENDED** | Already on Vercel, keys in env vars, 10s timeout, zero new infra | None material |
| **D. FootageBrain Hetzner backend** | Most powerful, server already has search | Couples LLM feature to footage backend |

### Recommended: Vercel Serverless Function

Add `api/generate.js` to the ziflow Vite project. Vercel auto-deploys it
alongside the frontend — no new server, no new account.

**Call chain (all server-side, ~2–4s total):**
```
POST /api/generate
  { prompt, type: "reel"|"longform", reel_id?, context? }

  1. POST api.footagebrain.com/api/search  → top 12 clips (semantic)
  2. GET  api.footagebrain.com/api/files/{id}/transcript  × top 5 clips
  3. POST api.anthropic.com/messages  (Claude Sonnet 4.6, streaming)

  Response:
  {
    hook, script, shots[{clip_id, filename, tc_start, tc_end, desc, drive_url}],
    edit_template, download_list[{filename, drive_url, drive_folder_url}],
    seo: { title, description, tags[], thumbnail_concept }
  }
```

### System prompt character (viral / SEO / hooks)

The LLM receives a fixed system prompt trained on:
- **Hook theory**: pattern-interrupt first 3 seconds, open loops, curiosity gaps
- **Reels structure**: hook → payoff → loop (< 60s), vertical-first framing
- **Longform**: intro hook → chapter structure → watch-time retention patterns
- **SEO**: YouTube title formulas, description keyword density, tags, thumbnail CTR
- **Specificity**: every shot cited by actual filename + timecode from transcripts, not fabricated

### What gets stored in Supabase

Just text blobs — no video, no binary:
- `reel.detail` jsonb (already exists) gets a new `ai_draft` key
- `attached_footage_items` rows for the clips the AI cited (already exists)

**No new tables needed.**

---

## 3. Supabase free tier: will it hold?

### Current usage audit

| Thing | Current estimate | Free tier limit |
|-------|-----------------|-----------------|
| Database rows | ~100 rows total (reels + tasks + footage refs) | unlimited rows |
| Database storage | < 0.5 MB | **500 MB** |
| Realtime connections | 3–6 concurrent (small team) | 200 concurrent |
| Realtime messages | ~100/day (reel updates) | 2,000,000/month |
| Auth MAU | ~5 users | 50,000 MAU |
| Edge Function invocations | 0 (not using yet) | 500,000/month |

### LLM feature adds to Supabase

Each generated draft stores ~3–8 KB of text in `reel.detail`.
1,000 drafts = ~5 MB. To hit the 500 MB limit you'd need ~100,000 drafts.
At 10 drafts/day that's 27 years. **Supabase free tier is not a constraint.**

### Verdict: **DO NOT self-host Supabase**

Self-hosting Supabase (Docker on a VPS) costs $10–20/month in server costs,
requires manual backups, SSL, upgrades. The free tier has years of headroom
for this app. Self-host only if:
- You need >500 MB DB storage (not happening — no video stored in Supabase)
- You need >50k monthly active users (not applicable)
- You need features on Supabase Pro like PITR backups or branching

**The real cost to watch is Claude API:**
- ~2,700 tokens input (search results + transcripts + system prompt)
- ~1,000 tokens output (draft + edit template + SEO)
- Total per generation: **~$0.02 on Claude Sonnet 4.6**
- 100 generations/month = $2. 1,000/month = $20.
- Use the `ANTHROPIC_API_KEY` already in the Nikky Content Desk project —
  or set a new one in Vercel env vars.

---

## 4. Build plan (phases if you want to proceed)

**Phase 1 — Backend API function** (Vercel `api/generate.js`)
- Accept prompt + type
- Search FootageBrain + fetch top-5 transcripts
- Call Claude with viral/SEO/hooks system prompt
- Return structured JSON draft

**Phase 2 — "Generate idea" UI** (new page or modal in ziflow)
- Prompt input + type toggle (Reel / Longform / YouTube)
- Streaming output so user sees draft appear in real time
- Shot list with thumbnails + timecodes
- One-click "attach all clips to this reel"

**Phase 3 — Download list**
- Renders Drive links for every cited clip
- "Copy all Drive links" button
- Optional: generate a `.csv` edit decision list (EDL-style)

**Phase 4 — SEO brief panel**
- Title options (A/B), description, 12 tags
- Thumbnail concept (text description)
- Character-count validators for each platform

**Total estimate:** 3–5 focused sessions to ship Phase 1+2. Phases 3+4 are
additive UI on top.

---

## 5. One dependency to confirm

The FootageBrain backend at `api.footagebrain.com` is **public with no auth**.
The Vercel function will call it directly. Confirm this is acceptable — if you
want to restrict it to server-to-server only, adding a shared secret header
to the FootageBrain Caddy config is a one-liner.
