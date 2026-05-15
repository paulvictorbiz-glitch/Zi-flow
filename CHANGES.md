# Ziflow — Change Log

Rollback log for edits made by Claude. Each entry captures the OLD version of
the affected snippets before they were replaced, so a change can be reverted
by hand if needed. Newest entries on top.

Workflow per change:
1. Log the old snippet here before editing.
2. Build the task.
3. Verify it works (syntax check, smoke test, dev server, etc.).
4. Ask the user to confirm before treating the change as committed.

---

## 2026-05-15 — Refactor step 2: folder structure (flat → src/pages, components, store, lib)

**Goal:** end the 25-flat-files-at-project-root situation. Pure mechanical move; no behavior change.

**New layout:**

```
src/
  main.jsx              (was: ./main.jsx)
  app.jsx               (was: ./app.jsx)
  auth.jsx              (was: ./auth.jsx)
  pages/
    pipeline.jsx, my-work.jsx, detail.jsx, detail-data.jsx,
    footage-library.jsx, export-view.jsx, analytics.jsx,
    list-view.jsx, calendar-view.jsx, archived-view.jsx
  components/
    fab.jsx, components.jsx, notifications.jsx, variant-row.jsx,
    rm-node.jsx, handoff.jsx, AttachedFootageList.jsx,
    FootageBrainSearch.jsx
  store/
    store.jsx
  lib/
    supabase-client.js, footage-brain-client.js,
    shared-data.jsx, time.jsx
```

**Files unchanged in place:** `index.html` (Vite entry), `package.json`,
`vite.config.js`, `seed/`, `supabase/`, `node_modules/`, `dist/`,
`SMOKE.md`, `CHANGES.md`, `start-all.bat`.

**Index entry:** `index.html` script src updated from `/main.jsx` to
`/src/main.jsx`.

**Import path rewrites:** every relative import inside the moved files was
rewritten to match the new locations (e.g. `./store.jsx` →
`../store/store.jsx` when called from a page, etc.). Done in bulk via a
Python script after `git mv` to preserve history.


**A. Preview button error.**

Old (`FootageBrainSearch.jsx` lines 300-304):

```jsx
window.open(
  "http://localhost:5173/files/" + result.video_file_id,
  "_blank",
  "noopener,noreferrer"
);
```

Port 5173 was the Vite dev port. Footage Brain in production serves both
backend and frontend from `localhost:8765`, so the preview link 404'd.
Switched to 8765.

**B. Music + Inspiration link buttons (post-create editable).**

Old behaviour (`detail.jsx` lines 185-218): the audio/inspiration URLs
saved during reel creation only rendered as links when present. There was
no way to add one after the reel was created.

New behaviour: two always-visible pills in the reel detail header
(alongside "Current reel state"). When empty they read `+ Music` /
`+ Inspiration` and clicking prompts for a URL. When set they read
`♪ Music ↗` / `✦ Inspiration ↗` in amber — clicking opens the link,
right-click/dropdown lets you edit. No more orphan links after create.


**Goal:** surface the new backend search modes (`visual` = CLIP frame
embeddings, `caption` = VLM captions, `multimodal` = fused) in the reel-card
"Search Footage Brain" modal so editors can pick them alongside the existing
semantic / keyword / hybrid / filename modes.

**File:** `FootageBrainSearch.jsx`

**Old snippet — SEARCH_MODES (lines 16–21):**

```jsx
const SEARCH_MODES = [
  { key: "semantic", label: "Semantic", hint: "meaning + visual concepts" },
  { key: "keyword",  label: "Keyword",  hint: "exact transcript terms" },
  { key: "hybrid",   label: "Hybrid",   hint: "semantic + keyword" },
  { key: "filename", label: "Filename", hint: "match by file name" },
];
```

**Old snippet — input placeholder branch (lines 214–220):**

```jsx
placeholder={
  mode === "filename"
    ? "e.g., '20241223', 'IMG_0512', 'drone'"
    : mode === "keyword"
    ? "Exact word in transcript…"
    : "e.g., 'sunrise drone shot', 'people talking indoors'"
}
```

**Note:** `footage-brain-client.js` already forwards `mode` verbatim to the
`/api/search` endpoint, so no client-side change is needed — the backend
(`backend/app/search/engine.py` in footage-brain-test) already routes
`visual`, `caption`, `multimodal` to the right handlers.
