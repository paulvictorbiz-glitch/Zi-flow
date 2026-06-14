/* =========================================================
   SocialStatusCards — at-a-glance connection health for every
   social platform, with a Connect / Reconnect button per card.

   Self-contained: reads live connection state from social-client.js
   (app_settings-backed; tokens stay server-side) and drives the same
   OAuth popup + postMessage flow the Analytics tab uses. Drop it at the
   top of any social page (Inbox, Analytics) to show whether all
   platforms are connected and to re-auth any that aren't.

   Tokens NEVER touch the browser — Connect/Reconnect just opens the
   platform's OAuth flow (proxied through /fb to api.footagebrain.com).
   ========================================================= */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase-client.js";
import {
  PLATFORMS,
  PLATFORM_BY_KEY,
  CONNECT_URLS,
  fetchConnections,
  invalidateConnectionsCache,
  deriveStatus,
} from "../lib/social-client.js";

/* OAuth entry points come from the shared CONNECT_URLS (social-client.js),
   which point directly at api.footagebrain.com so the OAuth CSRF state cookie
   stays same-host through the Google round-trip. */
const CONNECT_PATHS = CONNECT_URLS;

const STATUS_META = {
  connected:    { dot: "●", color: "var(--c-green)",        label: "Connected" },
  expiring:     { dot: "⚠", color: "var(--c-amber)",        label: "Token expiring" },
  error:        { dot: "●", color: "var(--c-red, #f87171)", label: "Error" },
  disconnected: { dot: "○", color: "var(--fg-mute)",        label: "Not connected" },
  initializing: { dot: "○", color: "var(--fg-faint)",       label: "Checking…" },
};

function fmtFollowers(n) {
  if (!n) return null;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function StatusCard({ conn, onConnect, canManage }) {
  const meta = PLATFORM_BY_KEY[conn.platform];
  const status = deriveStatus(conn);
  const sm = STATUS_META[status] || STATUS_META.disconnected;
  const healthy = status === "connected";
  const followers = fmtFollowers(conn.followers);

  return (
    <div
      style={{
        flex: "1 1 160px", minWidth: 160,
        border: "1px dashed " + (healthy ? (meta?.color || "var(--line-hard)") : "var(--line-hard)"),
        borderRadius: 8, padding: "12px 14px",
        background: "var(--bg-1)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--f-mono)", fontSize: 12,
          background: healthy ? (meta?.color || "var(--bg-2)") : "var(--bg-2)",
          color: healthy ? "#0b1220" : (meta?.color || "var(--fg)"),
          border: "1px solid " + (meta?.color || "var(--line-hard)"),
        }}>
          {meta?.glyph || "?"}
        </span>
        <span style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500 }}>{meta?.label || conn.platform}</span>
      </div>

      <div className="mono" style={{ fontSize: 10.5, color: sm.color, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{sm.dot}</span>
        <span>{sm.label}</span>
        {healthy && followers && <span style={{ color: "var(--fg-mute)" }}>· {followers} followers</span>}
      </div>

      {conn.lastError && (
        <div className="mono" style={{ fontSize: 9, lineHeight: 1.4, color: "var(--c-red, #f87171)" }}>
          {conn.lastError}
        </div>
      )}

      {canManage && !healthy && (
        <button
          onClick={() => onConnect(conn.platform)}
          style={{
            marginTop: "auto",
            padding: "5px 10px", fontSize: 10, fontFamily: "var(--f-mono)",
            letterSpacing: "0.06em", textTransform: "uppercase",
            border: "1px solid var(--c-cyan)", borderRadius: 4,
            background: "rgba(96,212,240,0.08)", color: "var(--c-cyan)",
            cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {status === "error" || status === "expiring" ? "Reconnect" : "Connect"}
        </button>
      )}
    </div>
  );
}

function SocialStatusCards({ canManage = true, title = "Platform connections" }) {
  const [conns, setConns] = useState(() => PLATFORMS.map(p => ({ platform: p.key, connected: false, status: "disconnected" })));

  const load = useCallback(() => {
    fetchConnections(supabase).then(rows => {
      if (!rows) return;
      setConns(PLATFORMS.map(p => rows.find(r => r.platform === p.key) || { platform: p.key, connected: false, status: "disconnected" }));
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => {
    invalidateConnectionsCache();
    load();
  }, [load]);

  const handleConnect = useCallback((platform) => {
    const url = CONNECT_PATHS[platform];
    if (!url) return;
    const popup = window.open(url, "_blank", "width=520,height=640");
    const handler = (e) => {
      if (e.data?.type === "oauth_complete" && e.data?.platform === platform) {
        window.removeEventListener("message", handler);
        popup?.close();
        refresh();
      }
    };
    window.addEventListener("message", handler);
  }, [refresh]);

  const connectedCount = conns.filter(c => deriveStatus(c) === "connected").length;
  const total = conns.length;
  const allConnected = connectedCount === total;

  return (
    <div style={{
      border: "1px dashed var(--line-hard)", borderRadius: 8,
      background: "var(--bg-2)", padding: "12px 14px", margin: "0 0 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
        <span className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </span>
        <span className="mono" style={{
          fontSize: 10.5,
          color: allConnected ? "var(--c-green)" : "var(--c-amber)",
        }}>
          {allConnected
            ? "✓ all " + total + " connected"
            : connectedCount + " of " + total + " connected · " + (total - connectedCount) + " need attention"}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {conns.map(c => (
          <StatusCard key={c.platform} conn={c} onConnect={handleConnect} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

export { SocialStatusCards };
