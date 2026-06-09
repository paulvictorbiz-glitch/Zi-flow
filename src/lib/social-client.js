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
              commentThreads for comments).
   TikTok   → TikTok Display API / Business API (video.list, comment.list).
   ========================================================= */

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

const CONNECTIONS_FALLBACK = [
  { platform: "facebook",  connected: true,  account: "Samuel Paul Victor", handle: "@samuelpaulvictor", followers: 8420,  tokenKind: "page", status: "connected",    lastError: null, lastCheckedAt: null, note: "Live — Page token via api.footagebrain.com" },
  { platform: "instagram", connected: false, account: null, handle: null, followers: 0, tokenKind: null, status: "disconnected", lastError: null, lastCheckedAt: null, note: "Connect via Facebook Business Login" },
  { platform: "youtube",   connected: false, account: null, handle: null, followers: 0, tokenKind: null, status: "disconnected", lastError: null, lastCheckedAt: null, note: "Connect via Google OAuth (YouTube Data + Analytics API)" },
  { platform: "tiktok",    connected: false, account: null, handle: null, followers: 0, tokenKind: null, status: "disconnected", lastError: null, lastCheckedAt: null, note: "Connect via TikTok Login Kit (requires app approval)" },
];

/* OAuth connect/reconnect entry points (proxied through /fb to the Hetzner
   backend). Reconnect re-runs the same flow as connect. These mirror the paths
   the Analytics tab uses; each backend route returns {connected:false} and
   guides the operator through the platform's OAuth until tokens are stored. */
export const CONNECT_URLS = {
  facebook:  "/fb/api/auth/facebook/login",
  instagram: "/fb/api/auth/instagram",
  youtube:   "/fb/api/auth/youtube",
  tiktok:    "/fb/api/auth/tiktok",
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
    _connectionsCache = rows.map(r => ({
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
 * Reply to a comment or DM. MOCK: resolves after a tick.
 * @returns {Promise<{ok:true, reply:{author:string,text:string,minsAgo:number}}>}
 */
export async function replyToThread(threadId, text) {
  // TODO(real): route by platform —
  //   FB/IG comment:  POST /v21.0/{comment-id}/comments  {message}
  //   FB/IG DM:        POST /v21.0/{page-id}/messages
  //   YouTube:         comments.insert (parentId = top-level comment)
  //   TikTok:          comment reply endpoint
  await new Promise(r => setTimeout(r, 250));
  return { ok: true, reply: { author: "you", text, minsAgo: 0 } };
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

/* ── util ───────────────────────────────────────────────────────────────── */
function relTime(mins) {
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}
