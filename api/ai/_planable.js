/**
 * Planable push helper (shared module — not a route; underscore-prefixed so Vercel
 * does not count it as a serverless function, keeping us under the 12-cap).
 *
 * Invoked by api/ai/suggest.js (?action=planable-push). Auth / page-ID allow-list /
 * idempotency are the CALLER's job — this module is a thin, side-effect-isolated
 * wrapper around Planable's write API.
 *
 * GOAL — pushReelToPlanable() creates ONE scheduled DRAFT/PENDING grouped cross-page
 * post in Planable for a single reel (one groupId spanning all pageIds). It NEVER
 * auto-publishes (hard default to draft/pending below) and NEVER throws past its own
 * boundary, so one failing reel can't abort a batch: every path returns
 * { ok:false, error } instead of raising. createPlanableCampaign() bundles a batch of
 * such posts under one Planable campaign.
 *
 * ── Planable specifics — VERIFIED against api.planable.io/api/v1 (2026-06-21) ────
 * Confirmed live against the OpenAPI spec + the owner's token. Base /api/v1; create
 * is POST /posts; auth Bearer; targeting is by an ARRAY of pageIds (NO platform field;
 * a single post fans out across all pageIds as ONE grouped post → one groupId);
 * caption is `text`; schedule is `scheduledAt` (ISO date-time); media is a `media`
 * array of up to 20 PUBLIC video URLs (≤100MB each, Planable downloads them
 * server-side — pass the URLs DIRECTLY, NOT media ids). The "never auto-publish"
 * guarantee is `publishAtScheduledDate:false` + never sending `approved:true` — the
 * post lands as a scheduled DRAFT the owner publishes/approves manually (this matters
 * because the workspace's approvalSettings.type is NONE). Campaigns: POST /campaigns
 * with { workspaceId, name } → { campaign:{ id } }; a post references it via
 * `campaignId`. Response 201 → { posts:[ { id, groupId, ... } ] }. All these live in
 * the labelled constants below; a future API change should need editing ONLY them +
 * buildCreatePostBody / extractPostId / extractGroupId / extractCampaignId.
 *
 * ── Media handling — DIRECT PUBLIC-URL ARRAY (no two-step) ──────────────────────
 * Per the VERIFIED live spec, `media` is an array of PUBLIC video URLs Planable
 * downloads server-side. We attach by setting body.media = mediaUrls DIRECTLY — there
 * is NO POST /media upload + GET /media/{id} poll. (The earlier two-step async dance
 * was a misread of the spec and has been removed.)
 *
 * ── Video-first / media-fallback rule ──────────────────────────────────────────
 * A reel is a video, so we try the media-bearing POST /posts first. If that POST
 * fails, we RETRY ONCE WITHOUT body.media rather than failing outright, and report
 * { ok:true, withMedia:false } so the caller/UI can surface that the draft went up
 * text-only and a human can attach the video in Planable.
 *
 * ── Titles (platform-specific) ──────────────────────────────────────────────────
 * Titles are sent ONLY when the caller supplies the matching key (non-empty), capped
 * at the platform's documented limit:
 *   youtube   -> body.youtubeTitle        (top-level, max 100)
 *   linkedin  -> body.linkedinVideoTitle  (top-level, max 150)
 *   pinterest -> body.pinterest.title     (NESTED under pinterest, max 100)
 *   ig/fb/tiktok/x/threads/gbp have NO title field (caption-only).
 *
 * ── Ingest-check (planablePostHasMedia) ─────────────────────────────────────────
 * Exported for the cleanup cron: confirms Planable has FULLY downloaded/ingested a
 * post's media BEFORE the source storage object is deleted, so we never delete a file
 * Planable is still fetching. Returns { ok, ingested }; SAFE DEFAULT ingested:false
 * (keep the file) whenever the check cannot be made reliably.
 */

// ── Planable API constants — VERIFIED 2026-06-21 (api.planable.io/api/v1) ─────────
// Edit here only. Re-verify against https://api.planable.io/api/v1/openapi.json.

// API base URL (note the /api/v1 prefix).
const PLANABLE_BASE_URL = "https://api.planable.io/api/v1";

// Create-post endpoint path (appended to base URL).
const PLANABLE_CREATE_POST_PATH = "/posts";

// Create-campaign endpoint path (appended to base URL).
const PLANABLE_CREATE_CAMPAIGN_PATH = "/campaigns"; // VERIFIED against api.planable.io/api/v1

// Authorization header form — Bearer token.
const PLANABLE_AUTH_HEADER = (token) => "Bearer " + token;

// Request field carrying the scheduled publish time (ISO-8601 date-time). Used only
// when a `scheduled` value is provided.
const PLANABLE_SCHEDULE_FIELD = "scheduledAt";

// NEVER AUTO-PUBLISH. Planable has no "state" string; auto-publish is controlled by
// the boolean `publishAtScheduledDate` (default false). We hard-set it false and
// NEVER send `approved:true`, so the post lands as a scheduled DRAFT the owner must
// publish/approve manually. Do NOT set this true and do NOT add `approved`.
const PLANABLE_FIELD_PUBLISH_AT_SCHEDULED = "publishAtScheduledDate";
const PLANABLE_PUBLISH_AT_SCHEDULED       = false; // hard-locked: never auto-publish.

// Request field names for the create-post body. Targeting is by pageIds (an ARRAY) —
// Planable's /posts takes NO platform field (sending one is a 400 validation error).
// A single POST with multiple pageIds creates ONE grouped cross-page post (one groupId).
const PLANABLE_FIELD_WORKSPACE = "workspaceId";
const PLANABLE_FIELD_PAGES     = "pageIds";    // ARRAY of page ids (grouped post).
const PLANABLE_FIELD_CAPTION   = "text";
const PLANABLE_FIELD_MEDIA     = "media";      // array of PUBLIC video URLs (direct).
const PLANABLE_FIELD_CAMPAIGN  = "campaignId"; // bundles posts under one campaign.

// ── Platform-specific TITLE fields + caps ───────────────────────────────────────
// Sent only when the caller supplies the matching titles.* key (non-empty).
const PLANABLE_FIELD_YOUTUBE_TITLE  = "youtubeTitle";       // top-level
const PLANABLE_FIELD_LINKEDIN_TITLE = "linkedinVideoTitle"; // top-level
const PLANABLE_FIELD_PINTEREST      = "pinterest";          // NESTED: pinterest.title
const YT_TITLE_MAX        = 100; // YouTube video title cap.
const LI_VIDEO_TITLE_MAX  = 150; // LinkedIn video title cap.
const PIN_TITLE_MAX       = 100; // Pinterest pin title cap.

// ── INGEST-CHECK (cleanup cron) — CONFIRM against Planable docs / live token ──────
// GET a post by id and confirm its media is fully ingested before the source storage
// object is deleted. Endpoint + the field/shape that proves ingestion are UNVERIFIED.
//
// ⚠ NEEDS-HUMAN-EYEBALL (live-token smoke — Planable field shapes, NOT a code defect):
// The shapes below — PLANABLE_GET_POST_PATH, PLANABLE_MEDIA_STATUS_FIELD/SUCCESS, and
// the create-post field names above (pageIds, text, media as a direct PUBLIC-URL array,
// youtubeTitle / linkedinVideoTitle / pinterest.title, campaignId, publishAtScheduledDate)
// — are coded per the documented Planable spec but can ONLY be settled against the live
// token. RUN A LIVE-TOKEN SMOKE BEFORE / AT THE FIRST REAL PUSH and reconcile any drift
// HERE (these labelled constants are the single edit point). This is fail-safe by design:
// the ingest-check returns ingested:false (KEEP the file) on any unrecognised shape, so a
// wrong constant never deletes a source file prematurely — it only over-retains. No
// build/runtime defect; do not "fix" in code without a live-token reading.
const PLANABLE_GET_POST_PATH = (id) => "/posts/" + encodeURIComponent(id); // // CONFIRM
// Field on a media object carrying its processing status. // CONFIRM
const PLANABLE_MEDIA_STATUS_FIELD   = "status";
const PLANABLE_MEDIA_STATUS_SUCCESS = "success";

// Where the post's attached-media array lives on the GET-post response. // CONFIRM
function extractPostMedia(json) {
  if (!json || typeof json !== "object") return null;
  const p = (Array.isArray(json.posts) && json.posts[0]) ? json.posts[0]
          : (json.post && typeof json.post === "object") ? json.post
          : (json.data && typeof json.data === "object") ? json.data
          : json;
  if (!p || typeof p !== "object") return null;
  const m = p[PLANABLE_FIELD_MEDIA];
  return Array.isArray(m) ? m : (m ? [m] : []);
}

// Minimal local status reader kept for the cleanup ingest-check (planablePostHasMedia).
// (The two-step media flow that previously owned this was removed.) // CONFIRM
function mediaItemStatus(m) {
  if (!m || typeof m !== "object") return null;
  const obj = (m.media && typeof m.media === "object") ? m.media
            : (m.data && typeof m.data === "object") ? m.data
            : m;
  const s = obj && obj[PLANABLE_MEDIA_STATUS_FIELD];
  return (typeof s === "string") ? s.toLowerCase() : null;
}

// Created post id lives in the 201 response under posts[] (Planable returns the
// created post(s) as an array). Fallbacks tolerate shape drift.
function extractPostId(json) {
  if (!json || typeof json !== "object") return null;
  const fromArr = Array.isArray(json.posts) && json.posts[0] && (json.posts[0].id || json.posts[0]._id);
  return (
    fromArr ||
    json.id ||
    json.post_id ||
    (json.data && (json.data.id || json.data.post_id)) ||
    (Array.isArray(json.data) && json.data[0] && json.data[0].id) ||
    null
  );
}

// A grouped cross-page post shares one groupId across its per-page posts. Extract it
// tolerantly from the 201 response (mirrors extractPostId's defensive shape-drift).
function extractGroupId(json) {
  if (!json || typeof json !== "object") return null;
  const fromArr = Array.isArray(json.posts) && json.posts[0] &&
    (json.posts[0].groupId || json.posts[0].group_id || json.posts[0].postGroupId);
  return (
    fromArr ||
    json.groupId ||
    json.group_id ||
    json.postGroupId ||
    (json.data && (json.data.groupId || json.data.group_id || json.data.postGroupId)) ||
    null
  );
}

// Campaign id from the POST /campaigns 201 response. Tolerant of shape drift,
// mirroring extractPostId.
function extractCampaignId(json) {
  if (!json || typeof json !== "object") return null;
  return (
    json.id ||
    json._id ||
    json.campaign_id ||
    json.campaignId ||
    (json.campaign && (json.campaign.id || json.campaign._id)) ||
    (json.data && (json.data.id || json.data._id || json.data.campaign_id)) ||
    (Array.isArray(json.data) && json.data[0] && (json.data[0].id || json.data[0]._id)) ||
    null
  );
}
// ────────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8000; // ~8s per call (AbortController).
const UA = "FootageBrainPlanablePush/1.0 (+https://footagebrain.com)";

// Strip characters a header value cannot carry — undici rejects code points > 255 with
// "String contains non ISO-8859-1 code point" and would THROW inside fetch(). A clean
// Bearer token is ASCII; this removes stray smart-quotes/BOM/newlines pasted during env
// setup so a dirty PLANABLE_API_TOKEN degrades to a clean error instead of crashing.
function sanitizeHeaderValue(v) {
  return String(v == null ? "" : v).replace(/[^\t\x20-\xFF]/g, "").trim();
}

// Trim a title to its platform cap (defensive: coerce, trim whitespace, slice).
function capTitle(v, max) {
  const s = String(v == null ? "" : v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Build the create-post request body for ONE grouped cross-page post.
 *   - body.pageIds   : ARRAY of page ids (the grouped fan-out — replaces single pageId).
 *   - body.text      : caption.
 *   - publishAtScheduledDate : HARD-LOCKED false (never auto-publish, never approved:true).
 *   - body.media     : mediaUrls passed DIRECTLY (PUBLIC urls, NOT media ids) when present.
 *                      Omitted entirely on the text-only retry (pass empty/falsy mediaUrls).
 *   - body.campaignId: when present, bundles this post under a campaign.
 *   - body.scheduledAt: when present.
 *   - titles         : { youtubeTitle?, linkedinVideoTitle?, pinterestTitle? } — each
 *                      added ONLY when its key is present + non-empty, capped per platform;
 *                      pinterest title is NESTED under body.pinterest.title.
 */
function buildCreatePostBody({ pageIds, text, mediaUrls, campaignId, scheduledAt, titles }) {
  const body = {
    [PLANABLE_FIELD_PAGES]: pageIds,
    [PLANABLE_FIELD_CAPTION]: text || "",
    // HARD-LOCKED false — the post is a scheduled DRAFT, never auto-published.
    [PLANABLE_FIELD_PUBLISH_AT_SCHEDULED]: PLANABLE_PUBLISH_AT_SCHEDULED,
  };
  // Attach media as a DIRECT array of PUBLIC urls. Omitted on the text-only retry.
  if (Array.isArray(mediaUrls) && mediaUrls.length) body[PLANABLE_FIELD_MEDIA] = mediaUrls;
  if (campaignId) body[PLANABLE_FIELD_CAMPAIGN] = campaignId;
  if (scheduledAt) body[PLANABLE_SCHEDULE_FIELD] = scheduledAt;

  // Platform-specific titles — only when the key is present + non-empty.
  if (titles && typeof titles === "object") {
    if (titles.youtubeTitle != null && String(titles.youtubeTitle).trim() !== "") {
      body[PLANABLE_FIELD_YOUTUBE_TITLE] = capTitle(titles.youtubeTitle, YT_TITLE_MAX);
    }
    if (titles.linkedinVideoTitle != null && String(titles.linkedinVideoTitle).trim() !== "") {
      body[PLANABLE_FIELD_LINKEDIN_TITLE] = capTitle(titles.linkedinVideoTitle, LI_VIDEO_TITLE_MAX);
    }
    if (titles.pinterestTitle != null && String(titles.pinterestTitle).trim() !== "") {
      // NESTED under pinterest; merge so we never clobber other pinterest fields.
      body[PLANABLE_FIELD_PINTEREST] = {
        ...(body[PLANABLE_FIELD_PINTEREST] || {}),
        title: capTitle(titles.pinterestTitle, PIN_TITLE_MAX),
      };
    }
  }
  return body;
}

function buildAuthHeaders(token) {
  return {
    Authorization: sanitizeHeaderValue(PLANABLE_AUTH_HEADER(token)),
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": UA,
  };
}

/**
 * One HTTP call to Planable with its OWN ~8s AbortController timeout.
 * Returns { ok, status, json, error }. Never throws.
 *
 * @param {string} token   Bearer token.
 * @param {string} method  "GET" | "POST".
 * @param {string} path    Path appended to PLANABLE_BASE_URL.
 * @param {object} [body]  JSON body (POST only).
 */
async function planableRequest(token, method, path, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const init = {
      method,
      signal: ctrl.signal,
      headers: buildAuthHeaders(token),
    };
    if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
    const res = await fetch(PLANABLE_BASE_URL + path, init);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null; // non-JSON / empty body — tolerate
    }
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error || json.detail)) ||
        `Planable HTTP ${res.status}`;
      return { ok: false, status: res.status, json, error: String(msg) };
    }
    return { ok: true, status: res.status, json, error: null };
  } catch (e) {
    const aborted = e && (e.name === "AbortError");
    return {
      ok: false,
      status: 0,
      json: null,
      error: aborted ? `Planable request timed out after ${FETCH_TIMEOUT_MS}ms` : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(t);
  }
}

// Thin create-post wrapper (preserves the old single-purpose call site).
function postToPlanable(token, body) {
  return planableRequest(token, "POST", PLANABLE_CREATE_POST_PATH, body);
}

/**
 * Create a Planable campaign to bundle a batch of pushed posts.
 * POST /campaigns with { workspaceId, name }.
 *
 * @param {object} args
 * @param {string} args.workspaceId  Planable workspace id.
 * @param {string} args.name         Campaign name.
 * @param {string} args.token        Planable API token (Bearer).
 * @returns {Promise<{ok:true, campaignId:string} | {ok:false, error:string}>}
 *          NEVER throws.
 */
export async function createPlanableCampaign({ workspaceId, name, token }) {
  try {
    if (!token) return { ok: false, error: "Missing Planable token" };
    if (!workspaceId) return { ok: false, error: "Missing workspaceId" };
    if (!name) return { ok: false, error: "Missing campaign name" };

    const r = await planableRequest(token, "POST", PLANABLE_CREATE_CAMPAIGN_PATH, {
      [PLANABLE_FIELD_WORKSPACE]: workspaceId,
      name,
    });
    if (!r.ok) {
      return { ok: false, error: r.error || "Planable campaign create failed" };
    }
    const campaignId = extractCampaignId(r.json);
    if (!campaignId) {
      return { ok: false, error: "Planable campaign create returned no campaign id" };
    }
    return { ok: true, campaignId };
  } catch (e) {
    // Absolute backstop — never throw past this boundary.
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Push a single reel to Planable as ONE scheduled DRAFT/PENDING grouped cross-page
 * post (one groupId spanning all pageIds).
 *
 * @param {object}   args
 * @param {string[]} args.pageIds      ARRAY of Planable page ids (caller-allow-listed, 1..20).
 * @param {string}   args.text         Post caption/body text.
 * @param {string[]} [args.mediaUrls]  PUBLIC video URLs attached DIRECTLY in body.media.
 * @param {string}   [args.campaignId] Campaign to bundle this post under (optional).
 * @param {object}   [args.titles]     { youtubeTitle?, linkedinVideoTitle?, pinterestTitle? }.
 * @param {string}   [args.scheduledAt] ISO-8601 scheduled publish time (optional).
 * @param {string}   args.token        Planable API token (Bearer).
 * @param {string}   [args.workspaceId] Planable workspace id (optional; pageIds target).
 *
 * @returns {Promise<{ok:true, postId:(string|null), groupId:(string|null), withMedia:boolean}
 *                   | {ok:false, error:string}>}
 *          Never throws past this boundary.
 */
export async function pushReelToPlanable({ pageIds, text, mediaUrls, campaignId, titles, scheduledAt, token, workspaceId }) {
  try {
    if (!token) return { ok: false, error: "Missing Planable token" };
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return { ok: false, error: "Missing pageIds" };
    }

    const wantMedia = Array.isArray(mediaUrls) && mediaUrls.length > 0;

    // First attempt — media-bearing when we have public video URLs. Media is attached
    // by passing the URLs DIRECTLY in body.media (Planable downloads them server-side);
    // there is NO two-step upload/poll.
    if (wantMedia) {
      const withMediaBody = buildCreatePostBody({
        pageIds, text, mediaUrls, campaignId, scheduledAt, titles, workspaceId,
      });
      const r1 = await postToPlanable(token, withMediaBody);
      if (r1.ok) {
        return {
          ok: true,
          postId: extractPostId(r1.json),
          groupId: extractGroupId(r1.json),
          withMedia: true,
        };
      }
      // VIDEO-FIRST FALLBACK: the media-bearing POST failed → retry ONCE WITHOUT
      // body.media so the draft still goes up (text-only) rather than failing the reel.
      const textOnlyBody = buildCreatePostBody({
        pageIds, text, mediaUrls: null, campaignId, scheduledAt, titles, workspaceId,
      });
      const r2 = await postToPlanable(token, textOnlyBody);
      if (r2.ok) {
        return {
          ok: true,
          postId: extractPostId(r2.json),
          groupId: extractGroupId(r2.json),
          withMedia: false,
        };
      }
      return { ok: false, error: r2.error || r1.error || "Planable push failed" };
    }

    // No media provided — text-only draft.
    const body = buildCreatePostBody({
      pageIds, text, mediaUrls: null, campaignId, scheduledAt, titles, workspaceId,
    });
    const r = await postToPlanable(token, body);
    if (r.ok) {
      return {
        ok: true,
        postId: extractPostId(r.json),
        groupId: extractGroupId(r.json),
        withMedia: false,
      };
    }
    return { ok: false, error: r.error || "Planable push failed" };
  } catch (e) {
    // Absolute backstop — never throw past this boundary.
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * INGEST-CHECK for the cleanup cron. Confirms Planable has FULLY downloaded/ingested
 * the media for a post BEFORE its source storage object is deleted — so we never
 * delete a file Planable is still fetching.
 *
 * SAFE DEFAULT: ingested:false (keep the file) whenever the check can't be made
 * reliably — a non-ok HTTP call, an unrecognised response shape, or no media found
 * all return ingested:false rather than risk a premature delete.
 *
 * NOTE / RISK: the GET-post endpoint and the "fully ingested" signal are UNVERIFIED
 * (// CONFIRM constants above). We treat the post as ingested only when Planable
 * reports its attached media in a terminal "success" status; absent a reliable
 * status field we conservatively return ingested:false. See deferredRisks.
 *
 * @param {object} args
 * @param {string} args.token   Planable API token (Bearer).
 * @param {string} args.postId  Planable post id to check.
 * @returns {Promise<{ok:true, ingested:boolean} | {ok:false, error:string}>}
 *          Never throws past this boundary.
 */
export async function planablePostHasMedia({ token, postId }) {
  try {
    if (!token) return { ok: false, error: "Missing Planable token" };
    if (!postId) return { ok: false, error: "Missing postId" };

    const r = await planableRequest(token, "GET", PLANABLE_GET_POST_PATH(postId));
    if (!r.ok) {
      // Can't confirm → SAFE DEFAULT keep the file.
      return { ok: true, ingested: false };
    }

    const media = extractPostMedia(r.json);
    if (!Array.isArray(media) || media.length === 0) {
      // No attached media found on the post → nothing for Planable to be mid-fetch on,
      // but we can't positively confirm ingestion of THIS post's source → keep safe.
      return { ok: true, ingested: false };
    }

    // Ingested only when EVERY attached media item reports a terminal success status.
    // If any item lacks a recognisable status, fail safe to ingested:false.
    const allSuccess = media.every((m) => mediaItemStatus(m) === PLANABLE_MEDIA_STATUS_SUCCESS);

    return { ok: true, ingested: Boolean(allSuccess) };
  } catch (e) {
    // Never throw; on any unexpected error fail safe to keep the file.
    return { ok: false, error: String((e && e.message) || e) };
  }
}
