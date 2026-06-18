/* =========================================================
   Training curriculum — pillar-module source of truth (rebuilt).

   Replaces the old 12-module CapCut course (training-data.jsx) with
   SIX pillar modules keyed 1:1 onto the CORE gamify skill keys so the
   training tab, the reel skill_tags, the spider chart, and the rubric
   sheet all share ONE skill set and module ↔ rubric links are exact.

   Module skillKey order matches the first 6 (Core) entries of
   GAMIFY_SKILLS in gamify-data.jsx:
     1 cutting-pacing  · 2 story-creative · 3 audio-engineering
     4 captions-text   · 5 color-visual   · 6 revisions-time

   Content is transcribed from `reel-editing-syllabus.md` (modules 1–5)
   and seeded from the `gold standard grading rubric.md` /
   RUBRIC["revisions-time"] subskills for module 6 (which the syllabus
   only references as a "Next Skill").

   Each module's `sections` carry the rich syllabus prose; the
   `checklist` array is the trackable lesson list — its indices drive
   training_progress.lessons_done (same model as the old `lessons`).

   To add tutorial links: paste them into a module's `videos` array as
   { label, url, kind }. kind 'youtube' renders an inline embed; kind 'ig'
   renders an outbound button (Instagram can't be iframe-embedded).

   Owner per-field edits live in Supabase (training_module_content,
   migration 0055) and override these code defaults at render time.
   ========================================================= */

import {
  GAMIFY_SKILLS,
  SKILL_BY_KEY as GAMIFY_SKILL_BY_KEY,
  RUBRIC,
} from "./gamify-data.jsx";

/* Re-export the canonical skill lookups so importers of the curriculum
   can read skills without reaching into gamify-data directly. */
export { SKILL_BY_KEY } from "./gamify-data.jsx";

const ICON = (key) => GAMIFY_SKILL_BY_KEY[key]?.icon || "•";
const LABEL = (key) => GAMIFY_SKILL_BY_KEY[key]?.label || key;

/* =========================================================
   PILLAR_MODULES — one object per CORE rubric pillar, in skillKey order.
   ========================================================= */
export const PILLAR_MODULES = [
  /* ── 1 · Cutting & Pacing ─────────────────────────────────────── */
  {
    id: "cutting-pacing",
    order: 1,
    skillKey: "cutting-pacing",
    title: LABEL("cutting-pacing"),
    icon: ICON("cutting-pacing"),
    deliverables: "3 videos",
    sections: {
      whyMatters:
        "Cutting and pacing are the foundation of reel editing. They control how fast the viewer moves through the content, how much attention is held, and whether the edit feels tight or bloated. In short-form content, weak pacing can kill retention even if everything else looks good.",
      definition:
        "Cutting & pacing is the ability to choose the right moment to cut, remove unnecessary dead space, control rhythm, and shape the viewer's attention so the reel feels smooth, intentional, and engaging.",
      goodLooks:
        "A strong edit feels clean, fast, and purposeful without feeling rushed. Every cut should either move the story forward, improve clarity, increase emotional impact, or add energy. Good pacing makes the viewer feel like the reel is moving naturally and efficiently.",
      commonMistakes: [
        "Leaving too much dead air",
        "Cutting too late or too early",
        "Using jump cuts randomly",
        "Letting scenes drag after the main point is already made",
        "Using B-roll just to fill space instead of improving the edit",
      ],
      goldExamples: [
        "A reel where every cut lands exactly on a meaningful beat and the viewer never feels bored",
        "A talking-head reel where pauses are removed cleanly, B-roll is inserted at the right moments, and the rhythm feels effortless",
        "A fast-paced reel where the tempo builds naturally and the cuts feel invisible",
      ],
      poorExamples: [
        "A reel with long pauses between sentences and no urgency",
        "A reel where cuts feel random and distracting instead of intentional",
        "A reel that tries to be fast but feels choppy, confusing, or exhausting",
      ],
      goldBreakdown: [
        "Cuts happen only when they serve a purpose",
        "There is no wasted silence or filler",
        "B-roll supports the message instead of distracting from it",
        "The pacing matches the style of the content",
        "The reel feels like it knows exactly when to move on",
      ],
      poorBreakdown: [
        "The edit holds on shots too long",
        "The rhythm is inconsistent",
        "There is no clear sense of momentum",
        "Jump cuts feel sloppy or unplanned",
        "The viewer can feel the edit, which reduces immersion",
      ],
      exercise:
        "Take a 20–30 second clip and make three versions: (1) a slow version, (2) a tight professional version, (3) an aggressive high-retention version. Then compare which version feels most natural, engaging, and efficient.",
      selfAssessment: [
        "Did I remove all unnecessary pauses?",
        "Do the cuts feel intentional?",
        "Does the viewer stay engaged without effort?",
        "Does the pacing fit the content style?",
      ],
      checklist: [
        "I understand how cutting affects viewer attention",
        "I can remove dead space without damaging meaning",
        "I can place cuts at the right moments",
        "I can use B-roll to improve pacing",
        "I can make a reel feel tighter without overediting",
      ],
      developmentPlan: [
        "Rewatch the raw footage before editing",
        "Practice tighter trims",
        "Study editors who are strong at short-form pacing",
        "Compare your cuts against a gold standard reel",
        "Re-edit the same clip multiple times with different pacing choices",
      ],
      proTips: [],
      quiz: [
        {
          q: "What's the main risk of weak pacing in short-form content?",
          type: "mcq",
          choices: [
            "The reel will be too short",
            "It can kill retention even if everything else looks good",
            "Colors will look washed out",
            "Captions fall out of sync",
          ],
          answer: 1,
          explain: "Weak pacing loses viewers regardless of how good the rest is — retention is what pays the price.",
        },
        {
          q: "Every cut should serve a purpose: move the story forward, improve clarity, add impact, or add energy.",
          type: "tf",
          answer: true,
          explain: "Purposeless cuts make the edit feel sloppy and noticeable.",
        },
        {
          q: "Which of these is a common pacing mistake?",
          type: "mcq",
          choices: [
            "Removing dead air",
            "Cutting on a meaningful beat",
            "Letting scenes drag after the point is already made",
            "Matching tempo to the content style",
          ],
          answer: 2,
          explain: "Holding a shot after the point lands is dead weight — trim it.",
        },
      ],
      flashcards: [
        { front: "Cutting & Pacing", back: "Choosing the right moment to cut, removing dead space, and shaping the viewer's attention so the reel feels smooth and intentional." },
        { front: "Sign of good pacing", back: "Cuts feel invisible; the viewer stays engaged without effort and never feels bored." },
        { front: "Role of B-roll", back: "Support the message and improve the edit — not just fill space." },
      ],
    },
    nextSkill: "story-creative",
    videos: [],
  },

  /* ── 2 · Story & Creative Choices ─────────────────────────────── */
  {
    id: "story-creative",
    order: 2,
    skillKey: "story-creative",
    title: LABEL("story-creative"),
    icon: ICON("story-creative"),
    deliverables: "7 videos",
    sections: {
      whyMatters:
        "Story and creative choices turn a sequence of clips into something memorable. A reel with strong pacing but weak story still feels forgettable; a clear narrative with good hooks and emotion is what drives shares, saves, and client satisfaction.",
      definition:
        "Story & Creative Choices is the ability to frame a clear idea or transformation, grab attention instantly with a strong hook, structure the content with a beginning, middle, and end, and make creative decisions that feel original but on-brand.",
      goodLooks:
        "The viewer instantly understands what this reel is about and why they should care. There is a clear progression or transformation, with emotional or intellectual beats that land. Creative choices (angles, text, pacing, humor, visual ideas) feel purposeful rather than random.",
      commonMistakes: [
        "Vague or slow hooks that don't give a reason to keep watching",
        "No clear story arc – just a collection of clips",
        "Confusing context; the viewer doesn't know what's happening or why",
        "Emotional beats that are mistimed or missing",
        "Copy-pasting trends without adding any original twist",
      ],
      goldExamples: [
        "A reel that hooks in the first second with a strong statement or visual and then delivers on that promise",
        "A transformation reel (before/after, problem/solution) where each step is clear and satisfying",
        "A story-driven reel that builds tension and lands a clean payoff or punchline",
      ],
      poorExamples: [
        "A reel where the first 3–4 seconds are setup with no clear hook",
        "A reel that jumps between ideas without logic, leaving the viewer confused",
        "A trend reel that looks like every other version on the platform, with nothing unique",
      ],
      goldBreakdown: [
        "The hook is immediate and specific (the first 3 seconds are most critical) – most viewers scroll past the first second if it does not engage or capture their attention",
        "There is a clear promise or question set up early, then resolved",
        "The order of shots/dialogue makes logical and emotional sense",
        "Context is established quickly, even for someone who has never seen this creator before",
        "Creative touches (text phrasing, angles, humor, visuals) make the reel feel distinct",
      ],
      poorBreakdown: [
        "The viewer has to work to understand what is happening",
        "The reel drifts or backtracks instead of progressing",
        "Important information is missing or delivered too late",
        "Creative choices feel copied, random, or off-tone",
        "The ending is weak or abrupt, with no payoff or call to action",
      ],
      exercise:
        "Hook Rewrite Exercise: take a 20–30s talking-head clip, create 3 different hooks (different first 2–3s) and edit each version to see which feels most thumb-stop. Story Arc Reorder: take a rough sequence of 6–10 shots and create two edits — one in original order, one reordered into a stronger beginning → middle → end — then compare clarity and emotional impact. Original Twist Exercise: take a common trend format, edit one 'template' version, then edit a second version where you add at least one original creative choice (structure, punchline, visual metaphor).",
      selfAssessment: [
        "Hook: does the first second give a clear reason to keep watching? Would a cold viewer stop scrolling, or not?",
        "Story Arc: is there a clear beginning, middle, and end? Does each moment build toward something?",
        "Context Clarity: can someone with zero background understand what's happening quickly?",
        "Emotional Beats & Creative Choices: are there moments that make the viewer feel something or think differently? Did you add at least one original decision that fits the brand?",
      ],
      checklist: [
        "The hook is clear and specific in the first 1–2 seconds",
        "The story has a visible beginning, middle, and end (or setup → payoff)",
        "Context is understandable for a brand-new viewer",
        "Emotional or tension beats are placed deliberately",
        "I added at least one creative twist that fits the brand, not just the trend",
      ],
      developmentPlan: [
        "Study 10–20 high-performing reels only for hooks and story (ignore color, captions, etc. for now)",
        "Write down, for each: what is the hook? what is the promise? what is the payoff?",
        "Re-edit 3 of your older reels: improve only the hook and order of shots – keep everything else identical",
        "Ask for feedback specifically on: 'Is the hook strong enough?', 'Is anything confusing?', 'Did the ending feel satisfying?'",
      ],
      proTips: [],
      quiz: [
        {
          q: "How critical are the first ~3 seconds of a reel?",
          type: "mcq",
          choices: [
            "Not important if the ending is strong",
            "Most critical — many viewers scroll past within the first second",
            "Only matter for educational content",
            "Matter less than the color grade",
          ],
          answer: 1,
          explain: "The hook in the first few seconds decides whether a cold viewer stays.",
        },
        {
          q: "A strong reel can just be a collection of clips with no clear beginning, middle, and end.",
          type: "tf",
          answer: false,
          explain: "Without a story arc the reel feels forgettable, even with good pacing.",
        },
        {
          q: "What makes a trend reel stand out from every other version?",
          type: "mcq",
          choices: [
            "Copying the format exactly",
            "Adding at least one original creative choice that fits the brand",
            "Using more on-screen text",
            "Making it longer",
          ],
          answer: 1,
          explain: "An original twist on a familiar format is what separates yours from the rest.",
        },
      ],
      flashcards: [
        { front: "The hook", back: "An immediate, specific opening (first 1–3s) that gives a cold viewer a reason to keep watching." },
        { front: "Story arc", back: "A clear beginning, middle, and end (or setup → payoff) so each moment builds toward something." },
        { front: "Context clarity", back: "A brand-new viewer can understand what's happening quickly, with no prior background." },
      ],
    },
    nextSkill: "audio-engineering",
    videos: [],
  },

  /* ── 3 · Audio Engineering ────────────────────────────────────── */
  {
    id: "audio-engineering",
    order: 3,
    skillKey: "audio-engineering",
    title: LABEL("audio-engineering"),
    icon: ICON("audio-engineering"),
    deliverables: "8 videos",
    sections: {
      whyMatters:
        "Audio is often the first thing people notice when it's bad and the last thing they praise when it's good. Clear, well-balanced audio dramatically increases watch-time, comprehension, and perceived professionalism, especially on mobile where people use small speakers or earbuds.",
      definition:
        "Audio Engineering is the ability to control loudness and consistency across clips, keep dialogue clear and intelligible, choose and mix music, SFX, and ambience tastefully, and use silence and dynamics to support story and emotion.",
      goodLooks:
        "The viewer can understand every word without effort. Music supports the mood without drowning speech. SFX (sound effects) and ambience (background sounds such as cars driving, birds chirping in a nature video) enhance the experience instead of cluttering it. Volume feels consistent from start to end, and nothing is harsh, peaky, or muddy.",
      commonMistakes: [
        "Dialogue too quiet or buried under music",
        "Big jumps in volume between clips or scenes",
        "Music choice that doesn't match the tone of the content",
        "Overuse of SFX and whooshes that distract instead of support",
        "No use of silence; everything is loud all the time",
      ],
      goldExamples: [
        "A talking-head reel where dialogue is crisp, music sits under the voice, and there are no volume jumps",
        "A dynamic reel where SFX emphasize key moments (cuts, transitions, text pops) without being overused",
        "A storytelling reel where quiet moments and pauses are used intentionally for tension or emotion",
      ],
      poorExamples: [
        "Dialogue is hard to understand, with inconsistent volume and background noise",
        "Music is too loud, wrong mood, or changes abruptly",
        "Random SFX spammed on every cut, making the reel feel cluttered and cheap",
      ],
      goldBreakdown: [
        "Dialogue is clearly on top of the mix, not fighting music",
        "Overall loudness feels even across the whole reel",
        "Music choice matches the energy and emotion of the content (many times, different music tracks are used to match changing emotions or pacing)",
        "SFX are used only where they add impact or clarity",
        "Silence or near-silence is used to highlight important lines or moments",
      ],
      poorBreakdown: [
        "Viewer must strain to hear or understand the speaker",
        "Volume jumps between clips or sections are noticeable",
        "Music feels generic or wrong for the message",
        "SFX draw attention to themselves instead of the content",
        "The audio track feels 'flat' emotionally, with no dynamics",
      ],
      exercise:
        "Exercise 1 – Dialogue Clarity Fix: take a raw talking-head clip with background noise or uneven levels, make Version A (minimal tweaks) and Version B (carefully leveled, cleaned, and balanced), then compare on phone speakers and cheap earbuds. Focus on normalizing levels, basic EQ / high-pass to clean low rumble, and reducing music under dialogue. Exercise 2 – Music & Tone Matching: take a 20–30s clip and edit three versions with a calm/ambient, a hype/energetic, and a dark/tense track; observe how each changes the perceived meaning and emotional tone. Exercise 3 – SFX & Silence: take a short sequence with cuts and text pops, make Version A (no SFX, just music), Version B (SFX on every event, overdone on purpose), and Version C (SFX on only 2–3 key moments plus one brief intentional silence); compare which feels most professional.",
      selfAssessment: [
        "Normalize Levels: is the overall volume consistent? Are there noticeable jumps between clips?",
        "Dialogue Clarity: can a viewer clearly understand every important word on phone speakers? Is dialogue free from distracting noise when possible?",
        "Background Music: does the track fit the mood and pacing? Does music support dialogue instead of fighting it?",
        "SFX & Accents: are SFX used with intention or spammed everywhere? Do they enhance impact without becoming annoying?",
        "Voice Tone Matching & Silence Usage: does the soundscape match the emotion and brand tone? Are quiet moments used to highlight key beats?",
      ],
      checklist: [
        "Dialogue is always easy to understand",
        "Volume is consistent across all clips",
        "Music choice fits the content and feels integrated",
        "SFX are used sparingly and purposefully",
        "At least one moment of contrast (quieter or more spacious) exists in longer reels",
      ],
      developmentPlan: [
        "Rewatch 10–15 high-performing reels with eyes closed, focusing only on dialogue loudness, music type and volume, and where SFX are used",
        "Take 3 old edits and only rework the audio (no visual changes); aim to move each from 'Junior' to 'Skilled' in the rubric",
        "Build a go-to audio stack: a few safe music playlists for different moods (favorite them in CapCut or download to a local folder) and a small library of tasteful SFX you actually like",
        "Ask for focused feedback: 'Is anything hard to hear?', 'Does the music feel right?', 'Are there any SFX that feel like too much?'",
      ],
      proTips: [
        "Audio: watch the audio levels to see if they are consistent or clipping (all in the red zone)",
        "For A-roll clips: press SHIFT + S to extract the audio to better control/manage that track (learn the usefulness of the sync-2-audio-tracks feature, and grouping/ungrouping clips)",
        "Learn how to compound clips with different layers of audio for easier management",
        "Favorite good audio tracks in CapCut for easy future access",
        "Develop a small library of tasteful SFX/music you actually like and find useful",
      ],
      quiz: [
        {
          q: "Music should usually sit underneath the dialogue, not fight it.",
          type: "tf",
          answer: true,
          explain: "Dialogue must stay clearly on top of the mix so every word is intelligible.",
        },
        {
          q: "Which is a sign of poor audio?",
          type: "mcq",
          choices: [
            "Consistent loudness across clips",
            "SFX spammed on every cut",
            "Dialogue clearly on top of the music",
            "Intentional silence for emphasis",
          ],
          answer: 1,
          explain: "Overused SFX make a reel feel cluttered and cheap.",
        },
        {
          q: "Why use silence or near-silence?",
          type: "mcq",
          choices: [
            "To save export time",
            "To highlight an important line or moment",
            "Because music is optional",
            "To hide background noise",
          ],
          answer: 1,
          explain: "A quiet beat draws attention to the line or moment right after it.",
        },
      ],
      flashcards: [
        { front: "Audio Engineering", back: "Controlling loudness and consistency, keeping dialogue clear, mixing music/SFX/ambience tastefully, and using silence and dynamics to support story." },
        { front: "Dialogue clarity test", back: "Can a viewer understand every important word on phone speakers and cheap earbuds?" },
        { front: "SFX rule", back: "Use them sparingly — only where they add real impact or clarity." },
      ],
    },
    nextSkill: "captions-text",
    videos: [],
  },

  /* ── 4 · Captions & Text ──────────────────────────────────────── */
  {
    id: "captions-text",
    order: 4,
    skillKey: "captions-text",
    title: LABEL("captions-text"),
    icon: ICON("captions-text"),
    deliverables: "6 videos",
    sections: {
      whyMatters:
        "Most people watch reels on mobile, often without sound or in noisy environments. Strong captions and text dramatically improve comprehension, retention, and shareability. They also define a creator's visual identity and make content feel deliberate rather than random.",
      definition:
        "Captions & Text is the ability to make on-screen text instantly readable on mobile (tip: watch the preview full screen on mobile to judge placing), sync captions tightly to the audio and story beats, use style and typography that fit the brand and platform, and emphasize the right words to guide attention and emotion (filters, glow overlay, etc.).",
      goodLooks:
        "Text is large enough, high-contrast, and on screen long enough to read once, even at normal scroll speed. Captions match the timing of speech and key moments. Emphasis, colors, and layout feel intentional and consistent with the creator's brand.",
      commonMistakes: [
        "Text too small or too thin to read on mobile",
        "Text placed under UI elements or too close to edges (pro tip: enable the social media platform danger zone to avoid)",
        "Captions lag behind or jump ahead of the speaker",
        "Overly busy styles, too many fonts, or inconsistent colors",
        "Emphasis on the wrong words or too many words highlighted",
      ],
      goldExamples: [
        "A reel where captions are perfectly synced, easy to read, and match the creator's style",
        "An educational reel where key phrases are emphasized to help the viewer remember the main points",
        "A storytelling reel that uses minimal but powerful text to support the narrative",
      ],
      poorExamples: [
        "Captions that are tiny, low-contrast, or disappear too fast",
        "Captions that are constantly late/early, making it hard to follow the speech",
        "Text styles that change randomly, with too many colors and fonts, making the reel look chaotic or silly",
      ],
      goldBreakdown: [
        "Font size is optimized for mobile screens (can be read at arm's length)",
        "Text has strong contrast against the background",
        "Placement respects safe areas (not hidden by platform UI)",
        "Caption timing closely follows speech and beat changes",
        "Emphasis is used sparingly and on truly important words",
      ],
      poorBreakdown: [
        "Important lines appear too briefly to read",
        "Text collides with other UI or visual elements",
        "Captions and speech are out of sync",
        "Style looks like a mix of random presets",
        "Emphasis is either missing or overdone everywhere",
      ],
      exercise:
        "Exercise 1 – Readability Stress Test: take a 15–30s talking-head clip and make Version A (small text, weaker contrast, default placement) and Version B (optimized for mobile — larger, high contrast, safe placement); watch both on your phone at 1x and 1.25x and note which is comfortably readable. Exercise 2 – Sync & Rhythm: take a 20–30s clip with clear speech, create captions manually (no auto-sync), align caption changes exactly when key words/phrases finish, avoid flashing new lines too early, then compare your manual timing against auto-generated timing and adjust. Exercise 3 – Emphasis & Hierarchy: take an educational or 'tips' reel, identify 3–6 key words/phrases that carry the main idea, and make Version A (all text same style) and Version B (only key phrases emphasized — bold, color, size, or animation); compare clarity and impact.",
      selfAssessment: [
        "Readability: is text clearly legible on a phone with brightness at 50–60%? Is there enough contrast and padding from edges?",
        "Sync to Audio: do captions appear and disappear in sync with speech and beats? Is there any noticeable lag or early change?",
        "Style & Typography: does the visual style match the brand and content tone? Is the font choice clean and consistent?",
        "Emphasis Text: are only the most important words/phrases emphasized? Does emphasis help guide attention instead of creating noise?",
      ],
      checklist: [
        "Text is readable at a glance on mobile",
        "Captions are timed tightly to the voice and beats",
        "Styles and fonts are consistent and brand-aligned",
        "Emphasis is used intentionally, not everywhere",
        "Text placement respects safe areas and doesn't clash with UI",
      ],
      developmentPlan: [
        "Collect 15–20 reels known for strong captions; for each note font size and weight, placement, timing pattern (per word, per phrase, per sentence), and how/where they use emphasis",
        "Re-caption 3 of your own old reels focusing only on larger/clearer text, better timing, and minimal but strong emphasis",
        "Build a caption style system: decide 1–2 base fonts (favorite on CapCut), define sizes for title/body/emphasis, and define 2–3 brand colors for text (follow Paul's Branding strategy for the color palette — click to go to the Branding strategy page)",
        "Ask reviewers specifically: 'Was anything hard to read?', 'Did any captions feel out of sync?', 'Did the emphasis help or distract?'",
      ],
      proTips: [
        "Is text clearly legible on a phone with brightness at 50–60%?",
        "Font size is optimized for mobile screens (can be read at arm's length)",
        "Tip: watch the preview full screen on mobile to judge placing",
        "Pro tip: enable the social media platform danger zone to avoid hiding text under platform UI",
      ],
      quiz: [
        {
          q: "Most reels are watched on mobile, often without sound.",
          type: "tf",
          answer: true,
          explain: "That's why readable, well-synced captions are essential to comprehension and retention.",
        },
        {
          q: "Which describes good caption practice?",
          type: "mcq",
          choices: [
            "Tiny, low-contrast text",
            "Many fonts and random colors",
            "Large, high-contrast text in safe areas, synced to speech",
            "Captions that disappear before they can be read",
          ],
          answer: 2,
          explain: "Readable, on-brand, tightly-synced captions guide attention without chaos.",
        },
        {
          q: "How should emphasis (bold / color / size) be used on text?",
          type: "mcq",
          choices: [
            "On every word",
            "Sparingly, on the truly important words",
            "Never",
            "Only on the last line",
          ],
          answer: 1,
          explain: "Emphasis works only when it's reserved for the words that carry the main idea.",
        },
      ],
      flashcards: [
        { front: "Captions & Text", back: "Making on-screen text instantly readable on mobile, synced tightly to audio and beats, styled on-brand, and emphasizing the right words." },
        { front: "Safe area", back: "Keep text clear of platform UI and screen edges — enable the platform's danger-zone guide." },
        { front: "Readability test", back: "Legible at a glance on a phone at 50–60% brightness, on screen long enough to read once." },
      ],
    },
    nextSkill: "color-visual",
    videos: [],
  },

  /* ── 5 · Color & Visual Clarity ───────────────────────────────── */
  {
    id: "color-visual",
    order: 5,
    skillKey: "color-visual",
    title: LABEL("color-visual"),
    icon: ICON("color-visual"),
    deliverables: "6 videos",
    sections: {
      whyMatters:
        "Color is not just about making footage look pretty. It affects clarity, mood, perceived quality, and how professionally the reel feels overall. Even if the edit is strong, bad exposure or messy color can make the whole reel feel unfinished or cheap.",
      definition:
        "Color & Visual Clarity is the ability to balance exposure so subjects are visible and intentional, use contrast to separate subjects from the background, control color temperature to match mood and setting, and keep saturation clean and appealing without making the image look overprocessed.",
      goodLooks:
        "A good grade or correction makes the image feel clean, balanced, and easy to watch. Skin tones look natural or intentionally stylized. Brightness, contrast, and color shifts feel consistent across shots unless a change is clearly intentional for style or story.",
      commonMistakes: [
        "Clips are too dark or too bright",
        "Skin tones look weird or inconsistent",
        "Contrast is too flat or too harsh",
        "Saturation is pushed too far and colors look unnatural",
        "Different shots don't match, making the reel feel visually disconnected",
        "Using just 1 filter for the whole reel when selected clips have varying contrast/color palettes can distort the overall reel (in some cases, manually adjusting the color for each clip is necessary)",
      ],
      goldExamples: [
        "A reel where exposure is consistently balanced across all shots and no scene feels washed out or crushed",
        "A reel where warm or cool tones are clearly used to support mood without hurting realism",
        "A reel where color feels polished, intentional, and unified from start to finish",
      ],
      poorExamples: [
        "A reel with some clips too dark to read clearly and others too bright",
        "A reel with obvious mismatch in white balance between cuts",
        "A reel where saturation or contrast is so aggressive that it becomes distracting",
      ],
      goldBreakdown: [
        "Exposure is controlled so the viewer can always see the subject clearly",
        "Contrast is strong enough to create depth, but not so harsh that detail is lost",
        "Color temperature matches the emotion, environment, or brand",
        "Saturation is balanced and clean",
        "The reel feels visually coherent from one cut to the next",
      ],
      poorBreakdown: [
        "The image feels inconsistent or accidental",
        "Shadows lose detail or highlights blow out",
        "Skin tones drift too much between scenes",
        "The whole reel may feel dull, muddy, neon, or overcooked",
        "Color does not support the story or content style",
      ],
      exercise:
        "Exercise 1 – Exposure & Contrast Fix: take a reel or raw clip with poor lighting consistency, make Version A (minimal correction) and Version B (carefully balanced exposure and contrast across all shots); focus on recovering details in highlights and shadows, keeping the subject readable, and matching contrast across cuts. Exercise 2 – Temperature Matching: take a sequence with multiple shots from different environments/times of day, make Version A (keep natural differences) and Version B (match or intentionally stylize temperature across shots); focus on warm vs cool mood, white balance consistency, and whether the reel feels unified. Exercise 3 – Saturation Clean-Up: take a reel with strong colors or mixed lighting, make one version with restrained natural saturation and one with deliberately stylized saturation; focus on skin tones, brand color preservation, and avoiding color clipping or neon-looking results.",
      selfAssessment: [
        "Is the reel visually consistent?",
        "Are exposure and contrast helping the story?",
        "Do skin tones and key colors look clean?",
        "Does the color support mood without distracting from the content?",
      ],
      checklist: [
        "The subject is always visible and clear",
        "Exposure is balanced across shots",
        "Contrast adds depth without crushing detail",
        "Color temperature is coherent and intentional",
        "Saturation feels clean and controlled",
      ],
      developmentPlan: [
        "Study reels that have strong visual consistency",
        "Practice color correction before color styling",
        "Regrade older edits by fixing exposure and white balance first",
        "Build a reference library of good skin tones, natural tones, and stylized looks",
        "Ask reviewers: 'Does anything look too dark, bright, or unnatural?', 'Do the shots match visually?', 'Does the color help the reel feel polished?'",
      ],
      proTips: [
        "CapCut skin-protecting features and auto enhance are great ways to start color correcting",
        "Some videos will be filmed in LOG or RAW color format and you must learn how to apply the correct LUT to bring back normal colors",
      ],
      quiz: [
        {
          q: "Bad exposure or messy color can make even a strong edit feel unfinished or cheap.",
          type: "tf",
          answer: true,
          explain: "Color affects perceived quality — poor grading undermines an otherwise good reel.",
        },
        {
          q: "Which is a sign of good color work?",
          type: "mcq",
          choices: [
            "Some clips dark, others bright",
            "Obvious white-balance mismatch between cuts",
            "Consistent exposure with clean, natural skin tones",
            "Neon, over-saturated colors",
          ],
          answer: 2,
          explain: "Balanced exposure and clean skin tones read as polished and professional.",
        },
        {
          q: "When is per-clip manual color adjustment necessary?",
          type: "mcq",
          choices: [
            "Never — one filter always works",
            "When clips have varying contrast/color palettes that one filter would distort",
            "Only for talking-head clips",
            "Only when exporting",
          ],
          answer: 1,
          explain: "A single filter across mismatched clips can distort the reel; sometimes each clip needs its own correction.",
        },
      ],
      flashcards: [
        { front: "Color & Visual Clarity", back: "Balancing exposure, using contrast to separate subject from background, controlling temperature for mood, and keeping saturation clean." },
        { front: "LOG / RAW footage", back: "Apply the correct LUT to bring the colors back to a normal baseline before grading." },
        { front: "Visual coherence", back: "Brightness, contrast, and color feel consistent across shots unless a change is clearly intentional." },
      ],
    },
    nextSkill: "revisions-time",
    videos: [],
  },

  /* ── 6 · Revisions & Time Management ──────────────────────────────
     Not written in the syllabus — seeded from RUBRIC["revisions-time"]
     subskills (the gold-standard rubric pillar 6). whyMatters /
     definition / goodLooks / commonMistakes / developmentPlan are
     derived from those grade descriptions, kept on-tone with modules
     1–5. checklist is the four pillar-6 subskills. proTips empty. */
  {
    id: "revisions-time",
    order: 6,
    skillKey: "revisions-time",
    title: LABEL("revisions-time"),
    icon: ICON("revisions-time"),
    deliverables: "Ongoing (applies to every reel)",
    sections: {
      whyMatters:
        "Revisions and time management are what make an editor reliable to work with. A great edit delivered late, or one that breaks other parts of the reel every time feedback is applied, costs trust and money. Editors who implement notes cleanly, keep their versions organized, and deliver on time become the ones clients and owners want to keep using.",
      definition:
        "Revisions & Time Management is the ability to implement feedback accurately without introducing new issues, keep versions organized and traceable, deliver within a reasonable time for the reel's complexity, and control scope — prioritizing high-impact work and knowing when 'good enough' is reached.",
      goodLooks:
        "Notes are applied precisely and quickly, often improving the reel beyond the exact request. Versions are cleanly labeled and easy for others to review or roll back. The edit lands within (or ahead of) the agreed time for its complexity, with effort spent on high-impact tasks rather than endless low-impact polish.",
      commonMistakes: [
        "Applying notes but introducing new issues or only partially addressing the feedback",
        "Messy version naming and organization that's hard for others to follow",
        "Overrunning a reasonable time for the scope of the reel",
        "Over-tweaking low-impact details instead of prioritizing what matters",
      ],
      goldExamples: [
        "A revision round where every note is addressed precisely and the editor proactively improves a related weak spot",
        "A project folder where versions are clearly labeled (v1, v2-feedback, final) and anyone can roll back instantly",
        "A complex reel delivered ahead of the agreed deadline without any drop in quality",
      ],
      poorExamples: [
        "A revision that fixes one note but quietly breaks the pacing or audio elsewhere",
        "A pile of exports named 'final', 'final2', 'finalreal' with no clear latest version",
        "A simple reel that takes far longer than its scope justifies because of endless small tweaks",
      ],
      goldBreakdown: [
        "Feedback is implemented precisely and quickly, often improving beyond the exact request",
        "Versions are cleanly structured, labeled, and easy for others to review or roll back",
        "Delivery is consistently within or ahead of a reasonable time while maintaining quality",
        "High-impact tasks are prioritized before polish; the editor knows when to stop",
      ],
      poorBreakdown: [
        "Notes are only partially addressed, or new issues appear with each round",
        "Version naming/organization is messy and untraceable",
        "The edit overruns a reasonable time for its scope",
        "Time is spent over-tweaking low-impact details",
      ],
      exercise:
        "Take a reel you've finished and run one full revision round on it: write down 4–6 specific notes, implement them all in a fresh version, then re-watch the whole reel end-to-end to confirm nothing else broke. Name your versions clearly (e.g. v1, v2-notes, final) and time how long the round took relative to the reel's complexity.",
      selfAssessment: [
        "Implementing Revisions Cleanly: did I apply every note accurately without breaking other parts of the edit?",
        "Version Management: are my versions saved, labeled, and easy for someone else to follow or roll back?",
        "Time Bound Execution: did I deliver within the agreed time range for this reel's complexity?",
        "Focus & Scope Control: did I prioritize high-impact tasks and know when 'good enough' was reached?",
      ],
      checklist: [
        "I can implement revision notes cleanly without introducing new issues",
        "I keep my versions saved, organized, and traceable",
        "I deliver within the agreed time for the reel's complexity",
        "I prioritize high-impact tasks and know when 'good enough' is reached",
      ],
      developmentPlan: [
        "On your next revision round, list every note before touching the timeline and tick them off one by one, then re-watch the full reel to catch any regressions",
        "Adopt a consistent version-naming convention (e.g. v1, v2-feedback, final) and keep an exports folder per project",
        "Estimate a target time for each reel based on its complexity, then track your actual time and close the gap",
        "Before polishing, ask: 'Is this change high-impact, or am I over-tweaking?' Stop when the reel is client-ready",
      ],
      proTips: [],
      quiz: [
        {
          q: "A great edit delivered late — or one that breaks other parts when feedback is applied — costs trust.",
          type: "tf",
          answer: true,
          explain: "Reliability matters as much as quality; clean, on-time revisions are what keep clients.",
        },
        {
          q: "Which describes good version management?",
          type: "mcq",
          choices: [
            "Files named final, final2, finalreal",
            "Cleanly labeled versions anyone can review or roll back",
            "One file overwritten every time",
            "No versions at all",
          ],
          answer: 1,
          explain: "Clear, traceable versions (e.g. v1, v2-feedback, final) let anyone roll back instantly.",
        },
        {
          q: "What does good scope control mean?",
          type: "mcq",
          choices: [
            "Polishing every tiny detail endlessly",
            "Prioritizing high-impact work and knowing when 'good enough' is reached",
            "Always taking the maximum time",
            "Ignoring feedback you disagree with",
          ],
          answer: 1,
          explain: "Spend effort where it moves the reel most, and stop when it's client-ready.",
        },
      ],
      flashcards: [
        { front: "Revisions & Time Management", back: "Implementing feedback accurately without new issues, keeping versions organized, delivering on time, and controlling scope." },
        { front: "Version naming", back: "Use a consistent convention (e.g. v1, v2-feedback, final) so anyone can review or roll back." },
        { front: "When to stop", back: "When the reel is client-ready — prioritize high-impact tasks over endless low-impact polish." },
      ],
    },
    nextSkill: null,
    videos: [],
  },
];

/* Fast lookup: skillKey → module. */
export const MODULE_BY_SKILL = Object.fromEntries(
  PILLAR_MODULES.map((m) => [m.skillKey, m])
);

export const TOTAL_MODULES = PILLAR_MODULES.length; // 6

/* =========================================================
   SKILLS — the catalog the reel skill-tag picker and the Training tab
   both read. Re-keyed onto the canonical Gamify skills (same shape the
   old training-data.jsx exported: key, label, icon, module, moduleTitle,
   week) so the skill-tag picker in detail.jsx keeps working unchanged.
   `module`/`week` now point at the pillar module for that skill (core
   pillars only have a module; bonus pillars fall back to label/0).
   ========================================================= */
export const SKILLS = GAMIFY_SKILLS.map((s) => {
  const mod = MODULE_BY_SKILL[s.key] || null;
  return {
    key: s.key,
    label: s.label,
    icon: s.icon,
    module: mod ? mod.id : null,
    moduleTitle: mod ? mod.title : s.label,
    week: mod ? mod.order : 0,
  };
});

/* =========================================================
   Level ladder — gates off completed-module count, rescaled for the 6
   pillar modules. The Training header shows the current level label +
   the next threshold. (Same shape/logic as the old training-data.jsx
   levelForCount, thresholds rescaled from 12 → 6 modules.)
   ========================================================= */
export const LEVELS = [
  { key: "apprentice",  label: "Apprentice",    min: 0, blurb: "Learning the pillars" },
  { key: "editor",      label: "Editor",        min: 2, blurb: "Core craft taking shape" },
  { key: "storyteller", label: "Storyteller",   min: 4, blurb: "Story, sound & visuals" },
  { key: "pro",         label: "Reel Pro",      min: 6, blurb: "All six pillars mastered" },
];

/* Resolve the level for a given count of completed modules. */
export function levelForCount(count) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (count >= lvl.min) current = lvl;
  }
  const next = LEVELS.find((l) => l.min > count) || null;
  return { current, next };
}

/* Extract a YouTube video id from common URL shapes, for inline embeds.
   (Copied verbatim from training-data.jsx.) */
export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

/* =========================================================
   Navigation helper — given a skillKey, produce the deep-link to its
   module (or null if the skill has no module, e.g. bonus pillars).
   The integration layer (app.jsx / GamifyRubricSheet) uses this to
   route a graded editor to "learn this skill".
   ========================================================= */
export function moduleLinkForSkill(skillKey) {
  return MODULE_BY_SKILL[skillKey]
    ? { view: "training", moduleId: skillKey }
    : null;
}
