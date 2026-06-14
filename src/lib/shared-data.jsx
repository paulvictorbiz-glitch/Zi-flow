/* =========================================================
   Static identity + workflow constants.

   Holds people, roles, the canonical 5-stage pipeline labels
   and the stage→responsible-role mapping that drives pipeline
   auto-handoff. Operational data (reels, review lane cards,
   tasks, attached footage) is read live from Supabase via the
   workflow store — this file is no longer a seed source.

   (The old CAL_WEEK / CAL_ITEMS calendar fixtures are gone —
   calendar-view.jsx now derives items from live reels.)
   ========================================================= */

/* ---------- Roles ----------
   The four fixed roles and their canonical person slot. The actual
   people (names/avatars/emails) are read live from the Supabase
   `people` table via src/lib/roster.jsx — see useRoster()/getRoster().
   `person` here is the canonical holder used for auto-handoff routing
   and the owner's perspective switcher; additional same-role members
   are added through the admin panel and receive work by assignment. */
const ROLES = {
  owner:    { label: "Owner / Creative Director", short: "Owner",    person: "paul" },
  skilled:  { label: "Skilled Editor",            short: "Skilled",  person: "alex" },
  variant:  { label: "Variant Editor",            short: "Variant",  person: "sam"  },
  reviewer: { label: "Reviewer",                  short: "Reviewer", person: "maya" },
};

/* Reels, reviewer-lane shadow cards, and tasks are persisted in
   Supabase and read live by the workflow store. The static fixture
   arrays that used to live here have been removed. */

/* ---------- Stage labels ----------
   Canonical 5-stage pipeline:
     not_started · in_progress · review · completed · posted

   Legacy values (idea / selected / main / variants / ready) still
   appear in seeded data and old DB rows. `STAGES` ordered list,
   `normalizeStage()` collapses legacy → canonical on read. */
const STAGES = ["not_started", "in_progress", "review", "completed", "posted"];

const STAGE_LABEL = {
  not_started: "Not started",
  in_progress: "In progress",
  review:      "Review",
  completed:   "Completed",
  posted:      "Posted",
};

const STAGE_TONE = {
  not_started: "cyan",
  in_progress: "warn",
  review:      "block",
  completed:   "ok",
  posted:      "ok",
};

const LEGACY_STAGE_MAP = {
  idea:     "not_started",
  selected: "not_started",
  main:     "in_progress",
  variants: "in_progress",
  ready:    "completed",
};

function normalizeStage(stage) {
  if (!stage) return stage;
  return LEGACY_STAGE_MAP[stage] || stage;
}

/* ---------- Stage → responsible role / person ----------
   When a reel transitions into a stage, the canonical owner for
   that stage becomes responsible. The pipeline auto-reassigns
   `owner` on stage change unless the user explicitly dropped the
   card into a different person's lane.

   Mapping:
     not_started → owner   (triage / kickoff)
     in_progress → skilled (cutting the main)
     review      → reviewer (caption + final pass)
     completed   → variant (variant packaging + scheduling prep)
     posted      → owner   (analytics review)
*/
const STAGE_ROLE = {
  not_started: "owner",
  in_progress: "skilled",
  review:      "reviewer",
  completed:   "variant",
  posted:      "owner",
};

function stageOwnerPersonId(stage) {
  const role = STAGE_ROLE[stage];
  return role ? ROLES[role]?.person : null;
}

/* Pipeline-board lanes are built live from the roster in pipeline.jsx
   (one row per non-reviewer member + the shared "review" lane). */

export {
  ROLES,
  STAGES, STAGE_LABEL, STAGE_TONE, normalizeStage,
  STAGE_ROLE, stageOwnerPersonId,
};
