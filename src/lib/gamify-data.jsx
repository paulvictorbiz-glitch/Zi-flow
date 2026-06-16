/* =========================================================
   Gamify — canonical data source of truth.

   The 10 skills here are THE consistent skill set across the whole
   app: the spider chart (10 axes), reel skill_tags, the rubric sheet
   on each reel, and the training modules all key off GAMIFY_SKILLS.

   Ordered as a beginner→advanced editor learning progression. The
   index in this array is the spider-chart axis order (axis 0 at the
   top, going clockwise).

   XP model (computed in the store, constants here):
     · A reel awards XP per skill from the reviewer grade:
         average=10, decent=20, excellent=35.
     · A skill's spider score (0–100) = min(100, cumulativeXP / 5),
       i.e. ~14 "excellent" reels in a skill maxes that axis.
     · total_xp is the sum across all skills; it drives the level
       ladder (XP_LEVELS) and reward unlocks.
     · Medals unlock off the spider chart filling (see MEDAL_TIERS).
   ========================================================= */

/* The 10 canonical skills, in chart-axis order (top, clockwise). */
export const GAMIFY_SKILLS = [
  { key: "cutting-pacing",        label: "Cutting & Pacing",        short: "Cutting",     icon: "✂️" },
  { key: "storytelling",          label: "Storytelling",            short: "Story",       icon: "📖" },
  { key: "captions-text",         label: "Captions & Text",         short: "Captions",    icon: "🔤" },
  { key: "audio-engineering",     label: "Audio Engineering",       short: "Audio",       icon: "🔊" },
  { key: "keyframing",            label: "Keyframing",              short: "Keyframes",   icon: "🎚️" },
  { key: "special-effects",       label: "Special Effects",         short: "FX",          icon: "💥" },
  { key: "color-grading",         label: "Color Grading",           short: "Color",       icon: "🎨" },
  { key: "motion-graphics",       label: "Motion Graphics",         short: "Motion",      icon: "✨" },
  { key: "reels-retention",       label: "Reels & Retention",       short: "Reels",       icon: "📱" },
  { key: "workflow-organization", label: "Workflow & Organization", short: "Workflow",    icon: "📋" },
];

export const SKILL_KEYS = GAMIFY_SKILLS.map(s => s.key);

/* Fast lookup: key → skill object. */
export const SKILL_BY_KEY = Object.fromEntries(GAMIFY_SKILLS.map(s => [s.key, s]));

/* ---------- XP / scoring constants ---------- */
export const XP_PER_GRADE = { average: 10, decent: 20, excellent: 35 };

/* Spider score per skill = min(100, cumulativeXP / SCORE_DIVISOR). */
export const SCORE_DIVISOR = 5;

export function scoreForSkillXp(xp) {
  return Math.max(0, Math.min(100, Math.round((xp || 0) / SCORE_DIVISOR)));
}

/* ---------- Level ladder (pool-billiards style, no end point) ----------
   Levels keep climbing; the UI only ever shows the current + next 2 so
   there's no visible cap. After the explicit rungs, levels extend by a
   fixed +800 XP step (see levelForXp). */
export const XP_LEVELS = [
  { level: 1,  xp: 0,    title: "Apprentice" },
  { level: 2,  xp: 100,  title: "Cutter" },
  { level: 3,  xp: 250,  title: "Storyteller" },
  { level: 4,  xp: 500,  title: "Craftsman" },
  { level: 5,  xp: 900,  title: "Artisan" },
  { level: 6,  xp: 1400, title: "Senior Editor" },
  { level: 7,  xp: 2000, title: "Director's Cut" },
  { level: 8,  xp: 2800, title: "Showrunner" },
  { level: 9,  xp: 3800, title: "Auteur" },
  { level: 10, xp: 5000, title: "Legend" },
];

const STEP_AFTER_LADDER = 1400; // XP per level once past the explicit rungs

/* Resolve {current, next, nextNext, progress} for a given total XP.
   `progress` is 0..1 within the current level band — drives the EXP bar.
   Never returns a null `next` (levels are endless) so the bar always fills
   toward something. */
export function levelForXp(totalXp) {
  const xp = Math.max(0, totalXp || 0);

  // Synthesize an endless ladder a few rungs past the explicit list.
  const ladder = [...XP_LEVELS];
  let last = ladder[ladder.length - 1];
  for (let i = 1; i <= 6; i++) {
    last = { level: last.level + 1, xp: last.xp + STEP_AFTER_LADDER, title: "Legend " + (i + 1) };
    ladder.push(last);
  }

  let current = ladder[0];
  for (const l of ladder) if (xp >= l.xp) current = l;
  const ci = ladder.indexOf(current);
  const next = ladder[ci + 1] || null;
  const nextNext = ladder[ci + 2] || null;

  const bandStart = current.xp;
  const bandEnd = next ? next.xp : current.xp + STEP_AFTER_LADDER;
  const progress = bandEnd > bandStart
    ? Math.max(0, Math.min(1, (xp - bandStart) / (bandEnd - bandStart)))
    : 1;

  return { current, next, nextNext, progress, xpIntoBand: xp - bandStart, bandSize: bandEnd - bandStart };
}

/* ---------- Reward unlocks ----------
   Boxed perks that unlock as the EXP bar crosses level thresholds.
   `id` is stored in gamify_progress.unlocked_rewards once earned. */
export const REWARDS = [
  { id: "reel-border-color", level: 3, label: "Reel border colors",   blurb: "Recolor your reel cards in My Workspace" },
  { id: "reorder-cards",     level: 5, label: "Reorder dashboard",     blurb: "Drag to reorder your dashboard cards" },
  { id: "profile-badge",     level: 7, label: "Custom profile badge",  blurb: "Pick a badge shown next to your name" },
  { id: "theme-accent",      level: 9, label: "Theme accent color",    blurb: "Set your own accent color across the app" },
];

/* ---------- Medal tiers ----------
   Medals unlock off the spider chart filling out (well-roundedness),
   independent of raw XP. `count` = how many skills must be ≥ `minScore`.
   When a tier unlocks the chart "resets toward" the next tier in the UI
   (the fill is shown relative to the next tier's threshold). */
export const MEDAL_TIERS = [
  { id: "bronze", title: "Junior Editor",       color: "#cd7f32", count: 5,  minScore: 50 },
  { id: "silver", title: "Intermediate Editor", color: "#c0c0c0", count: 10, minScore: 50 },
  { id: "gold",   title: "Master Editor",       color: "#ffd700", count: 10, minScore: 80 },
];

/* Resolve the earned medal id ('none'|'bronze'|'silver'|'gold') from a
   scores map { skillKey: 0..100 }. Returns the highest tier whose
   condition is met. */
export function medalForScores(scores) {
  const vals = SKILL_KEYS.map(k => Number(scores?.[k] || 0));
  let earned = "none";
  for (const tier of MEDAL_TIERS) {
    const meets = vals.filter(v => v >= tier.minScore).length >= tier.count;
    if (meets) earned = tier.id;
  }
  return earned;
}

/* Progress (0..1) toward the NEXT medal tier above the current one —
   drives the medal silhouette fill. */
export function medalProgress(scores) {
  const current = medalForScores(scores);
  const idx = MEDAL_TIERS.findIndex(t => t.id === current);
  const target = MEDAL_TIERS[idx + 1] || MEDAL_TIERS[MEDAL_TIERS.length - 1];
  const vals = SKILL_KEYS.map(k => Number(scores?.[k] || 0));
  const meeting = vals.filter(v => v >= target.minScore).length;
  return { current, target, progress: Math.max(0, Math.min(1, meeting / target.count)) };
}

/* =========================================================
   RUBRIC — per-skill assessment sheet.

   Each skill has sub-skills; each sub-skill has checklist items the
   editor self-assesses against. The three columns (Average / Decent /
   Excellent) describe the quality bands the reviewer grades on.

   Shape:
     RUBRIC[skillKey] = {
       label,
       subskills: [
         { id, label, items: ["checklist item", ...] }
       ]
     }
   ========================================================= */
export const RUBRIC_COLUMNS = ["Average", "Decent", "Excellent"];

export const RUBRIC = {
  "cutting-pacing": {
    label: "Cutting & Pacing",
    subskills: [
      { id: "clean-cuts",   label: "Clean Cuts",        items: ["No accidental frames left in", "Cuts land on action/beat"] },
      { id: "rhythm",       label: "Rhythm & Tempo",    items: ["Cut length matches energy", "Pacing varies with mood"] },
      { id: "trim-tight",   label: "Tight Trimming",    items: ["No dead air between lines", "Dead weight removed"] },
      { id: "continuity",   label: "Continuity",        items: ["Action matches across cuts", "No jarring jump cuts (unless intentional)"] },
    ],
  },
  "storytelling": {
    label: "Storytelling",
    subskills: [
      { id: "hook",         label: "Hook",              items: ["Strong 3–5s opening", "Reason to keep watching established"] },
      { id: "arc",          label: "Story Arc",         items: ["Clear beginning/middle/end", "Builds toward a payoff"] },
      { id: "shot-order",   label: "Shot Selection",    items: ["Best shots chosen", "Order serves the story"] },
      { id: "emotion",      label: "Emotional Beats",   items: ["Highs and lows land", "Resolution feels earned"] },
    ],
  },
  "captions-text": {
    label: "Captions & Text",
    subskills: [
      { id: "readable",     label: "Readability",       items: ["Legible size & contrast", "On screen long enough to read"] },
      { id: "sync",         label: "Sync to Speech",    items: ["Captions match audio timing", "No lag or lead"] },
      { id: "style",        label: "Style Consistency", items: ["Consistent font & color", "Safe-area positioning"] },
      { id: "emphasis",     label: "Emphasis Text",     items: ["Key words highlighted", "Pop-ins timed to delivery"] },
    ],
  },
  "audio-engineering": {
    label: "Audio Engineering",
    subskills: [
      { id: "normalize",    label: "Normalize Levels",  items: ["Adjusted to standard dB range", "No clipping on peaks"] },
      { id: "blend",        label: "Blending Tracks",   items: ["Seamless transitions between tracks", "Cross-fades applied"] },
      { id: "sfx",          label: "Add SFX",           items: ["Risers, wooshes, hits placed", "SFX timed to cuts"] },
      { id: "bgm",          label: "Background Music",  items: ["Matches video tone", "Ducked under dialogue"] },
      { id: "env-noise",    label: "Environmental Noise", items: ["Ambient beds added (city, room tone)", "Consistent across cuts"] },
    ],
  },
  "keyframing": {
    label: "Keyframing",
    subskills: [
      { id: "smooth",       label: "Smooth Curves",     items: ["Ease in/out applied", "No robotic linear motion"] },
      { id: "scale-pan",    label: "Scale & Pan",       items: ["Punch-ins motivated", "Movement is purposeful"] },
      { id: "tracking",     label: "Tracking",          items: ["Elements stick to subject", "No drift over time"] },
      { id: "timing",       label: "Timing",            items: ["Keyframes hit the beat", "No overshoot artifacts"] },
    ],
  },
  "special-effects": {
    label: "Special Effects",
    subskills: [
      { id: "transitions",  label: "Transitions",       items: ["Transitions fit the cut", "Not overused"] },
      { id: "zooms",        label: "Zooms & Punches",   items: ["Zoom timed to audio hit", "Speed feels natural"] },
      { id: "speed",        label: "Speed Ramps",       items: ["Ramps are smooth", "Slow-mo footage holds up"] },
      { id: "overlays",     label: "Overlays & Glows",  items: ["Overlays blended cleanly", "Effects enhance, not distract"] },
    ],
  },
  "color-grading": {
    label: "Color Grading",
    subskills: [
      { id: "exposure",     label: "Exposure & Contrast", items: ["Correctly exposed", "Contrast set for depth"] },
      { id: "wb",           label: "White Balance",     items: ["Neutral whites", "Skin tones natural"] },
      { id: "match",        label: "Shot Matching",     items: ["Shots match across the edit", "No jarring color shifts"] },
      { id: "look",         label: "Creative Look",     items: ["LUT/filter suits the mood", "Grade feels cinematic"] },
    ],
  },
  "motion-graphics": {
    label: "Motion Graphics",
    subskills: [
      { id: "text-anim",    label: "Text Animation",    items: ["Animated titles feel polished", "Custom keyframes, not just presets"] },
      { id: "masking",      label: "Masking & Reveals", items: ["Clean mask edges", "Reveals timed to content"] },
      { id: "shapes",       label: "Shape Graphics",    items: ["Location tags / lower-thirds clean", "On-brand style"] },
      { id: "integration",  label: "Scene Integration", items: ["Graphics sit in the scene", "Lighting/perspective respected"] },
    ],
  },
  "reels-retention": {
    label: "Reels & Retention",
    subskills: [
      { id: "hook-first",   label: "Hook-First Structure", items: ["3–5s hook stops the scroll", "Promise delivered"] },
      { id: "rapid",        label: "Rapid Pacing",      items: ["Tight cuts, no lulls", "Speed ramps for energy"] },
      { id: "cta",          label: "On-Screen CTA",     items: ["Clear call-to-action", "Captions drive watch time"] },
      { id: "export",       label: "Platform Export",   items: ["Correct aspect ratio (9:16)", "Bitrate/codec optimized for IG"] },
    ],
  },
  "workflow-organization": {
    label: "Workflow & Organization",
    subskills: [
      { id: "project-org",  label: "Project Organization", items: ["Folders & naming conventions", "Assets managed cleanly"] },
      { id: "timeline",     label: "Timeline Management", items: ["Multi-track layout is tidy", "Markers used for navigation"] },
      { id: "revisions",    label: "Revision Handling", items: ["Versioned saves", "Feedback addressed systematically"] },
      { id: "delivery",     label: "Export & Delivery", items: ["Export presets correct", "Delivery checklist followed"] },
    ],
  },
};

/* Max XP a reel can award if completed with the given skill tags graded
   at "excellent". Used for the green "+XP" preview badge on cards. */
export function maxXpForSkills(skillKeys = []) {
  return (skillKeys || []).length * XP_PER_GRADE.excellent;
}

/* ---------- Per-sub-skill grading (one grade per rubric row) ----------
   reviewer_grades is a map { subId: 'average'|'decent'|'excellent' }.
   A skill's XP is the AVERAGE of its graded sub-skills' grade-XP, so the
   per-skill maximum stays ~XP_PER_GRADE.excellent regardless of how many
   sub-skills a skill has. Ungraded rows don't count toward the average. */
export function xpForSkillGrades(gradesMap) {
  const vals = Object.values(gradesMap || {})
    .map(g => XP_PER_GRADE[g] || 0)
    .filter(v => v > 0);
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/* Default difficulty (0..100) for a freshly-tagged skill, before the admin
   drags it. Derived from how many sub-skills the rubric has (more = harder)
   so the axis is visible and sensible from the start. */
export function defaultDifficulty(skillKey) {
  const subs = RUBRIC[skillKey]?.subskills?.length || 1;
  return Math.min(100, 25 + subs * 6);
}

/* A reel's per-skill difficulty profile (0..100) for the card's spider chart.
   The admin drags these points; the value IS the difficulty. Falls back to
   defaultDifficulty for any tagged skill the admin hasn't set yet. */
export function reelSkillProfile(skillKeys = [], difficultyMap = {}) {
  const out = {};
  for (const key of skillKeys) {
    out[key] = key in (difficultyMap || {})
      ? Math.max(0, Math.min(100, Number(difficultyMap[key])))
      : defaultDifficulty(key);
  }
  return out;
}

/* ---------- Difficulty → XP multiplier ----------
   Dragging a point toward the center (low difficulty) shrinks the XP a skill
   awards; dragging outward (high difficulty) grows it. Difficulty 0..100 maps
   linearly onto DIFF_MIN_MULT..DIFF_MAX_MULT, with 50 ≈ 1.0× (neutral). */
export const DIFF_MIN_MULT = 0.5;
export const DIFF_MAX_MULT = 2.0;

export function difficultyMultiplier(difficulty) {
  const d = Math.max(0, Math.min(100, Number(difficulty ?? 50)));
  return DIFF_MIN_MULT + (d / 100) * (DIFF_MAX_MULT - DIFF_MIN_MULT);
}

/* XP a skill awards given its graded rows AND its reel difficulty. */
export function xpForSkillGradesWithDifficulty(gradesMap, difficulty) {
  return Math.round(xpForSkillGrades(gradesMap) * difficultyMultiplier(difficulty));
}

/* ---------- Editor lock ----------
   A reel is freely reassignable while it's in an early "planning" stage
   (idea / not_started). Once an editor starts work (in_progress, review,
   completed, posted) OR any gamify XP has been graded on it, it LOCKS to
   its current owner so XP attribution stays clean. The owner can still
   override with confirmation; editors are hard-blocked. */
const UNLOCKED_STAGES = new Set(["idea", "selected", "not_started"]);

export function isReelLocked(reel, rubricRows = []) {
  if (!reel) return false;
  const stageLocked = !UNLOCKED_STAGES.has(reel.stage);
  const graded = rubricRows.some(r =>
    r.reelId === reel.id && Object.keys(r.reviewerGrades || {}).length > 0);
  return stageLocked || graded;
}
