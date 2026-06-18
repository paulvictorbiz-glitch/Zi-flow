/* =========================================================
   Thumbnail DNA — stateless constants + helpers (no provider).

   Mirrors src/lib/reel-dna.jsx but for YouTube THUMBNAILS: paste a
   YouTube link, derive the thumbnail image client-side (zero-key, no
   server call), then tag it with six manual "design genes". The store
   (store.jsx) owns the thumbnail_dna rows; this module only holds the
   static catalog + pure URL helpers, so non-React code can import
   extractYouTubeId/thumbnailUrlFromId without pulling in React context.

   The six design genes are EXACTLY: color, typography, face, layout,
   mood, subject — each a PLAIN TEXT column on thumbnail_dna (pass-through
   both directions, NOT jsonb). genesOfInterest text[] marks which genes
   the user flagged (chips), mirroring reel_dna.
   ========================================================= */

/* The six design "genes" a captured thumbnail can be broken into. `key`
   matches a flat text column on thumbnail_dna AND the genes_of_interest
   array values (so a chip lights up the gene of interest). */
export const GENES = [
  { key: "color",      label: "Color",      hint: "Palette, contrast, saturation" },
  { key: "typography", label: "Typography", hint: "Fonts, weight, text treatment" },
  { key: "face",       label: "Face",       hint: "Expression, gaze, framing" },
  { key: "layout",     label: "Layout",     hint: "Composition, rule-of-thirds, focal point" },
  { key: "mood",       label: "Mood",       hint: "Emotion, energy, vibe" },
  { key: "subject",    label: "Subject",    hint: "What/who is shown" },
];

export const GENE_KEYS = GENES.map(g => g.key);

/* Thumbnail DNA is YouTube-only for now (paste a YT link). Kept as an
   array to mirror reel-dna's PLATFORMS shape and the C1 platform field. */
export const PLATFORMS = [
  { key: "yt", label: "YouTube" },
];

export const STATUSES = [
  { key: "captured",    label: "Captured" },
  { key: "in_progress", label: "In progress" },
  { key: "done",        label: "Done" },
];

export const SOURCES = [
  { key: "manual", label: "Manual" },
  { key: "yt_playlist", label: "Playlist" },
];

const LABELS = (arr) => Object.fromEntries(arr.map(x => [x.key, x.label]));
const PLATFORM_LABEL = LABELS(PLATFORMS);
const STATUS_LABEL   = LABELS(STATUSES);
const SOURCE_LABEL   = LABELS(SOURCES);
const GENE_LABEL     = LABELS(GENES);

export const platformLabel = (k) => PLATFORM_LABEL[k] || k || "—";
export const statusLabel   = (k) => STATUS_LABEL[k] || k || "—";
export const sourceLabel   = (k) => SOURCE_LABEL[k] || k || "—";
export const geneLabel     = (k) => GENE_LABEL[k] || k;

/* ---------------------------------------------------------------------------
   extractYouTubeId(url) — pull the 11-char video id out of any common YouTube
   URL form, returning null if none is found. Handles:
     · youtu.be/ID
     · youtube.com/watch?v=ID  (and ?v=ID anywhere in the query)
     · youtube.com/shorts/ID
     · youtube.com/embed/ID
     · youtube.com/live/ID
   Tolerant of a missing scheme ("youtu.be/abc", "www.youtube.com/watch?v=…").
   Tries the URL parser first (robust to extra query params / fragments), then
   falls back to a regex so a bare/odd string still resolves. Pure + zero-key. */
const YT_ID = "[A-Za-z0-9_-]{11}";

export function extractYouTubeId(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;

  // 1) Try the URL parser. Prepend a scheme if the user pasted a bare host so
  //    new URL() doesn't throw on "youtu.be/ID" / "www.youtube.com/…".
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const idRe = new RegExp(`^${YT_ID}$`);

    if (host === "youtu.be") {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && idRe.test(seg)) return seg;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && idRe.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      // /shorts/ID, /embed/ID, /live/ID, /v/ID
      if (parts.length >= 2 && /^(shorts|embed|live|v)$/i.test(parts[0]) && idRe.test(parts[1])) {
        return parts[1];
      }
    }
  } catch {
    /* fall through to regex */
  }

  // 2) Regex fallback — also catches odd/partial strings the parser missed.
  const patterns = [
    new RegExp(`youtu\\.be/(${YT_ID})`, "i"),
    new RegExp(`[?&]v=(${YT_ID})`, "i"),
    new RegExp(`/shorts/(${YT_ID})`, "i"),
    new RegExp(`/embed/(${YT_ID})`, "i"),
    new RegExp(`/live/(${YT_ID})`, "i"),
    new RegExp(`/v/(${YT_ID})`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(raw);
    if (m) return m[1];
  }
  return null;
}

/* ---------------------------------------------------------------------------
   thumbnailUrlFromId(id, quality) — build a zero-key YouTube thumbnail image
   URL for a video id. Defaults to maxresdefault (1280×720); the page's <img>
   uses onError to fall back to hqdefault client-side (maxres doesn't exist for
   every video, but hqdefault always does). Returns "" for a falsy id. */
export function thumbnailUrlFromId(id, quality = "maxresdefault") {
  if (!id) return "";
  return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
}

/* The hqdefault fallback target for the <img> onError handler. Kept as a
   sibling helper so the page doesn't hard-code the quality string. */
export function thumbnailFallbackUrlFromId(id) {
  return thumbnailUrlFromId(id, "hqdefault");
}
