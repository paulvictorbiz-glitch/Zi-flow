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
  getConnections,
  fetchConnections,
  invalidateConnectionsCache,
  getAnalytics,
  getTopPosts,
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

function Analytics() {
  const { person: me } = useAuth();
  const isOwner = me?.role === "owner";

  const [range, setRange] = useState("30d");
  const [connections, setConnections] = useState(() => getConnections());

  // Hydrate connection state from Supabase on mount (non-blocking).
  useEffect(() => {
    fetchConnections(supabase).then(c => { if (c) setConnections(c); });
  }, []);

  // After a connect/disconnect popup closes, refresh the connection list.
  const refreshConnections = useCallback(() => {
    invalidateConnectionsCache();
    fetchConnections(supabase).then(c => { if (c) setConnections(c); });
  }, []);

  const handleConnect = useCallback((platform) => {
    const paths = {
      instagram: "/fb/api/auth/instagram",
      youtube:   "/fb/api/auth/youtube",
      tiktok:    "/fb/api/auth/tiktok",
    };
    const url = paths[platform];
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

  const data = useMemo(() => getAnalytics(range), [range]);
  const topPosts = useMemo(() => getTopPosts({ limit: 10 }), []);

  const { totals, perPlatform, timeseries } = data;

  // Reel chosen for the cross-platform compare section.
  const compareReels = useMemo(
    () => [...new Set(topPosts.map((p) => p.reelId))],
    [topPosts]
  );
  const [compareReel, setCompareReel] = useState(null);
  const activeCompareReel = compareReel || compareReels[0];
  const compareRows = useMemo(() => {
    if (!activeCompareReel) return [];
    return getTopPosts({ limit: 100 })
      .filter((p) => p.reelId === activeCompareReel)
      .sort((a, b) => b.views - a.views);
  }, [activeCompareReel]);

  const kpis = [
    { lbl: "Total views", val: fmt(totals.views), delta: totals.deltas.views },
    { lbl: "Engagement", val: fmt(totals.engagement), delta: totals.deltas.engagement },
    { lbl: "Followers", val: fmt(totals.followers), delta: totals.deltas.followers },
    { lbl: "Posts", val: fmt(totals.posts), delta: totals.deltas.posts },
  ];

  return (
    <div className="analytics">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="page-head">
        <div className="titles">
          <h1>Analytics — cross-platform performance</h1>
          <div className="sub">
            Unified views, engagement, followers and top content across Facebook,
            Instagram, YouTube and TikTok. Live where connected; sample data otherwise.
          </div>
          <div className="conn-chips" style={{ marginTop: 12 }}>
            {connections.map((c) => {
              const meta = PLATFORM_BY_KEY[c.platform];
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
                  {isOwner && c.platform !== "facebook" && !c.connected && (
                    <button
                      className="conn-btn"
                      onClick={() => handleConnect(c.platform)}
                      title={"Connect " + meta.label}
                    >
                      Connect
                    </button>
                  )}
                  {isOwner && c.platform !== "facebook" && c.connected && (
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
          {RANGES.map((r) => (
            <DPill key={r} active={r === range} onClick={() => setRange(r)}>
              {r}
            </DPill>
          ))}
        </div>
      </div>

      {/* ── Aggregate KPIs ──────────────────────────────── */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.lbl}>
            <div className="lbl">{k.lbl}</div>
            <div className="val">{k.val}</div>
            <div
              className={
                "delta " +
                (k.delta > 0 ? "up" : k.delta < 0 ? "down" : "dim")
              }
            >
              {fmtDelta(k.delta)} <span style={{ color: "var(--fg-dim)" }}>vs prev {range}</span>
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
                  style={{ borderLeftColor: p.color }}
                >
                  <div className="pt-head">
                    <span className="pt-glyph" style={{ background: p.color }}>
                      {p.glyph}
                    </span>
                    <span className="pt-name">{p.label}</span>
                    {!m.connected && (
                      <span className="pt-tag">not connected · sample</span>
                    )}
                  </div>
                  <div>
                    <div className="pt-big" style={{ color: p.color }}>
                      {fmt(m.views)}
                    </div>
                    <div className="pt-sub">views</div>
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
                      <span className="k">Posts</span>
                      <span className="v">{fmt(m.posts)}</span>
                    </div>
                    <div className="pt-row">
                      <span className="k">Followers</span>
                      <span className="v">{fmt(m.followers)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ── Trend chart ─────────────────────────────────── */}
        <Card
          title="Daily views by platform"
          right={<DPill solid>{range}</DPill>}
          footLeft="Trend view"
        >
          <TrendChart timeseries={timeseries} />
        </Card>

        {/* ── Top content table ───────────────────────────── */}
        <Card
          title="Top content across platforms"
          right={<span className="mono muted">top {topPosts.length} by views</span>}
          footLeft="Content leaderboard"
        >
          <table className="vtable">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Platform</th>
                <th>Reel</th>
                <th className="num" style={{ textAlign: "right" }}>Views</th>
                <th className="num" style={{ textAlign: "right" }}>Likes</th>
                <th className="num" style={{ textAlign: "right" }}>Comments</th>
                <th className="num" style={{ textAlign: "right" }}>Shares</th>
                <th className="num" style={{ textAlign: "right" }}>Eng. rate</th>
              </tr>
            </thead>
            <tbody>
              {topPosts.map((row) => {
                const meta = PLATFORM_BY_KEY[row.platform];
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="plat-badge">
                        <span className="pb-glyph" style={{ background: meta.color }}>
                          {meta.glyph}
                        </span>
                        {meta.label}
                      </span>
                    </td>
                    <td className="reel-cell">
                      <span className="rc-id">{row.reelId}</span>{" "}
                      <span className="rc-title">{row.title}</span>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.views)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.likes)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.comments)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.shares)}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      <span className="pos">{fmtPct(row.engagementRate)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* ── Per-reel cross-platform compare ─────────────── */}
        <Card
          title="Cross-platform compare — one reel, every platform"
          right={
            <div className="compare-chips">
              {compareReels.map((rid) => (
                <DPill
                  key={rid}
                  active={rid === activeCompareReel}
                  onClick={() => setCompareReel(rid)}
                >
                  {rid}
                </DPill>
              ))}
            </div>
          }
          footLeft="Reel comparison"
        >
          <table className="vtable">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Platform</th>
                <th className="num" style={{ textAlign: "right" }}>Views</th>
                <th className="num" style={{ textAlign: "right" }}>Likes</th>
                <th className="num" style={{ textAlign: "right" }}>Comments</th>
                <th className="num" style={{ textAlign: "right" }}>Shares</th>
                <th className="num" style={{ textAlign: "right" }}>Eng. rate</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row, i) => {
                const meta = PLATFORM_BY_KEY[row.platform];
                return (
                  <tr key={row.id} className={i === 0 ? "winner" : ""}>
                    <td>
                      <span className="plat-badge">
                        <span className="pb-glyph" style={{ background: meta.color }}>
                          {meta.glyph}
                        </span>
                        {meta.label}
                      </span>
                      {i === 0 && <span className="winflag" style={{ marginLeft: 8 }}>top</span>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.views)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.likes)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.comments)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{fmt(row.shares)}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      <span className="pos">{fmtPct(row.engagementRate)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {compareRows[0] && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-mute)" }}>
              Best platform for{" "}
              <span style={{ color: "var(--c-cyan)" }}>{activeCompareReel}</span>:{" "}
              <span style={{ color: PLATFORM_BY_KEY[compareRows[0].platform].color }}>
                {PLATFORM_BY_KEY[compareRows[0].platform].label}
              </span>{" "}
              with {fmt(compareRows[0].views)} views.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Trend chart — inline SVG multi-line, one line per platform.
   Modeled on the prior RetentionChart (viewBox, dashed grid,
   mono axis labels). No decorative art. ───────────────────── */
function TrendChart({ timeseries }) {
  const w = 800, h = 220, pad = { l: 40, r: 14, t: 12, b: 24 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const n = timeseries.length;

  // Max across every platform value for a shared y-scale.
  let maxY = 1;
  for (const d of timeseries)
    for (const p of PLATFORMS) maxY = Math.max(maxY, d[p.key] || 0);
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

  const pathFor = (key) =>
    timeseries
      .map((d, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(d[key] || 0).toFixed(1))
      .join(" ");

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
        {/* one line per platform */}
        {PLATFORMS.map((p) => (
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
        {PLATFORMS.map((p) => (
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
