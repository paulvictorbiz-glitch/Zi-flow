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

/* ─────────────────────────────────────────────────────────
   Metallic cube palette (gold / silver / bronze). Tiles are
   assigned a metal by a stable hash of their face key, so each
   side reads as a coordinated metal without per-tile churn. */
export const METAL = {
  gold:   { color: "#d4af37", metalness: 0.92, roughness: 0.28 },
  silver: { color: "#c8ccd0", metalness: 0.95, roughness: 0.22 },
  bronze: { color: "#b08d57", metalness: 0.88, roughness: 0.34 },
};
export const METAL_KEYS = ["gold", "silver", "bronze"];
export function metalForKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return METAL_KEYS[Math.abs(h) % METAL_KEYS.length];
}

/* Continuous-zoom camera thresholds (world units of camera distance
   from origin). MIN/MAX clamp OrbitControls dolly; D_NEAR/D_FAR mark
   the stacked↔assembled↔free zone boundaries; HYST is the deadband
   that prevents flicker at a boundary; START is the initial distance. */
export const CAM = { MIN: 4.5, MAX: 60, D_NEAR: 6.8, D_FAR: 16, HYST: 1.1, START: 9 };

/* ─────────────────────────────────────────────────────────
   SCENE — placement of the decorative deep-space set-pieces.

   The cube sits at the origin (~±2 units). Set-pieces live on a
   30–200 unit shell, deliberately spread across ALL octants so the
   scene reads well from every orbit angle (the "engaging from all
   sides" goal). Positions are data here so they can be retuned in one
   place; the L1 components import these instead of hard-coding.
   Still pure data — no three.js / React. */
export const SCENE = {
  galaxyCenter:    [0, 0, -140],                                  // Sgr A* (Galaxy.jsx) — far −z
  binaryBlackHole: { position: [-66, -14, 34], scale: 1.0, tilt: [1.02, 0, 0.18] }, // −x −y +z
  pulsar:          { position: [46, 30, -38], scale: 1.1, tilt: [0.25, 0, 0.12] },   // +x +y −z
  fleet:           { position: [-34, 24, 26], scale: 0.85 },      // −x +y +z (front-left-up)
  nebula:          [-90, 18, -110],                               // existing
};

/* 360° ambient events — small, cheap, billboard/sprite-based pieces
   scattered across the far shell so no viewing angle is empty. */
export const AMBIENT = [
  { key: "gal1",  kind: "galaxy",       position: [155, 64, -110],  scale: 40, color: "#9bb8ff", spin: 0.020 },
  { key: "gal2",  kind: "galaxy",       position: [-165, -44, 92],  scale: 48, color: "#ffc6a0", spin: -0.015 },
  { key: "gal3",  kind: "galaxy",       position: [118, -96, 150],  scale: 32, color: "#c8a6ff", spin: 0.028 },
  { key: "gal4",  kind: "galaxy",       position: [-120, 96, 60],   scale: 28, color: "#a6ffe0", spin: -0.022 },
  { key: "comet1", kind: "comet",       position: [82, 52, 44],     dir: [-1, -0.4, -0.5], speed: 9,  color: "#bfe6ff", span: 150 },
  { key: "comet2", kind: "comet",       position: [-92, -30, -60],  dir: [0.7, 0.5, 0.6],  speed: 7,  color: "#d9fff0", span: 150 },
  { key: "comet3", kind: "comet",       position: [24, -84, 72],    dir: [0.2, 1, -0.3],   speed: 11, color: "#fff0c0", span: 150 },
  { key: "nova",   kind: "supernova",   position: [-124, 72, -34],  scale: 11, color: "#ffe2a8", period: 13 },
  { key: "flyby",  kind: "ringedPlanet", position: [40, -24, 50],   scale: 4.4, color: "#cda06a", ringColor: "#e8d2a0" },

  // ── extra fill so no octant is empty from any orbit angle ──
  { key: "gal5",  kind: "galaxy",       position: [70, 120, 90],    scale: 34, color: "#ffd9a0", spin: 0.018 },
  { key: "gal6",  kind: "galaxy",       position: [-70, -120, -90], scale: 36, color: "#a0c0ff", spin: -0.024 },
  { key: "gal7",  kind: "galaxy",       position: [180, -20, -60],  scale: 30, color: "#d8b0ff", spin: 0.02 },
  { key: "comet4", kind: "comet",       position: [-60, 90, 30],    dir: [0.6, -1, 0.3],   speed: 8,  color: "#cfeaff", span: 160 },
  { key: "comet5", kind: "comet",       position: [110, -10, -90],  dir: [-0.8, 0.2, 0.7], speed: 10, color: "#fff4d0", span: 170 },
  { key: "nova2",  kind: "supernova",   position: [90, 50, -120],   scale: 9,  color: "#a8d8ff", period: 17 },
  { key: "flyby2", kind: "ringedPlanet", position: [-50, 40, 70],   scale: 3.4, color: "#8a6fb0", ringColor: "#cdbce8" },
  { key: "flyby3", kind: "ringedPlanet", position: [60, -70, -30],  scale: 5.2, color: "#6f9bb0", ringColor: "#b0d4e0" },
];

/* ─────────────────────────────────────────────────────────
   QUALITY tiers — particle counts + per-tier bloom flag. The
   mobile/low-core gate (computed in Galaxy.jsx) and reduced-motion
   pick a tier so the scene scales down on weak hardware. */
export const QUALITY = {
  high: { distantStars: 5200, diskParticles: 6000, nearStars: 1200, bhDisk: 2600, jetParticles: 700, shootingStars: 6, bloom: true },
  mid:  { distantStars: 2800, diskParticles: 3200, nearStars: 700,  bhDisk: 1400, jetParticles: 360, shootingStars: 3, bloom: true },
  low:  { distantStars: 1200, diskParticles: 1600, nearStars: 420,  bhDisk: 700,  jetParticles: 0,   shootingStars: 1, bloom: false },
};

/* Pure tier selector (no window access — caller passes the booleans). */
export function pickQuality({ mobile = false, lowCore = false, reduced = false } = {}) {
  if (reduced || lowCore) return "low";
  if (mobile) return "mid";
  return "high";
}
