/* =========================================================
   Locations — structured, importable map-data layer.

   Two-layer Locations capability:
     · Layer 1 (quick): a Google My Maps embed, see MY_MAPS below.
     · Layer 2 (structured): a normalized Location record store that
       other tools (reels, planning, notes) can read/link to later.

   This layer is intentionally self-contained and local-first
   (localStorage, key `ziflow.locations.v1`) so it ships today
   without a Supabase schema change. The provider/hook shape
   mirrors `useWorkflow()` so a future move onto the store/DB is a
   drop-in: consumers keep calling `useLocations()`.

   Import sources supported (Google My Maps "Export to KML/KMZ"
   gives KML; generic sources give GeoJSON or CSV):
     · KML        — <Placemark> points, folder → category
     · GeoJSON    — FeatureCollection of Point features
     · CSV        — name,lat,lng[,category,address,notes,tags]
   ========================================================= */

import React from "react";

/* ---------- The quick-embed My Maps registry ----------
   Pulled from the embed iframe the operator pasted:
   .../maps/d/u/0/embed?mid=<MID>&ehbc=<EHBC>
   Keeping mid + ehbc separate so the structured layer can later
   tie imported placemarks back to the map they came from
   (Location.mapMid). */
const MY_MAPS = {
  mid: "1R1p7zxXRXizjVo6A9O7l00FffJB-WPE",
  ehbc: "2E312F",
  label: "Zi-flow locations map",
};

function myMapsEmbedUrl(map = MY_MAPS) {
  return (
    "https://www.google.com/maps/d/u/0/embed?mid=" +
    encodeURIComponent(map.mid) +
    "&ehbc=" +
    encodeURIComponent(map.ehbc)
  );
}

/* ---------- Location record schema ----------
   Stable shape every consumer can rely on. `linkedReelIds` /
   `linkedNoteIds` are the forward hooks for connecting a place to
   reels, planning items, and notes once those tools opt in. */
function makeLocation(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || "loc-" + Math.random().toString(36).slice(2, 9),
    name: (partial.name || "").trim() || "Untitled place",
    category: (partial.category || "").trim(),
    lat: numOrNull(partial.lat),
    lng: numOrNull(partial.lng),
    address: (partial.address || "").trim(),
    notes: (partial.notes || "").trim(),
    tags: Array.isArray(partial.tags)
      ? partial.tags.filter(Boolean)
      : splitTags(partial.tags),
    source: partial.source || "manual", // manual | kml | geojson | csv
    mapMid: partial.mapMid || null, // which My Maps mid it came from
    linkedReelIds: partial.linkedReelIds || [], // → reels (future)
    linkedNoteIds: partial.linkedNoteIds || [], // → notes (future)
    createdAt: partial.createdAt || now,
    updatedAt: now,
  };
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function splitTags(v) {
  if (!v) return [];
  return String(v)
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/* Dedupe key — same name at (near) the same point is the same
   place. Rounds coords so re-imports of the same KML don't pile
   up duplicates. */
function dedupeKey(loc) {
  const r = n => (n == null ? "_" : Number(n).toFixed(5));
  return (loc.name || "").toLowerCase().trim() + "|" + r(loc.lat) + "|" + r(loc.lng);
}

/* =========================================================
   Importers — text in, Location[] out. Each is defensive: a
   malformed source yields [] rather than throwing, and partial
   rows (missing coords) still import so the operator can fix
   them in the table.
   ========================================================= */

/* ---- KML (Google My Maps "Export to KML") ---- */
function parseKml(text, mapMid = null) {
  const out = [];
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, "application/xml");
  } catch (_) {
    return out;
  }
  if (!doc || doc.querySelector("parsererror")) return out;

  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  for (const pm of placemarks) {
    const name = textOf(pm, "name");
    const desc = textOf(pm, "description");

    // Folder name (My Maps "layer") → category, if the Placemark
    // sits inside one.
    let category = "";
    let p = pm.parentNode;
    while (p && p.nodeName) {
      if (p.nodeName === "Folder") {
        category = childText(p, "name") || "";
        break;
      }
      p = p.parentNode;
    }

    const coordEl = pm.getElementsByTagName("coordinates")[0];
    let lat = null,
      lng = null;
    if (coordEl && coordEl.textContent) {
      // KML is lng,lat[,alt]; My Maps lines/polys list many — take
      // the first vertex as the representative point.
      const first = coordEl.textContent.trim().split(/\s+/)[0] || "";
      const [x, y] = first.split(",").map(s => Number(s));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        lng = x;
        lat = y;
      }
    }

    out.push(
      makeLocation({
        name,
        category,
        lat,
        lng,
        notes: stripHtml(desc),
        source: "kml",
        mapMid,
      })
    );
  }
  return out;
}

/* ---- GeoJSON FeatureCollection (Point features) ---- */
function parseGeoJson(text, mapMid = null) {
  const out = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return out;
  }
  const features =
    data && data.type === "FeatureCollection" && Array.isArray(data.features)
      ? data.features
      : Array.isArray(data)
      ? data
      : [];
  for (const f of features) {
    const g = f && f.geometry;
    const props = (f && f.properties) || {};
    let lat = null,
      lng = null;
    if (g && g.type === "Point" && Array.isArray(g.coordinates)) {
      lng = Number(g.coordinates[0]);
      lat = Number(g.coordinates[1]);
    }
    out.push(
      makeLocation({
        name: props.name || props.Name || props.title || "",
        category: props.category || props.Category || props.layer || "",
        address: props.address || props.Address || "",
        notes: props.description || props.Description || props.notes || "",
        tags: props.tags,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        source: "geojson",
        mapMid,
      })
    );
  }
  return out;
}

/* ---- CSV (name,lat,lng[,category,address,notes,tags]) ----
   Tolerant header matcher so a My Maps "data table" CSV export or
   a hand-built sheet both work. Minimal RFC-4180 quote handling. */
function parseCsv(text, mapMid = null) {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.toLowerCase().trim());
  const col = (...names) => header.findIndex(h => names.includes(h));
  const iName = col("name", "title", "place", "location");
  const iLat = col("lat", "latitude", "y");
  const iLng = col("lng", "lon", "long", "longitude", "x");
  const iCat = col("category", "layer", "type", "group");
  const iAddr = col("address", "addr");
  const iNotes = col("notes", "note", "description", "desc");
  const iTags = col("tags", "tag");

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => !String(c).trim())) continue;
    out.push(
      makeLocation({
        name: iName >= 0 ? row[iName] : row[0],
        lat: iLat >= 0 ? row[iLat] : null,
        lng: iLng >= 0 ? row[iLng] : null,
        category: iCat >= 0 ? row[iCat] : "",
        address: iAddr >= 0 ? row[iAddr] : "",
        notes: iNotes >= 0 ? row[iNotes] : "",
        tags: iTags >= 0 ? row[iTags] : "",
        source: "csv",
        mapMid,
      })
    );
  }
  return out;
}

/* Dispatch on content sniff — used by the page's single "paste or
   upload" box so the operator doesn't have to declare the format. */
function parseAny(text, mapMid = null) {
  const t = (text || "").trim();
  if (!t) return [];
  if (t[0] === "{" || t[0] === "[") return parseGeoJson(t, mapMid);
  if (t.startsWith("<?xml") || t.includes("<kml") || t.includes("<Placemark"))
    return parseKml(t, mapMid);
  return parseCsv(t, mapMid);
}

/* ---- small parse helpers ---- */
function textOf(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return n && n.textContent ? n.textContent.trim() : "";
}
function childText(el, tag) {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeName === tag) return (c.textContent || "").trim();
  }
  return "";
}
function stripHtml(s) {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}
function csvRows(text) {
  const rows = [];
  let row = [],
    cell = "",
    q = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* =========================================================
   Provider + hook. Mirrors useWorkflow(): { locations, loaded,
   actions }. Persists synchronously to localStorage so a refresh
   keeps imported places; swap the persist/hydrate pair for store
   calls when Locations graduates onto Supabase.
   ========================================================= */

const STORAGE_KEY = "ziflow.locations.v1";
const LocationsContext = React.createContext(null);

function hydrate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(makeLocation) : [];
  } catch (_) {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (_) {
    /* quota / private-mode — keep working in-memory this session */
  }
}

function LocationsProvider({ children }) {
  const [locations, setLocations] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setLocations(hydrate());
    setLoaded(true);
  }, []);

  // Persist on every change once initial hydrate is done.
  React.useEffect(() => {
    if (loaded) persist(locations);
  }, [locations, loaded]);

  const actions = React.useMemo(
    () => ({
      add(partial) {
        const loc = makeLocation(partial);
        setLocations(prev => [loc, ...prev]);
        return loc;
      },
      update(id, patch) {
        setLocations(prev =>
          prev.map(l =>
            l.id === id
              ? { ...l, ...patch, updatedAt: new Date().toISOString() }
              : l
          )
        );
      },
      remove(id) {
        setLocations(prev => prev.filter(l => l.id !== id));
      },
      clearAll() {
        setLocations([]);
      },
      /* Bulk import with dedupe against what's already stored.
         Returns { added, skipped } so the UI can report. */
      importRecords(records) {
        let added = 0,
          skipped = 0;
        setLocations(prev => {
          const seen = new Set(prev.map(dedupeKey));
          const next = [...prev];
          for (const rec of records) {
            const loc = makeLocation(rec);
            const k = dedupeKey(loc);
            if (seen.has(k)) {
              skipped++;
              continue;
            }
            seen.add(k);
            next.unshift(loc);
            added++;
          }
          return next;
        });
        return { added, skipped };
      },
      /* Forward hooks — wiring points for reels / planning / notes.
         Kept here so consumers link through one stable API. */
      linkReel(id, reelId) {
        setLocations(prev =>
          prev.map(l =>
            l.id === id && !l.linkedReelIds.includes(reelId)
              ? {
                  ...l,
                  linkedReelIds: [...l.linkedReelIds, reelId],
                  updatedAt: new Date().toISOString(),
                }
              : l
          )
        );
      },
      unlinkReel(id, reelId) {
        setLocations(prev =>
          prev.map(l =>
            l.id === id
              ? {
                  ...l,
                  linkedReelIds: l.linkedReelIds.filter(r => r !== reelId),
                  updatedAt: new Date().toISOString(),
                }
              : l
          )
        );
      },
      exportJson() {
        return JSON.stringify(locations, null, 2);
      },
    }),
    [locations]
  );

  const value = React.useMemo(
    () => ({ locations, loaded, actions }),
    [locations, loaded, actions]
  );

  return (
    <LocationsContext.Provider value={value}>
      {children}
    </LocationsContext.Provider>
  );
}

function useLocations() {
  const ctx = React.useContext(LocationsContext);
  if (!ctx)
    throw new Error("useLocations must be used inside <LocationsProvider>");
  return ctx;
}

export {
  MY_MAPS,
  myMapsEmbedUrl,
  makeLocation,
  parseKml,
  parseGeoJson,
  parseCsv,
  parseAny,
  LocationsProvider,
  useLocations,
  LocationsContext,
};
