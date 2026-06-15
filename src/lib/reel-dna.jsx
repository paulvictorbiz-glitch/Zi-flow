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
