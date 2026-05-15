/* =========================================================
   Static identity + workflow constants.

   Holds people, roles, the canonical 5-stage pipeline labels
   and the stage→responsible-role mapping that drives pipeline
   auto-handoff. Operational data (reels, review lane cards,
   tasks, attached footage) is read live from Supabase via the
   workflow store — this file is no longer a seed source.

   CAL_WEEK / CAL_ITEMS remain as calendar scaffolding consumed
   by calendar-view.jsx until that view is moved onto `reels.dueAt`.
   ========================================================= */

/* ---------- People + roles ---------- */
const PEOPLE = {
  paul:  { id: "paul",  name: "Paul Victor",  short: "Paul V",  role: "owner",   avatar: "PV", tone: "amber"  },
  alex:  { id: "alex",  name: "Judy Adawag",  short: "Judy A",  role: "skilled", avatar: "JA", tone: "cyan"   },
  sam:   { id: "sam",   name: "Jay",          short: "Jay",     role: "variant", avatar: "JY", tone: "violet" },
  maya:  { id: "maya",  name: "Leroy Crosby", short: "Leroy C", role: "reviewer",avatar: "LC", tone: "green"  },
};

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

/* ---------- Calendar seed (week of May 13–19, 2026) ---------- */
const CAL_WEEK = [
  { date: "Mon May 13", label: "Mon", n: 13 },
  { date: "Tue May 14", label: "Tue", n: 14 },
  { date: "Wed May 15", label: "Wed", n: 15 },
  { date: "Thu May 16", label: "Thu", n: 16 },
  { date: "Fri May 17", label: "Fri", n: 17 },
  { date: "Sat May 18", label: "Sat", n: 18 },
  { date: "Sun May 19", label: "Sun", n: 19 },
];

/* Calendar items: each is anchored to a day-of-week (0=Mon) */
const CAL_ITEMS = [
  { dow: 0, t: "14:00", kind: "decision", reel: "REEL-201", title: "Hook A/B decision",       owner: "paul",  tone: "warn"  },
  { dow: 0, t: "17:00", kind: "review",   reel: "REEL-195", title: "Review · prayer flags",    owner: "paul",  tone: "warn"  },
  { dow: 0, t: "18:00", kind: "post",     reel: "REEL-188", title: "Post · Lalitpur dusk",      owner: "paul",  tone: "ok"    },
  { dow: 0, t: "22:00", kind: "post",     reel: "REEL-170", title: "Post · Boudha drone",       owner: "sam",   tone: "ok"    },
  { dow: 1, t: "09:00", kind: "post",     reel: "REEL-178", title: "Post · Annapurna teaser",   owner: "paul",  tone: "cyan"  },
  { dow: 1, t: "12:00", kind: "review",   reel: "REEL-206", title: "Review · street food",      owner: "paul",  tone: "cyan"  },
  { dow: 1, t: "17:00", kind: "handoff",  reel: "REEL-201", title: "Handoff · variant brief",   owner: "paul",  tone: "cyan"  },
  { dow: 2, t: "10:00", kind: "variant",  reel: "REEL-201", title: "Variants begin",            owner: "sam",   tone: "cyan"  },
  { dow: 2, t: "15:00", kind: "review",   reel: "REEL-192", title: "Re-review · Patan alleys",  owner: "paul",  tone: "block" },
  { dow: 3, t: "12:00", kind: "variant",  reel: "REEL-180", title: "Variants due · flyover",    owner: "sam",   tone: "warn"  },
  { dow: 3, t: "18:00", kind: "post",     reel: "REEL-180", title: "Post · Himalaya flyover",   owner: "paul",  tone: "cyan"  },
  { dow: 4, t: "11:00", kind: "post",     reel: "REEL-204", title: "Post · Kathmandu chaos",    owner: "paul",  tone: "cyan"  },
  { dow: 5, t: "18:00", kind: "variant",  reel: "REEL-175", title: "Variants due · Pashupati",  owner: "sam",   tone: "warn"  },
];

export {
  PEOPLE, ROLES,
  STAGES, STAGE_LABEL, STAGE_TONE, normalizeStage,
  STAGE_ROLE, stageOwnerPersonId,
  CAL_WEEK, CAL_ITEMS,
};
