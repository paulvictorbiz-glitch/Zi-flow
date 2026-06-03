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

## 2026-06-03 — Fix Generate: footage FK race + expand AI output

**Bug: AI-generated reels had no attached footage, "Generated reel" title, empty fields.**
Root cause (confirmed via live DB: 0 attached_footage rows for REEL-276..282):
`wrap()` fires its persistFn without awaiting, so `createReel` + each
`addAttachedFootage` hit Supabase concurrently. Footage rows have a
`reel_id` FK → reels.id, so they raced ahead of the reel insert and failed
the FK silently (error logged, optimistic state kept, never persisted).

- `src/store/store.jsx` — new `createReelWithFootage(reel, footageItems)`
  action: dispatches optimistically, then persists the reel FIRST (await),
  THEN the footage rows sequentially. OLD: idea-generator called
  `actions.createReel` + N× `actions.addAttachedFootage` (all concurrent).
- `src/pages/idea-generator.jsx` — `createReelFromDraft` now uses the new
  action, populates `script` (shot plan via new `buildShotPlan`), `logline`
  (description), and stashes the full AI draft in `detail.aiDraft`. Title
  falls back to the prompt, never the generic "Generated reel".

**Expanded the $0.02 generation to a full publish pack:**
- `api/generate.js` — system prompt + output schema now also return:
  `hook`, `flow` (beat-by-beat blueprint), and `seo` { youtube_title,
  ig_caption, description, hashtags[] }. `max_tokens` 800 → 2000. Robust
  JSON parse (strips ``` fences; on failure returns a usable minimal shape
  instead of `_raw` only).
- `src/pages/idea-generator.jsx` + `styles.css` — render hook card, flow
  blueprint, and a click-to-copy SEO pack (title, IG caption, description,
  hashtags).

## 2026-06-02 — LLM Idea Generator (Phase 1 + 2): Vercel function + UI

New feature: AI-generated content ideas (reel / longform) backed by real
FootageBrain footage. Adds a 9th tab "Generate" to the app.

**New files (no old content to log):**
- `api/generate.js` — Vercel serverless function: FootageBrain search →
  transcript fetch → Anthropic Claude (Sonnet 4.6) → structured JSON draft
- `src/pages/idea-generator.jsx` — prompt UI, streaming draft display,
  shot list with thumbnails, download list, SEO brief panel

**`package.json` — added dependency:**
- OLD deps: `@supabase/supabase-js`, `react`, `react-dom` only
- NEW: added `@anthropic-ai/sdk`

**`vite.config.js` — added dev proxy for /api:**
- OLD: proxy only for `/fb` and `/thumbnails`
- NEW: added `/api` → `http://localhost:3001` for `vercel dev` local testing

**`src/app.jsx` — added tab 9 and body render:**
- OLD tab 8 was the last tab; body ended at `{view === "coverage" && <Coverage />}`
- NEW: added `<button ... view === "generate">9 · Generate</button>` and
  `{view === "generate" && <IdeaGenerator />}` import + render

**`src/styles.css` — added idea generator styles:**
- Additive `.gen-*` class block appended after existing rules.

Requires `ANTHROPIC_API_KEY` env var set in Vercel project settings.
Local dev: use `vercel dev` (port 3001) instead of `npm run dev`.

## 2026-06-02 — Fix Coverage tab row overlap on mobile

Coverage rows squashed/overlapped on phones and the country name vanished.
`CoverageRow` was one flex row with four fixed-width columns (80+110+90+92 ≈
420px) + a `flex:1, minWidth:0` name; on a 390px screen the fixed columns
overflowed and the name collapsed to 0 width.
- `src/pages/coverage.jsx` — replaced inline-styled spans with classes
  (`.cov-row`/`.cov-name`/`.cov-meta`/… and `.cov-root-head`/`.cov-root-meta`).
  OLD: each cell had inline `style={{ width: 80, textAlign:'right', … }}`.
- `src/styles.css` — added desktop rules + a `@media (max-width:860px)` block
  that stacks the row (country on its own line, metrics wrap below).

## 2026-06-02 — Mobile-friendly UI + editable reference links

**Mobile (was desktop-only):**
- `index.html` — viewport meta was `content="width=1400"` (hard-pinned the
  desktop layout on every device → phones rendered a zoomed-out 1400px page).
  NEW: `width=device-width, initial-scale=1, viewport-fit=cover`.
- `src/styles.css` — appended a responsive `@media (max-width: 860px)` /
  `(max-width: 480px)` layer (additive; nothing replaced). Topbar compacts +
  wraps, breadcrumb hidden, tabstrip becomes horizontally scrollable, page-head
  stacks, detail-grid/hook-grid collapse to one column, .board/.spine scroll
  horizontally, modals (.m-shell) go near-fullscreen, paddings reduced.

**Editable reference links (`src/pages/detail.jsx`):**
Music + Inspiration links were only editable via shift+click — impossible on a
phone (no shift key), so once set they could only be opened, never changed.
- OLD: `<span onClick={handleRefClick ...}>♪ Music ↗</span>` (shift+click=edit).
- NEW: when a link is set, render the open-link plus a visible "✎" edit button
  (always prompts) — touch-friendly. Empty state ("+ Music") unchanged.

Verified: `npm run build` clean; Playwright mobile audit shows device-width
honored (clientWidth 390, no horizontal overflow); deployed via `vercel --prod`.

## 2026-06-02 — New "Coverage" tab (FootageBrain coverage tree + Drive folders)

Adds an 8th tab showing FootageBrain's per-country folder coverage tree, sourced
from the public `GET /api/dashboard/coverage-tree` endpoint. Each folder row
opens its Google Drive folder in a new tab (drive_folder_url). Lets the user
browse footage by folder and jump straight to Drive.

**New files (no rollback needed):**
- `src/pages/coverage.jsx` — the Coverage page.

**`src/lib/footage-brain-client.js`** — added `getFootageBrainCoverageTree()`.
INSERT-only; nothing replaced.

**`src/app.jsx`** — wired the tab in. Three INSERT-only edits:
- import `Coverage` from `./pages/coverage.jsx`
- new crumb label + tab button (`view === "coverage"`, "8 · Coverage")
- body render `{view === "coverage" && <Coverage />}`

Requires `vercel --prod` to deploy (git push alone does not deploy ziflow).

## 2026-05-22 — List View: per-reel "To pipeline" + Archive / Delete actions

User asked for two things in List View: a way to send a completed reel
back into the pipeline, and an archive/delete control on each row.

`src/pages/list-view.jsx`
- Imported `useAuth` to gate hard delete to the owner role (matches
  `archived-view.jsx`); `useWorkflow()` now also pulls `actions`.
- Added an "Actions" column (header + per-row cell). The cell calls
  `e.stopPropagation()` so its buttons don't also fire the row's
  open-detail handler. Each row gets:
  - "↩ To pipeline" — shown only for reels in the `completed` or
    `posted` stage. Calls `actions.moveStage(id, { stage: "in_progress" })`,
    which re-activates the reel and auto-hands it to the skilled editor.
  - "Archive" — `actions.archiveReel(id)` (soft, restorable from the
    Archived view).
  - "Delete" — owner role only, behind a `confirm()`; `actions.deleteReel(id)`.

OLD thead ended:
```jsx
              <th>Next action</th>
            </tr>
```
OLD row ended:
```jsx
                <td style={{ color: "var(--fg)" }}>{r.next || <span className="dim">—</span>}</td>
              </tr>
```

Verified: `npm run build`. Requires: Vercel redeploy of ziflow.

---

## 2026-05-22 — Fix: attached-footage thumbnails + preview links broken on footagebrain.com

Reel cards showed no thumbnails for attached footage once the card was
reopened on the deployed site. `AttachedFootageList.jsx` (and the Footage
Library page) built the thumbnail `src` as a same-origin `/thumbnails/...`
path. That works in local dev — Vite proxies `/thumbnails` to `:8765` —
but on footagebrain.com it resolves to `https://footagebrain.com/thumbnails/...`,
a 404, and the `<img>` `onError` handler then hides the image. Preview
buttons in the same two components hardcoded `localhost` URLs.

Same bug class the 2026-05-21 entry fixed for `FootageBrainSearch.jsx`;
these two components were missed.

`src/components/AttachedFootageList.jsx` — imported `footageBrainThumbnailUrl`
and `footageBrainFileUrl` from the FB client.
- Thumbnail. OLD:
  ```jsx
  src={`/thumbnails/${item.thumbnail_url.split(/[\\/]/).pop()}`}
  ```
  NEW: `src={footageBrainThumbnailUrl(item.thumbnail_url)}`.
- Preview. OLD:
  ```jsx
  window.open(
    `http://localhost:8765/files/${item.footage_file_id}`,
    "_blank"
  );
  ```
  NEW: `window.open(footageBrainFileUrl(item.footage_file_id), "_blank")`.

`src/pages/footage-library.jsx` — imported the same two helpers.
- Thumbnail. OLD: `src={"/thumbnails/" + c.thumbnail_url}`
  NEW: `src={footageBrainThumbnailUrl(c.thumbnail_url)}`.
- Preview. OLD:
  `window.open("http://localhost:5173/files/" + clip.footage_file_id, "_blank")`
  NEW: `window.open(footageBrainFileUrl(clip.footage_file_id), "_blank")`.

Verified: `npm run build`. Requires: Vercel redeploy of ziflow.

---

## 2026-05-22 — Fix: start-all.bat opened browser before Footage Brain was up

`start-all.bat` waited a fixed 5s + 4s, then opened both browser tabs.
But `start-prod.bat` rebuilds the Footage Brain frontend (`tsc` +
`vite build`) *before* starting uvicorn — that takes 1-2 minutes — so the
`localhost:8765` tab always opened to "can't connect."

OLD — fixed timeouts, blind browser opens:
```bat
REM Give Footage Brain a head start so its port is up before Ziflow proxies to it
timeout /t 5 /nobreak >nul

REM ── Step 2: Launch Ziflow dev server in its own window ─────────────────────
echo [2/2] Starting Ziflow (npm run dev) ...
start "Ziflow (dev)" cmd /k "cd /d "%ZIFLOW_DIR%" && npm run dev"

REM Open browser tabs for both
timeout /t 4 /nobreak >nul
start "" "http://localhost:8765"
start "" "http://localhost:8000"
```
NEW: a `:waitport` subroutine polls each port with a TCP connect and
opens `localhost:8765` only once the server actually answers (up to a
5-minute budget for the slow build), with a clear warning on timeout.
ZiFlow's tab is left to Vite's own `server.open` so it is not opened
twice. Local launcher only — not part of the deployed site.

---

## 2026-05-21 — Fix: search modal closes on text-select drag; pipeline card collapse

Two bug fixes.

**A. Footage Brain search modal "kicks you out" when clearing the query.**
`src/components/FootageBrainSearch.jsx` — the backdrop closed the modal on
any `click` that bubbled to it. Drag-selecting the search text (to clear/
replace it) often ends the drag past the input's edge; the mouseup lands
on the backdrop, the synthesized `click` targets the backdrop, and the
modal closed mid-search.

OLD — overlay div closed on raw click:
```jsx
        zIndex: 9999,
      }}
      onClick={onClose}
    >
```
NEW — track whether the press *started* on the backdrop; only close when
the whole press+release happened on the backdrop itself. Added a
`backdropDown` ref (after the `addedThisSession` state) and replaced
`onClick={onClose}` with `onMouseDown` + a guarded `onClick`.

**B. Pipeline card "Collapse" did nothing.**
`src/components/components.jsx` — `ReelCard`'s foot had a Collapse span
that was a no-op placeholder.

OLD:
```jsx
        <span
          className="collapse"
          onClick={e => { e.stopPropagation(); /* placeholder for per-card collapse */ }}
        >Collapse</span>
```
NEW: `ReelCard` gets a `collapsed` state. The span toggles it and reads
`Collapse`/`Expand`; the note and links rows render only when not
collapsed; `collapsed` is added to the card class list. OLD body rows:
```jsx
      {reel.note && <div className="note">{reel.note}</div>}
      {reel.links && reel.links.length > 0 && (
```
now guarded with `!collapsed &&`.

---

## 2026-05-21 — Search URL resolution: build-time → runtime (Vercel dev-mode build)

The earlier same-day fix branched on `import.meta.env.DEV`. Vercel builds
this project in development mode (the deployed bundle ships
`react.development` and JSX dev metadata), so `import.meta.env.DEV`
compiled to `true` and the production site resolved search to the
dev-only `/fb/api` Vite-proxy path → search broke on footagebrain.com.

- `src/lib/footage-brain-client.js` — replaced the `import.meta.env.DEV`
  branches with a runtime hostname check. OLD:
  ```js
  const FB_API_ORIGIN = import.meta.env.DEV
    ? ""
    : import.meta.env.VITE_FB_API_ORIGIN || "https://api.footagebrain.com";
  ```
  NEW: `IS_LOCAL_DEV` is computed from `window.location.hostname`
  (localhost / 127.0.0.1 / ::1) at module load. The deployed site is
  never localhost, so it always targets `https://api.footagebrain.com`,
  regardless of how the bundle was built. `footageBrainFileUrl` uses the
  same check; dropped the unused `VITE_FB_API_ORIGIN` override.

Note: Vercel building in dev mode also bloats the bundle (~1.5x,
`react.development`). Search now works regardless; that build-mode issue
is worth fixing separately.

---

## 2026-05-21 — Production URLs: ziflow on footagebrain.com calls api.footagebrain.com

Ziflow is being deployed to `footagebrain.com` (Vercel) with the
FootageBrain backend on `api.footagebrain.com` (Hetzner). The search
client used dev-only URLs, so search / thumbnails / preview would all
break in the production build.

- `src/lib/footage-brain-client.js` — the API base + health URLs were
  fixed dev-proxy strings. OLD:
  ```js
  const FOOTAGE_BRAIN_BASE = "/fb/api";
  const FOOTAGE_BRAIN_HEALTH = "/fb/health";
  ```
  NEW: branch on `import.meta.env.DEV` — dev keeps the Vite-proxied
  `/fb/*` paths; production builds target `https://api.footagebrain.com`
  (overridable via the `VITE_FB_API_ORIGIN` build env var). Added two
  exported helpers — `footageBrainThumbnailUrl()` and
  `footageBrainFileUrl()` — so the thumbnail `<img>` and the preview
  link resolve correctly in both dev and production.

- `src/components/FootageBrainSearch.jsx`:
  - Thumbnail — OLD: ``src={`/thumbnails/${result.thumbnail_path.split(/[\\/]/).pop()}`}``;
    NEW: `src={footageBrainThumbnailUrl(result.thumbnail_path)}`.
  - Preview — OLD: `window.open("http://localhost:8765/files/" + result.video_file_id, …)`;
    NEW: `window.open(footageBrainFileUrl(result.video_file_id), …)`.
  - Offline-warning text — OLD referenced `localhost:8765`; NEW is
    environment-neutral (a deployed user never sees localhost).

- `.gitignore` — added FootageBrain runtime artifacts (`data/`,
  `footage_brain.db*`, `machine_id.json`) that had landed loose in the
  ziflow folder, so they are never committed.

Pairs with footage-brain-test CHANGES.md (same date): backend CORS now
allows `footagebrain.com`, nginx proxies `/health`, and Caddy switched
to a Let's Encrypt cert for `api.footagebrain.com`.

Requires: Vercel redeploy of ziflow; FootageBrain redeploy on Hetzner.

---

## 2026-05-18 — "Source on Drive" link on Footage Brain search results

User wants the Google Drive source link visible when searching a clip in
Ziflow. Footage Brain now returns `drive_url` on every search result
(see footage-brain-test CHANGES.md same date). Surfaced it here:

- `src/lib/footage-brain-client.js` — `searchByFilename` re-maps file
  rows into the result shape and was dropping `drive_url`. OLD map went
  `…is_vertical: f.is_vertical, best_score: 1,`; NEW adds
  `drive_url: f.drive_url,` (semantic/keyword/hybrid pass FB's response
  through untouched, so they already carry it once FB is restarted).
- `src/components/FootageBrainSearch.jsx` — `FootageResultCard` now
  renders a green "⬇ Source on Drive" `<a>` (new tab) next to the
  Preview button, shown only when `result.drive_url` is set. OLD: button
  row ended after the `📺 Preview` button.

Requires: FB backend restarted with the search `drive_url` change, then
rebuild/restart Ziflow's frontend.

---

## 2026-05-16 — Add Locations capability (My Maps embed + structured import layer)

**New files (no rollback log needed):**
- `src/lib/locations-data.jsx` — structured map-data layer:
  `LocationsProvider` / `useLocations()` (mirrors `useWorkflow()`),
  localStorage-backed (`ziflow.locations.v1`), KML/GeoJSON/CSV
  importers, `MY_MAPS` registry (mid from the pasted embed),
  `linkedReelIds` / `linkedNoteIds` forward hooks.
- `src/pages/locations.jsx` — page with two tabs: **Map** (the
  Google My Maps iframe embed) and **Structured** (importable
  Location table). Reuses existing chrome classes; no new global
  CSS.

**Edited (pre-existing): `src/app.jsx`** — wired the new page into
the shell. OLD snippets being replaced:

1. Imports — after the `ArchivedView` import line:
```jsx
import { ArchivedView } from "./pages/archived-view.jsx";
import { NotificationsProvider, useNotifications } from "./components/notifications.jsx";
```

2. Crumb label ternary (lines ~96-100):
```jsx
{view === "pipeline"  ? "Pipeline · " + pipelineMode :
 view === "mywork"    ? "My work" :
 view === "detail"    ? "Reel detail" :
 view === "footage"   ? "Footage library" :
 view === "export"    ? "Export prep" : "Analytics"}
```

3. Tabstrip — the Analytics tab button was the last numbered tab:
```jsx
        <button className={"tab " + (view === "analytics" ? "is-active" : "")} onClick={() => setView("analytics")}>
          <span className="n">6 ·</span> Analytics
        </button>
```

4. Body conditionals — the Analytics line was last:
```jsx
      {view === "analytics" && <Analytics />}
```

5. Provider tree:
```jsx
            <WorkflowProvider>
              <NotificationsProvider>
                <AppShell />
              </NotificationsProvider>
            </WorkflowProvider>
```

**Motivation:** add a Locations capability in two layers — an
immediate-use My Maps embed and a structured, importable
place-data layer designed to later connect to reels/planning/notes
via the `linkedReelIds`/`linkedNoteIds` fields and the stable
`useLocations()` API. Local-first so it ships without a Supabase
schema change; the provider shape is a drop-in for a future
store/DB move.

**Verified:** `npm run build` (see report).

---

## 2026-05-15 — Refactor step 4: hoist pipeline-board constants into shared-data

**Duplications found:** only `pipeline.jsx` was carrying local constants
that shadowed shared-data (other pages already import from there).

- `PIPELINE_STAGES` was a hand-maintained array of `{key, label}` —
  shadowed `STAGES` (already in shared-data) and `STAGE_LABEL` (also
  there, with title-case labels vs the board's upper-case style).
  Now derived inline from those two: `STAGES.map(k => ({key: k,
  label: STAGE_LABEL[k].toUpperCase()}))`. One label table, one
  ordering source.

- `LANES` was 4 hardcoded lanes with names + roles. Moved to
  `shared-data.jsx` as `PIPELINE_LANES`, with names sourced from
  `PEOPLE` so a rename in one place propagates everywhere. The
  "review" lane id is preserved (it's a workflow slot, not a person
  id — Leroy's PEOPLE id is "maya").

Verified by build: 95 modules unchanged, CSS byte-identical, JS bundle
~70 bytes smaller from the dedup.

---

## 2026-05-15 — Refactor step 3: extract modals from fab.jsx

**Before:** `src/components/fab.jsx` was 345 lines mixing:
- `CreateFab` (the floating button, the only externally-used symbol)
- `TaskModal` (~60 lines)
- `ReelModal` (~150 lines, including its own `nextReelId` helper)
- `Modal` / `Field` / `SegRow` / `SelectInput` (shared form primitives)

External imports of the file:
```
src/app.jsx: import { CreateFab } from "./components/fab.jsx"
```
Only `CreateFab` was actually used outside — the other exports were leakage.

**After:**

```
src/components/fab.jsx                  (50 lines — just CreateFab)
src/components/modals/Modal.jsx         (Modal + Field + SegRow + SelectInput)
src/components/modals/TaskModal.jsx
src/components/modals/ReelModal.jsx     (includes nextReelId helper)
```

`fab.jsx` now imports the two flow modals from `./modals/`. Verified by
build (`npm run build`): 95 modules transformed (was 92 → +3 new files),
CSS byte-identical, JS bundle 461.01 kB (same as before).

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
