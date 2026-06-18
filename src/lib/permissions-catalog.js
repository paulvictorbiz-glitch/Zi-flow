/* =========================================================
   Permissions catalog — the editable surface for the Owner-only
   "Roles & permissions" admin page.

   Two axes the owner can edit per role:
     · VIEWS   — which top-level tabs a role sees (removed from nav
                 entirely when disabled).
     · ACTIONS — which actions a role can perform (the button/affordance
                 disappears when disabled).

   IMPORTANT — Phase 1 is UI-gating only. These toggles control what the
   dashboard renders; they are NOT enforced at the database layer (RLS
   still lets any authenticated user write). Real enforcement is Phase 2.

   The `owner` role is intentionally NOT editable here — it always has
   full access (god-mode) and is the only role that can open this page.
   That guarantees the owner can never lock themselves out.

   Defaults below mirror today's behavior exactly, so switching this
   system on changes nothing until the owner edits a toggle.
   ========================================================= */

/* Top-level tabs, in the order they appear in the tab strip. `key`
   matches the `view` string in app.jsx. */
export const VIEW_CAPS = [
  { key: "mywork",    label: "My work" },
  { key: "pipeline",  label: "Pipeline" },
  { key: "detail",    label: "Reel detail" },
  { key: "footage",   label: "Footage library" },
  { key: "editor",    label: "Video editor (OpenCut)" },
  { key: "lossless",  label: "Lossless cut (in-browser)" },
  { key: "export",    label: "Export" },
  { key: "analytics", label: "Analytics" },
  { key: "inbox",     label: "Inbox (comments & DMs)" },
  { key: "locations", label: "Locations" },
  { key: "coverage",  label: "Coverage" },
  { key: "generate",  label: "Generate (AI · paid)" },
  { key: "reeldna",   label: "Reel DNA (capture library)" },
  { key: "training",  label: "Training (editor course)" },
  { key: "activity",  label: "Activity (CapCut tracker)" },
  { key: "resources", label: "Resources (link sheet)" },
  { key: "monitor",   label: "Monitor (infra usage)" },
  { key: "pulse",     label: "Pulse (real-time alerts)" },
  { key: "ai",        label: "AI Brain (bot & notes)" },
];

/* Actions wired in Phase 1. Every key here maps to a real, gated
   affordance in the UI — no dead toggles. */
export const ACTION_CAPS = [
  { key: "createReel",      label: "Create new reels",        hint: "The + Create → New reel flow" },
  { key: "deleteReel",      label: "Delete reels",            hint: "Permanent delete in a card's ⋯ menu" },
  { key: "archiveReel",     label: "Archive reels",           hint: "Archive in a card's ⋯ menu" },
  { key: "approveReview",   label: "Approve / send back",     hint: "Review-queue Accept & Send-back" },
  { key: "attachFootage",   label: "Attach footage",          hint: "Search & add clips on a reel" },
  { key: "changeCardColor", label: "Change card color",       hint: "The 5-swatch colour picker on a reel" },
  { key: "editLogline",     label: "Edit logline",            hint: "The logline field on a reel's detail page" },
  { key: "editScript",      label: "Edit beat plan",          hint: "The beat-by-beat plan / shot list textarea" },
  { key: "editVoiceover",   label: "Edit voiceover",          hint: "The voiceover script field on a reel" },
  { key: "removeFootage",   label: "Remove attached footage", hint: "The ✕ button that detaches a clip from a reel" },
  { key: "moveReel",        label: "Move reel cards between stages", hint: "Drag/drop or stage dropdown to move a reel between workflow stages" },
  { key: "moveToCompleted", label: "Move cards to Completed",  hint: "Drag/drop or dropdown to move a card into the Completed stage" },
  { key: "editReelId",      label: "Edit Reel ID (display number)", hint: "Inline-edit the display number of a reel in list view" },
  { key: "bulkMoveReels",   label: "Bulk move / assign reels", hint: "Select multiple reels and move/assign them at once in list view" },
  { key: "tagReelSkills",   label: "Tag reels with syllabus skills", hint: "The skill-tag picker on a reel's detail page (links a reel to a Training module)" },
  { key: "gradeRubric",     label: "Grade Gamify rubric",     hint: "Set Junior Editor/Skilled Editor/Professional per skill on a reel — awards XP" },
  { key: "editManual",      label: "Edit the training manual", hint: "Inline-edit the Training course content (playbook prose, checklists, examples, embeds). Off = read-only." },
];

/* Roles the owner can configure. `owner` is excluded — always full. */
export const EDITABLE_ROLES = [
  { key: "skilled",  label: "Skilled Editor" },
  { key: "variant",  label: "Variant Editor" },
  { key: "reviewer", label: "Reviewer" },
];

/* =========================================================
   DEMO role — the shared testuser@gmail.com feedback account.

   Unlike the editable roles, demo is NOT configured from the admin
   matrix and is FAIL-CLOSED: anything not explicitly allowed below
   is denied. It is enforced directly in permissions.jsx (not merged
   into the stored config) so it can't be loosened by accident.

   Friends should be able to browse the core dashboard and *try*
   editing (their changes live only in the per-session sandbox, never
   the DB), but owner/infra/AI-cost surfaces stay hidden.
   ========================================================= */
export const DEMO_VIEWS = new Set([
  "mywork", "pipeline", "detail", "footage", "editor", "lossless",
  "export", "analytics", "inbox", "locations", "coverage", "reeldna",
  // hidden on purpose: generate (paid AI), training, activity,
  // resources, monitor, ai, settings
]);

export const DEMO_ACTIONS = new Set([
  "createReel", "archiveReel", "approveReview", "attachFootage",
  "changeCardColor", "editLogline", "editScript", "editVoiceover",
  "removeFootage", "moveReel", "moveToCompleted", "selfAssessRubric",
  // hidden on purpose: deleteReel, editReelId, bulkMoveReels, tagReelSkills,
  // gradeRubric (grading is owner/reviewer authority)
]);

/* Default permission set for one role — mirrors current behavior:
     · every tab visible
     · every action allowed EXCEPT the two that are gated today:
         deleteReel  → owner only           → false for everyone here
         approveReview → owner + reviewer    → true only for reviewer
   Anything not listed falls back to allowed (fail-open) so a missing
   or partial config can never lock a user out. */
export function defaultPermsForRole(roleKey) {
  const views = {};
  for (const v of VIEW_CAPS) views[v.key] = true;
  views.activity = false; // private monitoring tab — owner enables per-person
  views.monitor  = false; // infra usage — owner only
  views.pulse    = false; // real-time alerts — owner only
  views.ai       = false; // AI Brain — owner only

  const actions = {};
  for (const a of ACTION_CAPS) actions[a.key] = true;
  actions.deleteReel = false;
  actions.approveReview = roleKey === "reviewer";
  actions.moveToCompleted = false; // owner enables per-person if needed
  actions.editReelId = false;      // owner only
  actions.bulkMoveReels = false;   // owner only by default
  actions.editManual = false;      // training manual is owner-authored; owner grants edit per-person

  /* Gamify rubric grading mirrors review authority: only the reviewer
     role grades (Junior Editor/Skilled Editor/Professional → XP). Editors self-assess. */
  actions.gradeRubric = roleKey === "reviewer";

  /* Editors (skilled + variant) are READ-ONLY on creative fields and card
     styling by default — they execute the edit; the owner shapes the brief.
     These are new keys (editLogline/editScript/editVoiceover/removeFootage)
     plus the existing changeCardColor, all flipped off for editor roles.
     The owner can re-enable any of them per-role or per-person in the admin. */
  if (roleKey === "skilled" || roleKey === "variant") {
    actions.changeCardColor = false;
    actions.editLogline     = false;
    actions.editScript      = false;
    actions.editVoiceover   = false;
    actions.removeFootage   = false;
    actions.tagReelSkills   = false;   // owner curates which skills a reel teaches
  }

  return { views, actions };
}

/* The full default config keyed by role. */
export function defaultConfig() {
  const cfg = {};
  for (const r of EDITABLE_ROLES) cfg[r.key] = defaultPermsForRole(r.key);
  return cfg;
}

/* Default permissions for a person given their role key.
   Used to seed a person-level config entry on first toggle. */
export function defaultPermsForPerson(roleKey) {
  return defaultPermsForRole(roleKey || "skilled");
}
