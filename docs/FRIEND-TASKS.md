# Tasks for the second contributor

> Pick from here. Read `docs/COLLAB-NOTES.md` first (the rules). The owner (Paul) handles all
> deploys, DB migrations, and Hetzner backend work — you build on branches and open PRs.
> Best starting point: the **known bugs** below (small, isolated, clean PRs).

---

## Best starter tasks — known bugs

Confirmed in code, root-cause location known, low blast radius. Reproduce account-specific
bugs with **real per-account logins** — the in-app "switch perspective" only re-gates the UI,
it does NOT change the data layer, so it hides data-gating bugs.

1. **Final-video button missing for non-owners** — hard `isOwner &&` gate at
   `src/pages/detail.jsx:941`. Likely should be a `can()` / role check, not owner-only.
2. **Monitor page empty for non-owners** — hard gate at `src/store/store.jsx:2003`
   (+ render under `isOwner &&` at `src/app.jsx:676-678`, should be `canView()`).
3. **Scout ISO-8859-1 Headers TypeError** — a *client*-side browser fetch (the server fix at
   `api/ai/suggest.js:47` doesn't cover it); needs a runtime pin + the same `asciiHeader`
   treatment on the client call.
4. **Leroy (maya) can't switch perspectives** — switcher gated at `src/app.jsx:498`; also
   `src/store/store.jsx:1996` hardcodes `maya` → owner-like data.
5. **Jay / Amarea show role labels on their names** — roster label rendering bug.
6. **Names truncated to first letter** — roster / name display bug.

---

## Greenfield features (bigger, mostly separate files)

| Feature | State | Notes |
|---|---|---|
| **Training active-learning Phases 3–4** | MVP built (migration `0078`); Phases 3–4 not built | Quiz / Flashcards / Chapters exist — extend them |
| **Assign-to-editor dropdown** | Built but disabled | `src/pages/detail.jsx` has a `{false && isOwner}` guard — re-enable by removing `false &&` (confirm with owner first) |
| **Payment infrastructure** (Stripe credit packs) | Planned, no code | Needs Vercel Pro (project at 12/12 function cap) + owner's Stripe account → owner-led |
| **Jarvis AI overlay** | Roadmap only | 6 phases, read-only-first — owner-led |

---

## Built but NOT deployed — owner finishes & ships (context only)

You generally won't touch these (they're gated on migrations / Hetzner / deploy that only the
owner runs), but here's what's in flight so you don't duplicate work:

- **OpenCut collab multi-track editor** — on branch `feat/opencut-collab-multitrack`.
- **Reel DNA Analyze button fix** — committed, awaiting Hetzner deploy + fresh cookies.
- **Epidemic Music Library** (+ Browse/Favorites/Playlists) — blocked on an API-endpoint
  calibration only the owner can do.
- **Reel DNA spreadsheet/pipeline batch**, **row tagging**, **Editor render Phase 1** — built,
  awaiting the owner's deploy.

---

## Standing blockers / gotchas (infra)

- **`npm run dev` hits the LIVE production database** — never write/seed/delete data.
- **Zero automated tests** — `npm run build` is the only gate; verify behavior by hand.
- **Vercel Hobby caps the project at 12 serverless functions** — don't add a new `api/*.js`;
  fold server logic into `api/ai/suggest.js?action=` instead.
- **Migrations are numbered & append-only** — claim the next number with the owner before
  writing one; the owner applies it.
