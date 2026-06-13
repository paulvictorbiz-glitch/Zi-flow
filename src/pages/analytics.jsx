/* =========================================================
   Analytics — cross-platform analytics dashboard.
   Reads everything from src/lib/social-client.js (mock layer
   today; same shapes when real tokens land). Covers all four
   platforms: Facebook, Instagram, YouTube, TikTok.
   ========================================================= */

import React, { useState, useMemo, useEffect, useCallback } from "react";
import "./analytics.css";
import { DPill, Card } from "../components/components.jsx";
import { useAuth } from "../auth.jsx";
import { supabase } from "../lib/supabase-client.js";
import {
  PLATFORMS,
  PLATFORM_BY_KEY,
  CONNECT_URLS,
  getConnections,
  syncLiveConnections,
  invalidateConnectionsCache,
  fetchLiveYouTubeAnalytics,
  fetchLiveInstagramAnalytics,
  fetchLiveFacebookAnalytics,
  fetchInstagramMedia,
  fetchInstagramMediaDetail,
  fetchLiveTikTokAnalytics,
} from "../lib/social-client.js";

/* ── number formatting ──────────────────────────────────── */
function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}
const fmtPct = (n) => (n == null || isNaN(n) ? "—" : n.toFixed(1) + "%");
const fmtDelta = (n) =>
  n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(n % 1 === 0 ? 0 : 1) + "%";

const RANGES = ["7d", "30d", "90d"];

/* Build the dashboard data from REAL sources only — no sample/mock numbers.
   An unconnected platform contributes nothing. */
function buildRealAnalytics({ liveYT, liveIG, liveFB, connections, range, activePlatforms, igMedia }) {
  const connMap = Object.fromEntries((connections || []).map((c) => [c.platform, c]));
  const perPlatform = {};
  for (const p of PLATFORMS) {
    const connected = !!connMap[p.key]?.connected;
    perPlatform[p.key] = {
      views: 0, engagement: 0, likes: 0, comments: 0, shares: 0,
      followers: connected ? (connMap[p.key]?.followers || 0) : 0,
      posts: 0, engagementRate: 0, connected,
      delta: { views: null, engagement: null },
    };
  }

  const nFor = (range, len) => range === "7d" ? 7 : range === "30d" ? 30 : len;

  // YouTube
  if (liveYT && liveYT.channel && perPlatform.youtube.connected) {
    const all = Array.isArray(liveYT.analytics) ? liveYT.analytics : [];
    const n = nFor(range, all.length);
    const rows = all.slice(-n);
    const prevRows = all.slice(-(2 * n), -n);
    const views = rows.reduce((a, d) => a + (d.views || 0), 0);
    const likes = rows.reduce((a, d) => a + (d.likes || 0), 0);
    const comments = rows.reduce((a, d) => a + (d.comments || 0), 0);
    const engagement = likes + comments;
    const prevViews = prevRows.reduce((a, d) => a + (d.views || 0), 0);
    const prevEngagement = prevRows.reduce((a, d) => a + (d.likes || 0) + (d.comments || 0), 0);
    const subs = Number(liveYT.channel.subscriberCount);
    perPlatform.youtube = {
      views, engagement, likes, comments, shares: 0,
      followers: Number.isFinite(subs) ? subs : (connMap.youtube?.followers || 0),
      posts: Number(liveYT.channel.videoCount) || 0,
      engagementRate: views ? +((engagement / views) * 100).toFixed(1) : 0,
      connected: true,
      delta: {
        views: prevViews > 0 ? +((views - prevViews) / prevViews * 100).toFixed(1) : null,
        engagement: prevEngagement > 0 ? +((engagement - prevEngagement) / prevEngagement * 100).toFixed(1) : null,
      },
    };
  }

  // Instagram — reach maps to "views"; profile_views to "engagement"
  if (liveIG && liveIG.account && perPlatform.instagram.connected) {
    const all = Array.isArray(liveIG.insights) ? liveIG.insights : [];
    const n = nFor(range, all.length);
    const rows = all.slice(-n);
    const prevRows = all.slice(-(2 * n), -n);
    const views = rows.reduce((a, d) => a + (d.reach || 0), 0);
    const engagement = rows.reduce((a, d) => a + (d.profile_views || 0), 0);
    const prevViews = prevRows.reduce((a, d) => a + (d.reach || 0), 0);
    const prevEngagement = prevRows.reduce((a, d) => a + (d.profile_views || 0), 0);
    const followers = Number(liveIG.account.followers_count);
    perPlatform.instagram = {
      views, engagement, likes: 0, comments: 0, shares: 0,
      followers: Number.isFinite(followers) ? followers : (connMap.instagram?.followers || 0),
      posts: Number(liveIG.account.media_count) || 0,
      engagementRate: views ? +((engagement / views) * 100).toFixed(1) : 0,
      profileViewsTotal: liveIG.profile_views_total || 0,
      connected: true,
      delta: {
        views: prevViews > 0 ? +((views - prevViews) / prevViews * 100).toFixed(1) : null,
        engagement: prevEngagement > 0 ? +((engagement - prevEngagement) / prevEngagement * 100).toFixed(1) : null,
      },
    };
  }

  // Facebook — page impressions / engagements
  if (liveFB && liveFB.page && perPlatform.facebook.connected) {
    const all = Array.isArray(liveFB.insights) ? liveFB.insights : [];
    const n = nFor(range, all.length);
    const rows = all.slice(-n);
    const prevRows = all.slice(-(2 * n), -n);
    // FB insights rows use varying field names depending on metrics requested
    const sumField = (arr, ...keys) =>
      arr.reduce((a, d) => a + (keys.reduce((v, k) => v + (d[k] || 0), 0)), 0);
    const views = sumField(rows, "page_impressions_unique", "impressions", "views");
    const engagement = sumField(rows, "page_post_engagements", "engagements", "engagement");
    const prevViews = sumField(prevRows, "page_impressions_unique", "impressions", "views");
    const prevEngagement = sumField(prevRows, "page_post_engagements", "engagements", "engagement");
    const fans = Number(liveFB.page.fan_count ?? liveFB.page.followers_count);
    perPlatform.facebook = {
      views, engagement, likes: 0, comments: 0, shares: 0,
      followers: Number.isFinite(fans) ? fans : (connMap.facebook?.followers || 0),
      posts: Array.isArray(liveFB.posts) ? liveFB.posts.length : 0,
      engagementRate: views ? +((engagement / views) * 100).toFixed(1) : 0,
      connected: true,
      delta: {
        views: prevViews > 0 ? +((views - prevViews) / prevViews * 100).toFixed(1) : null,
        engagement: prevEngagement > 0 ? +((engagement - prevEngagement) / prevEngagement * 100).toFixed(1) : null,
      },
    };
  }

  // Filter to only active platforms for totals/chart
  const active = activePlatforms || new Set(PLATFORMS.map(p => p.key));
  const sumF = (field) => PLATFORMS.reduce(
    (a, p) => a + (active.has(p.key) ? (perPlatform[p.key][field] || 0) : 0), 0
  );
  const totals = {
    views: sumF("views"),
    engagement: sumF("engagement"),
    followers: sumF("followers"),
    posts: sumF("posts"),
  };

  // Aggregate delta across active connected platforms
  const activePPs = PLATFORMS.filter(p => active.has(p.key) && perPlatform[p.key].connected);
  const totalDeltaViews = activePPs.length
    ? activePPs.reduce((a, p) => {
        const d = perPlatform[p.key].delta.views;
        return d !== null ? { sum: a.sum + d, n: a.n + 1 } : a;
      }, { sum: 0, n: 0 })
    : { sum: 0, n: 0 };
  totals.deltaViews = totalDeltaViews.n > 0 ? +(totalDeltaViews.sum / totalDeltaViews.n).toFixed(1) : null;

  // Real daily trend, metric-aware
  const days = range === "7d" ? 7 : 30;
  let timeseries = [];
  if (liveYT && Array.isArray(liveYT.analytics) && liveYT.analytics.length && active.has("youtube")) {
    timeseries = liveYT.analytics.slice(-days).map((d) => ({
      date: d.day, youtube: d.views || 0,
      youtube_likes: d.likes || 0, youtube_comments: d.comments || 0,
    }));
  }
  const mergeRows = (rows, keyBase, fields) => {
    const map = Object.fromEntries(rows.map((d) => [d.day, d]));
    if (timeseries.length) {
      timeseries = timeseries.map((t) => {
        const r = map[t.date] || {};
        const entry = { ...t };
        for (const [k, src] of Object.entries(fields)) entry[`${keyBase}_${k}`] = r[src] || 0;
        entry[keyBase] = r[Object.values(fields)[0]] || 0;
        return entry;
      });
      const seen = new Set(timeseries.map((t) => t.date));
      for (const d of rows) {
        if (!seen.has(d.day)) {
          const entry = { date: d.day };
          for (const [k, src] of Object.entries(fields)) entry[`${keyBase}_${k}`] = d[src] || 0;
          entry[keyBase] = d[Object.values(fields)[0]] || 0;
          timeseries.push(entry);
        }
      }
      timeseries.sort((a, b) => (a.date < b.date ? -1 : 1));
    } else {
      timeseries = rows.map((d) => {
        const entry = { date: d.day };
        for (const [k, src] of Object.entries(fields)) entry[`${keyBase}_${k}`] = d[src] || 0;
        entry[keyBase] = d[Object.values(fields)[0]] || 0;
        return entry;
      });
    }
  };
  if (liveIG && Array.isArray(liveIG.insights) && liveIG.insights.length && active.has("instagram")) {
    mergeRows(liveIG.insights.slice(-days), "instagram", { views: "reach", engagement: "profile_views" });
  }
  if (liveFB && Array.isArray(liveFB.insights) && liveFB.insights.length && active.has("facebook")) {
    const fbRows = liveFB.insights.slice(-days).map(d => ({
      day: d.day || d.date || d.period,
      views: d.page_impressions_unique || d.impressions || d.views || 0,
      engagement: d.page_post_engagements || d.engagements || d.engagement || 0,
    }));
    mergeRows(fbRows, "facebook", { views: "views", engagement: "engagement" });
  }

  const livePlatforms = PLATFORMS.filter(
    (p) => active.has(p.key) && perPlatform[p.key].connected && perPlatform[p.key].views > 0
  );
  const videos = liveYT && Array.isArray(liveYT.videos) ? liveYT.videos : [];

  // Combined content table: YouTube videos + IG reels
  const combinedContent = [];
  for (const v of videos) {
    combinedContent.push({
      id: v.id, platform: "youtube", title: v.title || "",
      thumbnail: v.thumbnail, publishedAt: v.publishedAt,
      views: 0, likes: 0, comments: 0, permalink: v.id ? `https://youtu.be/${v.id}` : null,
    });
  }
  for (const m of (Array.isArray(igMedia) ? igMedia : [])) {
    combinedContent.push({
      id: m.id, platform: "instagram",
      title: (m.caption || "").slice(0, 120) || "(no caption)",
      thumbnail: m.thumbnail_url, publishedAt: m.timestamp,
      views: 0, likes: m.like_count || 0, comments: m.comments_count || 0,
      permalink: m.permalink,
    });
  }

  return { perPlatform, totals, timeseries, livePlatforms, videos, combinedContent };
}

function Analytics() {
  const { person: me } = useAuth();
  const isOwner = me?.role === "owner";

  const [range, setRange] = useState("30d");
  const [connections, setConnections] = useState(() => getConnections());
  const [liveYT, setLiveYT] = useState(null);
  const [liveIG, setLiveIG] = useState(null);
  const [liveFB, setLiveFB] = useState(null);
  const [igMedia, setIgMedia] = useState(null);
  const [tikTokData, setTikTokData] = useState(null);
  const [selectedReel, setSelectedReel] = useState(null);
  const [activePlatforms, setActivePlatforms] = useState(() => new Set(PLATFORMS.map(p => p.key)));
  const [activeMetric, setActiveMetric] = useState("views");
  const [sortCol, setSortCol] = useState("likes");
  const [sortDir, setSortDir] = useState("desc");

  // On mount: reconcile connection state against the REAL backend (promotes a
  // platform once its token lands, clears fabricated "connected" rows), then
  // overlay live YouTube analytics. Non-blocking — mock renders first paint.
  useEffect(() => {
    syncLiveConnections(supabase).then(c => { if (c) setConnections(c); });
    fetchLiveYouTubeAnalytics().then(d => setLiveYT(d || null));
    fetchLiveInstagramAnalytics().then(d => setLiveIG(d || null));
    fetchLiveFacebookAnalytics().then(d => setLiveFB(d || null));
    fetchInstagramMedia().then(m => setIgMedia(m || null));
    fetchLiveTikTokAnalytics().then(d => setTikTokData(d || null));
  }, []);

  // After a connect/disconnect popup closes, re-reconcile and re-pull live data.
  const refreshConnections = useCallback(() => {
    invalidateConnectionsCache();
    syncLiveConnections(supabase).then(c => { if (c) setConnections(c); });
    fetchLiveYouTubeAnalytics().then(d => setLiveYT(d || null));
    fetchLiveInstagramAnalytics().then(d => setLiveIG(d || null));
    fetchLiveFacebookAnalytics().then(d => setLiveFB(d || null));
    fetchInstagramMedia().then(m => setIgMedia(m || null));
    fetchLiveTikTokAnalytics().then(d => setTikTokData(d || null));
  }, []);

  const handleConnect = useCallback((platform) => {
    // Shared connect URLs point DIRECTLY at api.footagebrain.com so the OAuth
    // CSRF state cookie is same-host through the Google round-trip (see
    // social-client.js). Starting on www via /fb breaks the cookie.
    const url = CONNECT_URLS[platform];
    if (!url) return;
    const popup = window.open(url, "_blank", "width=520,height=640");
    const handler = (e) => {
      if (e.data?.type === "oauth_complete" && e.data?.platform === platform) {
        window.removeEventListener("message", handler);
        popup?.close();
        refreshConnections();
      }
    };
    window.addEventListener("message", handler);
  }, [refreshConnections]);

  const handleDisconnect = useCallback(async (platform) => {
    try {
      await fetch(`/fb/api/auth/disconnect/${platform}`);
    } catch { /* best-effort */ }
    refreshConnections();
  }, [refreshConnections]);

  const handleReelClick = useCallback(async (reel) => {
    setSelectedReel({ reel, metrics: null, loading: true });
    const metrics = await fetchInstagramMediaDetail(reel.id);
    setSelectedReel({ reel, metrics, loading: false });
  }, []);

  // Real-only: built entirely from connected platforms' live data (YouTube
  // today). Unconnected platforms contribute nothing — no sample numbers.
  const data = useMemo(
    () => buildRealAnalytics({ liveYT, liveIG, liveFB, connections, range, activePlatforms, igMedia }),
    [liveYT, liveIG, liveFB, connections, range, activePlatforms, igMedia]
  );

  const { totals, perPlatform, timeseries, livePlatforms, videos, combinedContent } = data;
  const anyConnected = connections.some((c) => c.connected);

  const togglePlatform = useCallback((key) => {
    setActivePlatforms(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }, []);

  const exportCSV = useCallback(() => {
    const rows = [["Platform", "Metric", "Value", "Range"]];
    for (const p of PLATFORMS) {
      const m = perPlatform[p.key];
      if (!m.connected) continue;
      rows.push([p.label, "Views", m.views, range]);
      rows.push([p.label, "Engagement", m.engagement, range]);
      rows.push([p.label, "Followers", m.followers, range]);
    }
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `footagebrain-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [perPlatform, range]);

  const sortedContent = useMemo(() => {
    const arr = [...combinedContent];
    arr.sort((a, b) => {
      const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return arr.slice(0, 20);
  }, [combinedContent, sortCol, sortDir]);

  const handleSort = useCallback((col) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === "desc" ? "asc" : "desc"); return col; }
      setSortDir("desc");
      return col;
    });
  }, []);

  const METRICS = [
    { key: "views", label: "Views" },
    { key: "reach", label: "Reach" },
    { key: "likes", label: "Likes" },
    { key: "comments", label: "Comments" },
    { key: "engagement", label: "Engagement" },
  ];

  const kpis = [
    { lbl: "Total views", val: fmt(totals.views), sub: `${range} window`, delta: totals.deltaViews },
    { lbl: "Engagement", val: fmt(totals.engagement), sub: "likes + comments" },
    { lbl: "Followers", val: fmt(totals.followers), sub: "connected platforms" },
    { lbl: "Videos", val: fmt(totals.posts), sub: "published" },
  ];

  return (
    <div className="analytics">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="page-head">
        <div className="titles">
          <h1>Analytics — cross-platform performance</h1>
          <div className="sub">
            Real numbers from your connected accounts only. Connect Facebook,
            Instagram, YouTube or TikTok to see its live metrics here.
          </div>
          <div className="conn-chips" style={{ marginTop: 12 }}>
            {connections.map((c) => {
              const meta = PLATFORM_BY_KEY[c.platform];
              if (!meta) return null;
              return (
                <span
                  key={c.platform}
                  className={"conn-chip" + (c.connected ? "" : " is-off")}
                  title={c.note}
                  style={c.connected ? { borderColor: meta.color } : undefined}
                >
                  <span
                    className={"glyph" + (c.connected ? "" : " off")}
                    style={c.connected ? { background: meta.color } : undefined}
                  >
                    {meta.glyph}
                  </span>
                  <span className="c-label">{meta.label}</span>
                  <span
                    className="c-dot"
                    style={c.connected ? { background: meta.color } : undefined}
                  />
                  <span className="c-foll">
                    {c.connected ? fmt(c.followers) + " followers" : "not connected"}
                  </span>
                  {isOwner && !c.connected && (
                    <button
                      className="conn-btn"
                      onClick={() => handleConnect(c.platform)}
                      title={"Connect " + meta.label}
                    >
                      Connect
                    </button>
                  )}
                  {isOwner && c.connected && (
                    <button
                      className="conn-btn conn-btn--disconnect"
                      onClick={() => handleDisconnect(c.platform)}
                      title={"Disconnect " + meta.label}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
        <div className="actions">
          <div className="filter-row">
            {RANGES.map((r) => (
              <DPill key={r} active={r === range} onClick={() => setRange(r)}>{r}</DPill>
            ))}
          </div>
          <div className="filter-row">
            {PLATFORMS.map((p) => (
              <DPill
                key={p.key}
                active={activePlatforms.has(p.key)}
                onClick={() => togglePlatform(p.key)}
                style={{ borderColor: activePlatforms.has(p.key) ? p.color : undefined }}
              >
                <span style={{ marginRight: 4, fontSize: 10 }}>{p.glyph}</span>{p.label}
              </DPill>
            ))}
            <DPill onClick={exportCSV} title="Download analytics as CSV">Export CSV</DPill>
          </div>
        </div>
      </div>

      {/* ── Aggregate KPIs (real, connected platforms only) ── */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.lbl}>
            <div className="lbl">{k.lbl}</div>
            <div className="val">{k.val}</div>
            <div className="delta dim">
              {k.delta != null ? (
                <span className={k.delta >= 0 ? "delta up" : "delta down"}>
                  {fmtDelta(k.delta)} vs prev {range}
                </span>
              ) : (
                <span style={{ color: "var(--fg-dim)" }}>{k.sub}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* ── Per-platform breakdown ─────────────────────── */}
        <Card
          title="Per-platform breakdown"
          right={<span className="mono muted">{range} window</span>}
          footLeft="Platform tiles"
        >
          <div className="plat-grid">
            {PLATFORMS.map((p) => {
              const m = perPlatform[p.key];
              return (
                <div
                  className="plat-tile"
                  key={p.key}
                  style={{ borderLeftColor: p.color, opacity: m.connected ? 1 : 0.7 }}
                >
                  <div className="pt-head">
                    <span className="pt-glyph" style={{ background: p.color }}>
                      {p.glyph}
                    </span>
                    <span className="pt-name">{p.label}</span>
                    {!m.connected && <span className="pt-tag">not connected</span>}
                  </div>

                  {m.connected ? (
                    <>
                      <div>
                        <div className="pt-big" style={{ color: p.color }}>
                          {fmt(m.views)}
                        </div>
                        <div className="pt-sub">views · {range}</div>
                      </div>
                      <div className="pt-rows">
                        <div className="pt-row">
                          <span className="k">Engagement</span>
                          <span className="v">{fmt(m.engagement)}</span>
                        </div>
                        <div className="pt-row">
                          <span className="k">Eng. rate</span>
                          <span className="v">{fmtPct(m.engagementRate)}</span>
                        </div>
                        <div className="pt-row">
                          <span className="k">Videos</span>
                          <span className="v">{fmt(m.posts)}</span>
                        </div>
                        {m.likes > 0 && (
                          <div className="pt-row pt-row--sub">
                            <span className="k">Likes</span>
                            <span className="v">{fmt(m.likes)}</span>
                          </div>
                        )}
                        {m.comments > 0 && (
                          <div className="pt-row pt-row--sub">
                            <span className="k">Comments</span>
                            <span className="v">{fmt(m.comments)}</span>
                          </div>
                        )}
                        <div className="pt-row">
                          <span className="k">Followers</span>
                          <span className="v">{fmt(m.followers)}</span>
                        </div>
                        {m.profileViewsTotal > 0 && (
                          <div className="pt-row">
                            <span className="k">Profile views (30d)</span>
                            <span className="v">{fmt(m.profileViewsTotal)}</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
                      <div className="pt-sub" style={{ color: "var(--fg-mute)" }}>
                        No data — connect your {p.label} account to see live metrics.
                      </div>
                      {isOwner && (
                        <button
                          className="conn-btn"
                          style={{ alignSelf: "flex-start" }}
                          onClick={() => handleConnect(p.key)}
                          title={"Connect " + p.label}
                        >
                          Connect {p.label}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* ── Trend chart ──────────────────────────────────── */}
        <Card
          title={`Daily ${METRICS.find(m => m.key === activeMetric)?.label || "views"}`}
          right={
            <div className="filter-row" style={{ margin: 0 }}>
              {METRICS.map(m => (
                <DPill key={m.key} active={activeMetric === m.key} onClick={() => setActiveMetric(m.key)}>
                  {m.label}
                </DPill>
              ))}
            </div>
          }
          footLeft="Trend view"
        >
          {timeseries.length && livePlatforms.length ? (
            <TrendChart timeseries={timeseries} platforms={livePlatforms} metric={activeMetric} />
          ) : (
            <div className="mono dim" style={{ padding: "24px 8px", textAlign: "center", fontSize: 12 }}>
              No daily data yet — connect a platform to see its trend.
            </div>
          )}
        </Card>

        {/* ── Recent uploads (real, from connected platforms) ── */}
        <Card
          title="Recent uploads"
          right={<span className="mono muted">{videos.length} latest</span>}
          footLeft="Content"
        >
          {videos.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 12,
              }}
            >
              {videos.map((v) => {
                const meta = PLATFORM_BY_KEY[v.platform] || PLATFORM_BY_KEY.youtube;
                const href = v.id ? `https://youtu.be/${v.id}` : null;
                const inner = (
                  <>
                    {v.thumbnail && (
                      <img
                        src={v.thumbnail}
                        alt=""
                        style={{ width: "100%", borderRadius: 6, display: "block", aspectRatio: "16/9", objectFit: "cover" }}
                      />
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <span className="pb-glyph" style={{ background: meta.color }}>{meta.glyph}</span>
                      <span className="mono dim" style={{ fontSize: 9.5 }}>
                        {(v.publishedAt || "").slice(0, 10)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg)", marginTop: 3, lineHeight: 1.35,
                                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {v.title}
                    </div>
                  </>
                );
                return href ? (
                  <a key={v.id} href={href} target="_blank" rel="noopener noreferrer"
                     style={{ textDecoration: "none" }}>
                    {inner}
                  </a>
                ) : (
                  <div key={v.id || v.title}>{inner}</div>
                );
              })}
            </div>
          ) : (
            <div className="mono dim" style={{ padding: "24px 8px", textAlign: "center", fontSize: 12 }}>
              {anyConnected
                ? "No recent uploads returned by the connected platform(s)."
                : "Connect a platform to see your recent content here."}
            </div>
          )}
        </Card>

        {/* ── Content performance table ────────────────────── */}
        {combinedContent.length > 0 && (
          <Card
            title="Content performance"
            right={<span className="mono muted">{combinedContent.length} items · sorted by {sortCol}</span>}
            footLeft="Click column header to sort"
          >
            <table className="content-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ width: 44 }}></th>
                  <th onClick={() => handleSort("title")} className={sortCol === "title" ? "sorted" : ""}>Title</th>
                  <th onClick={() => handleSort("publishedAt")} className={sortCol === "publishedAt" ? "sorted" : ""}>Date</th>
                  <th onClick={() => handleSort("views")} className={sortCol === "views" ? "sorted" : ""}>Views</th>
                  <th onClick={() => handleSort("likes")} className={sortCol === "likes" ? "sorted" : ""}>Likes</th>
                  <th onClick={() => handleSort("comments")} className={sortCol === "comments" ? "sorted" : ""}>Comments</th>
                </tr>
              </thead>
              <tbody>
                {sortedContent.map((item) => {
                  const meta = PLATFORM_BY_KEY[item.platform] || PLATFORM_BY_KEY.youtube;
                  return (
                    <tr key={item.id || item.title}>
                      <td><span className="pb-glyph" style={{ background: meta.color, fontSize: 9 }}>{meta.glyph}</span></td>
                      <td>
                        {item.thumbnail && (
                          <img src={item.thumbnail} alt="" className="ct-thumb" />
                        )}
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        {item.permalink ? (
                          <a href={item.permalink} target="_blank" rel="noopener noreferrer"
                             style={{ color: "var(--fg)", textDecoration: "none" }}
                             className="ct-title">
                            {item.title}
                          </a>
                        ) : (
                          <span className="ct-title">{item.title}</span>
                        )}
                      </td>
                      <td className="mono dim">{(item.publishedAt || "").slice(0, 10)}</td>
                      <td>{item.views > 0 ? fmt(item.views) : "—"}</td>
                      <td>{item.likes > 0 ? fmt(item.likes) : "—"}</td>
                      <td>{item.comments > 0 ? fmt(item.comments) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {/* ── Instagram Reels grid ─────────────────────────── */}
        {liveIG?.connected && (
          <Card
            title="Instagram Reels"
            right={<span className="mono muted">{igMedia ? `${igMedia.length} recent` : "loading…"}</span>}
            footLeft="Click a reel for lifetime metrics"
          >
            {igMedia && igMedia.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                {igMedia.map((reel) => (
                  <div
                    key={reel.id}
                    onClick={() => handleReelClick(reel)}
                    style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden",
                             background: "var(--bg-2)", padding: 8,
                             border: "1px solid var(--line)", transition: "border-color .15s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#E1306C"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "var(--line)"}
                  >
                    {reel.thumbnail_url ? (
                      <img
                        src={reel.thumbnail_url}
                        alt=""
                        style={{ width: "100%", borderRadius: 4, display: "block",
                                 aspectRatio: "9/16", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ width: "100%", aspectRatio: "9/16", borderRadius: 4,
                                   background: "var(--bg-3)", display: "flex", alignItems: "center",
                                   justifyContent: "center", fontSize: 24 }}>▶</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
                      <span className="pb-glyph" style={{ background: "#E1306C", fontSize: 8 }}>▶</span>
                      <span className="mono dim" style={{ fontSize: 9 }}>
                        {(reel.timestamp || "").slice(0, 10)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg)", marginTop: 3, lineHeight: 1.35,
                                  display: "-webkit-box", WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {reel.caption || "(no caption)"}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
                      <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>♥ {fmt(reel.like_count)}</span>
                      <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>💬 {fmt(reel.comments_count)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : igMedia === null ? (
              <div className="mono dim" style={{ padding: "24px 8px", textAlign: "center", fontSize: 12 }}>
                Loading reels…
              </div>
            ) : (
              <div className="mono dim" style={{ padding: "24px 8px", textAlign: "center", fontSize: 12 }}>
                No reels found for this account.
              </div>
            )}
          </Card>
        )}

        {/* ── TikTok performance (RapidAPI via Hetzner proxy) ─── */}
        <Card
          title="TikTok performance"
          right={
            <span className="mono muted">
              {tikTokData ? `${tikTokData.videoCount} recent videos` : "not connected"}
            </span>
          }
          footLeft="@paulvictortravels · RapidAPI"
        >
          {tikTokData ? (
            <div className="kpis" style={{ gridTemplateColumns: "repeat(5, 1fr)", margin: 0 }}>
              {[
                { lbl: "Total views",    val: tikTokData.totals.views },
                { lbl: "Total likes",    val: tikTokData.totals.likes },
                { lbl: "Total comments", val: tikTokData.totals.comments },
                { lbl: "Total shares",   val: tikTokData.totals.shares },
                { lbl: "Videos",         val: tikTokData.videoCount },
              ].map((k) => (
                <div className="kpi" key={k.lbl}>
                  <div className="lbl">{k.lbl}</div>
                  <div className="val" style={{ color: "#00F2EA" }}>{fmt(k.val)}</div>
                  <div className="delta dim">
                    <span style={{ color: "var(--fg-dim)" }}>last {tikTokData.videoCount} videos</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mono dim" style={{ padding: "24px 8px", textAlign: "center", fontSize: 12 }}>
              No TikTok data yet — the backend TikTok proxy (/api/auth/tiktok/analytics)
              isn't reachable. Once it's live, @paulvictortravels metrics appear here.
            </div>
          )}
        </Card>
      </div>

      {/* ── Reel detail panel (slide-in overlay) ────────────── */}
      {selectedReel && (
        <ReelDetailPanel
          reel={selectedReel.reel}
          metrics={selectedReel.metrics}
          loading={selectedReel.loading}
          onClose={() => setSelectedReel(null)}
        />
      )}
    </div>
  );
}

/* ── Reel detail panel — fixed right-side overlay showing lifetime metrics
   for a single IG reel as a horizontal bar chart. ─────────────────────── */
const REEL_METRICS = [
  { key: "views",                  label: "Views" },
  { key: "reach",                  label: "Reach" },
  { key: "total_interactions",     label: "Total interactions" },
  { key: "likes",                  label: "Likes" },
  { key: "comments",               label: "Comments" },
  { key: "shares",                 label: "Shares" },
  { key: "saved",                  label: "Saves" },
  { key: "ig_reels_avg_watch_time",label: "Avg watch time (ms)" },
];

function ReelDetailPanel({ reel, metrics, loading, onClose }) {
  const maxVal = metrics
    ? Math.max(1, ...REEL_METRICS.map(m => metrics[m.key] || 0))
    : 1;

  return (
    <div
      style={{
        position: "fixed", right: 0, top: 0, bottom: 0,
        width: "min(420px, 100vw)", background: "var(--card)",
        borderLeft: "1px solid var(--line)", zIndex: 200,
        display: "flex", flexDirection: "column", overflowY: "auto",
        boxShadow: "-4px 0 24px rgba(0,0,0,.4)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "#E1306C", borderRadius: 4, padding: "2px 6px",
                         fontSize: 10, color: "#fff", fontFamily: "var(--f-mono)" }}>IG</span>
          <span style={{ fontSize: 13, color: "var(--fg)", fontWeight: 600 }}>Reel analytics</span>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--fg-dim)",
                   cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
        >×</button>
      </div>

      {/* Thumbnail + meta */}
      <div style={{ padding: 16, flexShrink: 0 }}>
        {reel.thumbnail_url && (
          <img
            src={reel.thumbnail_url}
            alt=""
            style={{ width: "100%", borderRadius: 8, display: "block",
                     maxHeight: 280, objectFit: "cover", marginBottom: 10 }}
          />
        )}
        <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.4, marginBottom: 6 }}>
          {reel.caption || "(no caption)"}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="mono dim" style={{ fontSize: 10 }}>{(reel.timestamp || "").slice(0, 10)}</span>
          {reel.permalink && (
            <a href={reel.permalink} target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 10, color: "#E1306C", textDecoration: "none" }}>
              View on Instagram ↗
            </a>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ padding: "0 16px 16px", flex: 1 }}>
        <div style={{ fontSize: 10, color: "var(--fg-dim)", fontFamily: "var(--f-mono)",
                      marginBottom: 12, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Lifetime totals (cumulative, not per-day)
        </div>
        {loading ? (
          <div className="mono dim" style={{ fontSize: 12, padding: "16px 0" }}>Loading metrics…</div>
        ) : metrics ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {REEL_METRICS.map(({ key, label }) => {
              const val = metrics[key] || 0;
              const pct = (val / maxVal) * 100;
              return (
                <div key={key}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                                 marginBottom: 3, fontSize: 11 }}>
                    <span style={{ color: "var(--fg-dim)" }}>{label}</span>
                    <span style={{ color: "var(--fg)", fontFamily: "var(--f-mono)" }}>{fmt(val)}</span>
                  </div>
                  <div style={{ height: 6, background: "var(--bg-3)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "#E1306C",
                                  borderRadius: 3, transition: "width .4s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mono dim" style={{ fontSize: 12, padding: "16px 0" }}>
            Metrics unavailable for this reel.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Trend chart — inline SVG multi-line, one line per platform.
   Modeled on the prior RetentionChart (viewBox, dashed grid,
   mono axis labels). No decorative art. ───────────────────── */
function TrendChart({ timeseries, platforms = PLATFORMS, metric = "views" }) {
  const w = 800, h = 220, pad = { l: 40, r: 14, t: 12, b: 24 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const n = timeseries.length;

  // Resolve which field to read for each platform based on the selected metric.
  const fieldFor = (platformKey) => {
    // Try platform-specific metric key first (e.g. youtube_likes), then platform key, then 0
    const specific = `${platformKey}_${metric}`;
    return (d) => d[specific] ?? d[platformKey] ?? 0;
  };

  // Max across the plotted platforms for the y-scale.
  let maxY = 1;
  for (const d of timeseries)
    for (const p of platforms) maxY = Math.max(maxY, fieldFor(p.key)(d));
  // Round the top up to a tidy gridline.
  const niceMax = niceCeil(maxY);

  const x = (i) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v) => pad.t + (1 - v / niceMax) * innerH;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);

  // X tick labels: show ~5 evenly spaced dates.
  const tickIdx = [];
  const ticks = Math.min(5, n);
  for (let t = 0; t < ticks; t++)
    tickIdx.push(Math.round((t / (ticks - 1 || 1)) * (n - 1)));

  const pathFor = (key) => {
    const getter = fieldFor(key);
    return timeseries
      .map((d, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(getter(d)).toFixed(1))
      .join(" ");
  };

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {/* horizontal grid + y labels */}
        {grid.map((g, i) => (
          <g key={"g" + i}>
            <line
              x1={pad.l} x2={w - pad.r}
              y1={y(g)} y2={y(g)}
              stroke="var(--line)" strokeDasharray="2 4"
            />
            <text
              x={pad.l - 6} y={y(g) + 3}
              fontSize="9" fontFamily="var(--f-mono)" fill="var(--fg-dim)"
              textAnchor="end"
            >
              {fmt(g)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {tickIdx.map((idx) => (
          <text
            key={"x" + idx}
            x={x(idx)} y={h - 6}
            fontSize="9" fontFamily="var(--f-mono)" fill="var(--fg-dim)"
            textAnchor="middle"
          >
            {(timeseries[idx]?.date || "").slice(5)}
          </text>
        ))}
        {/* one line per plotted platform */}
        {platforms.map((p) => (
          <path
            key={p.key}
            d={pathFor(p.key)}
            fill="none"
            stroke={p.color}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="trend-legend">
        {platforms.map((p) => (
          <span className="lg" key={p.key}>
            <span className="swatch" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* Round a number up to a clean axis maximum (1/2/2.5/5 × 10^k). */
function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

export { Analytics };
