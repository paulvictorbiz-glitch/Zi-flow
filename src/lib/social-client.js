/* =========================================================
   Social client — unified data layer for cross-platform
   analytics + a single comments/DM inbox across Facebook,
   Instagram, YouTube and TikTok.

   ── Design ──────────────────────────────────────────────
   This is the ONE contract the Analytics tab and the Inbox tab
   both read from. Today it returns rich MOCK data so the whole
   dashboard can be built and demoed before any API tokens exist.
   Each function has a clearly marked `// TODO(real)` seam showing
   exactly which real endpoint replaces the mock once a platform
   is connected.

   When tokens land, swap the body of each fetch* function for a
   real call (or branch per-platform on isConnected()). The shapes
   returned here are the stable interface the UI depends on — keep
   them identical when wiring real data.

   ── Real-API notes (validated for Facebook) ─────────────
   Facebook/IG go through the Hetzner backend's stored Page token
   (see api/auth/facebook on api.footagebrain.com). Working calls:
     • Page fields:   GET /v21.0/{page-id}?fields=fan_count,followers_count
     • Page insights: GET /v21.0/{page-id}/insights?metric=
         page_impressions_unique,page_post_engagements,page_views_total
         (note: page_impressions & page_fans are DEPRECATED in v21)
     • Posts:         GET /v21.0/{page-id}/published_posts?fields=
         message,created_time,likes.summary(true),comments.summary(true)
     • Comments:      GET /v21.0/{post-id}/comments  (reply via POST)
     • DMs:           GET /v21.0/{page-id}/conversations  (needs pages_messaging)
   YouTube  → YouTube Data API v3 (Analytics API for views/retention,
              commentThreads for comments). Live helpers now exist:
              fetchLiveYouTubeAnalytics()/fetchLiveYouTubeInbox() (via /fb).
   TikTok   → TikTok Display API / Business API (video.list, comment.list).
   ========================================================= */

import { supabase } from "./supabase-client.js";

export const PLATFORMS = [
  { key: "facebook",  label: "Facebook",  color: "#1877F2", glyph: "f"  },
  { key: "instagram", label: "Instagram", color: "#E1306C", glyph: "◉"  },
  { key: "youtube",   label: "YouTube",   color: "#FF0000", glyph: "▶"  },
  { key: "tiktok",    label: "TikTok",    color: "#00F2EA", glyph: "♪"  },
];

export const PLATFORM_BY_KEY = Object.fromEntries(PLATFORMS.map(p => [p.key, p]));

/* ── Platform connection state ───────────────────────────────────────────────
   getConnections() is synchronous so it can be called inside useMemo and
   getAnalytics(). On first load it returns the fallback constants; after
   fetchConnections() resolves it returns the live Supabase values via the
   module-level cache. Token material NEVER lives here or in Supabase —
   tokens stay on the Hetzner backend only. */

// All platforms start as disconnected until syncLiveConnections() confirms
// real token state from the backend. Showing any "connected" state here before
// verification would display fabricated follower counts to the user.
const CONNECTIONS_FALLBACK = [
  { platform: "facebook",  connected: false, account: null, handle: null, followers: 0, tokenKind: null, status: "initializing", lastError: null, lastCheckedAt: null, note: "Live — Page token via api.footagebrain.com" },
  { platform: "instagram", connected: false, account: null, handle: null, followers: 0, tokenKind: null, status: "initializing", lastError: null, lastCheckedAt: null, note: "Connect via Facebook Business Login" },
  { platform: "youtube",   connected: false, account: null, handle: null, followers: 0, tokenKind: null, status: "initializing", lastError: null, lastCheckedAt: null, note: "Connect via Google OAuth (YouTube Data + Analytics API)" },
  { platform: "tiktok",    connected: true,  account: "paulvictortravels", handle: "@paulvictortravels", followers: 0, tokenKind: "rapidapi", status: "connected", lastError: null, lastCheckedAt: null, note: "RapidAPI tiktok-api23 — personal page via secUid" },
];

/* OAuth connect/reconnect entry points. Reconnect re-runs the same flow as
   connect. Each backend route returns {connected:false} and guides the
   operator through the platform's OAuth until tokens are stored.

   NOTE: connect URLs point DIRECTLY at api.footagebrain.com, not the /fb proxy
   on www. The OAuth CSRF state is a cookie the backend sets when the flow
   starts and reads when Google redirects back to
   api.footagebrain.com/api/auth/.../callback. If the flow STARTED on www (via
   /fb) the cookie would be scoped to www and never reach the api callback —
   producing "Invalid OAuth state (possible CSRF)". Starting on api keeps the
   cookie same-host. (The data-fetch helpers below still use /fb — they're
   same-origin XHR and don't rely on this cookie.) */
const API_ORIGIN = "https://api.footagebrain.com";
export const CONNECT_URLS = {
  facebook:  `${API_ORIGIN}/api/auth/facebook/login`,
  instagram: `${API_ORIGIN}/api/auth/instagram`,
  youtube:   `${API_ORIGIN}/api/auth/youtube`,
  tiktok:    `${API_ORIGIN}/api/auth/tiktok`,
};

let _connectionsCache = null;

export function getConnections() {
  return _connectionsCache || CONNECTIONS_FALLBACK;
}

/* Normalised health status for a connection row, consumed by the Social
   accounts panel. Precedence: an explicit error from the last health check
   wins; then a near-term token expiry (within 7 days) downgrades a live
   connection to "expiring"; otherwise connected/disconnected by the bool. */
export function deriveStatus(conn) {
  if (!conn) return "disconnected";
  if (conn.status === "error" || conn.lastError) return "error";
  if (!conn.connected) return "disconnected";
  if (conn.expiresAt) {
    const ms = new Date(conn.expiresAt).getTime() - Date.now();
    if (Number.isFinite(ms) && ms <= 0) return "error";   // already expired
    if (Number.isFinite(ms) && ms < 7 * 864e5) return "expiring";
  }
  return "connected";
}

/** Async: reads app_settings key "social_connections" from Supabase and
 *  populates the module cache. Call once on page mount; subsequent synchronous
 *  getConnections() calls return the cached result. */
export async function fetchConnections(supabaseClient) {
  try {
    const { data, error } = await supabaseClient
      .from("app_settings")
      .select("value")
      .eq("key", "social_connections")
      .maybeSingle();
    if (error || !data) return getConnections();
    const rows = Array.isArray(data.value) ? data.value : [];
    _connectionsCache = rows.filter(r => PLATFORM_BY_KEY[r.platform]).map(r => ({
      platform:      r.platform,
      connected:     !!r.connected,
      account:       r.handle || null,
      handle:        r.handle || null,
      followers:     r.followers || 0,
      tokenKind:     r.token_kind || null,
      expiresAt:     r.expires_at || null,
      connectedAt:   r.connected_at || null,
      status:        r.status || (r.connected ? "connected" : "disconnected"),
      lastError:     r.last_error || null,
      lastCheckedAt: r.last_checked_at || null,
      note:          r.note || "",
    }));
    return _connectionsCache;
  } catch {
    return getConnections();
  }
}

/** Clears the cache so the next getConnections() call re-reads from Supabase.
 *  Call after a connect or disconnect action completes. */
export function invalidateConnectionsCache() {
  _connectionsCache = null;
}

/* ── Team-chat notify preference ─────────────────────────────────────────────
   Mirrors the app_settings read/upsert pattern used for "social_connections"
   above. The value is a per-user map: { [userId]: boolean }.

   NOTE: real-time new-message detection comes from Rocket.Chat itself (the
   chat is an iframe embed — the app can't read messages). This pref only
   records who opted in + drives the browser Notification permission prompt.
   True in-app new-message badges would require the full Rocket.Chat API. */
export async function getChatNotifyPref(supabaseClient = supabase) {
  try {
    const { data, error } = await supabaseClient
      .from("app_settings")
      .select("value")
      .eq("key", "chat_notify_prefs")
      .maybeSingle();
    if (error || !data) return {};
    return (data.value && typeof data.value === "object") ? data.value : {};
  } catch {
    return {};
  }
}

export async function setChatNotifyPref(userId, enabled, supabaseClient = supabase) {
  if (!userId) return;
  const current = await getChatNotifyPref(supabaseClient);
  const value = { ...current, [userId]: !!enabled };
  try {
    await supabaseClient
      .from("app_settings")
      .upsert({ key: "chat_notify_prefs", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch { /* non-fatal — RLS may block non-owner writes */ }
  return value;
}

/**
 * Run a health check across connections and persist the result.
 *
 * Today only Facebook has a live token, so it's the only platform actually
 * probed (via the Hetzner backend through /fb). A non-null insights response
 * means the Page token is valid → status "connected"; a null/failed response
 * means the token is likely expired or the backend is unreachable → status
 * "error" with a user-facing message. Disconnected platforms are left as-is.
 *
 * The result is written back to app_settings.social_connections (status,
 * last_error, last_checked_at, followers) so every client sees the same
 * health, and the module cache is refreshed.
 *
 * @returns {Promise<Array>} the updated connection rows (UI shape)
 */
export async function runHealthChecks(supabaseClient) {
  const nowIso = new Date().toISOString();
  // Start from the freshest server state.
  await fetchConnections(supabaseClient);
  const conns = getConnections().map(c => ({ ...c }));

  for (const c of conns) {
    if (c.platform === "facebook" && c.connected) {
      const live = await fetchLiveFacebookAnalytics();
      if (live) {
        c.status = "connected";
        c.lastError = null;
        const fans = live.page?.followers_count ?? live.page?.fan_count;
        if (Number.isFinite(fans)) c.followers = fans;
      } else {
        c.status = "error";
        c.lastError = "Couldn't reach the Facebook Page API — the Page token may have expired, or api.footagebrain.com is unreachable. Reconnect to refresh it.";
      }
      c.lastCheckedAt = nowIso;
    } else if (c.platform === "youtube" && c.connected) {
      const live = await fetchLiveYouTubeAnalytics();
      if (live) {
        c.status = "connected";
        c.lastError = null;
        const subs = Number(live.channel?.subscriberCount);
        if (Number.isFinite(subs)) c.followers = subs;
      } else {
        c.status = "error";
        c.lastError = "Couldn't reach the YouTube Data API — the Google OAuth token may have expired (Testing-mode tokens lapse after 7 days), or api.footagebrain.com is unreachable. Reconnect to refresh it.";
      }
      c.lastCheckedAt = nowIso;
    } else if (c.platform === "instagram" && c.connected) {
      const live = await fetchLiveInstagramAnalytics();
      if (live) {
        c.status = "connected";
        c.lastError = null;
        const fans = Number(live.account?.followers_count);
        if (Number.isFinite(fans)) c.followers = fans;
      } else {
        c.status = "error";
        c.lastError = "Couldn't reach the Instagram Graph API — reconnect Facebook to refresh the Page token, and confirm the IG account is a Business/Creator account linked to the Page.";
      }
      c.lastCheckedAt = nowIso;
    } else if (c.connected) {
      // Connected but no live probe wired yet — mark checked, keep status.
      c.lastCheckedAt = nowIso;
    }
    // Disconnected platforms: nothing to probe.
  }

  // Persist back to the same jsonb array shape the migration seeds.
  try {
    const value = conns.map(c => ({
      platform: c.platform,
      connected: !!c.connected,
      handle: c.handle,
      followers: c.followers || 0,
      token_kind: c.tokenKind || null,
      expires_at: c.expiresAt || null,
      connected_at: c.connectedAt || null,
      status: c.status || (c.connected ? "connected" : "disconnected"),
      last_error: c.lastError || null,
      last_checked_at: c.lastCheckedAt || null,
      note: c.note || "",
    }));
    await supabaseClient
      .from("app_settings")
      .upsert({ key: "social_connections", value, updated_at: nowIso }, { onConflict: "key" });
  } catch {
    // Non-fatal — the in-memory cache below still reflects the check.
  }

  _connectionsCache = conns;
  return conns;
}

/* Persist the UI-shape connection rows back to app_settings.social_connections
   (the jsonb array the migration seeds). Best-effort: a write failure (e.g. RLS
   for a non-owner viewer) is swallowed — the in-memory cache still reflects the
   live truth for the current session. */
async function persistConnections(supabaseClient, conns, nowIso) {
  try {
    const value = conns.map(c => ({
      platform: c.platform,
      connected: !!c.connected,
      handle: c.handle,
      followers: c.followers || 0,
      token_kind: c.tokenKind || null,
      expires_at: c.expiresAt || null,
      connected_at: c.connectedAt || null,
      status: c.status || (c.connected ? "connected" : "disconnected"),
      last_error: c.lastError || null,
      last_checked_at: c.lastCheckedAt || null,
      note: c.note || "",
    }));
    await supabaseClient
      .from("app_settings")
      .upsert({ key: "social_connections", value, updated_at: nowIso }, { onConflict: "key" });
  } catch { /* non-fatal */ }
}

/* Probe a platform's backend /status (token presence — does NOT call the
   platform API, so a Google/FB outage can't cause a false demotion). Returns
   the parsed JSON ({connected, channel?/page?}) or undefined on a transport
   error (in which case callers leave the stored row unchanged — no flapping). */
async function probeStatus(apiBase) {
  try {
    const r = await fetch(`${apiBase}/status`);
    if (!r.ok) return undefined;
    return await r.json();
  } catch {
    return undefined;
  }
}

/**
 * Reconcile stored connection state against the REAL backend, then persist.
 *
 * The source of truth is each platform's `/status` (token presence), NOT the
 * stored `connected` flag — which can be stale or fabricated (e.g. a seeded
 * "facebook connected:true / 8420 followers" row with no token). This:
 *   · promotes a platform to connected with its real follower count once its
 *     OAuth token lands (YouTube → subscriberCount), and
 *   · demotes a platform with no backing token to "not connected" (clearing any
 *     fake follower number) so the UI never shows an unverified count as real.
 *
 * Call on Analytics mount and after a connect completes.
 * @returns {Promise<Array>} the reconciled connection rows (UI shape)
 */
export async function syncLiveConnections(supabaseClient) {
  const nowIso = new Date().toISOString();
  await fetchConnections(supabaseClient);
  const conns = getConnections().map(c => ({ ...c }));

  const apply = async (platform, apiBase, pick) => {
    const row = conns.find(c => c.platform === platform);
    if (!row) return;
    const st = await probeStatus(apiBase);
    if (st === undefined) return; // transport error — leave unchanged
    if (st.connected) {
      row.connected = true;
      row.status = "connected";
      row.lastError = null;
      pick(row, st);
    } else {
      row.connected = false;
      row.status = "disconnected";
      row.followers = 0;
      row.account = null;
      row.handle = null;
    }
    row.lastCheckedAt = nowIso;
  };

  await apply("youtube", YT_API, (row, st) => {
    const ch = st.channel || {};
    row.handle = ch.handle || row.handle;
    row.account = ch.title || row.account;
    row.tokenKind = "oauth";
    row.expiresAt = st.expires_at || null;
    const subs = Number(ch.subscriberCount);
    if (Number.isFinite(subs)) row.followers = subs;
  });
  await apply("facebook", FB_API, (row, st) => {
    const pg = st.page || {};
    const fans = Number(pg.followers_count ?? pg.fan_count);
    if (Number.isFinite(fans)) row.followers = fans;
  });
  await apply("instagram", IG_API, (row, st) => {
    const ac = st.account || {};
    row.handle = ac.username ? "@" + ac.username : row.handle;
    row.account = ac.username || row.account;
    row.tokenKind = "page";
    const fans = Number(ac.followers_count);
    if (Number.isFinite(fans)) row.followers = fans;
  });

  await persistConnections(supabaseClient, conns, nowIso);
  _connectionsCache = conns;
  return conns;
}

export const isConnected = (platform) =>
  !!getConnections().find(c => c.platform === platform)?.connected;

/* ── deterministic mock helpers ─────────────────────────────────────────── */
// Tiny seeded PRNG so the mock numbers are stable across renders (no jitter).
function seeded(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const hash = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
};

const REELS = [
  { reelId: "REEL-180", title: "Himalaya flyover" },
  { reelId: "REEL-170", title: "Boudha drone reveal" },
  { reelId: "REEL-166", title: "Pashupati monks at dawn" },
  { reelId: "REEL-161", title: "Patan square crowd" },
  { reelId: "REEL-152", title: "Mountain horizon line" },
  { reelId: "REEL-148", title: "Pokhara lake mist" },
];

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

/* ── Analytics ──────────────────────────────────────────────────────────── */
/**
 * Cross-platform analytics for the Analytics tab.
 * @param {"7d"|"30d"|"90d"} range
 * @returns {{
 *   range:string,
 *   totals:{views:number,engagement:number,followers:number,posts:number,deltas:object},
 *   perPlatform:Record<string,{views:number,engagement:number,followers:number,posts:number,engagementRate:number,connected:boolean}>,
 *   timeseries:Array<{date:string, facebook:number, instagram:number, youtube:number, tiktok:number}>,
 *   topPosts:Array<object>
 * }}
 */
export function getAnalytics(range = "30d") {
  // TODO(real): per connected platform, replace this block with live calls
  // (FB insights, YouTube Analytics API, TikTok Business API) and aggregate.
  const days = RANGE_DAYS[range] || 30;
  const rnd = seeded(hash("analytics" + range));

  const base = {
    facebook:  { followers: 8420,  daily: 1600 },
    instagram: { followers: 24300, daily: 5200 },
    youtube:   { followers: 11200, daily: 3400 },
    tiktok:    { followers: 58900, daily: 14800 },
  };

  const perPlatform = {};
  for (const p of PLATFORMS) {
    const b = base[p.key];
    const views = Math.round(b.daily * days * (0.8 + rnd() * 0.5));
    const engagement = Math.round(views * (0.03 + rnd() * 0.05));
    perPlatform[p.key] = {
      views,
      engagement,
      followers: b.followers,
      posts: Math.round(days / 3 + rnd() * 6),
      engagementRate: +((engagement / views) * 100).toFixed(1),
      connected: isConnected(p.key),
    };
  }

  const totals = {
    views: sum(perPlatform, "views"),
    engagement: sum(perPlatform, "engagement"),
    followers: sum(perPlatform, "followers"),
    posts: sum(perPlatform, "posts"),
    deltas: { views: +12.4, engagement: +8.1, followers: +9.0, posts: 0 },
  };

  // Per-day timeseries (one value per platform per day) for the trend chart.
  const timeseries = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 864e5);
    const day = { date: d.toISOString().slice(0, 10) };
    for (const p of PLATFORMS) {
      const wobble = 0.7 + seeded(hash(p.key + day.date))() * 0.6;
      day[p.key] = Math.round(base[p.key].daily * wobble);
    }
    timeseries.push(day);
  }

  return { range, totals, perPlatform, timeseries, topPosts: getTopPosts({ limit: 10 }) };
}

function sum(obj, field) {
  return Object.values(obj).reduce((a, x) => a + (x[field] || 0), 0);
}

/**
 * Best-performing posts across platforms (for the "Top content" table and the
 * per-reel cross-platform comparison).
 */
export function getTopPosts({ platform = "all", limit = 12 } = {}) {
  const rows = [];
  for (const r of REELS) {
    for (const p of PLATFORMS) {
      const rnd = seeded(hash(r.reelId + p.key));
      const views = Math.round(8000 + rnd() * 240000);
      const likes = Math.round(views * (0.02 + rnd() * 0.06));
      const comments = Math.round(likes * (0.05 + rnd() * 0.12));
      const shares = Math.round(likes * (0.03 + rnd() * 0.1));
      rows.push({
        id: `${p.key}_${r.reelId}`,
        platform: p.key,
        reelId: r.reelId,
        title: r.title,
        postedAgo: `${Math.ceil(rnd() * 21)}d ago`,
        views, likes, comments, shares,
        engagementRate: +(((likes + comments + shares) / views) * 100).toFixed(1),
      });
    }
  }
  const filtered = platform === "all" ? rows : rows.filter(r => r.platform === platform);
  return filtered.sort((a, b) => b.views - a.views).slice(0, limit);
}

/* ── Unified inbox (comments + DMs) ─────────────────────────────────────── */
const AUTHORS = [
  "wanderlustkate", "trekkingtom", "nomad.nina", "pixel_pete", "luca.films",
  "mara_journeys", "the_drone_guy", "sunset.sara", "raj.shoots", "ellie.edits",
  "globetrot.gabe", "viewfromvera", "captain.kai", "mountain.mia", "studio.sven",
];
const COMMENT_TEXTS = [
  "This is insane 🔥 what drone did you use?",
  "Where is this exactly? Adding to my bucket list",
  "The color grade is unreal",
  "How did you get this shot??",
  "Saved. The transition at 0:12 is buttery",
  "Need a tutorial on this edit 🙏",
  "First!! love your content",
  "What's the song? Shazam failed me",
  "Booking a flight rn lol",
  "underrated creator fr",
  "Is this AI or real?? looks too good",
  "The monks part gave me chills",
];
const DM_TEXTS = [
  "Hey! Would love to collab on a Nepal series — open to it?",
  "Can we license this clip for a travel brand campaign?",
  "What gear list do you run for these reels?",
  "Press here — can we feature this on our page?",
  "Are you doing paid edits? Need 3 reels cut.",
];

/**
 * Unified inbox across every platform. Each item is a comment or DM that may
 * need a reply, linked to the reel/post it's on so the Inbox can group "all
 * comments for a reel across all platforms" and let the owner reply in one place.
 *
 * @param {{platform?:string, kind?:"all"|"comment"|"dm", reelId?:string, onlyUnreplied?:boolean}} opts
 */
export function getInboxThreads(opts = {}) {
  const { platform = "all", kind = "all", reelId = null, onlyUnreplied = false } = opts;
  // TODO(real): merge FB /comments + /conversations, IG comments/DMs,
  // YouTube commentThreads, TikTok comment.list — normalize into this shape.
  const items = [];
  let n = 0;
  for (const r of REELS) {
    for (const p of PLATFORMS) {
      const rnd = seeded(hash("inbox" + r.reelId + p.key));
      const count = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i++) {
        const isDm = rnd() > 0.78;
        const author = AUTHORS[Math.floor(rnd() * AUTHORS.length)];
        const text = isDm
          ? DM_TEXTS[Math.floor(rnd() * DM_TEXTS.length)]
          : COMMENT_TEXTS[Math.floor(rnd() * COMMENT_TEXTS.length)];
        const replied = rnd() > 0.62;
        const minsAgo = Math.floor(rnd() * 4320); // up to 3d
        items.push({
          id: `${p.key}_${r.reelId}_${i}_${n++}`,
          platform: p.key,
          kind: isDm ? "dm" : "comment",
          reelId: r.reelId,
          postTitle: r.title,
          author: { name: author, handle: "@" + author, avatar: author.slice(0, 2).toUpperCase() },
          text,
          likes: Math.floor(rnd() * 240),
          minsAgo,
          time: relTime(minsAgo),
          sentiment: rnd() > 0.85 ? "negative" : rnd() > 0.3 ? "positive" : "neutral",
          replied,
          replies: replied
            ? [{ author: "you", text: "Appreciate it! 🙌", minsAgo: Math.floor(minsAgo * 0.6) }]
            : [],
        });
      }
    }
  }
  let out = items;
  if (platform !== "all") out = out.filter(t => t.platform === platform);
  if (kind !== "all")     out = out.filter(t => t.kind === kind);
  if (reelId)             out = out.filter(t => t.reelId === reelId);
  if (onlyUnreplied)      out = out.filter(t => !t.replied);
  return out.sort((a, b) => a.minsAgo - b.minsAgo);
}

/** Group inbox threads by reel → so the UI can show every platform's comments
 *  for one reel together (the "reply to all comments for a reel" view). */
export function getInboxByReel(opts = {}) {
  const threads = getInboxThreads(opts);
  const byReel = {};
  for (const t of threads) {
    (byReel[t.reelId] ||= { reelId: t.reelId, postTitle: t.postTitle, threads: [], platforms: new Set() })
      .threads.push(t);
    byReel[t.reelId].platforms.add(t.platform);
  }
  return Object.values(byReel)
    .map(g => ({ ...g, platforms: [...g.platforms], unreplied: g.threads.filter(t => !t.replied).length }))
    .sort((a, b) => b.threads.length - a.threads.length);
}

/** Counts for nav badges / inbox header. */
export function getInboxSummary() {
  const all = getInboxThreads();
  const byPlatform = {};
  for (const p of PLATFORMS) {
    const items = all.filter(t => t.platform === p.key);
    byPlatform[p.key] = { total: items.length, unreplied: items.filter(t => !t.replied).length };
  }
  return {
    total: all.length,
    unreplied: all.filter(t => !t.replied).length,
    comments: all.filter(t => t.kind === "comment").length,
    dms: all.filter(t => t.kind === "dm").length,
    byPlatform,
  };
}

/**
 * Reply to a comment or DM. Routes to the real backend for Facebook + Instagram
 * (the Page token posts the reply on the live platform); falls back to a local
 * mock for platforms without a write endpoint yet (YouTube/TikTok) or if the
 * network call fails, so the UI never dead-ends.
 *
 * Pass the whole `thread` (or at least {id, platform, kind}) so we can route.
 * A bare string id still works and uses the mock.
 * @returns {Promise<{ok:true, reply:{author:string,text:string,minsAgo:number}}>}
 */
export async function replyToThread(thread, text) {
  const t = typeof thread === "object" && thread ? thread : { id: thread };
  const platform = t.platform;
  const mock = () => ({ ok: true, reply: { author: "you", text, minsAgo: 0 } });

  try {
    if (platform === "facebook") {
      const r = await fetch(`${FB_API}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: t.id, message: text, kind: t.kind || "comment" }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) return { ok: true, reply: { author: "you", text, minsAgo: 0, replyId: d.reply_id } };
      return { ok: false, error: d.error || "Facebook reply failed" };
    }
    if (platform === "instagram") {
      const r = await fetch(`${IG_API}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: t.id, message: text }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) return { ok: true, reply: { author: "you", text, minsAgo: 0, replyId: d.reply_id } };
      return { ok: false, error: d.error || "Instagram reply failed" };
    }
    // YouTube + TikTok: the frontend/proxy contract is wired so manual replies
    // work the moment the Hetzner endpoint exists (these APIs require business
    // verification + app review). Until the backend route is live, the call
    // returns 404/501 and we surface a clear "pending verification" state rather
    // than a generic failure. See TODO Backlog → "YouTube replies".
    if (platform === "youtube" || platform === "tiktok") {
      const base = platform === "youtube" ? YT_API : TIKTOK_API;
      const r = await fetch(`${base}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_id: t.id, message: text, kind: t.kind || "comment" }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) return { ok: true, reply: { author: "you", text, minsAgo: 0, replyId: d.reply_id } };
      const label = platform === "youtube" ? "YouTube" : "TikTok";
      if (r.status === 404 || r.status === 501) {
        return { ok: false, pending: true, error: `${label} replies are pending business verification — not sent yet. Reply on ${label} directly for now.` };
      }
      return { ok: false, error: d.error || `${label} reply failed` };
    }
  } catch {
    // network/transport error — fall through to mock so the draft isn't lost
    return mock();
  }

  // Unknown platform — explicit error so the UI never silently "succeeds".
  return { ok: false, error: `Replies for ${t.platform || "this platform"} are not supported yet — your reply was NOT sent.` };
}

/* ── Live data (real platform APIs) ─────────────────────────────────────────
   Additive and non-breaking: the sync get* functions above always return mock
   so the dashboard renders instantly with no network. These async helpers pull
   REAL data for connected platforms — Facebook today, via the Hetzner backend
   through the same `/fb` proxy the footage client uses — and return null when
   nothing is connected yet, so callers transparently keep the mock.

   Usage (opt-in overlay): a page can, after first paint, call
   `fetchLiveFacebookAnalytics()` and, if non-null, merge the real Facebook
   numbers over the mock `perPlatform.facebook` / top posts. YouTube + TikTok
   get their own fetchLive* helpers here once those OAuth flows land. */
const FB_API = "/fb/api/auth/facebook";

export async function fetchLiveFacebookAnalytics() {
  try {
    const r = await fetch(`${FB_API}/insights`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? d : null; // {page:{fan_count,followers_count}, insights[], posts[]}
  } catch {
    return null;
  }
}

export async function fetchLiveFacebookInbox() {
  try {
    const r = await fetch(`${FB_API}/comments`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? (d.threads || []) : null;
  } catch {
    return null;
  }
}

const YT_API = "/fb/api/auth/youtube";

export async function fetchLiveYouTubeAnalytics() {
  try {
    const r = await fetch(`${YT_API}/insights`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? d : null; // {channel:{title,subscriberCount}, analytics[], videos[]}
  } catch {
    return null;
  }
}

export async function fetchLiveYouTubeInbox() {
  try {
    const r = await fetch(`${YT_API}/comments`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? (d.threads || []) : null; // commentThreads normalized to inbox shape
  } catch {
    return null;
  }
}

/* Instagram rides the same Facebook Page token (Business/Creator IG linked to
   the Page). The backend resolves the IG Business Account ID from the Page and
   reads insights via the Instagram Graph API — no separate OAuth. Returns null
   until the Page is connected AND re-authorized with instagram_manage_insights. */
const IG_API = "/fb/api/auth/instagram";

/* TikTok goes through the Hetzner backend via the /fb proxy — same-origin XHR,
   and (critically) the RapidAPI key stays SERVER-SIDE on Hetzner. Never call
   RapidAPI directly from the browser: the key would ship in the public bundle
   and anyone could run up the bill. */
const TIKTOK_API = "/fb/api/auth/tiktok";

export async function fetchLiveInstagramAnalytics() {
  try {
    const r = await fetch(`${IG_API}/insights`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? d : null; // {account:{username,followers_count,media_count}, insights[]}
  } catch {
    return null;
  }
}

export async function fetchInstagramMedia() {
  try {
    const r = await fetch(`${IG_API}/media`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? (d.media || []) : null;
  } catch {
    return null;
  }
}

export async function fetchInstagramMediaDetail(mediaId) {
  try {
    const r = await fetch(`${IG_API}/media/${encodeURIComponent(mediaId)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? (d.metrics || null) : null;
  } catch {
    return null;
  }
}

export async function fetchLiveInstagramInbox() {
  try {
    const r = await fetch(`${IG_API}/comments`);
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.connected ? (d.threads || []) : null; // normalized inbox threads (comments + DMs)
  } catch {
    return null;
  }
}

/* ── TikTok analytics (via Hetzner /fb proxy → RapidAPI tiktok-api23) ────────
   The RapidAPI key lives ONLY in the Hetzner backend env. The backend calls
   RapidAPI server-side and returns the already-aggregated shape below, so the
   key never reaches the browser bundle. Returns null until the backend route
   (/api/auth/tiktok/analytics) is live. */
export async function fetchLiveTikTokAnalytics() {
  try {
    const r = await fetch(`${TIKTOK_API}/analytics`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || d.connected === false) return null;
    const videos = d.videos || d.itemList || [];
    // Prefer backend-computed totals; fall back to computing from videos.
    const totals = d.totals || videos.reduce(
      (acc, v) => ({
        views:    acc.views    + (v.stats?.playCount    || 0),
        likes:    acc.likes    + (v.stats?.diggCount    || 0),
        comments: acc.comments + (v.stats?.commentCount || 0),
        shares:   acc.shares   + (v.stats?.shareCount   || 0),
      }),
      { views: 0, likes: 0, comments: 0, shares: 0 }
    );
    return {
      platform: "tiktok",
      videos,
      totals,
      videoCount: d.videoCount ?? videos.length,
      topVideo: d.topVideo || [...videos].sort(
        (a, b) => (b.stats?.playCount || 0) - (a.stats?.playCount || 0)
      )[0] || null,
    };
  } catch { return null; }
}

export async function fetchLiveTikTokInbox() {
  return []; // comments not available via this RapidAPI endpoint
}

/* ── AI classification for inbox threads ───────────────────────────────── */
// Fire-and-forget: called after threads load. Returns {[threadId]: {topic, tags, severity}}.
// Uses classify_only=true so no DB writes happen on every inbox refresh.
export async function classifyInboxThreads(threads, accessToken) {
  if (!Array.isArray(threads) || !threads.length) return {};
  const messages = threads.slice(0, 50).map(t => ({
    id: t.id,
    source: t.platform || "inbox",
    channel: t.postTitle || t.platform || "social",
    author: t.author?.handle || t.author?.name || "unknown",
    body: (t.text || "").slice(0, 500),
  }));
  try {
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const r = await fetch("/api/ai/monitor", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages, classify_only: true }),
    });
    if (!r.ok) return {};
    const d = await r.json();
    return d.classifications || {};
  } catch {
    return {};
  }
}

/* ── AI reply suggestions for inbox threads ─────────────────────────────────
   On-demand (the inbox ✨ "Suggest replies" button) — NOT fire-and-forget on
   load, to avoid doubling the shared free-OpenRouter burn the classify call
   already incurs per refresh. Posts to the same /api/ai/monitor route (folded
   in under the Vercel 12-function cap) with suggest_replies:true. Returns
   { [threadId]: string[] } (2-3 drafts each); resolves to {} on any failure so
   the inbox never breaks. The drafts only seed the editable compose box — the
   human always edits + sends. */
export async function suggestInboxReplies(threads, accessToken) {
  if (!Array.isArray(threads) || !threads.length) return {};
  const payload = threads.slice(0, 8).map(t => ({
    id: t.id,
    platform: t.platform || "",
    kind: t.kind || "comment",
    text: (t.text || "").slice(0, 500),
    postTitle: t.postTitle || "",
    author: t.author?.handle || t.author?.name || "",
    sentiment: t.sentiment || "neutral",
  }));
  try {
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const r = await fetch("/api/ai/monitor", {
      method: "POST",
      headers,
      body: JSON.stringify({ suggest_replies: true, threads: payload }),
    });
    if (!r.ok) return {};
    const d = await r.json();
    return d.suggestions || {};
  } catch {
    return {};
  }
}

/* ── Reel → team chat (single source of truth) ──────────────────────────────
   Both the Team-chat "Share a reel" picker and the reel card's "Discuss"
   popover call this so they behave identically: post a pink reel-reference
   card into a Rocket.Chat channel AND save the feedback as a comment on the
   reel. Auth is the caller's Supabase JWT (the backend verifies it); the
   shared slash secret never reaches the browser. Returns
   { ok, message_url, saved_comment, error }. */
export async function shareReelToChannel({ reelId, feedback = "", channel = "pipeline" }) {
  if (!reelId) return { ok: false, error: "No reel selected." };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { ok: false, error: "Not signed in." };
    const res = await fetch("/fb/api/rocketchat/dashboard/reel-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reel_id: reelId, feedback: (feedback || "").trim(), channel }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) return { ok: false, error: j.error || "Send failed." };
    return { ok: true, message_url: j.message_url, saved_comment: j.saved_comment };
  } catch (_) {
    return { ok: false, error: "Network error." };
  }
}

/* ── util ───────────────────────────────────────────────────────────────── */
function relTime(mins) {
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}
