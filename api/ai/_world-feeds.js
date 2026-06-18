/**
 * World Monitor free-feed ingest engine (shared module — not a route; underscore-
 * prefixed so Vercel does not count it as a serverless function, keeping us under
 * the 12-function cap). Mirrors api/ai/_rss.js (fetch → parse → dedup-upsert →
 * prune → usage write-back), but for geospatial event feeds instead of RSS.
 *
 * Invoked by api/ai/suggest.js when ?action=world-ingest (auth done by the caller).
 *
 * HYBRID strategy: we do NOT self-host the AGPL worldmonitor codebase. We natively
 * ingest the FREE feeds it aggregates into Supabase as monitor_events rows with
 * source_type='geo', then render them in Pulse alongside the embed iframe. PAID
 * APIs (Finnhub/FRED/IMF/NASDAQ/flights) have NO code path here — they stay OFF as
 * app_settings flags only.
 *
 * Feeds (each gated by app_settings.world_monitor.free.<x> === true):
 *   - usgs  : USGS earthquakes GeoJSON (no key)              → event_type='earthquake'
 *   - firms : NASA FIRMS active-fire CSV (env FIRMS_MAP_KEY) → event_type='fire'
 *   - acled : ACLED conflict events JSON (env ACLED_KEY+EMAIL)→ event_type='conflict'
 *
 * Geo rows are written with column `lng` (NOT `lon`) and source_type='geo'.
 * Dedup reuses the EXISTING FULL unique index on (source_type, external_id) from
 * 0061 — NEVER add a partial index as an ON CONFLICT arbiter (42P10 / 0 rows).
 *
 * Secrets live in ENV only (Vercel + .env.local), never in app_settings.
 */

const FETCH_TIMEOUT_MS = 7000;
const ITEMS_PER_FEED   = 100;   // per-feed cap to stay well under the ~10s timeout
const RETENTION_DAYS   = 60;    // auto-pruned: geo rows older than this are dropped
const UA = "FootageBrainWorldMonitor/1.0 (+https://footagebrain.com)";

// monitor_events.category CHECK is still ('algo','news') — geo rows ride 'news'.
const GEO_CATEGORY    = "news";
const GEO_SOURCE_TYPE = "geo";

// ── HTTP ──────────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: accept || "*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Zero-dep CSV line splitter (handles simple quoted fields). FIRMS CSV is plain
// comma-separated with no embedded newlines, so a per-line split is sufficient.
function splitCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── USGS earthquakes (GeoJSON, no key) ──────────────────────────────────────
// Significant-or-larger events in the past day keeps volume sane and relevant.
const USGS_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";

async function fetchUsgs() {
  const res = await fetchWithTimeout(USGS_URL, "application/json, */*");
  const data = await res.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  const rows = [];
  for (const f of features.slice(0, ITEMS_PER_FEED)) {
    const id = f?.id;
    const p = f?.properties || {};
    const coords = f?.geometry?.coordinates || []; // [lng, lat, depth]
    const lng = num(coords[0]);
    const lat = num(coords[1]);
    if (!id || lat == null || lng == null) continue;
    const mag = num(p.mag);
    const place = typeof p.place === "string" ? p.place : null;
    rows.push({
      external_id: String(id),
      event_type: "earthquake",
      metric: mag != null ? `M${mag.toFixed(1)}` : null,
      magnitude: mag,
      lat, lng,
      place,
      title: place ? `M${mag != null ? mag.toFixed(1) : "?"} — ${place}` : `Earthquake ${id}`,
      summary: place || null,
      severity: mag != null && mag >= 6 ? "high" : mag != null && mag >= 4.5 ? "watch" : "info",
      source_name: "USGS",
      source_url: typeof p.url === "string" ? p.url : null,
      region: place,
      published_at: p.time ? new Date(Number(p.time)).toISOString() : null,
    });
  }
  return rows;
}

// ── NASA FIRMS active fires (CSV; needs FIRMS_MAP_KEY) ──────────────────────
// Global VIIRS (S-NPP) active-fire detections for the last 1 day.
function firmsUrl(key) {
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/world/1`;
}

async function fetchFirms(key) {
  const res = await fetchWithTimeout(firmsUrl(key), "text/csv, text/plain, */*");
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const iLat = col("latitude");
  const iLng = col("longitude");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iSat = col("satellite");
  const iConf = col("confidence");
  if (iLat < 0 || iLng < 0) return [];

  const rows = [];
  for (const line of lines.slice(1, ITEMS_PER_FEED + 1)) {
    const c = splitCsvLine(line);
    const lat = num(c[iLat]);
    const lng = num(c[iLng]);
    if (lat == null || lng == null) continue;
    const acqDate = iDate >= 0 ? (c[iDate] || "").trim() : "";
    const acqTime = iTime >= 0 ? (c[iTime] || "").trim() : "";
    const sat = iSat >= 0 ? (c[iSat] || "").trim() : "";
    const conf = iConf >= 0 ? (c[iConf] || "").trim() : "";
    // Deterministic external_id so a repeated ingest dedups (no native id in CSV).
    const externalId = `firms:${lat.toFixed(4)},${lng.toFixed(4)}:${acqDate}:${acqTime}:${sat}`;
    let publishedAt = null;
    if (acqDate) {
      const hh = acqTime.padStart(4, "0").slice(0, 2);
      const mm = acqTime.padStart(4, "0").slice(2, 4);
      const d = new Date(`${acqDate}T${hh}:${mm}:00Z`);
      if (!isNaN(d.getTime())) publishedAt = d.toISOString();
    }
    rows.push({
      external_id: externalId.slice(0, 500),
      event_type: "fire",
      metric: conf ? `conf ${conf}` : null,
      confidence: conf || null,
      lat, lng,
      place: null,
      title: `Active fire — ${lat.toFixed(2)}, ${lng.toFixed(2)}`,
      summary: sat ? `VIIRS ${sat}${conf ? ` · confidence ${conf}` : ""}` : null,
      severity: "info",
      source_name: "NASA FIRMS",
      source_url: "https://firms.modaps.eosdis.nasa.gov/",
      region: null,
      published_at: publishedAt,
    });
  }
  return rows;
}

// ── ACLED conflict events (JSON; needs ACLED_KEY + ACLED_EMAIL) ─────────────
function acledUrl(key, email) {
  const qs = new URLSearchParams({
    key,
    email,
    limit: String(ITEMS_PER_FEED),
    // newest first; ACLED defaults to event_date asc otherwise.
    // (field names per ACLED API: event_date, event_id_cnty, fatalities, ...)
  });
  return `https://api.acleddata.com/acled/read?${qs.toString()}`;
}

async function fetchAcled(key, email) {
  const res = await fetchWithTimeout(acledUrl(key, email), "application/json, */*");
  const data = await res.json();
  const list = Array.isArray(data?.data) ? data.data : [];
  const rows = [];
  for (const e of list.slice(0, ITEMS_PER_FEED)) {
    const id = e?.event_id_cnty;
    const lat = num(e?.latitude);
    const lng = num(e?.longitude);
    if (!id || lat == null || lng == null) continue;
    const fatalities = num(e?.fatalities);
    const type = typeof e?.event_type === "string" ? e.event_type : null;
    const country = typeof e?.country === "string" ? e.country : null;
    const where = [e?.location, country].filter(Boolean).join(", ") || null;
    rows.push({
      external_id: String(id),
      event_type: "conflict",
      metric: fatalities != null ? `${fatalities} fatalities` : null,
      fatalities,
      lat, lng,
      place: where,
      title: `${type || "Conflict"}${where ? ` — ${where}` : ""}`,
      summary: typeof e?.notes === "string" ? e.notes.slice(0, 500) : (type || null),
      severity: fatalities != null && fatalities >= 10 ? "high" : fatalities ? "watch" : "info",
      source_name: "ACLED",
      source_url: typeof e?.source === "string" ? null : null,
      region: country,
      published_at: e?.event_date ? new Date(e.event_date).toISOString() : null,
    });
  }
  return rows;
}

// ── Dedup-aware upsert into monitor_events (source_type='geo') ──────────────
// Pre-filter rows whose external_id already exists (cheap; the FULL unique index
// on (source_type, external_id) is the real guard), then upsert with
// ignoreDuplicates so .select() returns ONLY the newly inserted rows.
async function upsertGeoRows(sb, rawRows) {
  if (!rawRows.length) return 0;

  const ids = rawRows.map((r) => r.external_id);
  const { data: existing } = await sb
    .from("monitor_events")
    .select("external_id")
    .eq("source_type", GEO_SOURCE_TYPE)
    .in("external_id", ids);
  const seen = new Set((existing || []).map((r) => r.external_id));
  const fresh = rawRows.filter((r) => !seen.has(r.external_id));
  if (!fresh.length) return 0;

  const rows = fresh.map((r) => ({
    source_type: GEO_SOURCE_TYPE,
    external_id: r.external_id,
    category: GEO_CATEGORY,
    platform: null,
    severity: r.severity || "info",
    status: "new",
    starred: false,
    title: r.title,
    summary: r.summary ?? null,
    source_name: r.source_name ?? null,
    source_url: r.source_url ?? null,
    region: r.region ?? null,
    tags: [],
    published_at: r.published_at ?? null,
    created_by: null,
    // geo columns added by migration 0064 (lng — NOT lon):
    event_type: r.event_type ?? null,
    metric: r.metric ?? null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    magnitude: r.magnitude ?? null,
    place: r.place ?? null,
    confidence: r.confidence ?? null,
    fatalities: r.fatalities ?? null,
  }));

  const { data: inserted, error } = await sb
    .from("monitor_events")
    .upsert(rows, { onConflict: "source_type,external_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return (inserted || []).length;
}

// ── Retention: 60-day prune of unstarred geo rows (mirrors _rss.pruneOld) ───
async function pruneOld(sb) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await sb
      .from("monitor_events")
      .delete()
      .eq("source_type", GEO_SOURCE_TYPE)
      .eq("starred", false)
      .lt("created_at", cutoff)
      .select("id");
    if (error) throw error;
    return (data || []).length;
  } catch (e) {
    console.warn("world-ingest prune failed (non-fatal):", e.message);
    return 0;
  }
}

// ── Usage write-back (Team B is the SOLE writer of world_monitor_usage) ─────
// Read-modify-write the FLAT usage shape. Best-effort: a usage write failure
// must never fail the ingest run.
async function writeUsage(sb, { firmsInserted, acledInserted, usgsCount }) {
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "world_monitor_usage")
      .maybeSingle();
    const cur = (data && data.value) || {};
    const today = todayKey();

    // FIRMS daily counter resets when the stored day rolls over.
    const sameDay = cur.firms_day === today;
    const firmsDailyUsed = (sameDay ? Number(cur.firms_daily_used) || 0 : 0) + (firmsInserted || 0);

    const next = {
      ...cur,
      last_ingest_at: new Date().toISOString(),
      firms_daily_used: firmsDailyUsed,
      firms_day: today,
      firms_daily_limit: Number(cur.firms_daily_limit) || 1000,
      acled_used: (Number(cur.acled_used) || 0) + (acledInserted || 0),
      acled_limit: Number(cur.acled_limit) || 0,
      usgs_count: usgsCount || 0,
      embed_ok: cur.embed_ok === false ? false : true,
    };

    await sb
      .from("app_settings")
      .upsert({ key: "world_monitor_usage", value: next }, { onConflict: "key" });
  } catch (e) {
    console.warn("world-ingest usage write failed (non-fatal):", e.message);
  }
}

// ── Public entry ────────────────────────────────────────────────────────────
/**
 * Run the World Monitor free-feed ingest. `sb` must be a service-role client.
 * Reads app_settings.world_monitor and runs only the free feeds the owner has
 * enabled (missing/parse-error settings → all OFF, no throw). Each feed is
 * isolated in its own try/catch; a missing env key is a soft note in `errors`,
 * not a throw. Returns the summary the route hands back to cron / Refresh.
 *
 * @returns {{ feeds: string[], inserted: number, byFeed: {usgs:number, firms:number, acled:number}, pruned: number, errors: {feed:string, error:string}[] }}
 */
export async function ingestWorldEvents(sb) {
  const errors = [];
  const byFeed = { usgs: 0, firms: 0, acled: 0 };
  let usgsCount = 0;

  // Read enabled flags — missing or unparseable → everything OFF (no throw).
  let free = {};
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "world_monitor")
      .maybeSingle();
    free = (data && data.value && data.value.free) || {};
  } catch (e) {
    console.warn("world-ingest: could not read world_monitor flags (all OFF):", e.message);
    free = {};
  }

  const feeds = [];

  // USGS — no key required.
  if (free.usgs === true) {
    feeds.push("usgs");
    try {
      const rows = await fetchUsgs();
      usgsCount = rows.length;
      byFeed.usgs = await upsertGeoRows(sb, rows);
    } catch (e) {
      errors.push({ feed: "usgs", error: String(e.message || e).slice(0, 200) });
    }
  }

  // FIRMS — needs FIRMS_MAP_KEY.
  if (free.firms === true) {
    feeds.push("firms");
    const key = process.env.FIRMS_MAP_KEY;
    if (!key) {
      errors.push({ feed: "firms", error: "FIRMS_MAP_KEY not configured" });
    } else {
      try {
        const rows = await fetchFirms(key);
        byFeed.firms = await upsertGeoRows(sb, rows);
      } catch (e) {
        errors.push({ feed: "firms", error: String(e.message || e).slice(0, 200) });
      }
    }
  }

  // ACLED — needs ACLED_KEY + ACLED_EMAIL.
  if (free.acled === true) {
    feeds.push("acled");
    const key = process.env.ACLED_KEY;
    const email = process.env.ACLED_EMAIL;
    if (!key || !email) {
      errors.push({ feed: "acled", error: "ACLED_KEY/ACLED_EMAIL not configured" });
    } else {
      try {
        const rows = await fetchAcled(key, email);
        byFeed.acled = await upsertGeoRows(sb, rows);
      } catch (e) {
        errors.push({ feed: "acled", error: String(e.message || e).slice(0, 200) });
      }
    }
  }

  const inserted = byFeed.usgs + byFeed.firms + byFeed.acled;
  const pruned = await pruneOld(sb);

  // Usage write-back (best-effort; never fails the run).
  await writeUsage(sb, {
    firmsInserted: byFeed.firms,
    acledInserted: byFeed.acled,
    usgsCount,
  });

  return { feeds, inserted, byFeed, pruned, errors };
}
