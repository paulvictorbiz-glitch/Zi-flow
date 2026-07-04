# DEADWEIGHT register

Single list of things that are (or may become) **dead weight** — built-but-dormant code,
oversized dependencies, redundant artifacts — tagged at discovery so they get trimmed on a
schedule instead of found by archaeology months later. See the discipline in memory
`feedback_deadweight-tagging-discipline`.

**Conventions**
- Add a row the moment you ship something speculative, heavy, flag-gated, or not-yet-wired.
- In code, drop a grep-able marker: `// DEADWEIGHT(reason, review-by: YYYY-MM)` (JS) / `# DEADWEIGHT(...)` (py).
- Pair every `FEATURE_X=0` flag with a review-by date here.
- Review monthly: `grep -rn "DEADWEIGHT" src api backend-handoff` + scan this file. Remove rows when actioned.

| Item | Location | Why it's (potential) dead weight | Remove / trim when | Added | Status |
|---|---|---|---|---|---|
| **CUDA / GPU stack in backend image** (~4.6 GB: `nvidia-*` 2.7 GB, CUDA-torch 1.2 GB, `triton` 691 MB) | box image `footagebrain-backend:latest` (pulled transitively by `sentence-transformers`) | Box is **CPU-only** (`no /dev/nvidia*`) — these libraries never execute | Rebuild with CPU-only torch (`+cpu` pin) + multi-stage → ~10 GB → ~3 GB. Draft ready in `backend-handoff/slim-image/` | 2026-06-27 | **DRAFTED, not rebuilt** (gated: backend rebuild + smoke test) |
| **Orphan image `footage-brain-test-backend:latest`** (10.3 GB) | box | Built by the stale root compose; never serves traffic | — | 2026-06-27 | ✅ **REMOVED 2026-06-27 (Phase 1)** |
| **Stale root compose** (`/srv/footagebrain/footage-brain-test/docker-compose.yml`) | box | The "orphan factory" — builds the orphan if compose is run from the wrong dir | — | 2026-06-27 | ✅ **Renamed `.disabled` 2026-06-27** |
| **Old Three.js "Space" homepage** (~24 files: `space3d.jsx`+`.css`, all 20 of `components/space/**`, `rm-node.jsx`, `variant-row.jsx`) | FootageBrain `src/` | Replaced by live `hud-space.jsx`; only importer of the space tree is the orphaned `space3d.jsx` | Owner greenlights the A+B cleanup batch (plan `is-there-any-housekeeping-async-wilkes`) | 2026-06-27 | Pending owner go-ahead |
| **`edit_ai.py`** (captions / silence-trim worker) | `backend-handoff/edit_ai.py` (+ box, not deployed) | Built but **no UI caller and not deployed** → fully dormant | Wire a UI + deploy, OR remove. Decide-by **2026-09** | 2026-06-27 | Dormant — decide-by date set |
| **Social Inbox mock data** (`TODO(real)` seams) | `src/lib/social-client.js` | Inbox tab serves demo FB/IG/YT/TikTok data; real APIs partly blocked on platform verification | Swap to live API calls when verification clears | 2026-06-27 | Provisional |
| **57 `.bak` files** in live backend source dir | box `/srv/.../backend/app/**` | Ad-hoc rollback snapshots; canonical source is the private backend git repo | Optional tidy (≈1 MB total — left in place; harmless) | 2026-06-27 | Left in place (low value/risk) |
