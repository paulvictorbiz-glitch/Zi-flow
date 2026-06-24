/* =========================================================
   "Teams messages" card for the My Work tab.

   Shows the most recent Rocket.Chat channel messages (the signed-in
   user's own messages are already excluded server-side), with an
   unseen-count pill, a "Mark all read" action, and a mute toggle for
   the audible ping + floating toast. Clicking a row opens the Team tab.

   All data comes from useTeamChatAlerts(); the card is self-contained
   and renders an empty state when there's nothing (also the state when
   the backend endpoint isn't deployed yet).
   ========================================================= */

import React from "react";
import { useTeamChatAlerts } from "../lib/team-chat-alerts.jsx";

function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

export function TeamChatRecentCard({ onOpenTeam }) {
  const {
    recentMessages, unseenCount, muted, toggleMuted, markAllRead,
    desktopPerm, enableDesktop,
  } = useTeamChatAlerts();

  const rows = (recentMessages || []).slice(0, 8);
  const open = () => onOpenTeam?.();

  return (
    <div style={{
      background: "var(--bg-1, #11151f)",
      border: "1px solid var(--line, #232a38)",
      borderRadius: 10,
      overflow: "hidden",
      fontFamily: "var(--f-mono, ui-monospace, monospace)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 14px", borderBottom: "1px solid var(--line, #232a38)",
      }}>
        <span style={{ fontSize: 14 }} aria-hidden="true">💬</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg, #e7ecf5)" }}>
          Teams messages
        </span>
        {unseenCount > 0 && (
          <span className="needs-badge" style={{ marginLeft: 0 }}>{unseenCount}</span>
        )}
        <span style={{ flex: 1 }} />
        {desktopPerm === "default" && (
          <button
            type="button"
            onClick={enableDesktop}
            title="Show new messages as desktop notifications"
            style={{
              background: "transparent", border: "1px solid var(--line, #232a38)",
              borderRadius: 6, cursor: "pointer", fontSize: 10, padding: "3px 7px",
              color: "var(--c-cyan, #36d6e7)", fontFamily: "var(--f-mono, ui-monospace, monospace)",
            }}
          >🖥 Enable desktop alerts</button>
        )}
        {desktopPerm === "denied" && (
          <span
            title="Blocked in your browser — re-enable notifications for this site in browser settings"
            style={{ fontSize: 10, color: "var(--fg-mute, #8b93a7)" }}
          >desktop alerts blocked</span>
        )}
        <button
          type="button"
          onClick={toggleMuted}
          title={muted ? "Unmute new-message ping" : "Mute new-message ping"}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: 14, padding: "2px 4px", color: "var(--fg-mute, #8b93a7)",
          }}
        >{muted ? "🔕" : "🔔"}</button>
        {unseenCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 11, color: "var(--c-cyan, #36d6e7)", padding: "2px 4px",
              fontFamily: "var(--f-mono, ui-monospace, monospace)",
            }}
          >Mark all read</button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--fg-mute, #8b93a7)" }}>
          No recent Teams messages.
        </div>
      ) : (
        <div>
          {rows.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={open}
              title="Open Team chat"
              style={{
                display: "flex", alignItems: "baseline", gap: 8, width: "100%",
                padding: "9px 14px", background: "transparent", border: "none",
                borderTop: "1px solid var(--line-soft, rgba(255,255,255,0.04))",
                textAlign: "left", cursor: "pointer", color: "inherit",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg, #e7ecf5)", flexShrink: 0, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.sender || "Someone"}
              </span>
              {m.room && (
                <span style={{ fontSize: 10, color: "var(--c-cyan, #36d6e7)", flexShrink: 0 }}>
                  #{m.room}
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--fg-dim, #aeb6c6)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.text || "(no text)"}
              </span>
              <span style={{ fontSize: 10, color: "var(--fg-mute, #8b93a7)", flexShrink: 0 }}>
                {relTime(m.ts)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
