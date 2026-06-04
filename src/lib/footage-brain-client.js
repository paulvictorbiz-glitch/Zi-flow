/**
 * Footage Brain API Client
 * 
 * Wrapper for semantic search and metadata calls to Footage Brain backend.
 * Runs on localhost:8765 in dev mode.
 */

// Resolve the FootageBrain origin at RUNTIME from the page hostname, not at
// build time. (Vercel builds this project in development mode, so
// import.meta.env.DEV is unreliable here — a hostname check is not.)
// On localhost the Vite dev proxy (vite.config.js) forwards /fb/* and
// /thumbnails/* to the backend on :8765, so requests stay same-origin.
// Anywhere else — the deployed ziflow on footagebrain.com — calls the
// FootageBrain API subdomain directly; the backend enables CORS for it.
const IS_LOCAL_DEV =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);

const FB_API_ORIGIN = IS_LOCAL_DEV ? "" : "https://api.footagebrain.com";

const FOOTAGE_BRAIN_BASE = IS_LOCAL_DEV ? "/fb/api" : `${FB_API_ORIGIN}/api`;
const FOOTAGE_BRAIN_HEALTH = IS_LOCAL_DEV ? "/fb/health" : `${FB_API_ORIGIN}/health`;

/**
 * Search Footage Brain semantic index.
 * 
 * @param {string} query - Search query (e.g., "sunrise drone shot")
 * @param {object} options - Optional filters
 * @param {string} options.mode - "semantic" | "keyword" | "hybrid" (default: "semantic")
 * @param {number} options.n_results - Max results (default: 30, max: 200)
 * @param {string} options.project_tag - Filter by project tag
 * @returns {Promise<SearchResponse>}
 */
export async function searchFootageBrain(query, options = {}) {
  const mode = options.mode || "semantic";
  const n_results = Math.min(options.n_results || 30, 200);

  const body = {
    query,
    mode,
    n_results,
  };

  // Add optional filters
  if (options.project_tag) body.project_tag = options.project_tag;
  if (options.source_root_id) body.source_root_id = options.source_root_id;
  if (options.min_duration !== undefined) body.min_duration = options.min_duration;
  if (options.max_duration !== undefined) body.max_duration = options.max_duration;

  try {
    const response = await fetch(`${FOOTAGE_BRAIN_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Footage Brain search error:", error);
    throw error;
  }
}

/**
 * Get full file metadata from Footage Brain.
 * 
 * @param {string} fileId - Footage Brain video_file.id
 * @returns {Promise<VideoFileOut>}
 */
export async function getFootageFileMetadata(fileId) {
  try {
    const response = await fetch(`${FOOTAGE_BRAIN_BASE}/files/${fileId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Metadata fetch failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Footage Brain metadata fetch error:", error);
    throw error;
  }
}

/**
 * Get transcript chunks for a file.
 * 
 * @param {string} fileId - Footage Brain video_file.id
 * @returns {Promise<TranscriptChunkOut[]>}
 */
export async function getFootageTranscript(fileId) {
  try {
    const response = await fetch(`${FOOTAGE_BRAIN_BASE}/files/${fileId}/transcript`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Transcript fetch failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Footage Brain transcript fetch error:", error);
    throw error;
  }
}

// Map a /api/files row into the search-result shape the UI renders, so the
// filename + folder browsers reuse the same FootageResultCard.
function fileRowToResult(f) {
  return {
    video_file_id: f.id,
    filename: f.filename,
    abs_path: f.abs_path,
    extension: f.extension,
    duration_seconds: f.duration_seconds,
    thumbnail_path: f.thumbnail_path,
    width: f.width,
    height: f.height,
    is_vertical: f.is_vertical,
    drive_url: f.drive_url,
    best_score: 1,
    matched_chunks: [],
    frame_matches: [],
  };
}

/**
 * Filename search — the /api/search modes search transcripts/embeddings, not
 * filenames. The backend's /api/files now takes a `filename` substring filter,
 * so this matches ANY file (not just recent ones).
 *
 * @param {string} query - Filename substring to match (case-insensitive)
 * @param {object} options - { n_results?: number }
 */
export async function searchByFilename(query, options = {}) {
  const limit = Math.min(options.n_results || 200, 500);
  const q = (query || "").trim();
  const url = `${FOOTAGE_BRAIN_BASE}/files?limit=${limit}&sort_by=name`
    + (q ? `&filename=${encodeURIComponent(q)}` : "");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`File list failed: ${response.statusText}`);
    const files = await response.json();
    const results = (files || []).map(fileRowToResult);
    return { query, mode: "filename", total: results.length, results };
  } catch (error) {
    console.error("Footage Brain filename search error:", error);
    throw error;
  }
}

/**
 * Folder browse — list every clip under a folder (abs_path prefix), sorted by
 * name, paginated past the 500-row page size. Powers the "Folders" mode.
 *
 * @param {string} absFolder - the folder's absolute-path prefix (root + rel_path)
 */
export async function searchByFolder(absFolder, options = {}) {
  const cap = options.max || 2000;
  const all = [];
  for (let offset = 0; offset < cap; offset += 500) {
    const url = `${FOOTAGE_BRAIN_BASE}/files?limit=500&offset=${offset}`
      + `&sort_by=name&abs_folder=${encodeURIComponent(absFolder)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Folder list failed: ${response.statusText}`);
    const page = await response.json();
    all.push(...(page || []));
    if (!page || page.length < 500) break;
  }
  const results = all.map(fileRowToResult);
  return { query: absFolder, mode: "folder", total: results.length, results };
}

/**
 * Coverage tree — per-scan-root → per-country-folder view with file counts,
 * per-stage completion, and the Google Drive folder each country's clips live
 * in. Powers the Coverage tab. Same endpoint the local FootageBrain UI uses.
 *
 * @returns {Promise<{
 *   stages: string[],
 *   disabled_stages: string[],
 *   roots: Array<{
 *     root_id: string, label: string, path: string, is_online: boolean,
 *     file_count: number,
 *     stage_counts: Record<string, number>,
 *     skipped_counts: Record<string, number>,
 *     folders: Array<{
 *       rel_path: string, file_count: number,
 *       drive_folder_url: string | null, drive_linked_count: number,
 *       stage_counts: Record<string, number>,
 *       skipped_counts: Record<string, number>,
 *     }>
 *   }>
 * }>}
 */
export async function getFootageBrainCoverageTree() {
  try {
    const response = await fetch(`${FOOTAGE_BRAIN_BASE}/dashboard/coverage-tree`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Coverage tree fetch failed: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Footage Brain coverage tree error:", error);
    throw error;
  }
}

/**
 * Health check for Footage Brain API.
 *
 * @returns {Promise<boolean>}
 */
export async function checkFootageBrainHealth() {
  try {
    const response = await fetch(FOOTAGE_BRAIN_HEALTH, {
      method: "GET",
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Absolute URL for a result thumbnail. Dev resolves to the Vite-proxied
 * /thumbnails path; production points at the FootageBrain API subdomain.
 * The backend records thumbnail_path with a directory prefix (and possibly
 * Windows backslashes), so only the basename is kept.
 *
 * @param {string} thumbnailPath - thumbnail_path from a search result
 * @returns {string} URL usable as an <img src>, or "" if no thumbnail
 */
export function footageBrainThumbnailUrl(thumbnailPath) {
  if (!thumbnailPath) return "";
  const name = String(thumbnailPath).split(/[\\/]/).pop();
  return `${FB_API_ORIGIN}/thumbnails/${name}`;
}

/**
 * URL of the FootageBrain file-detail page, opened in a new tab by the
 * "Preview" button. Dev hits the backend on :8765 directly (the SPA route
 * isn't proxied by Vite); production uses the API subdomain.
 *
 * @param {string} fileId - Footage Brain video_file.id
 * @returns {string}
 */
export function footageBrainFileUrl(fileId) {
  const origin = IS_LOCAL_DEV ? "http://localhost:8765" : FB_API_ORIGIN;
  return `${origin}/files/${fileId}`;
}

/**
 * Short folder/country label for a clip, from its absolute path — the
 * country/trip folder it lives in (e.g. "Norway", "Taiwan", "DCIM - lost norway
 * files"), with the leading ordinal stripped and generic media subfolders
 * (101MEDIA, DCIM, …) skipped. Returns null if nothing meaningful is found.
 *
 * @param {string} absPath - a clip's abs_path (or source_path)
 * @returns {string|null}
 */
export function footageFolderLabel(absPath) {
  if (!absPath) return null;
  const parts = String(absPath).split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const GENERIC = /^(\d+\s*media|dcim|media|clips|videos?|footage|\d+)$/i;
  for (let i = parts.length - 2; i >= 1; i--) {        // walk up from the parent
    const seg = parts[i];
    if (GENERIC.test(seg)) continue;                   // skip 101MEDIA / DCIM / etc.
    return seg.replace(/^\s*\d+(?:\.\d+)?\s*[\)\.]\s*/, "").trim() || seg;  // strip "13) "
  }
  return null;
}

/**
 * Format Footage Brain search result for storage in Supabase.
 * Extracts minimal data needed for references.
 * 
 * @param {SearchResult} result - Raw search result from Footage Brain
 * @returns {object} Formatted for attached_footage_items table
 */
export function formatSearchResultForAttachment(result) {
  return {
    footage_file_id: result.video_file_id,
    filename: result.filename,
    source_path: result.abs_path,
    extension: result.extension,
    duration_seconds: result.duration_seconds,
    thumbnail_url: result.thumbnail_path,
    width: result.width,
    height: result.height,
    is_vertical: result.is_vertical,
    best_score: result.best_score,
    matched_chunks: result.matched_chunks?.slice(0, 5) || [],
    // Carried so the reel card can link straight to the clip on Google Drive.
    drive_url: result.drive_url || null,
    drive_folder_url: result.drive_folder_url || null,
  };
}
