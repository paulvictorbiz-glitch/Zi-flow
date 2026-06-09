# Phase 1 — Sleek nav, Lossless tab, multi-platform analytics + unified inbox

Owner: Paul. Drafted 2026-06-08. Build-as-much-as-possible now; real social API
tokens wired later.

## Goals
1. **Sleek nav** — replace the horizontal tab strip with a hamburger in the
   **upper-right** that opens a tab menu **sliding in/out from the left**.
2. **Lossless tab** — in-browser LosslessCut-style trimmer via **ffmpeg.wasm**
   (`-c copy`, files never leave the browser). New tab like the OpenCut editor.
3. **Cross-platform analytics + unified inbox** — pull/aggregate analytics and
   comments+DMs from **Facebook, Instagram, YouTube, TikTok**; one **Inbox** tab
   to reply to all comments for a reel across every platform. Built on mock data
   now (real tokens later).

## Architecture decisions
- **Shared data contract:** `src/lib/social-client.js` (DONE) — `PLATFORMS`,
  `getConnections`, `getAnalytics`, `getTopPosts`, `getInboxThreads`,
  `getInboxByReel`, `getInboxSummary`, `replyToThread`. Rich deterministic mock
  now; each fn has a `// TODO(real)` seam (FB endpoints validated against the
  live Page token). Analytics + Inbox both read from here.
- **New tabs:** `inbox`, `lossless` added to `TABS` (app.jsx) + `VIEW_CAPS`
  (permissions-catalog). `analytics` already exists — extended in place.
- **Real API home:** Facebook/IG via the Hetzner backend's stored Page token
  (`api.footagebrain.com`, already built). YouTube=Google OAuth, TikTok=Login Kit
  — added later behind the same `social-client` interface.

## Work split (non-overlapping files → safe parallel subagents)
| Agent | Owns (only) | Task |
|---|---|---|
| **Nav** | `src/app.jsx`, `src/styles.css`, `src/lib/permissions-catalog.js` | Hamburger (upper-right) → left slide-in drawer of tabs; register `inbox` + `lossless` tabs + caps |
| **Analytics** | `src/pages/analytics.jsx` (+ `analytics.css`) | Multi-platform analytics from `social-client`: per-platform KPIs, trend chart, top content, per-reel cross-platform compare. Keep mock A/B section |
| **Inbox** | `src/pages/inbox.jsx` (+ `inbox.css`) | Unified comments/DM inbox grouped by reel, platform filters, reply boxes (`replyToThread`) |
| **Lossless** | `src/pages/lossless.jsx` (+ `lossless.css`) | ffmpeg.wasm trimmer from CDN (no npm deps): pick file → set in/out segments → export `-c copy` → download |

Foundation already in place: `social-client.js`, `inbox.jsx`/`lossless.jsx` stubs
(stable exports `Inbox` / `LosslessCut` so the Nav agent's imports never break).

## Constraints given to every agent
- Match the dark/mono terminal aesthetic; reuse CSS vars (`--bg`,`--fg`,`--c-cyan`,
  `--f-mono`…) and shared components (`DPill`,`Pill`,`Card`,`Selector`).
- Touch ONLY your owned files. Page agents must NOT edit `styles.css`/`app.jsx`
  (use a co-located `.css` or inline styles).
- No new npm deps (Lossless loads ffmpeg.wasm from CDN).

## After agents land
- Integrate-check: `npm run build` clean, manual smoke of each tab.
- Continue building the analytics panel (real FB insights endpoint on Hetzner).
- Deploy via `vercel --prod` (never git push).
