/* =========================================================
   Gamify — canonical data source of truth.

   The 9 skills here are THE consistent skill set across the whole
   app: the spider chart (9 axes), reel skill_tags, the rubric sheet
   on each reel, and the training modules all key off GAMIFY_SKILLS.

   Mirrors the "gold standard" reel-editing rubric: 6 Core Pillars
   followed by 3 Bonus Craft Pillars (`bonus: true`). The index in this
   array is the spider-chart axis order (axis 0 at the top, going
   clockwise).

   XP model (computed in the store, constants here):
     · A reel awards XP per skill from the reviewer grade:
         junior-editor=10, skilled-editor=20, professional=35.
     · A skill's spider score (0–100) = min(100, cumulativeXP / 5),
       i.e. ~14 "professional" reels in a skill maxes that axis.
     · total_xp is the sum across all skills; it drives the level
       ladder (XP_LEVELS) and reward unlocks.
     · Medals unlock off the spider chart filling (see MEDAL_TIERS).
   ========================================================= */

/* The 9 canonical skills, in chart-axis order (top, clockwise).
   First 6 are Core Pillars; last 3 are Bonus Craft Pillars. */
export const GAMIFY_SKILLS = [
  // Core Pillars
  { key: "cutting-pacing",      label: "Cutting & Pacing",            short: "Cutting",    icon: "✂️",  bonus: false },
  { key: "story-creative",      label: "Story & Creative Choices",    short: "Story",      icon: "📖",  bonus: false },
  { key: "audio-engineering",   label: "Audio Engineering",           short: "Audio",      icon: "🔊",  bonus: false },
  { key: "captions-text",       label: "Captions & Text",             short: "Captions",   icon: "🔤",  bonus: false },
  { key: "color-visual",        label: "Color & Visual Clarity",      short: "Color",      icon: "🎨",  bonus: false },
  { key: "revisions-time",      label: "Revisions & Time Management", short: "Revisions",  icon: "📋",  bonus: false },
  // Bonus Craft Pillars
  { key: "motion-graphics",     label: "Motion Graphics",             short: "Motion",     icon: "✨",  bonus: true  },
  { key: "special-effects",     label: "Special Effects",             short: "FX",         icon: "💥",  bonus: true  },
  { key: "thumbnails-branding", label: "Thumbnails & Branding",       short: "Thumbnails", icon: "🖼️", bonus: true  },
];

export const SKILL_KEYS = GAMIFY_SKILLS.map(s => s.key);

/* Fast lookup: key → skill object. */
export const SKILL_BY_KEY = Object.fromEntries(GAMIFY_SKILLS.map(s => [s.key, s]));

/* ---------- XP / scoring constants ----------
   Grade keys are the slugs stored in gamify_rubric.reviewer_grades. */
export const XP_PER_GRADE = { "junior-editor": 10, "skilled-editor": 20, "professional": 35 };

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
  { id: "bronze", title: "Reel Apprentice", color: "#cd7f32", count: 4, minScore: 50 },
  { id: "silver", title: "Reel Craftsman",  color: "#c0c0c0", count: 7, minScore: 50 },
  { id: "gold",   title: "Reel Auteur",     color: "#ffd700", count: 9, minScore: 80 },
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
   RUBRIC — per-skill assessment sheet (the "gold standard" rubric).

   Each skill has sub-skills. Each sub-skill carries:
     · items  — short checklist cues the editor self-assesses against
     · grades — the descriptive quality band per level the reviewer
                grades on (Junior Editor / Skilled Editor / Professional)

   Level intent:
     · Junior Editor — baseline competence with guidance; attempted but
       may be rough or inconsistent.
     · Skilled Editor — reliable production-level work; consistent and
       intentional with few major issues.
     · Professional — polished, client-ready, strong taste and efficiency;
       intentionally hard to reach.

   Shape:
     RUBRIC[skillKey] = {
       label, bonus?,
       subskills: [
         { id, label,
           items: ["checklist cue", ...],
           grades: { "junior-editor": "...", "skilled-editor": "...", "professional": "..." } }
       ]
     }
   ========================================================= */
export const RUBRIC_COLUMNS = ["Junior Editor", "Skilled Editor", "Professional"];

export const RUBRIC = {
  /* ---------- Core Pillars ---------- */
  "cutting-pacing": {
    label: "Cutting & Pacing",
    subskills: [
      { id: "clean-cuts", label: "Clean Cuts",
        items: ["Cuts land on action or beat", "No stray frames at cut points"],
        grades: {
          "junior-editor":  "Cuts are functional; occasional rough edges or slightly mistimed trims but video is watchable.",
          "skilled-editor": "Cuts feel deliberate and mostly invisible; very few distracting edits.",
          "professional":   "Cuts are razor-precise and invisible; timing feels effortless and highly intentional.",
        } },
      { id: "rhythm", label: "Rhythm & Tempo",
        items: ["Cut length matches energy", "Flow keeps viewers engaged"],
        grades: {
          "junior-editor":  "Basic rhythm; some sections drag or rush but overall flow exists.",
          "skilled-editor": "Rhythm supports the content; viewers stay engaged with minimal dead time.",
          "professional":   "Rhythm is dynamic and expertly tuned to emotion, music, and platform scroll behavior.",
        } },
      { id: "pacing", label: "Proper Pacing",
        items: ["Unnecessary pauses removed", "No obvious filler for the format"],
        grades: {
          "junior-editor":  "Keeps most unnecessary pauses out; some fluff remains.",
          "skilled-editor": "Pacing is tight for the format; little to no obvious filler.",
          "professional":   "Every second earns its place; pacing maximizes retention and impact for short-form.",
        } },
      { id: "jl-cuts", label: "J-Cuts / L-Cuts",
        items: ["Audio leads or lags across cuts", "Transitions feel smooth"],
        grades: {
          "junior-editor":  "Occasionally uses audio across cuts, sometimes awkwardly.",
          "skilled-editor": "Uses audio lead/lag to smooth transitions in many places.",
          "professional":   "Audio pre-/post-roll is masterfully used to glue scenes and enhance narrative flow.",
        } },
      { id: "cutaways", label: "Cutaways (B-roll)",
        items: ["B-roll well chosen", "B-roll timed to support story"],
        grades: {
          "junior-editor":  "Adds B-roll but not always well chosen or timed.",
          "skilled-editor": "B-roll clarifies context and adds variety at appropriate moments.",
          "professional":   "Cutaways perfectly support story, pacing, and emotional beats with zero redundancy.",
        } },
      { id: "jump-cut", label: "Jump-cut Control",
        items: ["Jump cuts feel intentional", "Never jarring or confusing"],
        grades: {
          "junior-editor":  "Jump cuts occur but can feel random or jarring.",
          "skilled-editor": "Jump cuts are intentional and usually support energy or clarity.",
          "professional":   "Jump cuts are rhythmically precise and stylistic, never confusing or fatiguing.",
        } },
    ],
  },
  "story-creative": {
    label: "Story & Creative Choices",
    subskills: [
      { id: "hook", label: "Hook",
        items: ["Opening grabs attention", "Gives a reason to keep watching"],
        grades: {
          "junior-editor":  "Opening signals topic or moment of interest, even if rough.",
          "skilled-editor": "Hook clearly grabs attention and makes most viewers want to stay.",
          "professional":   "Hook is instantly compelling and highly optimized for thumb-stop behavior.",
        } },
      { id: "arc", label: "Story Arc",
        items: ["Clear beginning/middle/end", "Builds toward a payoff"],
        grades: {
          "junior-editor":  "Basic beginning–middle–end exists.",
          "skilled-editor": "Story progression is clear and structured with intentional beats.",
          "professional":   "Narrative arc is tight, escalating, and emotionally or intellectually satisfying.",
        } },
      { id: "context", label: "Context Clarity",
        items: ["Viewer understands quickly", "Works for cold audiences"],
        grades: {
          "junior-editor":  "Viewer can understand what's happening within a few seconds.",
          "skilled-editor": "Context is clear very quickly, even for cold audiences.",
          "professional":   "Context is communicated almost instantly with elegant visual and audio cues.",
        } },
      { id: "emotion", label: "Emotional Beats",
        items: ["Emotional moments land", "Beats are well timed"],
        grades: {
          "junior-editor":  "Some emotional moments exist but may be blunt or mistimed.",
          "skilled-editor": "Emotional beats land and support the message.",
          "professional":   "Emotional moments are timed with high precision and feel deeply resonant.",
        } },
      { id: "original", label: "Original Thinking / Creative Choices",
        items: ["Distinct creative decisions", "On-brand, not just templates"],
        grades: {
          "junior-editor":  "Relies mainly on familiar patterns and trends; some small creative attempts.",
          "skilled-editor": "Mixes known patterns with some distinct creative decisions that fit the brand.",
          "professional":   "Shows strong original voice while staying on-brand; creative choices significantly elevate the reel beyond templates.",
        } },
    ],
  },
  "audio-engineering": {
    label: "Audio Engineering",
    subskills: [
      { id: "normalize", label: "Normalize Levels",
        items: ["Consistent volume across clips", "No clipping or harshness"],
        grades: {
          "junior-editor":  "Overall volume is usable; some jumps between clips.",
          "skilled-editor": "Levels are consistent enough to feel polished end-to-end.",
          "professional":   "Loudness and dynamics feel broadcast-grade; no noticeable jumps or harshness.",
        } },
      { id: "dialogue", label: "Dialogue Clarity",
        items: ["Speech is understandable", "Not buried under music/noise"],
        grades: {
          "junior-editor":  "Speech is understandable but may compete with music or noise.",
          "skilled-editor": "Dialogue is clear and mostly free from distracting elements.",
          "professional":   "Dialogue is clean, present, and sits perfectly in the mix even under music.",
        } },
      { id: "bgm", label: "Background Music",
        items: ["Music fits the mood", "Transitions are not jarring"],
        grades: {
          "junior-editor":  "Music fits decently and runs at acceptable level.",
          "skilled-editor": "Music supports mood and pacing; transitions are not jarring.",
          "professional":   "Track choice, edits, and transitions are highly intentional and drive emotion and rhythm.",
        } },
      { id: "sfx", label: "SFX & Accents",
        items: ["SFX punctuate actions/transitions", "Timed to cuts"],
        grades: {
          "junior-editor":  "Some SFX are added and roughly timed.",
          "skilled-editor": "SFX are used selectively to punctuate actions and transitions.",
          "professional":   "Sound design is detailed and tasteful; SFX enhance immersion without clutter.",
        } },
      { id: "tone-match", label: "Voice Tone Matching",
        items: ["Music/FX match voiceover tone", "Aligned with brand emotion"],
        grades: {
          "junior-editor":  "Music/FX broadly match the voiceover tone.",
          "skilled-editor": "Audio choices are aligned with content emotion and brand.",
          "professional":   "Tone matching is precise; soundscape amplifies message and personality.",
        } },
      { id: "silence", label: "Silence Usage",
        items: ["Quiet moments feel intentional", "Used for emphasis or pacing"],
        grades: {
          "junior-editor":  "Occasional quiet moments, not always intentional.",
          "skilled-editor": "Silence or near-silence is used for emphasis or pacing.",
          "professional":   "Silence is wielded with mastery to create contrast, tension, or emotional weight.",
        } },
    ],
  },
  "captions-text": {
    label: "Captions & Text",
    subskills: [
      { id: "readable", label: "Readability",
        items: ["Legible size & contrast", "Laid out for mobile / safe areas"],
        grades: {
          "junior-editor":  "Text is readable on most devices; occasional size/contrast issues.",
          "skilled-editor": "Text is clearly legible and well placed for mobile.",
          "professional":   "Text is instantly readable in a scroll context; layout accounts for safe areas and fast reading.",
        } },
      { id: "sync", label: "Sync to Audio",
        items: ["Captions follow speech", "No drift, lag, or lead"],
        grades: {
          "junior-editor":  "Captions roughly follow speech, with occasional drift.",
          "skilled-editor": "Caption timing aligns well with spoken delivery and beats.",
          "professional":   "Timing is extremely tight and enhances rhythm, emphasis, and comprehension.",
        } },
      { id: "style", label: "Style & Typography",
        items: ["Consistent font & styling", "Supports brand and tone"],
        grades: {
          "junior-editor":  "Style is consistent enough; font is acceptable.",
          "skilled-editor": "Typography and styling support brand and content tone.",
          "professional":   "Text design feels premium and distinctively branded while remaining highly functional.",
        } },
      { id: "emphasis", label: "Emphasis Text",
        items: ["Key words highlighted", "Emphasis guides attention"],
        grades: {
          "junior-editor":  "Some words highlighted but not always meaningful.",
          "skilled-editor": "Key words and phrases are emphasized to guide attention.",
          "professional":   "Emphasis is crafted to shape emotional beats, retention, and shareability without visual noise.",
        } },
    ],
  },
  "color-visual": {
    label: "Color & Visual Clarity",
    subskills: [
      { id: "exposure", label: "Exposure & Contrast",
        items: ["Correctly exposed clips", "Contrast supports clarity"],
        grades: {
          "junior-editor":  "Image is usable; some clips slightly over/under-exposed or flat.",
          "skilled-editor": "Exposure and contrast are consistent and support clarity.",
          "professional":   "Tonal balance is refined across shots; values guide attention and mood.",
        } },
      { id: "balance", label: "Color Balance / Temperature",
        items: ["Acceptable white balance", "Consistent across shots"],
        grades: {
          "junior-editor":  "White balance is acceptable; some inconsistencies.",
          "skilled-editor": "Color temperature supports setting and subject; limited shifts across shots.",
          "professional":   "Color is deliberately tuned to mood and brand; shifts are controlled or stylistic.",
        } },
      { id: "saturation", label: "Saturation & Cleanliness",
        items: ["Colors pleasing, not dull/overpushed", "Consistent saturation"],
        grades: {
          "junior-editor":  "Colors are fine but may be slightly dull or overpushed.",
          "skilled-editor": "Saturation is pleasing and consistent.",
          "professional":   "Color intensity is finely judged; image feels rich yet natural or stylized in a controlled way.",
        } },
    ],
  },
  "revisions-time": {
    label: "Revisions & Time Management",
    subskills: [
      { id: "implement", label: "Implementing Revisions Cleanly",
        items: ["Notes applied accurately", "No new issues introduced"],
        grades: {
          "junior-editor":  "Applies notes but may introduce new issues or only partially address feedback.",
          "skilled-editor": "Accurately implements most notes without breaking other parts of the edit.",
          "professional":   "Implements feedback precisely and quickly, often improving beyond the exact request.",
        } },
      { id: "versions", label: "Version Management",
        items: ["Versions saved & organized", "Naming is traceable"],
        grades: {
          "junior-editor":  "Keeps some versions but naming/organization can be messy.",
          "skilled-editor": "Versions are reasonably organized and traceable.",
          "professional":   "Versions are cleanly structured, labeled, and easy for others to review or roll back.",
        } },
      { id: "time-bound", label: "Time Bound Execution",
        items: ["Delivered within agreed time", "Time matches reel complexity"],
        grades: {
          "junior-editor":  "Completes edit but occasionally overruns reasonable time for scope.",
          "skilled-editor": "Delivers within agreed time range for this reel complexity.",
          "professional":   "Consistently delivers ahead of reasonable time while maintaining or improving quality.",
        } },
      { id: "scope", label: "Focus & Scope Control",
        items: ["Prioritizes high-impact tasks", "Knows when 'good enough' is reached"],
        grades: {
          "junior-editor":  "Tends to over-tweak low-impact details.",
          "skilled-editor": "Generally prioritizes high-impact tasks before polish.",
          "professional":   "Shows excellent judgment on when “good enough” is reached vs when to push craft further.",
        } },
    ],
  },

  /* ---------- Bonus Craft Pillars ---------- */
  "motion-graphics": {
    label: "Motion Graphics",
    bonus: true,
    subskills: [
      { id: "text-anim", label: "Text Animation",
        items: ["Animations timed to content", "Feels custom, not just presets"],
        grades: {
          "junior-editor":  "Text animates in/out with basic presets.",
          "skilled-editor": "Animations are clean, timed to content, and not distracting.",
          "professional":   "Animation is expressive, custom-feeling, and perfectly aligned with rhythm and brand.",
        } },
      { id: "masking", label: "Masking & Reveals",
        items: ["Clean mask edges", "Reveals support the moment"],
        grades: {
          "junior-editor":  "Attempts masks/reveals; edges or timing may be rough.",
          "skilled-editor": "Masks are clean enough and reveals support moments.",
          "professional":   "Masking is precise and inventive; reveals feel seamless and cinematic.",
        } },
      { id: "shapes", label: "Shape Graphics & Scene Integration",
        items: ["Graphics support hierarchy", "Fit the scene, not floating"],
        grades: {
          "junior-editor":  "Uses simple shapes or UI elements; sometimes floaty.",
          "skilled-editor": "Graphics support hierarchy and fit the scene.",
          "professional":   "Graphics feel fully integrated into the environment and composition, not floating stickers.",
        } },
      { id: "parallax", label: "Parallax / Depth",
        items: ["Depth adds interest", "Not exaggerated or gimmicky"],
        grades: {
          "junior-editor":  "Basic depth effect; sometimes exaggerated or gimmicky.",
          "skilled-editor": "Depth adds interest without harming clarity.",
          "professional":   "Parallax is subtle, polished, and truly enhances dimensionality and focus.",
        } },
    ],
  },
  "special-effects": {
    label: "Special Effects",
    bonus: true,
    subskills: [
      { id: "transitions", label: "Transitions (FX-based)",
        items: ["Transitions motivated by content", "Not overused"],
        grades: {
          "junior-editor":  "Uses trendy transitions; occasionally overused.",
          "skilled-editor": "Transitions are smooth and mostly motivated by content.",
          "professional":   "Transitions are elegant, purposeful, and never feel like random presets.",
        } },
      { id: "zooms", label: "Zooms & Punches",
        items: ["Punch-ins emphasize key beats", "Even and intentional"],
        grades: {
          "junior-editor":  "Punch-ins exist but may be uneven or overdone.",
          "skilled-editor": "Punch-ins emphasize key beats effectively.",
          "professional":   "Zooms are tightly timed and feel like intentional camera work, not patchwork.",
        } },
      { id: "speed", label: "Speed Ramps",
        items: ["Ramps support energy/clarity", "Smooth, not jerky"],
        grades: {
          "junior-editor":  "Speed changes exist; sometimes jerky or misaligned with action.",
          "skilled-editor": "Speed ramps support energy and clarity.",
          "professional":   "Speed ramps are fluid and rhythmically perfect, enhancing drama and flow.",
        } },
      { id: "overlays", label: "Overlays / Glows / Glitch / Chromab",
        items: ["Effects support style/mood", "Controlled, not noisy"],
        grades: {
          "junior-editor":  "Effects are experimented with but sometimes noisy.",
          "skilled-editor": "Effects support style and mood without overwhelming.",
          "professional":   "Effects are tastefully minimal or highly stylized in a controlled, high-end way.",
        } },
    ],
  },
  "thumbnails-branding": {
    label: "Thumbnails & Branding",
    bonus: true,
    subskills: [
      { id: "thumbnail", label: "Thumbnail Design",
        items: ["Clear, readable thumbnail", "Uses brand elements"],
        grades: {
          "junior-editor":  "Thumbnail communicates topic; text may be small or busy.",
          "skilled-editor": "Thumbnail is clear, readable, and uses brand elements.",
          "professional":   "Thumbnail is highly clickable, visually disciplined, and strongly aligned with channel/brand strategy.",
        } },
      { id: "branding", label: "Branding Consistency",
        items: ["Logo/colors used", "Consistent visual language"],
        grades: {
          "junior-editor":  "Basic logo/colors used.",
          "skilled-editor": "Visual language is mostly consistent across reels.",
          "professional":   "Brand identity is unmistakable; reels and thumbnails feel like a cohesive system.",
        } },
    ],
  },
};

/* Max XP a reel can award if completed with the given skill tags graded
   at "professional". Used for the green "+XP" preview badge on cards. */
export function maxXpForSkills(skillKeys = []) {
  return (skillKeys || []).length * XP_PER_GRADE["professional"];
}

/* ---------- Per-sub-skill grading (one grade per rubric row) ----------
   reviewer_grades is a map { subId: 'junior-editor'|'skilled-editor'|'professional' }.
   A skill's XP is the AVERAGE of its graded sub-skills' grade-XP, so the
   per-skill maximum stays ~XP_PER_GRADE.professional regardless of how many
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
