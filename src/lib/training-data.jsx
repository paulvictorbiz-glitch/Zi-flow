/* =========================================================
   Training curriculum — static source of truth for the Training tab.

   Transcribed from `Training Course Syllabus.md` (3-month CapCut Pro
   editing course). Each module is a self-contained unit with a checklist
   of lessons, objectives, a practical exercise, and a milestone. The
   `skill` key is the canonical tag written onto reels (reels.skill_tags),
   so a real production reel can be flagged as practice for that module.

   To add tutorial links: paste them into a module's `videos` array as
   { label, url, kind }. kind 'youtube' renders an inline embed; kind 'ig'
   renders an outbound button (Instagram can't be iframe-embedded).

   Levels gate off how many of the 12 modules are complete — they drive
   the EXP/level label in the Training header.

   NOTE: the 12 curriculum modules below stay as the teaching structure,
   but the exported SKILLS list (further down) re-keys onto the 10
   canonical Gamify skills via MODULE_TO_GAMIFY_SKILL, so reel tags, the
   spider chart, and the rubric all share ONE skill set.
   ========================================================= */

import { GAMIFY_SKILLS } from "./gamify-data.jsx";

export const MODULES = [
  /* ── Month 1 — Foundations ───────────────────────────────────── */
  {
    id: "m1", month: 1, week: 1,
    title: "Interface & Basic Editing",
    skill: "basic-editing",
    skillLabel: "Basic editing",
    lessons: [
      "Navigating CapCut Pro: timeline, preview, tools.",
      "Importing clips, frames/fps/resolution settings.",
      "Cutting, trimming, splitting, joining clips.",
      "Adding music, titles, basic transitions.",
      "Exporting settings (formats, quality, bitrates).",
    ],
    objectives: [
      "Safely import/export and perform non-destructive cuts.",
      "Apply basic titles and transitions.",
    ],
    exercise: "Edit a 20–30 second clip with music, text, and transitions.",
    milestone: "Deliver a 30-second \"mini edit\" for review.",
    videos: [],
  },
  {
    id: "m2", month: 1, week: 2,
    title: "Story Structure & Pacing",
    skill: "story-pacing",
    skillLabel: "Story & pacing",
    lessons: [
      "Story beats: hook → journey → climax → resolution.",
      "Shot selection and order for travel vlogs.",
      "Basic pacing: short cuts for energy, longer for mood.",
    ],
    objectives: ["Build a simple 3-part story arc."],
    exercise: "Reorder 5 travel clips into a story arc; add music and text.",
    milestone: "45-second travel \"mini-vlog\" draft.",
    videos: [],
  },
  {
    id: "m3", month: 1, week: 3,
    title: "Audio Basics & J/L Cuts",
    skill: "audio-jl-cuts",
    skillLabel: "Audio & J/L cuts",
    lessons: [
      "Volume balancing, mute, ducking.",
      "J-cuts and L-cuts for smooth audio transitions.",
      "Basic audio cleanup (noise reduction in CapCut).",
    ],
    objectives: ["Apply J/L cuts and balance audio levels."],
    exercise: "Edit a 40-second clip with J/L cuts and balanced audio.",
    milestone: "40-second \"audio-smooth\" edit.",
    videos: [],
  },
  {
    id: "m4", month: 1, week: 4,
    title: "Transitions, Stabilization & Speed",
    skill: "transitions-speed",
    skillLabel: "Transitions & speed",
    lessons: [
      "CapCut transitions (cross-dissolve, zoom, slide).",
      "Stabilization tool and how to avoid shaky footage.",
      "Speed curves: custom ramps, slow/fast motion.",
    ],
    objectives: ["Stabilize shaky clips and apply speed ramps."],
    exercise: "Stabilize 2 clips, add speed ramps, and a transition.",
    milestone: "50-second \"stabilized + speed\" edit.",
    videos: [],
  },

  /* ── Month 2 — Intermediate Storytelling & Cinematics ────────── */
  {
    id: "m5", month: 2, week: 5,
    title: "B-Roll, Coverage & J/L Cut Mastery",
    skill: "broll-coverage",
    skillLabel: "B-roll & coverage",
    lessons: [
      "B-roll purpose: context, detail, emotion.",
      "Coverage strategy: main shot + B-roll layers.",
      "J/L cut refinement and multi-layer audio.",
    ],
    objectives: ["Build layered shots with B-roll and refined J/L cuts."],
    exercise: "Edit a 60-second travel vlog segment with B-roll and J/L cuts.",
    milestone: "60-second travel vlog draft.",
    videos: [],
  },
  {
    id: "m6", month: 2, week: 6,
    title: "Color Correction & Basic Grading",
    skill: "color-grading",
    skillLabel: "Color & grading",
    lessons: [
      "Exposure, contrast, saturation, white balance.",
      "Using CapCut's color tools and LUTs (basic).",
      "Matching shots for consistent look.",
    ],
    objectives: ["Correct exposure and apply basic LUTs for consistency."],
    exercise: "Correct 5 travel clips and apply a LUT for a cohesive look.",
    milestone: "60-second \"color-corrected\" travel vlog.",
    videos: [],
  },
  {
    id: "m7", month: 2, week: 7,
    title: "Sound Design & Layering",
    skill: "sound-design",
    skillLabel: "Sound design",
    lessons: [
      "Layering ambience, music, and Foley.",
      "Building sound textures (wind, footsteps, city noise).",
      "Syncing sound to action and pacing.",
    ],
    objectives: ["Construct multi-layer sound design for travel scenes."],
    exercise: "Add ambience + Foley + music to a 50-second clip; sync to action.",
    milestone: "50-second \"sound-rich\" travel edit.",
    videos: [],
  },
  {
    id: "m8", month: 2, week: 8,
    title: "Motion Graphics, Text Animation & Masking",
    skill: "motion-graphics",
    skillLabel: "Motion graphics",
    lessons: [
      "Text animation presets and custom keyframes.",
      "Masking for overlays and shape reveals.",
      "Basic shape graphics and animated location tags.",
    ],
    objectives: ["Create animated text and simple masking overlays."],
    exercise: "Add animated location tags and a masked reveal to a 60-second clip.",
    milestone: "60-second \"motion graphics\" travel vlog.",
    videos: [],
  },

  /* ── Month 3 — Advanced Projects & Long-Form Workflow ────────── */
  {
    id: "m9", month: 3, week: 9,
    title: "Cinematic IG Reels — Editing for Retention",
    skill: "reels-retention",
    skillLabel: "Reels & retention",
    lessons: [
      "Hook-first structure (3–5s hook).",
      "Rapid cuts, dynamic transitions, and speed ramps for reels.",
      "On-screen text, captions, and call-to-action.",
      "Export settings for Instagram (aspect ratio, bitrate, codec).",
    ],
    objectives: ["Build a 15–30s cinematic reel optimized for retention."],
    exercise: "Edit a 20-second travel reel with hook, speed ramps, captions.",
    milestone: "20-second cinematic IG reel draft.",
    videos: [],
  },
  {
    id: "m10", month: 3, week: 10,
    title: "Documentary Structure & Pacing",
    skill: "documentary-pacing",
    skillLabel: "Documentary pacing",
    lessons: [
      "Documentary beats: intro → problem → journey → resolution.",
      "Interview editing: J/L cuts, B-roll, audio cleanup.",
      "Pacing for long-form: rhythm, silence, and emphasis.",
    ],
    objectives: ["Structure a 2–3 minute documentary segment."],
    exercise: "Edit a 2-minute documentary clip with interview + B-roll.",
    milestone: "2-minute documentary draft.",
    videos: [],
  },
  {
    id: "m11", month: 3, week: 11,
    title: "Long-Form Workflow & Organization",
    skill: "longform-workflow",
    skillLabel: "Long-form workflow",
    lessons: [
      "Project organization: folders, naming conventions, asset management.",
      "Timeline management for long edits (multi-track, markers).",
      "Client workflow: revisions, versioning, feedback loops.",
      "Export presets for YouTube (aspect, bitrate, codec).",
    ],
    objectives: ["Manage a long-form project and handle revision cycles."],
    exercise: "Organize a 3-minute project folder, set markers, and create export presets.",
    milestone: "Organized 3-minute project ready for review.",
    videos: [],
  },
  {
    id: "m12", month: 3, week: 12,
    title: "Final Project — Complicated Long-Form Edit",
    skill: "final-longform",
    skillLabel: "Final long-form",
    lessons: [
      "Integrating all skills: story, color, sound, motion, pacing.",
      "Review and polish: cut redundancy, enhance emotional beats.",
      "Final export and delivery checklist.",
    ],
    objectives: ["Produce a polished 3–5 minute \"complicated long-form\" piece."],
    exercise: "Travel/YouTube documentary (3–5 min) with cinematic reels inserted: hook, interview, B-roll, color grade, layered sound, motion graphics, smooth pacing.",
    milestone: "3–5 minute long-form documentary + 20-second cinematic reel.",
    isFinal: true,
    videos: [],
  },
];

/* Month groupings — drive the scroll sections and the jump rail. */
export const MONTHS = [
  { month: 1, label: "Month 1 — Foundations",                  hint: "Cutting, audio, stabilization, transitions" },
  { month: 2, label: "Month 2 — Intermediate & Cinematics",    hint: "B-roll, color, sound design, motion graphics" },
  { month: 3, label: "Month 3 — Advanced & Long-Form",         hint: "Cinematic reels, documentary, long-form workflow" },
];

/* End-of-month checkpoints + final review, rendered after each month's
   modules. Keyed by the month they close out. */
export const CHECKPOINTS = {
  1: {
    title: "Month 1 Checkpoint — Foundations Reel",
    body: "Assemble the 3 mini-edits (Modules 1–4) into a 1–2 minute \"foundations reel\". Reviewed on: cuts accuracy, pacing, audio balance, stabilization, transitions.",
  },
  2: {
    title: "Month 2 Checkpoint — Cinematic Travel Vlog",
    body: "Produce a 1.5–2 minute travel vlog integrating B-roll, color, sound design, and motion graphics. Reviewed on story clarity, color consistency, sound layering, and motion graphics timing.",
  },
  3: {
    title: "Month 3 Checkpoint & Final Review",
    body: "Submit the final project + 20-second reel. Reviewed on story clarity, color consistency, sound design quality, motion graphics timing, pacing, and long-form workflow.",
  },
};

/* Map each curriculum module onto one of the 9 canonical Gamify skills.
   The 3-month course keeps its 12 pedagogical modules, but every reel
   tag, spider-chart axis, and rubric keys off the SAME 9 skills so the
   gamify layer and the training tab stay consistent. */
/* NOTE: training modules are NOT 1:1 with the rubric pillars — they map to
   the nearest canonical skill so reel tags / spider chart / rubric stay on
   one skill set. The training curriculum will be rebuilt separately. */
export const MODULE_TO_GAMIFY_SKILL = {
  m1:  "cutting-pacing",   // Interface & basic editing → cutting
  m2:  "story-creative",   // Story structure & pacing
  m3:  "audio-engineering",// Audio basics & J/L cuts
  m4:  "special-effects",  // Transitions, stabilization & speed
  m5:  "cutting-pacing",   // B-roll, coverage & J/L mastery
  m6:  "color-visual",     // Color correction & grading
  m7:  "audio-engineering",// Sound design & layering
  m8:  "motion-graphics",  // Motion graphics, text animation & masking
  m9:  "story-creative",   // Cinematic IG reels — retention/hook
  m10: "story-creative",   // Documentary structure & pacing
  m11: "revisions-time",   // Long-form workflow & organization
  m12: "revisions-time",   // Final project — long-form
};

/* Skill catalog — the single source the reel skill-tag picker and the
   Training tab both read. Re-exports the 9 canonical Gamify skills so
   the whole app shares one consistent skill set. Each entry keeps the
   `module`/`moduleTitle`/`week` of its FIRST representative curriculum
   module for the tooltip in the skill-tag picker. */
export const SKILLS = GAMIFY_SKILLS.map(s => {
  const repModuleId = Object.keys(MODULE_TO_GAMIFY_SKILL)
    .find(mid => MODULE_TO_GAMIFY_SKILL[mid] === s.key);
  const repModule = MODULES.find(m => m.id === repModuleId);
  return {
    key: s.key,
    label: s.label,
    icon: s.icon,
    module: repModule?.id || null,
    moduleTitle: repModule?.title || s.label,
    week: repModule?.week || 0,
  };
});

/* Level ladder — gates off completed-module count. The Training header
   shows the current level label + the next threshold. */
export const LEVELS = [
  { key: "apprentice",  label: "Apprentice",     min: 0,  blurb: "Learning the toolkit" },
  { key: "editor",      label: "Editor",         min: 4,  blurb: "Foundations locked in" },
  { key: "storyteller", label: "Storyteller",    min: 8,  blurb: "Cinematics & sound" },
  { key: "longform",    label: "Long-Form Pro",  min: 12, blurb: "Complex long-form ready" },
];

export const TOTAL_MODULES = MODULES.length;

/* Resolve the level for a given count of completed modules. */
export function levelForCount(count) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (count >= lvl.min) current = lvl;
  }
  const next = LEVELS.find(l => l.min > count) || null;
  return { current, next };
}

/* Assessment rubric (0–5 scale) — reference table shown at the bottom. */
export const RUBRIC = [
  { category: "Cuts & Pacing",            beginner: "Rough, inconsistent timing",   intermediate: "Clean cuts, basic pacing",     advanced: "Tight pacing, rhythm matches story" },
  { category: "Audio & J/L Cuts",         beginner: "Unbalanced, no J/L",           intermediate: "Balanced, some J/L",           advanced: "Polished audio, refined J/L cuts" },
  { category: "Color & Consistency",      beginner: "Overexposed, mismatched",      intermediate: "Corrected, consistent LUT",    advanced: "Grade feels cinematic, shots match" },
  { category: "Sound Design",             beginner: "Single layer, flat",           intermediate: "Multi-layer, basic Foley",     advanced: "Rich layers, synced to action/emotion" },
  { category: "Motion Graphics",          beginner: "Static text",                  intermediate: "Basic animation",              advanced: "Animated text, masking, overlays" },
  { category: "Workflow & Organization",  beginner: "Messy folders",                intermediate: "Organized, named",             advanced: "Professional workflow, markers, presets" },
];

/* Extract a YouTube video id from common URL shapes, for inline embeds. */
export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}
