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

/**
 * Filename search — Footage Brain's /api/search modes (semantic/keyword/hybrid)
 * all search transcripts and frame embeddings, NOT filenames. So for "find file
 * named X" we fetch a page from /api/files and filter client-side.
 *
 * @param {string} query - Filename substring to match (case-insensitive)
 * @param {object} options - { n_results?: number }
 * @returns {Promise<{ query: string, mode: "filename", total: number, results: SearchResult[] }>}
 */
export async function searchByFilename(query, options = {}) {
  const limit = Math.min(options.n_results || 100, 500);
  const url = `${FOOTAGE_BRAIN_BASE}/files?limit=${limit}&sort_by=created_at_desc`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`File list failed: ${response.statusText}`);
    const files = await response.json();
    const q = query.trim().toLowerCase();
    // Map the file rows into the search-result shape so the UI doesn't branch.
    const results = (files || [])
      .filter(f => !q || (f.filename || "").toLowerCase().includes(q))
      .map(f => ({
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
      }));
    return { query, mode: "filename", total: results.length, results };
  } catch (error) {
    console.error("Footage Brain filename search error:", error);
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
  };
}
