# Ziflow — Smoke Checklist

Run after every refactor step. The goal isn't perfect coverage — it's "did
I break a golden path?" If anything below fails, revert the refactor and
investigate before continuing.

**Setup:**
1. `npm run dev` — Vite should start on :8000 with no console errors.
2. Open the app, log in. Browser dev-tools console should be empty (no red).

---

## Navigation (every tab loads)

- [ ] **My work** — opens, shows reels assigned to current user, no errors.
- [ ] **Pipeline** — kanban view renders all stage columns.
- [ ] **Pipeline → "list"** mode toggle renders the list view.
- [ ] **Footage library** — opens, shows attached clips grouped by reel.
- [ ] **Export prep** — opens, no console errors.
- [ ] **Analytics** — opens, no console errors.

## Reel CRUD (the riskiest paths)

- [ ] **Create new reel** — FAB button → modal opens → fill title → "Create reel" → new card appears in pipeline → opens to detail.
- [ ] **Create reel with attached footage** — same flow, but add a clip via the FB Search modal first, then create. Verify the clip is attached on the reel detail after create.
- [ ] **Create reel with music + inspiration links** — same flow, fill both link fields → after create, both pills appear in **amber** on the detail header.
- [ ] **Edit reel title inline** (if your refactor touches detail.jsx). Save and refresh; persists.
- [ ] **Move reel between stages** (drag or stage-pill click) — card moves; refresh page; persisted.
- [ ] **Delete or archive reel** — gone from pipeline; appears in archived view.

## Music / Inspiration links (post-create)

- [ ] On an existing reel with no music link, click **+ Music** → prompt opens → paste a URL → save.
- [ ] Pill switches to amber `♪ Music ↗`.
- [ ] Click amber pill → opens URL in new tab.
- [ ] **Shift+click** amber pill → re-prompts to edit.
- [ ] Same for **+ Inspiration**.
- [ ] Refresh page → both pills still amber, link preserved.

## Footage Brain Search (the modal)

- [ ] Open any reel → "Add footage" → search modal opens.
- [ ] All 7 mode chips render: Semantic, Keyword, Hybrid, **Visual, Caption, Multimodal**, Filename.
- [ ] Each mode runs a search without throwing.
- [ ] Click "Preview" on a result → opens `localhost:8765/files/<id>` in new tab (FB must be running). Should NOT 404.
- [ ] Click "Add to Reel" on a result → button flips to "✓ Added".
- [ ] Close modal → attached footage appears on the reel.

## Persistence (the silent-failure trap)

- [ ] After any of the above edits, **refresh the page**. Every change should still be present. If a field reverts on refresh, persistence is broken — common after a store-layer refactor.
- [ ] Open the same reel in a second browser tab. Edit in tab A. Tab B should NOT show stale data after a refresh.

## Console / network

- [ ] Browser console: zero red errors during the full pass. (Yellow warnings are OK.)
- [ ] Network tab: no failed Supabase requests (no 4xx/5xx from `supabase.co`).

## After-refactor build gate

- [ ] `npm run build` exits clean. No warnings about missing exports / unresolved imports.

---

**Time budget:** ~5 minutes per full pass once you have the muscle memory. Don't skip the persistence section — it's where refactors hide their bugs.
