/* =========================================================
   Reel DNA — filtering model (pure, provider-free).

   Two consumers share this module so a reel is matched the same
   way everywhere:
     · the Classic spreadsheet's per-column filter row
       (text contains per column + select equality), and
     · the Comprehensive view's faceted filter rail
       (multi-select chips per platform/status/source/gene +
       a free-text search + a location search).

   Row values are read through resolveBrief() (lib/reel-dna.jsx) so
   note-derived fields (e.g. an IG-DM row whose quickNotes still
   holds "location=Bali, music=…") filter exactly like promoted
   structured fields.
   ========================================================= */

import {
  GENES, PLATFORMS, STATUSES, SOURCES, CONTENT_TYPES,
  platformLabel, statusLabel, sourceLabel, contentTypeLabel, geneLabel,
  resolveBrief,
} from "./reel-dna.jsx";

/* ---------------------------------------------------------------------------
   RD_COLUMNS — the ORDERED 11-column model of the DnaTable spreadsheet, index-
   aligned to the three hardcoded render sites (thead / ColumnFilterRow / tbody).
   `hideable:false` columns (mark, reel, actions) can never be hidden. The store
   persists ONLY these key strings (per-user "reel_dna_hidden_cols"); alignment
   is enforced by single-owner coupling, so the store does NOT import this. */
export const RD_COLUMNS = [
  { key: "mark",     label: "Mark",          hideable: false },
  { key: "reel",     label: "Reel",          hideable: false },
  { key: "location", label: "Location",      hideable: true },
  { key: "music",    label: "Music",         hideable: true },
  { key: "font",     label: "Font",          hideable: true },
  { key: "sfx",      label: "SFX",           hideable: true },
  { key: "story",    label: "Story / Pacing", hideable: true },
  { key: "notes",    label: "Notes",         hideable: true },
  // Status column removed (DNA-007 — "not needed"). Status still lives on the
  // record and remains filterable in the Comprehensive faceted rail.
  { key: "assets",   label: "Assets",        hideable: true },
  { key: "actions",  label: "",              hideable: false },
];

/* The 8 columns a user is allowed to hide (drives the "Columns" menu). */
export const RD_HIDEABLE_COLUMNS = RD_COLUMNS.filter((c) => c.hideable);

/* makeColVisibility(hiddenCols) => (key) => boolean.
   Pure, provider-free, defensive vs a non-array. A non-hideable column is
   ALWAYS visible (can't be hidden even if its key somehow lands in the set). */
export function makeColVisibility(hiddenCols) {
  const set = new Set(Array.isArray(hiddenCols) ? hiddenCols : []);
  return (key) => {
    const col = RD_COLUMNS.find((c) => c.key === key);
    if (col && col.hideable === false) return true;
    return !set.has(key);
  };
}

/* ---------------------------------------------------------------------------
   Per-row searchable text for each filterable column. Lower-cased lazily by
   the matchers. `get` returns a plain string (may be empty). */
export const RD_TEXT_COLUMNS = [
  { key: "reel",     label: "Reel",          get: (it) => it.reelUrl || "" },
  { key: "location", label: "Location",      get: (it, b) => b.location || "" },
  { key: "music",    label: "Music",         get: (it, b) => [b.musicTrack, b.musicSource].filter(Boolean).join(" ") },
  { key: "font",     label: "Font",          get: (it, b) => b.fontNames || "" },
  { key: "sfx",      label: "SFX",           get: (it, b) => b.sfx || "" },
  { key: "story",    label: "Story / Pacing", get: (it, b) => b.story || "" },
  { key: "notes",    label: "Notes",         get: (it) => it.quickNotes || "" },
];

/* Select-style columns matched by exact equality on a top-level field. */
export const RD_SELECT_COLUMNS = [
  { key: "platform", label: "Platform", field: "platform", options: PLATFORMS, labelFn: platformLabel },
  { key: "source",   label: "Source",   field: "source",   options: SOURCES,   labelFn: sourceLabel },
  { key: "contentType", label: "Type", field: "contentType", options: CONTENT_TYPES, labelFn: contentTypeLabel },
  { key: "status",   label: "Status",   field: "status",   options: STATUSES,  labelFn: statusLabel },
];

/* Default column-filter state: every text column empty, every select "all". */
export function emptyColumnFilters() {
  const f = {};
  RD_TEXT_COLUMNS.forEach((c) => { f[c.key] = ""; });
  RD_SELECT_COLUMNS.forEach((c) => { f[c.key] = "all"; });
  return f;
}

export function hasActiveColumnFilters(filters) {
  if (!filters) return false;
  return RD_TEXT_COLUMNS.some((c) => (filters[c.key] || "").trim()) ||
         RD_SELECT_COLUMNS.some((c) => filters[c.key] && filters[c.key] !== "all");
}

/* Apply the Classic spreadsheet column filters. */
export function applyColumnFilters(items, filters) {
  if (!Array.isArray(items) || !filters) return items || [];
  if (!hasActiveColumnFilters(filters)) return items;

  return items.filter((it) => {
    const b = resolveBrief(it);
    for (const c of RD_TEXT_COLUMNS) {
      const needle = (filters[c.key] || "").trim().toLowerCase();
      if (needle && !c.get(it, b).toLowerCase().includes(needle)) return false;
    }
    for (const c of RD_SELECT_COLUMNS) {
      const want = filters[c.key];
      if (want && want !== "all" && it[c.field] !== want) return false;
    }
    return true;
  });
}

/* ---------------------------------------------------------------------------
   Faceted model for the Comprehensive view. State shape:
     { q, location, platforms[], statuses[], sources[], genes[] }
   The arrays are OR-within / AND-across (pick IG+TT → either platform;
   also pick status=done → AND that). */
export function emptyFacetState() {
  return { q: "", location: "", platforms: [], statuses: [], sources: [], genes: [] };
}

export function hasActiveFacets(s) {
  if (!s) return false;
  return !!(s.q || "").trim() || !!(s.location || "").trim() ||
    s.platforms.length || s.statuses.length || s.sources.length || s.genes.length;
}

/* Count how many of `items` carry each facet value (for the rail badges).
   Counts are computed against the *unfiltered* pool so the user can see what
   exists, not just what's left after filtering. */
export function computeFacets(items) {
  const list = Array.isArray(items) ? items : [];
  const tally = (field) => {
    const m = new Map();
    for (const it of list) { const v = it[field]; if (v) m.set(v, (m.get(v) || 0) + 1); }
    return m;
  };
  const pCount = tally("platform");
  const stCount = tally("status");
  const srcCount = tally("source");

  const gCount = new Map();
  for (const it of list)
    for (const g of (it.genesOfInterest || [])) gCount.set(g, (gCount.get(g) || 0) + 1);

  const opt = (catalog, countMap, labelFn) =>
    catalog
      .map((c) => ({ key: c.key, label: labelFn(c.key), count: countMap.get(c.key) || 0 }))
      .filter((o) => o.count > 0);

  return {
    platforms: opt(PLATFORMS, pCount, platformLabel),
    statuses:  opt(STATUSES, stCount, statusLabel),
    sources:   opt(SOURCES, srcCount, sourceLabel),
    genes:     opt(GENES, gCount, geneLabel),
    total: list.length,
  };
}

/* Free-text haystack for the global search box — reel URL + every brief field. */
export function searchHaystack(it, b) {
  return [
    it.reelUrl, b.location, b.musicTrack, b.musicSource, b.fontNames,
    b.sfx, b.story, b.leftover, it.quickNotes,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function applyFacets(items, s) {
  if (!Array.isArray(items) || !s) return items || [];
  if (!hasActiveFacets(s)) return items;
  const q = (s.q || "").trim().toLowerCase();
  const loc = (s.location || "").trim().toLowerCase();

  return items.filter((it) => {
    if (s.platforms.length && !s.platforms.includes(it.platform)) return false;
    if (s.statuses.length && !s.statuses.includes(it.status)) return false;
    if (s.sources.length && !s.sources.includes(it.source)) return false;
    if (s.genes.length) {
      const g = it.genesOfInterest || [];
      if (!s.genes.every((want) => g.includes(want))) return false;
    }
    if (q || loc) {
      const b = resolveBrief(it);
      if (q && !searchHaystack(it, b).includes(q)) return false;
      if (loc && !(b.location || "").toLowerCase().includes(loc)) return false;
    }
    return true;
  });
}

/* Immutable toggle of a value inside one of the facet arrays. */
export function toggleFacet(state, key, value) {
  const arr = state[key] || [];
  const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  return { ...state, [key]: next };
}

/* RD_COLUMNS / RD_HIDEABLE_COLUMNS / makeColVisibility (contract C3) are
   defined near the TOP of this module (the column registry). */
