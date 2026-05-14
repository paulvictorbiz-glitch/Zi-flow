-- =========================================================
--  Step 6a follow-up #2 — persist the rest of the Reel Detail
--  view's editable state (checklists, variants, handoff
--  package, allowed-changes, ReadyForReview stage, per-reel
--  task composer).
--
--  These are all structured arrays / small objects that always
--  read together with the reel and never get queried
--  independently — perfect fit for a single jsonb column.
--  Cheap to write, easy to break out into proper tables later
--  if one field starts wanting its own queries.
--
--  Shape of the blob (all optional; defaults baked into the
--  client):
--    detail: {
--      checks:           [{ id, label, done?, warn?, block? }],
--      handoffChecks:    [{ id, label, done?, warn?, block? }],
--      perReelTasks:     [{ audience, type, assignee, instruction, due?, status }],
--      variants:         [{ letter, type?, label, state }],
--      handoffPackage:   [{ k, l, done, warn?, note? }],
--      allowed:          [{ id, text }],
--      notouch:          [{ id, text }],
--      readyForReview:   "editing"|"review-ready"|"in-review"|"approved"
--    }
-- =========================================================

alter table public.reels
  add column if not exists detail jsonb;
