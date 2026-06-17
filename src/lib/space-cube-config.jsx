/* =========================================================
   space-cube-config — L0 SINGLE SOURCE OF TRUTH for the 3D
   "Space" alternate homepage (owner-only, /space).

   Pure data + one tiny navigation helper. NO React, NO three.js,
   NO store imports here — presentation (L1) and composition (L2)
   consume this. Keeping it data-only is what lets the cube stay
   fully isolated from the rest of the app.

   Model:
     · FACES  — the 6 cube faces = 6 categories. Each gives a color
                + label used to tint/ group the page tiles and to
                build the left-hand menu.
     · PAGES  — the interactive tiles ("inner cubes"). Each maps to
                one app page: it carries a live-data `widget` id and
                a `link` (the AppShell `wb_view` key it opens). Tiles
                with link:null are "to be built" placeholders.

   All class names in L1/L2 use the `s3d-` prefix to avoid CSS
   collisions with the rest of the app.
   ========================================================= */

/* Gold reserved for the cube intersections / glow. */
export const GOLD = "#f5c266";
export const GOLD_BRIGHT = "#ffd86b";

/* Bluish-grey, alien-tech cube body. */
export const CUBE_BODY = "#26354c";
export const CUBE_EDGE = "#3c5274";

/* The 6 faces = 6 categories. `color` is a cool accent (gold stays
   reserved for the glowing intersections). */
export const FACES = [
  { key: "dashboard", label: "My Work & Dashboard",        color: "#7fd9ff", blurb: "What needs you now — work, activity, training." },
  { key: "social",    label: "Social & Platform Analytics", color: "#7aa6ff", blurb: "Reach, engagement and unreplied conversations across platforms." },
  { key: "content",   label: "Content Planning & Pipeline", color: "#a99bff", blurb: "Ideate, deconstruct and move reels down the pipeline." },
  { key: "footage",   label: "Footage & Production",        color: "#6bd6e0", blurb: "Library, editor, lossless cuts, coverage and delivery." },
  { key: "locations", label: "Locations",                   color: "#7fd49a", blurb: "The map of every place pinned for shoots." },
  { key: "intel",     label: "News & Algorithm Intel",      color: "#8a98ad", blurb: "Platform algorithm shifts and trend signals. (Coming soon.)" },
];

export const FACE_BY_KEY = Object.fromEntries(FACES.map(f => [f.key, f]));

/* The page tiles. `link` is the AppShell view key (localStorage
   `wb_view`) opened by "Open full page". `widget` selects the live
   mini-widget (L1 widget registry). `link:null` ⇒ placeholder. */
export const PAGES = [
  // ── My Work & Dashboard ───────────────────────────────
  { key: "mywork",   face: "dashboard", label: "My Work",   widget: "mywork",   link: "mywork",   blurb: "Your review queue and assigned reels." },
  { key: "activity", face: "dashboard", label: "Activity",  widget: "activity", link: "activity", blurb: "The live feed of everything happening." },
  { key: "training", face: "dashboard", label: "Training",  widget: "training", link: "training", blurb: "Skill modules and gamified progress." },

  // ── Social & Platform Analytics ───────────────────────
  { key: "analytics", face: "social", label: "Analytics", widget: "analytics", link: "analytics", blurb: "Views, engagement and trends." },
  { key: "inbox",     face: "social", label: "Inbox",     widget: "inbox",     link: "inbox",     blurb: "Unreplied comments and DMs." },
  { key: "monitor",   face: "social", label: "Monitor",   widget: "monitor",   link: "monitor",   blurb: "System and platform health." },

  // ── Content Planning & Pipeline ───────────────────────
  { key: "pipeline", face: "content", label: "Pipeline", widget: "pipeline", link: "pipeline", blurb: "Every reel by stage, end to end." },
  { key: "generate", face: "content", label: "Generate", widget: "generate", link: "generate", blurb: "AI concept and script generation." },
  { key: "reeldna",  face: "content", label: "Reel DNA",  widget: "reeldna",  link: "reeldna",  blurb: "Reverse-engineer any reel into its genes." },

  // ── Footage & Production ──────────────────────────────
  { key: "footage",  face: "footage", label: "Footage",  widget: "footage",  link: "footage",  blurb: "Browse and tag the clip library." },
  { key: "editor",   face: "footage", label: "Editor",   widget: "editor",   link: "editor",   blurb: "The editing workspace." },
  { key: "lossless", face: "footage", label: "Lossless", widget: "lossless", link: "lossless", blurb: "Lossless cutting tool." },
  { key: "export",   face: "footage", label: "Export",   widget: "export",   link: "export",   blurb: "Reel export and delivery." },
  { key: "coverage", face: "footage", label: "Coverage", widget: "coverage", link: "coverage", blurb: "Shot coverage / filming status." },

  // ── Locations ─────────────────────────────────────────
  { key: "locations", face: "locations", label: "Locations", widget: "locations", link: "locations", blurb: "Pins on the map for every place." },

  // ── News & Algorithm Intel (to be built) ──────────────
  { key: "news", face: "intel", label: "News",      widget: "soon", link: null, blurb: "Trend and news signals. Coming soon." },
  { key: "algo", face: "intel", label: "Algo Watch", widget: "soon", link: null, blurb: "Platform algorithm changes. Coming soon." },
];

export const PAGE_BY_KEY = Object.fromEntries(PAGES.map(p => [p.key, p]));

/* Navigation: open a page in the classic app. AppShell reads
   `wb_view` from localStorage on mount, so we set it then hand off
   to /app. This is the ONLY way the cube touches app state and it
   is a single, well-understood key. */
export function openInApp(view) {
  if (!view) return;
  try { localStorage.setItem("wb_view", view); } catch (_) {}
  window.location.assign("/app");
}
