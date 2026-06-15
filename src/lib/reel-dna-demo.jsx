/* =========================================================
   Reel DNA — LANDING PAGE DEMO DATA (L0, single source of truth)

   This module is the ONLY source of truth for the public landing
   page proof-of-concept. The 3D helix, the fan-out asset cards, and
   the read-only CapCut timeline all read from `DEMO_REEL` here so the
   three lists can never drift (red flag #6 in the plan).

   Nothing here is wired to Supabase — it is static mock data modeled
   on a genuinely complex, multi-layer edit (à la a dense Instagram
   reel) so the timeline looks like real reverse-engineered footage.

   CONTRACT (do not break — L1 components depend on these shapes):

     DEMO_REEL.sampleReel = { sourceUrl, mp4, poster, durationLabel }
     DEMO_REEL.totalSec   = number (timeline length, for the ruler)
     DEMO_REEL.genes[]    = {
        key, label, color, helixT (0..1 position along the helix),
        blurb, assets: [{ name, kind, info, downloadUrl, swapHint }]
     }
     DEMO_REEL.timeline[] = {
        id, label, gene, startTs ("m:ss"), endTs ("m:ss"),
        notes, downloadUrl
     }
        — `gene` MUST be one of DEMO_REEL.genes[].key (timeline ↔ helix
          parity is asserted by the QA harness).

   Derived export:
     LANES[] = [{ key, label, color, order }]  (one per gene, in helix
       order) — shared by the timeline view so lane order/labels/colors
       match the helix nodes exactly.
   ========================================================= */

/* Neon palette tuned for the premium black + glow theme. These are
   raw hex (not CSS vars) because the R3F helix needs real colors for
   emissive materials, and the DOM components can use them directly too. */
const C = {
  aroll:  "#36e0c8", // teal      — primary footage
  broll:  "#4da6ff", // blue      — secondary / cutaway footage
  text:   "#ffb547", // amber     — titles / kinetic type
  caption:"#ffd83d", // yellow    — burned-in captions
  afx:    "#b06bff", // violet    — transitions / effects
  gfx:    "#ff6bd6", // pink      — overlays / graphics / stickers
  sfx:    "#5dff8f", // green     — sound effects
  music:  "#9b8cff", // periwinkle— music bed
  vo:     "#ff7a6b", // coral     — voiceover
  color:  "#7af0ff", // cyan      — color / LUT
  speed:  "#ff4d6d", // red       — speed ramps
  logo:   "#c9d4e8", // pale      — brand / logo
};

/* ---------- Genes (helix nodes + asset groups) ----------
   12 genes → 12 helix nodes → 12 timeline lanes. helixT spreads them
   evenly down the strand (0 = top, 1 = bottom). Each gene carries the
   assets that fan out around the helix on hover. */
export const genes = [
  {
    key: "aroll", label: "A-Roll", color: C.aroll, helixT: 0.04,
    blurb: "Primary talking / performance footage — the spine of the cut.",
    assets: [
      { name: "Main take — 4K 60fps", kind: "video", info: "Sony FX3 · 24-105 · graded", downloadUrl: "#aroll-main", swapHint: "Drop your hero footage" },
      { name: "Alt angle — wide", kind: "video", info: "Locked-off B-cam", downloadUrl: "#aroll-wide", swapHint: "Swap your wide" },
    ],
  },
  {
    key: "broll", label: "B-Roll", color: C.broll, helixT: 0.12,
    blurb: "Cutaways & inserts that hide jump-cuts and keep energy high.",
    assets: [
      { name: "Product macro", kind: "video", info: "100mm macro · 120fps", downloadUrl: "#broll-macro", swapHint: "Use your own insert" },
      { name: "City timelapse", kind: "video", info: "Stock · 5s", downloadUrl: "#broll-city", swapHint: "Swap establishing shot" },
      { name: "Hands close-up", kind: "video", info: "Detail cutaway", downloadUrl: "#broll-hands", swapHint: "Swap detail shot" },
    ],
  },
  {
    key: "text", label: "Titles", color: C.text, helixT: 0.20,
    blurb: "Kinetic title cards & lower-thirds — the typographic hook.",
    assets: [
      { name: "Font — Druk Wide Bold", kind: "font", info: "Display · paid", downloadUrl: "https://commercialtype.com/catalog/druk", swapHint: "Pick your headline font" },
      { name: "Font — Inter Tight", kind: "font", info: "UI · free (Google Fonts)", downloadUrl: "https://fonts.google.com/specimen/Inter+Tight", swapHint: "Swap body font" },
      { name: "Title preset — slam-in", kind: "preset", info: "After Effects .mogrt", downloadUrl: "#text-slam", swapHint: "Use your title preset" },
    ],
  },
  {
    key: "caption", label: "Captions", color: C.caption, helixT: 0.28,
    blurb: "Word-by-word burned-in subtitles for sound-off viewing.",
    assets: [
      { name: "Caption style — bounce pop", kind: "preset", info: "Auto-captions · karaoke highlight", downloadUrl: "#cap-bounce", swapHint: "Swap caption style" },
      { name: "Font — Montserrat ExtraBold", kind: "font", info: "Free (Google Fonts)", downloadUrl: "https://fonts.google.com/specimen/Montserrat", swapHint: "Pick caption font" },
    ],
  },
  {
    key: "afx", label: "AFX / FX", color: C.afx, helixT: 0.36,
    blurb: "Transitions, glitches, zoom-punches and motion effects.",
    assets: [
      { name: "Zoom punch transition", kind: "effect", info: "12 frames · ease-out", downloadUrl: "#afx-zoom", swapHint: "Swap transition" },
      { name: "RGB glitch wipe", kind: "effect", info: "Chromatic aberration", downloadUrl: "#afx-glitch", swapHint: "Use your glitch" },
      { name: "Film burn overlay", kind: "effect", info: "Screen blend · 8s loop", downloadUrl: "#afx-burn", swapHint: "Swap overlay FX" },
    ],
  },
  {
    key: "gfx", label: "Graphics", color: C.gfx, helixT: 0.44,
    blurb: "Stickers, arrows, emoji and overlay graphics that point the eye.",
    assets: [
      { name: "Arrow sticker pack", kind: "graphic", info: "PNG · 24 frames", downloadUrl: "#gfx-arrows", swapHint: "Use your stickers" },
      { name: "Progress bar overlay", kind: "graphic", info: "Animated · transparent", downloadUrl: "#gfx-bar", swapHint: "Swap overlay" },
    ],
  },
  {
    key: "sfx", label: "SFX", color: C.sfx, helixT: 0.52,
    blurb: "Whooshes, risers, impacts & pops that sell every cut.",
    assets: [
      { name: "Whoosh — transition", kind: "audio", info: "0.4s · -6dB", downloadUrl: "#sfx-whoosh", swapHint: "Swap whoosh" },
      { name: "Impact hit", kind: "audio", info: "Sub-boom · on beat", downloadUrl: "#sfx-impact", swapHint: "Use your impact" },
      { name: "UI pop", kind: "audio", info: "For sticker reveals", downloadUrl: "#sfx-pop", swapHint: "Swap pop" },
    ],
  },
  {
    key: "music", label: "Music", color: C.music, helixT: 0.60,
    blurb: "The trending audio bed that sets pacing and mood.",
    assets: [
      { name: "Track — 'Night Drive' (trending)", kind: "audio", info: "Original audio · 128 BPM", downloadUrl: "#music-track", swapHint: "Swap the track" },
      { name: "Beat-grid markers", kind: "data", info: "Auto-detected · 1/4 notes", downloadUrl: "#music-grid", swapHint: "Re-detect to your song" },
    ],
  },
  {
    key: "vo", label: "Voiceover", color: C.vo, helixT: 0.68,
    blurb: "Scripted narration ducked under the music bed.",
    assets: [
      { name: "VO take — final", kind: "audio", info: "De-noised · -3dB · ducked", downloadUrl: "#vo-final", swapHint: "Drop your VO" },
      { name: "Script — VO", kind: "doc", info: "Timed to clips", downloadUrl: "#vo-script", swapHint: "Use your script" },
    ],
  },
  {
    key: "color", label: "Color / LUT", color: C.color, helixT: 0.78,
    blurb: "The grade & LUT that give the reel its signature look.",
    assets: [
      { name: "LUT — teal & orange", kind: "lut", info: ".cube · 33pt", downloadUrl: "#color-lut", swapHint: "Apply your LUT" },
      { name: "Grade preset", kind: "preset", info: "Lift/gamma/gain", downloadUrl: "#color-grade", swapHint: "Swap grade" },
    ],
  },
  {
    key: "speed", label: "Speed Ramps", color: C.speed, helixT: 0.88,
    blurb: "Time-remaps & speed ramps that punctuate the beats.",
    assets: [
      { name: "Ramp — 100→400%", kind: "preset", info: "Optical flow · on beat", downloadUrl: "#speed-ramp", swapHint: "Swap ramp" },
      { name: "Freeze-frame preset", kind: "preset", info: "Hold + scale 110%", downloadUrl: "#speed-freeze", swapHint: "Use your freeze" },
    ],
  },
  {
    key: "logo", label: "Brand / Logo", color: C.logo, helixT: 0.96,
    blurb: "End-card, watermark & brand bumper.",
    assets: [
      { name: "Animated logo bumper", kind: "graphic", info: "1.2s · alpha", downloadUrl: "#logo-bumper", swapHint: "Use your logo" },
      { name: "Corner watermark", kind: "graphic", info: "PNG · 12% opacity", downloadUrl: "#logo-watermark", swapHint: "Swap watermark" },
    ],
  },
];

/* ---------- Timeline (the reverse-engineered multi-layer edit) ----------
   Reel is 0:28. Clips are dense and overlapping across all 12 lanes so it
   reads like a complicated CapCut/Premiere project. `gene` ties each clip
   to its lane + helix node. Shape matches reel-deconstructor's ClipBlock. */
export const totalSec = 28;

let _n = 0;
const seg = (gene, label, startTs, endTs, notes = "", downloadUrl = "") =>
  ({ id: `demo-${gene}-${_n++}`, gene, label, startTs, endTs, notes, downloadUrl });

export const timeline = [
  // A-roll — the backbone, a few long takes
  seg("aroll", "Hook — to camera", "0:00", "0:03", "Pattern interrupt"),
  seg("aroll", "Point 1", "0:06", "0:11"),
  seg("aroll", "Point 2", "0:15", "0:20"),
  seg("aroll", "CTA — to camera", "0:24", "0:28"),

  // B-roll — fills the gaps between A-roll
  seg("broll", "Product macro", "0:03", "0:06"),
  seg("broll", "City timelapse", "0:11", "0:13"),
  seg("broll", "Hands close-up", "0:13", "0:15"),
  seg("broll", "Reaction cutaway", "0:20", "0:22"),
  seg("broll", "Detail insert", "0:22", "0:24"),

  // Titles — kinetic type beats
  seg("text", "DRUK slam title", "0:00", "0:02"),
  seg("text", "Lower-third", "0:06", "0:09"),
  seg("text", "Big number '3'", "0:15", "0:17"),
  seg("text", "End title", "0:25", "0:28"),

  // Captions — run almost the whole reel
  seg("caption", "Auto-captions", "0:01", "0:24", "Word-by-word bounce"),

  // AFX — transitions on every cut
  seg("afx", "Zoom punch", "0:03", "0:03.5"),
  seg("afx", "Glitch wipe", "0:11", "0:11.5"),
  seg("afx", "Whip transition", "0:15", "0:15.5"),
  seg("afx", "Film burn", "0:20", "0:22"),
  seg("afx", "Zoom punch", "0:24", "0:24.5"),

  // Graphics — overlays
  seg("gfx", "Arrow sticker", "0:07", "0:09"),
  seg("gfx", "Progress bar", "0:00", "0:28", "Top of frame"),
  seg("gfx", "Emoji burst", "0:17", "0:18"),

  // SFX — pinpoint hits
  seg("sfx", "Whoosh", "0:03", "0:03.5"),
  seg("sfx", "Impact hit", "0:15", "0:15.5"),
  seg("sfx", "UI pop", "0:07", "0:07.5"),
  seg("sfx", "Riser", "0:22", "0:24"),

  // Music — one continuous bed
  seg("music", "Night Drive (trending)", "0:00", "0:28", "128 BPM"),

  // Voiceover — under the music
  seg("vo", "VO — intro", "0:03", "0:06"),
  seg("vo", "VO — body", "0:11", "0:20"),

  // Color — whole-reel adjustment layer
  seg("color", "Teal & orange LUT", "0:00", "0:28", "Adjustment layer"),

  // Speed — punctuation
  seg("speed", "Ramp 100→400%", "0:13", "0:15"),
  seg("speed", "Freeze-frame", "0:17", "0:18"),

  // Logo
  seg("logo", "Watermark", "0:00", "0:28", "Corner · 12%"),
  seg("logo", "Logo bumper", "0:26", "0:28"),
];

/* ---------- Derived: lanes (timeline ↔ helix shared order) ---------- */
export const LANES = genes.map((g, i) => ({
  key: g.key, label: g.label, color: g.color, order: i,
}));

/* ---------- Sample reel (the playable / scrubable element) ----------
   Red flag #1: the IG URL is display-only; the thing that actually
   plays + scrubs is our own asset. mp4/poster paths live in /public.
   Agent A drops the real files in; until then these paths 404 gracefully
   and the player shows its upload affordance. */
export const sampleReel = {
  sourceUrl: "https://www.instagram.com/reels/DW63eqkCMMN/",
  mp4: "/demo/sample-reel.mp4",
  poster: "/demo/sample-reel-poster.jpg",
  durationLabel: "0:28",
};

/* ---------- Bundled export (what L2 imports) ---------- */
export const DEMO_REEL = { sampleReel, totalSec, genes, timeline, LANES };

export default DEMO_REEL;
