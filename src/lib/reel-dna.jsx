/* =========================================================
   Reel DNA — stateless constants + helpers (no provider).

   The store (store.jsx) is the single source of truth for reel_dna
   rows; this module only holds the static catalog (genes, platforms,
   statuses, sources) and a couple of pure helpers used by the page and
   the share-target prefill. Keeping it provider-free avoids a second
   hydrate and lets non-React code (e.g. the deep-link handler in app.jsx)
   import platformFromUrl without pulling in React context.

   Gene sub-key casing is camelCase app-side (e.g. hook.startTs). The DB
   columns are jsonb and pass through untouched, so this casing is the
   contract — keep it consistent everywhere a gene object is written.
   ========================================================= */

/* The five "genes" a captured reel can be broken into. `key` matches the
   genes_of_interest array values and the per-gene jsonb column names. */
export const GENES = [
  { key: "music", label: "Music",  hint: "Track name, link, source" },
  { key: "font",  label: "Font",   hint: "Font names + links/downloads" },
  { key: "hook",  label: "Hook",   hint: "Start/end timestamps + clip" },
  { key: "sfx",   label: "SFX",    hint: "Sound-effect times + type" },
  { key: "story", label: "Story",  hint: "Structure / style notes" },
];

export const GENE_KEYS = GENES.map(g => g.key);

export const PLATFORMS = [
  { key: "ig",     label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "yt",     label: "YouTube" },
];

export const STATUSES = [
  { key: "captured",    label: "Captured" },
  { key: "in_progress", label: "In progress" },
  { key: "done",        label: "Done" },
];

export const SOURCES = [
  { key: "manual",       label: "Manual" },
  { key: "ig_dm",        label: "IG DM" },
  { key: "share_target", label: "Shared" },
];

const LABELS = (arr) => Object.fromEntries(arr.map(x => [x.key, x.label]));
const PLATFORM_LABEL = LABELS(PLATFORMS);
const STATUS_LABEL   = LABELS(STATUSES);
const SOURCE_LABEL    = LABELS(SOURCES);
const GENE_LABEL      = LABELS(GENES);

export const platformLabel = (k) => PLATFORM_LABEL[k] || k || "—";
export const statusLabel   = (k) => STATUS_LABEL[k] || k || "—";
export const sourceLabel   = (k) => SOURCE_LABEL[k] || k || "—";
export const geneLabel     = (k) => GENE_LABEL[k] || k;

/* Sniff the platform from a pasted/shared URL. Returns a PLATFORMS key,
   defaulting to 'ig' (the most common capture). The user can override in
   the form, so this is a best-effort prefill, not validation. */
export function platformFromUrl(url) {
  const u = (url || "").toLowerCase();
  if (/tiktok\.com/.test(u)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(u)) return "yt";
  if (/instagram\.com|instagr\.am/.test(u)) return "ig";
  return "ig";
}

/* ---------------------------------------------------------------------------
   parseTagNote(note) — turn a free-text capture note into structured reel_dna
   fields, so a one-line note like

     location=Bali, music=phonk house, font=Aktiv Grotesk, sfx=whoosh @0:02

   auto-populates the spreadsheet columns + gene chips instead of being typed
   field-by-field. This is the heart of the "1-click logging" flow: Paul DMs
   (or pastes) a reel with a tag note and the row fills itself in.

   Tolerant by design: keys are case-insensitive with aliases, values may
   contain commas/spaces (a value runs until the next recognized key), wrapping
   quotes are stripped, and a bare key with no value (e.g. "SFX") still lights
   that gene's chip. Anything unrecognized is preserved as `leftover` (→ kept in
   quickNotes) so nothing the user typed is silently dropped.

   Returns: { fields, genesOfInterest, location, leftover }
     · fields  — partial { music, font, sfx, story, hook } gene objects, shaped
                 exactly like GeneEditor expects (music.track, font.names, …).
     · genesOfInterest — gene keys mentioned (so the chips light up).
     · location — top-level location string (own reel_dna column) or null.
     · leftover — unrecognized free text, or null.                            */
const TAG_ALIASES = {
  location: "location", loc: "location", place: "location", where: "location",
  music: "music", track: "music", song: "music", audio: "music",
  font: "font", fonts: "font", typeface: "font", type: "font",
  sfx: "sfx", sound: "sfx", sounds: "sfx", fx: "sfx",
  story: "story", pacing: "story", structure: "story", style: "story",
  hook: "hook",
};

const stripValue = (s) =>
  String(s || "")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")  // wrapping quotes
    .replace(/[,;]+$/, "")                    // trailing separators
    .trim();

// Fold a parsed value into the gene-object shape GeneEditor reads. Returns the
// gene key touched, or null for location (handled by the caller) / no-op.
function applyTagValue(fields, canonical, value) {
  switch (canonical) {
    case "music": if (value) fields.music = { ...(fields.music || {}), track: value }; return "music";
    case "font":  if (value) fields.font  = { ...(fields.font  || {}), names: value }; return "font";
    case "sfx":   if (value) fields.sfx   = { ...(fields.sfx   || {}), notes: value }; return "sfx";
    case "story": if (value) fields.story = { ...(fields.story || {}), styleNotes: value }; return "story";
    case "hook":
      // hook is timestamp/clip-based; a URL value is a clip download, anything
      // else has no structured home → let the caller push it to leftover.
      if (value && /^https?:\/\//i.test(value)) {
        fields.hook = { ...(fields.hook || {}), downloadLink: value };
      } else if (value) {
        return "hook:leftover";
      }
      return "hook";
    default: return null;
  }
}

export function parseTagNote(note) {
  const empty = { fields: {}, genesOfInterest: [], location: null, leftover: null };
  const text = String(note || "").trim();
  if (!text) return empty;

  const keyAlt = Object.keys(TAG_ALIASES)
    .sort((a, b) => b.length - a.length)         // longest-first so "location" beats "loc"
    .join("|");
  const re = new RegExp(`(?:^|[\\s,;\\n])(${keyAlt})\\s*[:=]\\s*`, "gi");

  // Collect each key match + where its value begins.
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ canonical: TAG_ALIASES[m[1].toLowerCase()], matchStart: m.index, valueStart: re.lastIndex });
  }
  if (hits.length === 0) return { ...empty, leftover: text };

  const fields = {};
  const genes = new Set();
  const leftoverParts = [];
  let location = null;

  // Text before the first recognized key is free-text leftover.
  const preamble = text.slice(0, hits[0].matchStart).trim();
  if (preamble) leftoverParts.push(preamble);

  hits.forEach((h, i) => {
    const valueEnd = i + 1 < hits.length ? hits[i + 1].matchStart : text.length;
    const value = stripValue(text.slice(h.valueStart, valueEnd));
    if (h.canonical === "location") {
      if (value) location = value;
      return;
    }
    const touched = applyTagValue(fields, h.canonical, value);
    if (touched === "hook:leftover") {
      if (value) leftoverParts.push(`hook: ${value}`);
      genes.add("hook");
    } else if (touched) {
      genes.add(touched);
    }
  });

  return {
    fields,
    genesOfInterest: [...genes],
    location: location || null,
    leftover: leftoverParts.length ? leftoverParts.join(" · ") : null,
  };
}

/* A captured URL may arrive via the PWA share-target as a `text` field
   (some apps put the link in text, not url). Pull the first http(s) URL
   out of whatever string we were handed. */
export function extractUrl(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const m = /https?:\/\/[^\s]+/.exec(c);
    if (m) return m[0];
    if (/^[\w-]+\.[\w.-]+\//.test(c)) return c; // bare domain/path
  }
  return (candidates.find(Boolean) || "").trim();
}
