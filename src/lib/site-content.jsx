/* =========================================================
   Site content — mock marketing copy for the public site
   (founding team, about, product). Single source of truth so the
   Home, About, Product, and Team views stay consistent.

   Pure data + a couple of constants. No React, no data fetching.
   ========================================================= */

/* ---------- Founding team ---------- */
export const TEAM = [
  {
    id: "paul",
    name: "Paul Victor",
    title: "Co-Founder & CEO",
    photo: "/team/paul-victor.jpeg",
    initials: "PV",
    accent: "#56e6ff",
    bio: "Builds the product and the business. Paul turns the messy reality of short-form production into systems creators can actually use — from the pipeline that runs the studio to the engine that reverse-engineers a reel into its genes.",
    social: { type: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/in/samuelpaulvictor/" },
  },
  {
    id: "leroy",
    name: "Leroy Crosby",
    title: "Co-Founder & CTO",
    photo: "/team/leroy-crosby.jpg",
    initials: "LC",
    accent: "#9b8cff",
    bio: "Lives in the edit. Leroy sets the creative bar — the pacing, the cuts, the feel — and makes sure every reel we deconstruct teaches something a creator can put straight back into their own work.",
    social: { type: "instagram", label: "Instagram", url: "https://www.instagram.com/cr.osby/" },
  },
];

/* ---------- The "why" (mission) ---------- */
export const MISSION = {
  eyebrow: "Why we're doing this",
  headline: "Remove the mystery from editing.",
  body: "We're a team of creators who believe understanding and improving short-form content should be effortless, expressive, and accessible to everyone. With Reel DNA, we reverse-engineer reels into intuitive timelines — exposing the cuts, assets, and timing that make a clip work — so editing decisions become visible and learnable. Our mission is simple: remove the mystery from editing so creators can confidently analyze, improve, and apply bold ideas to their content.",
};

/* ---------- About page ---------- */
export const ABOUT = {
  eyebrow: "About us",
  headline: "We turn great reels into a blueprint anyone can learn from.",
  intro:
    "Reel DNA started with a simple frustration: the best short-form edits look effortless, but the craft behind them is invisible. The cuts, the fonts, the sound design, the speed ramps — all of it is locked inside a finished clip. We built Reel DNA to unlock it.",
  values: [
    {
      title: "Make the invisible visible",
      body: "Every reel is a stack of deliberate decisions. We expose them as a clean, scrubbable timeline so you can see exactly how a clip was built.",
    },
    {
      title: "Assets, not just analysis",
      body: "We don't stop at 'here's what they did.' Each gene carries the real building blocks — fonts, LUTs, transitions, SFX — ready to download or swap with your own.",
    },
    {
      title: "Learnable by design",
      body: "Pacing and structure are skills. By showing the genome of a reel, we turn watching into learning, so your next edit is sharper than your last.",
    },
    {
      title: "Built by operators",
      body: "We run a real short-form studio. Reel DNA is the tool we wished existed — battle-tested on our own pipeline before it ever reached you.",
    },
  ],
  stats: [
    { value: "12", label: "Genes per reel" },
    { value: "<1s", label: "To a full breakdown" },
    { value: "100%", label: "Assets swappable" },
    { value: "0", label: "Editing degrees required" },
  ],
};

/* ---------- Product page ---------- */
export const PRODUCT = {
  eyebrow: "The product",
  headline: "Paste a reel. Get its genome.",
  intro:
    "Reel DNA reverse-engineers any short-form video into a multi-layer timeline — then hands you every asset, timed and downloadable.",
  features: [
    {
      key: "deconstruct",
      title: "Instant deconstruction",
      body: "Drop in a reel and watch it resolve into a CapCut-style, multi-track timeline — footage, titles, captions, transitions, SFX, music, color, and speed, each on its own lane.",
      color: "#56e6ff",
    },
    {
      key: "genes",
      title: "Twelve genes, fully exposed",
      body: "Hover a gene on the DNA helix and its layer lights up on the timeline while its assets fan out — the exact font, the LUT, the transition preset, the beat-grid.",
      color: "#9b8cff",
    },
    {
      key: "download",
      title: "Download every asset",
      body: "Grab the real building blocks behind a reel. No guessing which font or which sound effect — it's right there, one click away.",
      color: "#36e0c8",
    },
    {
      key: "swap",
      title: "Swap with your own",
      body: "Love the structure but not the footage? Replace any layer with your own clips, font, or logo. Keep the proven pacing; make it 100% you.",
      color: "#ffb547",
    },
    {
      key: "scrub",
      title: "Scrub frame-by-frame",
      body: "Upload your own cut and scrub it against the deconstructed timeline to see exactly where your pacing diverges from a reel that worked.",
      color: "#ff6bd6",
    },
    {
      key: "learn",
      title: "Learn the craft",
      body: "Every breakdown is a lesson. See how pros structure a hook, time a transition, or land a beat — then apply it to your next post.",
      color: "#5dff8f",
    },
  ],
  steps: [
    { n: "01", title: "Paste any reel URL", body: "Instagram, TikTok, or YouTube Shorts." },
    { n: "02", title: "We sequence the DNA", body: "Cuts, layers, assets, and timing — extracted automatically." },
    { n: "03", title: "Explore & download", body: "Scrub the timeline, grab the assets, or swap in your own." },
  ],
};

/* ---------- Testimonials ---------- */
// TODO: replace with real testimonial copy before production
export const TESTIMONIALS = [
  {
    name: "Maya Rodriguez",
    role: "Short-form Editor",
    quote: "Reel DNA showed me exactly why a hook worked — the cut timing, the SFX placement, all of it. My retention jumped in a week.",
    avatar: "",
  },
  {
    name: "Devon Blake",
    role: "Content Creator, 480k",
    quote: "I stopped guessing which font or transition a viral reel used. It's just there, one click, ready to drop into my own edit.",
    avatar: "",
  },
  {
    name: "Priya Nair",
    role: "Agency Producer",
    quote: "We onboard junior editors with Reel DNA now. Watching a breakdown teaches pacing faster than any course we tried.",
    avatar: "",
  },
  {
    name: "Marcus Feld",
    role: "TikTok Strategist",
    quote: "The timeline view is the clearest way I've ever seen to explain 'why this clip works' to a client. Total game-changer.",
    avatar: "",
  },
  {
    name: "Sofia Alvarez",
    role: "Reels Coach",
    quote: "Being able to swap the footage but keep the proven structure means my students ship real posts, not just watch tutorials.",
    avatar: "",
  },
  {
    name: "Jaylen Carter",
    role: "Brand Video Lead",
    quote: "Reverse-engineering a competitor's best reel used to take an afternoon. Now it's under a second and I have every asset.",
    avatar: "",
  },
  {
    name: "Hannah Weiss",
    role: "Freelance Editor",
    quote: "The beat-grid and speed-ramp breakdowns alone paid for themselves. I finally understand how the pros land a transition.",
    avatar: "",
  },
  {
    name: "Omar Haddad",
    role: "Studio Owner",
    quote: "It's the tool I wished existed for years. My whole team deconstructs, learns, and ships sharper edits every single week.",
    avatar: "",
  },
];

/* ---------- Nav ---------- */
export const NAV = [
  { key: "home", label: "Home" },
  { key: "product", label: "Product" },
  { key: "about", label: "About" },
  { key: "team", label: "Team" },
];
