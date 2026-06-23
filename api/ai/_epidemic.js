/**
 * Epidemic Sound music-library helper (shared module — NOT a route; underscore-prefixed
 * so Vercel does not count it as a serverless function, keeping us under the 12-cap).
 *
 * Invoked by api/ai/suggest.js (?action=epidemic-search | epidemic-track | epidemic-download).
 * Auth (the user's Supabase JWT), the music_tracks cache, and the action-layer HTTP shapes
 * are the CALLER's job — this module is a thin, side-effect-isolated, never-throw wrapper
 * around Epidemic's content API. The Epidemic token is read ONLY from env INSIDE this
 * module (buildAuthHeaders); it is NEVER a function argument from the client and is NEVER
 * returned or logged. The only secret-ish value any export returns is the short-lived
 * signed CDN download URL minted by Epidemic itself.
 *
 * ── SWAP-READY auth modes ───────────────────────────────────────────────────────
 * AUTH_MODE flips the base URL + auth header form so a future official Partner key can
 * replace today's private token with ZERO frontend change — only env flips:
 *   AUTH_MODE='private' (default) : BASE=https://api.epidemicsound.com
 *                                   Authorization: Bearer <EPIDEMIC_TOKEN>
 *   AUTH_MODE='partner' (future)  : BASE=https://partner-content-api.epidemicsound.com
 *                                   x-api-key: <EPIDEMIC_TOKEN>   (partner token)
 *
 * ── Frozen contracts the ACTION layer (suggest.js) returns ──────────────────────
 *   POST /api/ai/suggest?action=epidemic-search
 *     body { term, limit?, offset?, filters?:{moods?[],genres?[]} }
 *       -> 200 { ok:true, tracks: mapTrack[] }
 *   POST /api/ai/suggest?action=epidemic-track   body { id }
 *       -> 200 { ok:true, track: mapTrack }
 *   POST /api/ai/suggest?action=epidemic-download body { id, format?, quality? }
 *       -> 200 { ok:true, url, expires }
 *   ERRORS: 500 { error:'EPIDEMIC_TOKEN not configured' } (env missing);
 *           502 { error:'epidemic_token_expired' } (Epidemic 401/403 → "reconnect — see Paul");
 *           502 { error } (other upstream failure).
 *
 * This module's exports return { ok, ... } | { ok:false, error, expired? } so the action
 * layer maps `expired:true` → 502 'epidemic_token_expired', and missing env → 500.
 */

// ── Epidemic API constants — CALIBRATION-REQUIRED (settle against the LIVE token) ──
// Edit ONLY here when the live private endpoint shapes are confirmed. Every path below
// is best-effort per the documented API and tagged // CALIBRATION-REQUIRED because the
// private subscription endpoints may differ from the partner content API.

// Which auth/transport profile we're on. Default 'private' (today's owner token).
const AUTH_MODE = process.env.EPIDEMIC_AUTH_MODE || "private";

// Per-mode base URL.
const BASE_URL =
  AUTH_MODE === "partner"
    ? "https://partner-content-api.epidemicsound.com" // future Partner content API
    : "https://api.epidemicsound.com";                // private subscription API (default)

// Endpoint paths (appended to BASE_URL). Query strings are built by the request wrapper.
//   search   : GET {BASE}/v0/tracks/search?term=&limit=&offset=   // CALIBRATION-REQUIRED (path may differ on private)
//   track    : GET {BASE}/v0/tracks/{id}                          // CALIBRATION-REQUIRED
//   download : GET {BASE}/v0/tracks/{id}/download?format=&quality= // CALIBRATION-REQUIRED -> { url, expires }
//   preview  : NOT a separate endpoint — a field on the track object (previewUrl/lqMp3/waveform), mapped in mapTrack()
const EP_SEARCH_PATH = "/v0/tracks/search"; // CALIBRATION-REQUIRED
const EP_TRACK_PATH = (id) => "/v0/tracks/" + encodeURIComponent(id); // CALIBRATION-REQUIRED
const EP_DOWNLOAD_PATH = (id) => "/v0/tracks/" + encodeURIComponent(id) + "/download"; // CALIBRATION-REQUIRED -> { url, expires }

const FETCH_TIMEOUT_MS = 8000; // ~8s per call (AbortController).
const UA = "FootageBrainEpidemic/1.0 (+https://footagebrain.com)";

// ── Latin-1-safe header guard ─────────────────────────────────────────────────────
// undici/Node fetch THROWS "String contains non ISO-8859-1 code point" on any header
// value with a code point > U+00FF (project memory reference_undici-iso8859-header-error;
// mirrors suggest.js:40-49 asciiHeader / _planable.js sanitizeHeaderValue). A clean
// Bearer/api-key token is ASCII, so this is a no-op for clean values and degrades a
// dirty EPIDEMIC_TOKEN (stray smart-quote / NBSP / BOM / newline pasted at env setup)
// to a clean error instead of crashing fetch().
function sanitizeHeaderValue(v) {
  return String(v == null ? "" : v).replace(/[^\t\x20-\xFF]/g, "").trim();
}

/**
 * Build auth headers. The token is read HERE from process.env.EPIDEMIC_TOKEN — never
 * passed in from the client, never returned to the caller, never logged. Returns null
 * when the env var is missing so the caller can surface 500 'EPIDEMIC_TOKEN not configured'.
 */
function buildAuthHeaders() {
  const token = process.env.EPIDEMIC_TOKEN;
  if (!token) return null; // caller turns this into 500 'EPIDEMIC_TOKEN not configured'.

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": UA,
  };

  if (AUTH_MODE === "partner") {
    // FUTURE partner branch — one config flip (EPIDEMIC_AUTH_MODE=partner) swaps the
    // transport. Partner content API authenticates with an api-key header rather than a
    // Bearer token. Leave this branch intact so the swap is purely env-driven.
    headers["x-api-key"] = sanitizeHeaderValue(token);
  } else {
    // Default private subscription token — Bearer.
    headers.Authorization = sanitizeHeaderValue("Bearer " + token);
  }
  return headers;
}

/**
 * Normalise a raw Epidemic track object into the FROZEN shape callers see, so no raw
 * Epidemic field name ever leaks to the store/UI. Tolerant: any missing field → null/[].
 *
 * @param {object} raw
 * @returns {{id:string, title:string, artist:string, bpm:(number|null),
 *            lengthSec:(number|null), moods:string[], genres:string[],
 *            coverUrl:(string|null), previewUrl:(string|null)}}
 */
export function mapTrack(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      id: "",
      title: "",
      artist: "",
      bpm: null,
      lengthSec: null,
      moods: [],
      genres: [],
      coverUrl: null,
      previewUrl: null,
    };
  }

  const str = (v) => (v == null ? "" : String(v));

  // id — tolerate id / trackId / _id.
  const id = str(raw.id || raw.trackId || raw._id || "");

  // title — tolerate title / name.
  const title = str(raw.title || raw.name || "");

  // artist — Epidemic exposes contributing artists as an array of objects OR a string.
  let artist = "";
  if (Array.isArray(raw.artists) && raw.artists.length) {
    artist = raw.artists
      .map((a) => (a && typeof a === "object" ? a.name || a.title || "" : str(a)))
      .filter(Boolean)
      .join(", ");
  } else if (typeof raw.artist === "string") {
    artist = raw.artist;
  } else if (raw.artist && typeof raw.artist === "object") {
    artist = str(raw.artist.name || raw.artist.title || "");
  }

  // bpm — // CALIBRATION-REQUIRED (key may be bpm / tempo / metadata.bpm). Coerce → number|null.
  const bpmRaw = raw.bpm != null ? raw.bpm : raw.tempo != null ? raw.tempo : (raw.metadata && raw.metadata.bpm);
  const bpmNum = Number(bpmRaw);
  const bpm = Number.isFinite(bpmNum) ? bpmNum : null;

  // lengthSec — // CALIBRATION-REQUIRED (key may be length / lengthInSeconds / duration[ms]).
  // duration is often MILLISECONDS; lengthInSeconds/length are seconds. Coerce → number|null.
  let lengthSec = null;
  if (raw.lengthInSeconds != null && Number.isFinite(Number(raw.lengthInSeconds))) {
    lengthSec = Number(raw.lengthInSeconds);
  } else if (raw.length != null && Number.isFinite(Number(raw.length))) {
    lengthSec = Number(raw.length);
  } else if (raw.duration != null && Number.isFinite(Number(raw.duration))) {
    // duration is likely ms → convert to whole seconds; if it looks like seconds (<1000), keep.
    const d = Number(raw.duration);
    lengthSec = d >= 1000 ? Math.round(d / 1000) : d;
  }

  // moods — array of strings or array of {name}.
  const moods = toStringArray(raw.moods);

  // genres — array of strings or array of {name}.
  const genres = toStringArray(raw.genres);

  // coverUrl — // CALIBRATION-REQUIRED (may be images.l / coverArt / artworkUrl / images[0].url).
  const coverUrl =
    pickUrl(raw.coverUrl) ||
    pickUrl(raw.coverArt) ||
    pickUrl(raw.artworkUrl) ||
    (raw.images && (pickUrl(raw.images.l) || pickUrl(raw.images.m) || pickUrl(raw.images.s))) ||
    (Array.isArray(raw.images) && raw.images[0] && pickUrl(raw.images[0].url || raw.images[0])) ||
    null;

  // previewUrl — // CALIBRATION-REQUIRED (may be previewUrl / lqMp3 / waveform / audio.lqMp3 / previews[0].url).
  const previewUrl =
    pickUrl(raw.previewUrl) ||
    pickUrl(raw.lqMp3) ||
    pickUrl(raw.waveform) ||
    (raw.audio && (pickUrl(raw.audio.lqMp3) || pickUrl(raw.audio.previewUrl))) ||
    (Array.isArray(raw.previews) && raw.previews[0] && pickUrl(raw.previews[0].url || raw.previews[0])) ||
    null;

  return { id, title, artist, bpm, lengthSec, moods, genres, coverUrl, previewUrl };
}

// Coerce a mixed array (strings or {name}/{title} objects) into a clean string[].
function toStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === "object" ? x.name || x.title || "" : x == null ? "" : String(x)))
    .filter(Boolean);
}

// Pull a usable URL string out of a value that may be a string or {url}. → string|null.
function pickUrl(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.url === "string") return v.url;
  return null;
}

/**
 * One HTTP call to Epidemic with its OWN ~8s AbortController timeout.
 * Returns { ok, status, json, error } — NEVER throws. The caller distinguishes an
 * upstream 401/403 (→ 'epidemic_token_expired') from other failures via the `status`
 * field plus the exported helpers' `expired` flag.
 *
 * @param {"GET"|"POST"} method
 * @param {string} path   Path appended to BASE_URL.
 * @param {object} [opts]
 * @param {object} [opts.params] query-string params (skips null/undefined/"" values).
 * @param {object} [opts.body]   JSON body (non-GET only).
 */
async function epidemicRequest(method, path, { params, body } = {}) {
  const headers = buildAuthHeaders();
  if (!headers) {
    // Env missing — surface a distinct flag so the action layer returns 500.
    return { ok: false, status: 0, json: null, error: "EPIDEMIC_TOKEN not configured", noToken: true };
  }

  // Build the URL + query string.
  let target = BASE_URL + path;
  if (params && typeof params === "object") {
    const qs = new URLSearchParams();
    for (const [k, val] of Object.entries(params)) {
      if (val === undefined || val === null || val === "") continue;
      qs.append(k, String(val));
    }
    const q = qs.toString();
    if (q) target += (target.includes("?") ? "&" : "?") + q;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const init = { method, signal: ctrl.signal, headers };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);

    const res = await fetch(target, init);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null; // non-JSON / empty body — tolerate.
    }

    if (!res.ok) {
      const msg =
        (json && (json.message || json.error || json.detail)) ||
        `Epidemic HTTP ${res.status}`;
      // 401/403 → expired/invalid token. The caller maps this to 'epidemic_token_expired'.
      const expired = res.status === 401 || res.status === 403;
      return { ok: false, status: res.status, json, error: String(msg), expired };
    }
    return { ok: true, status: res.status, json, error: null };
  } catch (e) {
    const aborted = e && e.name === "AbortError";
    return {
      ok: false,
      status: 0,
      json: null,
      error: aborted
        ? `Epidemic request timed out after ${FETCH_TIMEOUT_MS}ms`
        : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(t);
  }
}

// Pull a list of raw track objects out of a search/list response, tolerant of shape drift.
function extractTrackList(json) {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.tracks)) return json.tracks;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.data)) return json.data;
  if (json.data && Array.isArray(json.data.tracks)) return json.data.tracks;
  return [];
}

// Pull a single raw track object out of a get-track response, tolerant of shape drift.
function extractTrack(json) {
  if (!json || typeof json !== "object") return null;
  if (json.track && typeof json.track === "object") return json.track;
  if (json.data && typeof json.data === "object" && !Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.tracks) && json.tracks[0]) return json.tracks[0];
  return json; // assume the body IS the track.
}

/**
 * Search the Epidemic catalog.
 *
 * @param {object} args
 * @param {string} args.term            Free-text search term.
 * @param {number} [args.limit]         Page size.
 * @param {number} [args.offset]        Page offset.
 * @param {object} [args.filters]       { moods?:string[], genres?:string[] } — added as
 *                                      repeated query params when present.
 * @returns {Promise<{ok:true, tracks:object[]} | {ok:false, error:string, expired?:boolean}>}
 *          mapped through mapTrack(); NEVER throws.
 */
export async function searchTracks({ term, limit, offset, filters } = {}) {
  try {
    const params = { term: term || "" };
    if (limit != null) params.limit = limit;
    if (offset != null) params.offset = offset;
    // filters — // CALIBRATION-REQUIRED (private API may expect mood= / genre= singular,
    // CSV, or nested). Sent as comma-joined repeated keys; reconcile at calibration.
    if (filters && typeof filters === "object") {
      if (Array.isArray(filters.moods) && filters.moods.length) params.moods = filters.moods.join(",");
      if (Array.isArray(filters.genres) && filters.genres.length) params.genres = filters.genres.join(",");
    }

    const r = await epidemicRequest("GET", EP_SEARCH_PATH, { params });
    if (!r.ok) {
      return { ok: false, error: r.error || "Epidemic search failed", expired: Boolean(r.expired), noToken: Boolean(r.noToken) };
    }
    const tracks = extractTrackList(r.json).map(mapTrack);
    return { ok: true, tracks };
  } catch (e) {
    // Absolute backstop — never throw past this boundary.
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Fetch one track's full metadata.
 *
 * @param {string} id  Epidemic track id.
 * @returns {Promise<{ok:true, track:object} | {ok:false, error:string, expired?:boolean}>}
 *          mapped through mapTrack(); NEVER throws.
 */
export async function getTrack(id) {
  try {
    if (!id) return { ok: false, error: "Missing track id" };
    const r = await epidemicRequest("GET", EP_TRACK_PATH(id));
    if (!r.ok) {
      return { ok: false, error: r.error || "Epidemic track fetch failed", expired: Boolean(r.expired), noToken: Boolean(r.noToken) };
    }
    const rawTrack = extractTrack(r.json);
    if (!rawTrack) return { ok: false, error: "Epidemic track fetch returned no track" };
    return { ok: true, track: mapTrack(rawTrack) };
  } catch (e) {
    // Absolute backstop — never throw past this boundary.
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Mint a short-lived signed CDN download URL for a track. This is the ONLY secret-ish
 * value any export returns — and it is a short-lived signed link minted by Epidemic,
 * NOT the EPIDEMIC_TOKEN (which never leaves this module).
 *
 * @param {string} id  Epidemic track id.
 * @param {object} [opts]
 * @param {('mp3'|'wav')} [opts.format]  Defaults to 'mp3'.
 * @param {string} [opts.quality]        Optional quality hint.
 * @returns {Promise<{ok:true, url:string, expires:(number|string|null)}
 *                   | {ok:false, error:string, expired?:boolean}>}  NEVER throws.
 */
export async function getDownloadUrl(id, { format, quality } = {}) {
  try {
    if (!id) return { ok: false, error: "Missing track id" };
    const params = { format: format || "mp3" }; // CALIBRATION-REQUIRED (key/values on private API)
    if (quality != null && quality !== "") params.quality = quality; // CALIBRATION-REQUIRED

    const r = await epidemicRequest("GET", EP_DOWNLOAD_PATH(id), { params });
    if (!r.ok) {
      return { ok: false, error: r.error || "Epidemic download failed", expired: Boolean(r.expired), noToken: Boolean(r.noToken) };
    }

    // Response shape — // CALIBRATION-REQUIRED -> { url, expires } (tolerate drift).
    const json = r.json || {};
    const node = json.data && typeof json.data === "object" ? json.data : json;
    const url = pickUrl(node.url) || pickUrl(node.downloadUrl) || pickUrl(node.signedUrl) || pickUrl(node.href);
    if (!url) return { ok: false, error: "Epidemic download returned no url" };

    // expires — // CALIBRATION-REQUIRED (epoch seconds / ms / ISO string). Pass through.
    const expires =
      node.expires != null
        ? node.expires
        : node.expiresAt != null
        ? node.expiresAt
        : node.expiresIn != null
        ? node.expiresIn
        : null;

    return { ok: true, url, expires };
  } catch (e) {
    // Absolute backstop — never throw past this boundary.
    return { ok: false, error: String((e && e.message) || e) };
  }
}
