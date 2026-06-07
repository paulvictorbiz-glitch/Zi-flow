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
  { key: "export",    label: "Export" },
  { key: "analytics", label: "Analytics" },
  { key: "locations", label: "Locations" },
  { key: "coverage",  label: "Coverage" },
  { key: "generate",  label: "Generate (AI · paid)" },
  { key: "activity",  label: "Activity (CapCut tracker)" },
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
];

/* Roles the owner can configure. `owner` is excluded — always full. */
export const EDITABLE_ROLES = [
  { key: "skilled",  label: "Skilled Editor" },
  { key: "variant",  label: "Variant Editor" },
  { key: "reviewer", label: "Reviewer" },
];

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

  const actions = {};
  for (const a of ACTION_CAPS) actions[a.key] = true;
  actions.deleteReel = false;
  actions.approveReview = roleKey === "reviewer";

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
