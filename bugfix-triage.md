# Bug Fix Triage — "Do these first (daily-use impact)"

> Source list: `obsidian-vault/05 - Roadmap/TODO Backlog.md` → "🐛 Bug Fixes (do these first — daily use impact)".
> Purpose: categorize the 7 bugs by subsystem + map file ownership so a multi-subagent
> run (`/qa-verified-plan` → `/senior-architect`) can fix them without cross-task file collisions.

---

## The 7 bugs

| # | Bug | One-line |
|---|-----|----------|
| 1 | Permissions don't enforce on general users | Capability toggles (e.g. "can't move reel cards") don't actually gate the action. |
| 2 | Owner perspective-preview bleeds full permissions | Viewing-as-editor doesn't fully reflect the editor's restricted caps. |
| 3 | Rubric archive is global, should be per-reel | Hiding a sub-skill row on one reel hides it on every reel. |
| 4 | Migration check button errors | "Check migrations" 500s on missing `migrations.manifest.json`. |
| 5 | Drag-reorder tasks in My Work + readability | Task rows aren't draggable; low text contrast in that section. |
| 6 | Verify training widget on owner dashboard | Confirm per-editor `TrainingProgressWidget` renders + navigates for owner. |
| 7 | Redundant rubric self-ranking control | `selfAssessRubric` shows in both the perms matrix and the Monitor Gamify card. |

---

## Categories (by subsystem)

- **A · Permissions & Access Control** — #1, #2 (+ catalog half of #7)
- **B · Gamify / Rubric** — #3, #7
- **C · My Work tab** — #5, #6
- **D · Dev / Deploy tooling** — #4

---

## File-ownership map (the part that matters for parallel subagents)

| File | Touched by | Notes |
|------|-----------|-------|
| `src/lib/permissions.jsx` | 1, 2 | `can()` fail-opens on unset caps; `effectiveRole`/`effectivePersonId` already wired. |
| `src/lib/permissions-catalog.js` | 1, 7 | #1 adds a "move card" cap; #7 removes `selfAssessRubric` (line 63). **Contested.** |
| `src/pages/pipeline.jsx` | 1 | Only `can("moveToCompleted")` checked (L155/200/400/429) — no general move gate. |
| `src/pages/detail.jsx` | 1 | Action affordances to gate. |
| `src/app.jsx` | 2 | Perspective → `setEffectiveRole`/`setEffectivePersonId` (L193-206). |
| `src/components/GamifyRubricSheet.jsx` | 3 | `gamifyHiddenSubskills` flat array → per-reel map (L91-103, L151-187). |
| `src/store/store.jsx` | 3, 5 | #3 = `gamify_hidden_subskills` reducer/persist (L476,861,940-1121,1598); #5 = task-order persist. **Contested.** |
| `src/pages/monitor.jsx` | 4, 7 | #4 = migration card; #7 = Gamify grading-mode switch (L960-968) stays here. **Contested.** |
| `src/pages/my-work.jsx` | 1, 5, 6 | #1 = gate task/card moves; #5 = draggable task rows (L576 pattern); #6 = widget (L1356). **Hot file.** |
| `src/pages/my-work.css` (+ `training.css`) | 5 | Contrast/font fixes. |
| `src/components/TrainingProgressWidget.jsx` | 6 | Owner render + row→Training nav. |
| `scripts/gen-migration-manifest.mjs`, `check-migration-manifest.mjs` | 4 | Manifest generation/check. |
| `package.json`, `supabase/MIGRATIONS.md` | 4 | Pre-deploy `migrate:manifest` step + doc. |
| `api/monitor/status.js` (`?action=migrations`) | 4 | Server side of the check button. |

**Contested files (cannot be edited by two parallel agents):** `permissions-catalog.js`, `store.jsx`, `monitor.jsx`, and the hot file `my-work.jsx`.

---

## Recommended subagent execution plan (single-writer-per-file)

A naive "7 agents in parallel" collides on the 4 contested files. Structure as **2 waves**, each agent owning a disjoint file set. `/senior-architect` enforces this via its File Ownership Registry.

### Wave 1 — parallel (no shared files)
- **T-PERM** → bugs **#1 + #2 + the catalog half of #7**
  Owns: `permissions.jsx`, `permissions-catalog.js`, `pipeline.jsx`, `detail.jsx`, `app.jsx`.
  Folding #7's catalog edit here avoids a second writer on `permissions-catalog.js`.
  **Contract out:** name of the new "move card" capability key; confirmed preview-role semantics.
- **T-TOOL** → bug **#4**
  Owns: `scripts/gen-migration-manifest.mjs`, `scripts/check-migration-manifest.mjs`, `package.json`, `supabase/MIGRATIONS.md`, `api/monitor/status.js`.
  (Does **not** touch `monitor.jsx` UI — the button already exists; only the manifest/server path is broken.)

### Wave 2 — parallel after Wave 1 (consume Wave-1 contracts)
- **T-MYWORK** → bugs **#5 + #6 + apply T-PERM's move-cap gate inside My Work**
  Owns: `my-work.jsx`, `my-work.css`, `training.css`, `TrainingProgressWidget.jsx`, **store.jsx task-order region only**.
- **T-GAMIFY** → bug **#3 + verify #7's Monitor side**
  Owns: `GamifyRubricSheet.jsx`, `monitor.jsx` (Gamify card), **store.jsx gamify region only**.

### The one true serialization point
`store.jsx` is needed by both T-MYWORK (task order) and T-GAMIFY (per-reel hidden map). Single-writer rule → **do not run these two in parallel on store.jsx**. Two clean options:
1. **Split-region contract** — let each own a clearly-delimited, non-overlapping region of `store.jsx` and run them sequentially (T-GAMIFY then T-MYWORK), or
2. **Dedicated T-STORE micro-task** in Wave 1.5 that lands both new store actions (`setGamifyHiddenSubskills` per-reel + `reorderTasks` persist); then T-MYWORK and T-GAMIFY only consume those actions and never touch `store.jsx`. **(Recommended — fully unblocks Wave 2 parallelism.)**

---

## Quick wins / risk notes
- **#6 is mostly verification**, not a build — likely a 5-minute confirm (widget already imported at `my-work.jsx:31,1356`). Could be folded into T-MYWORK as a checklist item.
- **#2 may already be fixed** by commit `308e0ae` (preview role wiring is present). Scope T-PERM to *verify + close the fail-open gaps*, not rebuild.
- **#3 is a data-shape migration** (`string[]` → `{ [reelId]: string[] }`) in `app_settings.gamify_hidden_subskills` — needs a backward-compatible read so existing flat arrays don't crash. Flag for QA.
- All 7 are **frontend/tooling only** — no Supabase schema migration required (the per-reel rubric change is a JSON-shape change inside an existing `app_settings` row).

---

## How to launch the fix run
1. `/qa-verified-plan` with this file as the brief (categories + ownership map + waves above).
2. Approve the layered plan.
3. `/senior-architect` — feed it the File Ownership Registry from the table above; it will run Wave 1 in parallel, the store micro-task, then Wave 2 in parallel, with per-task QA.
