/* =========================================================
   Global floating toast for a new Teams (Rocket.Chat) message.

   Mounted once near the app's CreateFab so it can appear on ANY
   view. Reads the newest message from useTeamChatAlerts(); renders
   nothing when there's none. Auto-dismisses after a few seconds;
   clicking it opens the Team tab.

   Independent of monitor's `.mon-toast` (own class + bottom-left so
   it never collides with the FAB / monitor toast).
   ========================================================= */

import React from "react";
import { useTeamChatAlerts } from "../lib/team-chat-alerts.jsx";
import "./team-chat-toast.css";

const AUTO_DISMISS_MS = 6000;

export function TeamChatToast({ onOpenTeam }) {
  const { latestToast, dismissToast } = useTeamChatAlerts();

  // Re-arm the auto-dismiss timer whenever a new toast appears.
  React.useEffect(() => {
    if (!latestToast) return;
    const id = setTimeout(dismissToast, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [latestToast, dismissToast]);

  if (!latestToast) return null;

  const { room, sender, text } = latestToast;
  const open = () => { onOpenTeam?.(); dismissToast(); };

  return (
    <div className="tc-toast" role="status" aria-live="polite">
      <button className="tc-toast-body" onClick={open} title="Open Team chat">
        <span className="tc-toast-icon" aria-hidden="true">💬</span>
        <span className="tc-toast-text">
          <span className="tc-toast-head">
            New message{room ? ` · #${room}` : ""}
          </span>
          <span className="tc-toast-line">
            {sender ? <b>{sender}: </b> : null}{text || "(no text)"}
          </span>
        </span>
      </button>
      <button
        className="tc-toast-close"
        onClick={dismissToast}
        aria-label="Dismiss"
        title="Dismiss"
      >×</button>
    </div>
  );
}
